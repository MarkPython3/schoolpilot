#!/usr/bin/env python3
"""
SchoolPilot backend — zero dependencies (Python 3.8+ standard library only).

Multi-tenant: schools, classes, and three kinds of account (admin, teacher,
student).  The database starts almost empty — only a single admin account is
seeded.  The admin builds everything else (schools, classes, teachers,
students, timetable) through the API.

Run:  python3 server.py            # http://localhost:8000
Env:  PORT=8000  DB=schoolpilot.db
"""
import base64
import gzip
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

ROOT = os.path.dirname(os.path.abspath(__file__))

def load_env(path=os.path.join(ROOT, ".env")):
    """Minimal .env reader: KEY=VALUE lines; real environment variables win."""
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

load_env()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_PUBLISHABLE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")  # server-side only, never send or log
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "").strip().lower()
PUBLIC = os.path.join(ROOT, "public")
DB_PATH = os.environ.get("DB", os.path.join(ROOT, "schoolpilot.db"))
PORT = int(os.environ.get("PORT", "8000"))
_lock = threading.Lock()

# --------------------------------------------------------------------------- #
#  Reference data (fixed catalogues the admin picks from)
# --------------------------------------------------------------------------- #
SUBJECTS = {
    "mate":  ("Matematică", "#0D9488", "Mate"),
    "rom":   ("Limba română", "#D9488A", "Rom"),
    "fiz":   ("Fizică", "#2563EB", "Fiz"),
    "chim":  ("Chimie", "#16A34A", "Chim"),
    "bio":   ("Biologie", "#6B8E23", "Bio"),
    "ist":   ("Istorie", "#A1552B", "Ist"),
    "geo":   ("Geografie", "#0E7490", "Geo"),
    "eng":   ("Engleză", "#7C3AED", "Eng"),
    "info":  ("Informatică", "#334155", "Info"),
    "sport": ("Educație fizică", "#E8650E", "Sport"),
    "fra":   ("Limba franceză", "#BE185D", "Fra"),
    "art":   ("Educație plastică", "#DB7706", "Art"),
    "muz":   ("Educație muzicală", "#C026D3", "Muz"),
    "tic":   ("Tehnologia informației și a comunicațiilor (TIC)", "#475569", "TIC"),
    "ger":   ("Limba germană", "#B45309", "Ger"),
    "spa":   ("Limba spaniolă", "#DC2626", "Spa"),
    "ita":   ("Limba italiană", "#059669", "Ita"),
    "lat":   ("Limba latină", "#78716C", "Lat"),
    "lit":   ("Literatură universală", "#E11D74", "Lit U"),
    "rel":   ("Religie", "#854D0E", "Rel"),
    "log":   ("Logică, argumentare și comunicare", "#4F46E5", "Logică"),
    "psih":  ("Psihologie", "#9333EA", "Psih"),
    "soc":   ("Sociologie", "#0284C7", "Soc"),
    "econ":  ("Economie", "#15803D", "Econ"),
    "edant": ("Educație antreprenorială", "#CA8A04", "Antrep"),
    "fil":   ("Filosofie", "#6D28D9", "Fil"),
    "edsoc": ("Educație socială", "#0F766E", "Ed Soc"),
    "tehn":  ("Educație tehnologică", "#57534E", "Tehn"),
    "dir":   ("Consiliere și orientare (Dirigenție)", "#0891B2", "Dirig"),
    "opt":   ("Opțional (CDEOȘ)", "#64748B", "Opț"),
}
PERIODS = ["%02d:00" % h for h in range(8, 22)]  # one slot per entry; a day holds at most this many
LESSON_MINUTES = 50
# OMEC 3194/2026. Modules 3 and 4 vary by county; this is the earliest variant, and the admin can change any date.
DEFAULT_MODULES = [(1, "2026-09-07", "2026-10-23"), (2, "2026-11-02", "2026-12-22"), (3, "2027-01-11", "2027-02-12"),
                   (4, "2027-02-22", "2027-04-23"), (5, "2027-05-05", "2027-06-18")]
PRIORITIES = ("urgent", "normal", "info")
EVENT_KINDS = {"club": "Club", "olimpiada": "Olimpiadă", "concurs": "Concurs", "termen": "Termen", "altul": "Eveniment"}
QUIET_START, QUIET_END = 20, 7  # messages to teachers wait until the morning
EVENING_HOUR = 15  # from this hour the student's Azi page also shows the next school day
RISK_AVERAGE = 6
MUST_CHANGE_MSG = "Trebuie să îți setezi o parolă nouă."

def below_risk(avg):
    """Risk zone: the average ROUNDS below 6 (x.50 rounds up), so 5.50 is not at risk."""
    return avg is not None and avg < RISK_AVERAGE - 0.5
TYPE_W = {"test": 3, "quiz": 2, "tema": 1}
TYPE_LABEL = {"test": "Lucrare", "quiz": "Ascultare", "tema": "Temă"}
DAYNAMES = ["Lun", "Mar", "Mie", "Joi", "Vin", "Sâm", "Dum"]
FULLDAYS = ["Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"]
MONTHS = ["", "ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "nov", "dec"]
PACK_RULES = {"sport": "Echipament sport", "chim": "Halat de laborator",
              "fiz": "Caiet de laborator", "info": "Laptop / cont", "tic": "Laptop / cont",
              "art": "Trusă de desen"}

def today():
    return date.today()

def week_monday(d=None):
    """Monday of the school week: on Saturday and Sunday that is the coming Monday."""
    d = d or today()
    if d.weekday() > 4:
        return d + timedelta(days=7 - d.weekday())
    return d - timedelta(days=d.weekday())

def iso(d):
    return d.isoformat()

def parse_iso(s):
    return date.fromisoformat(s)

def day_label(d):
    return "%s %d" % (DAYNAMES[d.weekday()], d.day)

# --------------------------------------------------------------------------- #
#  The page: precompiled when public/build matches the source, else compiled in the browser
# --------------------------------------------------------------------------- #
CTYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".jsx": "text/javascript",
          ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json",
          ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4"}
COMPRESSIBLE = {"text/html", "text/javascript", "text/css", "image/svg+xml", "application/json"}
APP_SOURCES = ("app.jsx", "tailwind.config.js")  # build.mjs hashes the same files, in this order
VENDOR = ["react.production.min.js", "react-dom.production.min.js", "framer-motion.js", "supabase.js"]
_gz = {}

def gzipped(data):
    key = hashlib.sha1(data).digest()
    if key not in _gz:
        if len(_gz) > 64:
            _gz.clear()
        _gz[key] = gzip.compress(data, 6)
    return _gz[key]

def source_hash():
    h = hashlib.sha256()
    for name in APP_SOURCES:
        with open(os.path.join(PUBLIC, name), "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:16]

def built_hash():
    try:
        with open(os.path.join(PUBLIC, "build", "stamp.json")) as f:
            return json.load(f).get("source")
    except (OSError, ValueError):
        return None

def page_html():
    with open(os.path.join(PUBLIC, "index.html"), encoding="utf-8") as f:
        html = f.read()
    src = source_hash()
    if os.environ.get("DEV") != "1" and built_hash() == src:
        head = ['<link rel="preload" as="image" href="/media/hero/f000.webp" fetchpriority="high" />']
        head += ['<script defer src="/vendor/%s"></script>' % v for v in VENDOR]
        head += ['<script defer src="/build/app.js?v=%s"></script>' % src]
        body = []
        # after the inline <style>, where Tailwind Play used to inject its CSS, so the cascade is unchanged
        html = html.replace("</head>", '<link rel="stylesheet" href="/build/app.css?v=%s" />\n</head>' % src, 1)
    else:  # source changed since the last `node build.mjs`: compile in the browser, as before
        head = ['<script src="/vendor/tailwindcss.js"></script>', '<script src="/tailwind.config.js?v=%s"></script>' % src]
        head += ['<script src="/vendor/%s"></script>' % v for v in VENDOR + ["babel.min.js"]]
        body = ['<script type="text/babel" data-presets="react" src="/app.jsx?v=%s"></script>' % src]
    return html.replace("<!--APP-HEAD-->", "\n".join(head)).replace("<!--APP-BODY-->", "\n".join(body)).encode("utf-8")

# --------------------------------------------------------------------------- #
#  Database
# --------------------------------------------------------------------------- #
def connect():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    return con

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL, name TEXT NOT NULL,
  homeroom_teacher_id INTEGER
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, name TEXT NOT NULL,
  school_id INTEGER, class_id INTEGER, subjects TEXT NOT NULL DEFAULT '[]',
  email TEXT, auth_id TEXT
);
CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY AUTOINCREMENT, class_id INTEGER NOT NULL,
  day INTEGER NOT NULL, period INTEGER NOT NULL,
  subject TEXT NOT NULL, teacher_id INTEGER, room TEXT, time TEXT, end_time TEXT
);
CREATE TABLE IF NOT EXISTS school_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL,
  kind TEXT NOT NULL, note TEXT, author_id INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER NOT NULL, recipient_id INTEGER NOT NULL, body TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0, reply_to INTEGER, created_at TEXT NOT NULL, visible_at TEXT NOT NULL, read_at TEXT
);
CREATE TABLE IF NOT EXISTS lesson_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, timetable_id INTEGER NOT NULL, class_id INTEGER NOT NULL, date TEXT NOT NULL,
  kind TEXT NOT NULL, teacher_id INTEGER, room TEXT, note TEXT, author_id INTEGER, created_at TEXT NOT NULL,
  UNIQUE (timetable_id, date)
);
CREATE TABLE IF NOT EXISTS subject_goals (
  student_id INTEGER NOT NULL, subject TEXT NOT NULL, target INTEGER NOT NULL, PRIMARY KEY (student_id, subject)
);
CREATE TABLE IF NOT EXISTS school_modules (
  school_id INTEGER NOT NULL, number INTEGER NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
  PRIMARY KEY (school_id, number)
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL, class_id INTEGER, subject TEXT,
  author_id INTEGER, title TEXT NOT NULL, body TEXT, priority TEXT NOT NULL DEFAULT 'normal', created_at TEXT NOT NULL, link TEXT
);
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id INTEGER NOT NULL, student_id INTEGER NOT NULL, read_at TEXT NOT NULL,
  PRIMARY KEY (announcement_id, student_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT, ref TEXT, created_at TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, class_id INTEGER NOT NULL,
  subject TEXT NOT NULL, type TEXT NOT NULL, date TEXT NOT NULL,
  title TEXT NOT NULL, teacher_id INTEGER
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  subject TEXT NOT NULL, value INTEGER NOT NULL, date TEXT NOT NULL,
  teacher_id INTEGER, note TEXT
);
CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  subject TEXT NOT NULL, kind TEXT NOT NULL, date TEXT NOT NULL,
  teacher_id INTEGER
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  title TEXT NOT NULL, subject TEXT, type TEXT NOT NULL DEFAULT 'tema',
  due TEXT, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
"""

ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ADDED_COLUMNS = [  # columns newer than the first databases
    ("users", "email", "TEXT"), ("users", "auth_id", "TEXT"),
    ("classes", "homeroom_teacher_id", "INTEGER"),
    ("grades", "teacher_id", "INTEGER"), ("grades", "note", "TEXT"),
    ("absences", "teacher_id", "INTEGER"),
    ("timetable", "time", "TEXT"), ("timetable", "end_time", "TEXT"), ("announcements", "link", "TEXT"),
]

def old_grade_date_to_iso(text, ref):
    """'3 nov' (the old stored format) → ISO. The year wasn't stored, so take the
    latest such date that isn't in the future. None if it can't be parsed."""
    m = re.match(r"^(\d{1,2}) (\w+)$", (text or "").strip())
    if not m or m.group(2) not in MONTHS[1:]:
        return None
    month = MONTHS.index(m.group(2))
    try:
        d = date(ref.year, month, int(m.group(1)))
        return iso(d if d <= ref else date(ref.year - 1, month, int(m.group(1))))
    except ValueError:
        return None

def migrate(con):
    """Bring an older database up to date; safe to run on every start."""
    missing = [(t, c, kind) for t, c, kind in ADDED_COLUMNS
               if c not in [r["name"] for r in con.execute("PRAGMA table_info(%s)" % t).fetchall()]]
    old_dates = [r for r in con.execute("SELECT id, date FROM grades").fetchall() if not ISO_RE.match(r["date"])]
    if not missing and not old_dates:
        return
    backup_path = DB_PATH + ".pre-migration.db"  # first migration only; *.db is git-ignored
    if not os.path.exists(backup_path):
        backup = sqlite3.connect(backup_path)
        con.backup(backup)
        backup.close()
    for t, c, kind in missing:
        con.execute("ALTER TABLE %s ADD COLUMN %s %s" % (t, c, kind))
    for r in old_dates:
        new = old_grade_date_to_iso(r["date"], today())
        if new:
            con.execute("UPDATE grades SET date=? WHERE id=?", (new, r["id"]))
        else:
            print("Grade %d keeps its unreadable date: %r" % (r["id"], r["date"]))

def init_db():
    con = connect()
    con.executescript(SCHEMA)
    migrate(con)
    con.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email)")
    if not con.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
        con.execute("INSERT INTO users(role,name) VALUES('admin','Administrator')")
    if ADMIN_EMAIL:
        con.execute("UPDATE users SET email=? WHERE role='admin'", (ADMIN_EMAIL,))
    con.commit()
    con.close()

# --------------------------------------------------------------------------- #
#  Auth (Supabase Auth over plain urllib)
# --------------------------------------------------------------------------- #
class HttpError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code, self.msg = code, msg

def supabase(method, path, body=None, bearer=None):
    """Call Supabase Auth. With `bearer` it acts as that user (publishable key);
    without, it is an Admin API call authorised by the secret key alone (the
    gateway turns the `apikey` header into the Authorization it needs)."""
    headers = {"Content-Type": "application/json"}
    if bearer:
        headers["apikey"] = SUPABASE_PUBLISHABLE_KEY
        headers["Authorization"] = "Bearer " + bearer
    else:
        headers["apikey"] = SUPABASE_SECRET_KEY
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(SUPABASE_URL + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}
    except (urllib.error.URLError, OSError):
        raise HttpError(503, "Serviciul de autentificare nu răspunde. Încearcă din nou.")

TOKEN_TTL = 180  # seconds a validated access token is trusted without asking Supabase again
_token_cache = {}  # token -> (expires_at, {"auth_id", "email", "must_change"})
_token_lock = threading.Lock()

def _jwt_exp(token):
    try:
        part = token.split(".")[1]
        return float(json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))["exp"])
    except Exception:
        return 0.0

def token_identity(token):
    now = time.time()
    with _token_lock:
        hit = _token_cache.get(token)
    if hit and hit[0] > now:
        return hit[1]
    status, u = supabase("GET", "/auth/v1/user", bearer=token)
    if status != 200 or not u.get("email"):
        raise HttpError(401, "Sesiunea a expirat. Intră din nou în cont.")
    info = {"auth_id": u["id"], "email": u["email"].lower(),
            "must_change": bool((u.get("user_metadata") or {}).get("must_change_password"))}
    with _token_lock:
        if len(_token_cache) > 1000:
            for k in [k for k, v in _token_cache.items() if v[0] <= now]:
                del _token_cache[k]
        _token_cache[token] = (min(now + TOKEN_TTL, _jwt_exp(token) or now + TOKEN_TTL), info)
    return info

def forget_email(email):
    """Drop cached tokens for an account (after a reset or delete)."""
    with _token_lock:
        for k in [k for k, v in _token_cache.items() if v[1]["email"] == email]:
            del _token_cache[k]

# ---- demo pass: a QR code at a stand logs phones in as one demo student, without Supabase ----
# Off unless DEMO_STUDENT_ID is set (demo.sh sets it). The pass is signed with a key derived from
# the server's secret, lasts DEMO_TTL, and stops working as soon as demo mode is switched off.
DEMO_TTL = 12 * 3600
PUBLIC_URL_FILE = os.environ.get("PUBLIC_URL_FILE", "/tmp/schoolpilot-public-url")

def demo_student_id():
    try:
        return int(os.environ.get("DEMO_STUDENT_ID") or 0) or None
    except ValueError:
        return None

def _demo_key():
    return hmac.new((SUPABASE_SECRET_KEY or "schoolpilot").encode(), b"schoolpilot-demo-pass", hashlib.sha256).digest()

def demo_pass(uid):
    body = base64.urlsafe_b64encode(json.dumps({"u": uid, "exp": int(time.time()) + DEMO_TTL}).encode()).decode().rstrip("=")
    sig = hmac.new(_demo_key(), body.encode(), hashlib.sha256).hexdigest()
    return "demo.%s.%s" % (body, sig)

def demo_identity(token):
    """The demo student's id for a valid pass, else None."""
    try:
        _, body, sig = token.split(".")
        if not hmac.compare_digest(sig, hmac.new(_demo_key(), body.encode(), hashlib.sha256).hexdigest()):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except (ValueError, TypeError):
        return None
    if data.get("exp", 0) < time.time() or data.get("u") != demo_student_id():
        return None
    return data["u"]

def public_url():
    try:
        with open(PUBLIC_URL_FILE) as f:
            url = f.read().strip()
        return url if url.startswith("https://") else None
    except OSError:
        return os.environ.get("PUBLIC_URL") or None

_PW_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

def temp_password():
    while True:
        pw = "-".join("".join(secrets.choice(_PW_CHARS) for _ in range(4)) for _ in range(3))
        if re.search(r"[a-z]", pw) and re.search(r"[A-Z]", pw) and re.search(r"\d", pw):
            return pw

def _sb_error(status, payload, what):
    if payload.get("error_code") == "email_exists" or status == 422 and "already" in json.dumps(payload):
        return HttpError(400, "Există deja un cont cu acest email.")
    return HttpError(502, "%s (Supabase %d: %s)" % (what, status, payload.get("msg") or payload.get("message") or "eroare"))

def create_auth_user(email, name):
    pw = temp_password()
    status, u = supabase("POST", "/auth/v1/admin/users", {
        "email": email, "password": pw, "email_confirm": True,
        "user_metadata": {"name": name, "must_change_password": True}})
    if status not in (200, 201) or not u.get("id"):
        raise _sb_error(status, u, "Nu am putut crea contul")
    return u["id"], pw

def reset_auth_password(auth_id):
    pw = temp_password()
    status, u = supabase("PUT", "/auth/v1/admin/users/%s" % auth_id, {
        "password": pw, "user_metadata": {"must_change_password": True}})
    if status != 200:
        raise _sb_error(status, u, "Nu am putut reseta parola")
    return pw

def delete_auth_user(auth_id):
    if not auth_id:
        return
    status, u = supabase("DELETE", "/auth/v1/admin/users/%s" % auth_id)
    if status not in (200, 204, 404):
        raise _sb_error(status, u, "Nu am putut șterge contul")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

def add_account(con, role, name, email, school_id, class_id=None, subjects=None):
    """Create the Supabase user first, then the local row; undo Supabase if the insert fails."""
    name, email = (name or "").strip(), (email or "").strip().lower()
    if not name:
        raise HttpError(400, "Numele este obligatoriu.")
    if not EMAIL_RE.match(email):
        raise HttpError(400, "Emailul nu este valid.")
    if con.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        raise HttpError(400, "Există deja un cont cu acest email.")
    auth_id, pw = create_auth_user(email, name)
    try:
        cur = con.execute("INSERT INTO users(role,name,school_id,class_id,subjects,email,auth_id) VALUES(?,?,?,?,?,?,?)",
                          (role, name, school_id, class_id, json.dumps(subjects or []), email, auth_id))
    except Exception:
        delete_auth_user(auth_id)
        raise
    return {"id": cur.lastrowid, "email": email, "tempPassword": pw}

def remove_users(con, rows):
    """Delete users (never the admin) in Supabase and locally, with their own data."""
    for r in rows:
        if r["role"] == "admin":
            raise HttpError(400, "Contul de administrator nu poate fi șters.")
    for r in rows:
        delete_auth_user(r["auth_id"])
        if r["email"]:
            forget_email(r["email"])
        uid = r["id"]
        for t in ("grades", "absences", "tasks", "notifications", "announcement_reads", "subject_goals"):
            con.execute("DELETE FROM %s WHERE student_id=?" % t, (uid,))
        con.execute("UPDATE announcements SET author_id=NULL WHERE author_id=?", (uid,))
        con.execute("UPDATE school_events SET author_id=NULL WHERE author_id=?", (uid,))
        con.execute("DELETE FROM messages WHERE sender_id=? OR recipient_id=?", (uid, uid))
        for c in con.execute("SELECT id FROM lesson_changes WHERE author_id=?", (uid,)).fetchall():  # nobody else could ever remove them
            drop_notifications(con, "change:%d" % c["id"])
            con.execute("DELETE FROM lesson_changes WHERE id=?", (c["id"],))
        for t in ("timetable", "assessments", "grades", "absences", "lesson_changes"):
            con.execute("UPDATE %s SET teacher_id=NULL WHERE teacher_id=?" % t, (uid,))
        con.execute("UPDATE classes SET homeroom_teacher_id=NULL WHERE homeroom_teacher_id=?", (uid,))
        con.execute("DELETE FROM users WHERE id=?", (uid,))

def date_text(value):
    try:
        d = parse_iso(value)
        return "%d %s" % (d.day, MONTHS[d.month])
    except (TypeError, ValueError):
        return value or ""

def notify(con, student_id, kind, title, body="", ref=None):
    con.execute("INSERT INTO notifications(student_id,kind,title,body,ref,created_at) VALUES(?,?,?,?,?,?)",
                (student_id, kind, title, body, ref, datetime.now().isoformat(timespec="seconds")))

def drop_notifications(con, *refs):
    """The grade, absence or assessment behind them was deleted."""
    con.executemany("DELETE FROM notifications WHERE ref=?", [(r,) for r in refs])

def notify_class_assessment(con, assessment_id, class_id, subject, kind, day, title):
    what = TYPE_LABEL.get(kind, "Evaluare")
    text = "%s nouă la %s" % (what, subj_name(subject)) + ("" if title == what else ": %s" % title)
    for s in con.execute("SELECT id FROM users WHERE role='student' AND class_id=?", (class_id,)).fetchall():
        notify(con, s["id"], "assessment", text, "Pe %s" % date_text(day), "assessment:%d" % assessment_id)

def next_school_day(d):
    d = d + timedelta(days=1)
    while d.weekday() > 4:
        d += timedelta(days=1)
    return d

def add_due_reminders(con, uid, class_id):
    """One reminder per test or assignment, the first time we see it is due today or tomorrow.
    Skipped when the pupil was told about it today, so a late one doesn't arrive twice."""
    t = today()
    for a in con.execute("SELECT * FROM assessments WHERE class_id=? AND date>=? AND date<=?",
                         (class_id, iso(t), iso(next_school_day(t)))).fetchall():
        ref = "reminder:%d" % a["id"]
        if con.execute("""SELECT 1 FROM notifications WHERE student_id=?
                          AND (ref=? OR (ref=? AND created_at>=?))""",
                       (uid, ref, "assessment:%d" % a["id"], iso(t))).fetchone():
            continue
        when = "azi" if a["date"] == iso(t) else ("mâine" if a["date"] == iso(t + timedelta(days=1)) else "luni")
        what = TYPE_LABEL.get(a["type"], "Evaluare")
        notify(con, uid, "reminder", "%s %s" % (what, when) + ("" if a["title"] == what else ": %s" % a["title"]),
               subj_name(a["subject"]), ref)

def build_events(con, me, school_id=None):
    sid = school_id if me["role"] == "admin" else me["school_id"]
    rows = con.execute("SELECT * FROM school_events WHERE school_id=? AND date>=? ORDER BY date, id", (sid, iso(today()))).fetchall()
    return {"kinds": EVENT_KINDS, "items": [{"id": r["id"], "title": r["title"], "date": r["date"], "kind": r["kind"], "kindLabel": EVENT_KINDS.get(r["kind"], "Eveniment"),
                                             "note": r["note"] or "", "canDelete": me["role"] == "admin" or r["author_id"] == me["id"]} for r in rows]}

def post_event(con, me, body, now):
    need(me, "teacher", "admin")
    title = (body.get("title") or "").strip()[:120]
    kind = body.get("kind") if body.get("kind") in EVENT_KINDS else "altul"
    school_id = int(body["schoolId"]) if me["role"] == "admin" else me["school_id"]
    if not title:
        raise HttpError(400, "Scrie un titlu.")
    try:
        day = iso(parse_iso(body.get("date")))
    except (TypeError, ValueError):
        raise HttpError(400, "Data nu este validă.")
    if day < iso(today()):
        raise HttpError(400, "Alege o dată viitoare.")
    note = (body.get("note") or "").strip()[:300]
    cur = con.execute("INSERT INTO school_events(school_id,title,date,kind,note,author_id,created_at) VALUES(?,?,?,?,?,?,?)",
                      (school_id, title, day, kind, note, me["id"], now))
    for sid in audience(con, school_id, None):
        notify(con, sid, "event", "%s: %s" % (EVENT_KINDS[kind], title), "Pe %s" % date_text(day), "event:%d" % cur.lastrowid)
    return {"id": cur.lastrowid}

def ics_text(value):
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")

def build_calendar(con, me):
    """iCalendar file text: the student's upcoming tests, assignments and school events."""
    entries = []
    if me["class_id"]:
        for a in con.execute("SELECT * FROM assessments WHERE class_id=? AND date>=?", (me["class_id"], iso(today()))).fetchall():
            entries.append(("a%d" % a["id"], a["date"], "%s: %s (%s)" % (TYPE_LABEL.get(a["type"], "Evaluare"), a["title"], subj_name(a["subject"]))))
    for e in con.execute("SELECT * FROM school_events WHERE school_id=? AND date>=?", (me["school_id"], iso(today()))).fetchall():
        entries.append(("e%d" % e["id"], e["date"], e["title"]))
    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SchoolPilot//RO"]
    for uid, day, title in sorted(entries, key=lambda x: x[1]):
        start = parse_iso(day)
        lines += ["BEGIN:VEVENT", "UID:%s@schoolpilot" % uid, "DTSTAMP:%s" % stamp, "DTSTART;VALUE=DATE:%s" % start.strftime("%Y%m%d"),
                  "DTEND;VALUE=DATE:%s" % (start + timedelta(days=1)).strftime("%Y%m%d"), "SUMMARY:%s" % ics_text(title), "END:VEVENT"]
    return {"ics": "\r\n".join(lines + ["END:VCALENDAR"]) + "\r\n", "count": len(entries)}

def class_insights(con, class_id):
    """School-wide picture for the admin: where a class is overloaded or struggling."""
    wl = class_workload(con, class_id)
    days = [d for wk in wl["weeks"] for d in wk["days"]]
    busiest = max(days, key=lambda d: d["score"])
    grades = con.execute("""SELECT g.student_id, g.subject, AVG(g.value) a FROM grades g JOIN users u ON u.id=g.student_id
                            WHERE u.class_id=? GROUP BY g.student_id, g.subject""", (class_id,)).fetchall()
    unexcused = con.execute("""SELECT COUNT(*) n FROM absences a JOIN users u ON u.id=a.student_id
                               WHERE u.class_id=? AND a.kind='unexcused'""", (class_id,)).fetchone()["n"]
    return {"clashes": len(wl["collisions"]), "busiest": busiest["dateLabel"] if busiest["score"] else None,
            "average": round(sum(g["a"] for g in grades) / len(grades), 2) if grades else None,
            "atRisk": sum(1 for g in grades if below_risk(g["a"])), "unexcused": unexcused}

def message_contacts(con, me):
    """Students talk only to the teachers of their class; never to each other."""
    if me["role"] == "student":
        if not me["class_id"]:
            return []
        rows = con.execute("""SELECT DISTINCT u.id, u.name FROM users u WHERE u.role='teacher' AND (
                                u.id IN (SELECT teacher_id FROM timetable WHERE class_id=?)
                                OR u.id=(SELECT homeroom_teacher_id FROM classes WHERE id=?)) ORDER BY u.name""", (me["class_id"], me["class_id"])).fetchall()
        out = []
        for r in rows:
            subjects = teacher_subjects(con, r["id"], me["class_id"])
            out.append({"id": r["id"], "name": r["name"], "detail": ", ".join(subj_short(c) for c in subjects), "subjects": subjects})
        return out
    if me["role"] == "teacher":
        ids = announcement_class_ids(con, me["id"])
        rows = con.execute("SELECT id,name,class_id FROM users WHERE role='student' AND class_id IN (%s) ORDER BY name" % (",".join("?" * len(ids)) or "NULL"), ids).fetchall()
        return [{"id": r["id"], "name": r["name"], "detail": class_name(con, r["class_id"])} for r in rows]
    return []

def delivery_time(moment):
    """Quiet hours: a message sent to a teacher late at night appears at 07:00."""
    if moment.hour >= QUIET_START:
        return (moment + timedelta(days=1)).replace(hour=QUIET_END, minute=0, second=0, microsecond=0)
    if moment.hour < QUIET_END:
        return moment.replace(hour=QUIET_END, minute=0, second=0, microsecond=0)
    return moment

def unread_messages(con, uid):
    return con.execute("SELECT COUNT(*) n FROM messages WHERE recipient_id=? AND read_at IS NULL AND visible_at<=?",
                       (uid, datetime.now().isoformat(timespec="seconds"))).fetchone()["n"]

def message_row(r, uid):
    return {"id": r["id"], "mine": r["sender_id"] == uid, "body": r["body"], "at": r["created_at"], "anonymous": bool(r["anonymous"]),
            "pending": r["sender_id"] == uid and r["visible_at"] > datetime.now().isoformat(timespec="seconds")}

def build_threads(con, me):
    uid, now, threads = me["id"], datetime.now().isoformat(timespec="seconds"), {}
    rows = con.execute("SELECT * FROM messages WHERE (sender_id=? OR (recipient_id=? AND visible_at<=?)) ORDER BY id", (uid, uid, now)).fetchall()
    for r in rows:
        if r["anonymous"]:  # its own thread; on the teacher's side never tied to the student's name
            root = r["reply_to"] or r["id"]
            if me["role"] == "teacher":
                key, name, other = "anon:%d" % root, "Întrebare anonimă", None
            else:
                teacher = r["recipient_id"] if r["sender_id"] == uid else r["sender_id"]
                key, name, other = "anon:%d" % root, "Întrebare anonimă · %s" % ((user_row(con, teacher) or {"name": "Cont șters"})["name"]), None
        else:
            other = r["recipient_id"] if r["sender_id"] == uid else r["sender_id"]
            key, name = "user:%d" % other, (user_row(con, other) or {"name": "Cont șters"})["name"]
        t = threads.setdefault(key, {"key": key, "name": name, "anonymous": other is None, "unread": 0})
        t.update({"last": r["body"][:80], "at": r["created_at"], "lastId": r["id"]})
        if r["recipient_id"] == uid and not r["read_at"]:
            t["unread"] += 1
    return {"contacts": message_contacts(con, me), "threads": sorted(threads.values(), key=lambda t: -t["lastId"]), "quietHours": [QUIET_START, QUIET_END]}

def thread_rows(con, me, key):
    uid, now = me["id"], datetime.now().isoformat(timespec="seconds")
    if key.startswith("anon:"):
        root = int(key[5:])
        return con.execute("""SELECT * FROM messages WHERE anonymous=1 AND (id=? OR reply_to=?) AND (sender_id=? OR recipient_id=?)
                              AND (sender_id=? OR visible_at<=?) ORDER BY id""", (root, root, uid, uid, uid, now)).fetchall()
    other = int(key[5:])
    return con.execute("""SELECT * FROM messages WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=? AND visible_at<=?))
                          AND anonymous=0 ORDER BY id""", (uid, other, other, uid, now)).fetchall()

def send_message(con, me, body):
    need(me, "student", "teacher")
    text = (body.get("body") or "").strip()
    if not text or len(text) > 1000:
        raise HttpError(400, "Mesajul are între 1 și 1000 de caractere.")
    moment, anonymous, reply_to = datetime.now(), 0, None
    key = body.get("thread") or ""
    if key.startswith("anon:"):  # inside an anonymous exchange: the teacher answers, the student follows up
        q = con.execute("SELECT * FROM messages WHERE id=? AND anonymous=1 AND (recipient_id=? OR sender_id=?)",
                        (int(key[5:]), me["id"], me["id"])).fetchone()
        if not q or (me["role"] == "teacher") != (q["recipient_id"] == me["id"]):
            raise HttpError(404, "not found")
        to = q["sender_id"] if me["role"] == "teacher" else q["recipient_id"]
        anonymous, reply_to = 1, q["id"]
    else:
        to = int(key[5:]) if key.startswith("user:") else int(body["to"])
        if to not in [c["id"] for c in message_contacts(con, me)]:
            raise HttpError(403, "Nu poți scrie acestei persoane.")
        anonymous = 1 if body.get("anonymous") and me["role"] == "student" else 0
    visible = delivery_time(moment) if me["role"] == "student" else moment
    cur = con.execute("INSERT INTO messages(sender_id,recipient_id,body,anonymous,reply_to,created_at,visible_at) VALUES(?,?,?,?,?,?,?)",
                      (me["id"], to, text, anonymous, reply_to, moment.isoformat(timespec="seconds"), visible.isoformat(timespec="seconds")))
    if me["role"] == "teacher":
        notify(con, to, "message", "Mesaj de la %s" % me["name"], text[:80], "message:%d" % cur.lastrowid)
    if anonymous and not key.startswith("anon:"):  # a new anonymous question starts its own thread
        key = "anon:%d" % cur.lastrowid
    return {"id": cur.lastrowid, "delayed": visible > moment, "thread": key or "user:%d" % to}

def change_label(r, con):
    if r["kind"] == "cancelled":
        return "Oră anulată"
    if r["kind"] == "room":
        room = r["room"] or ""
        if re.match(r"(?i)(sala|sală|lab|laborator|atelier|cabinet|amfiteatru)\b", room):  # "Sala 21", "Lab F"
            return "Mutată în %s" % room
        return "Mutată în sala %s" % room  # "A24"
    return "Suplinire: %s" % (teacher_name(con, r["teacher_id"]) or "profesor șters")

def change_row(con, r):
    slot = con.execute("SELECT * FROM timetable WHERE id=?", (r["timetable_id"],)).fetchone()
    return {"id": r["id"], "timetableId": r["timetable_id"], "date": r["date"], "kind": r["kind"], "label": change_label(r, con), "note": r["note"] or "",
            "room": r["room"] or "", "substitute": (teacher_name(con, r["teacher_id"]) or "profesor șters") if r["kind"] == "substitute" else "",
            "subjectName": subj_name(slot["subject"]) if slot else "", "className": class_name(con, r["class_id"]),
            "time": slot_time(slot) if slot else ""}

def class_changes(con, class_id):
    rows = con.execute("SELECT * FROM lesson_changes WHERE class_id=? AND date>=? ORDER BY date", (class_id, iso(today()))).fetchall()
    return [change_row(con, r) for r in rows]

def save_lesson_change(con, me, body, now):
    need(me, "teacher")
    slot = con.execute("SELECT * FROM timetable WHERE id=?", (int(body["timetableId"]),)).fetchone()
    if not slot or slot["teacher_id"] != me["id"]:
        raise HttpError(403, "Poți schimba doar orele tale.")
    try:
        day = parse_iso(body.get("date"))
    except (TypeError, ValueError):
        raise HttpError(400, "Data nu este validă.")
    if day < today() or day.weekday() != slot["day"]:
        raise HttpError(400, "Alege o dată viitoare, în ziua acestei ore.")
    if not module_of(school_modules(con, me["school_id"]), iso(day)):
        raise HttpError(400, "În ziua aleasă e vacanță, nu sunt ore.")
    kind, room, substitute = body.get("kind"), (body.get("room") or "").strip()[:40], None
    if kind == "room" and not room:
        raise HttpError(400, "Scrie sala nouă.")
    if kind == "substitute":
        t = user_row(con, int(body.get("teacherId") or 0))
        if not t or t["role"] != "teacher" or t["school_id"] != me["school_id"]:
            raise HttpError(400, "Alege profesorul suplinitor.")
        substitute = t["id"]
    if kind not in ("cancelled", "room", "substitute"):
        raise HttpError(400, "Alege tipul schimbării.")
    old = con.execute("SELECT id FROM lesson_changes WHERE timetable_id=? AND date=?", (slot["id"], iso(day))).fetchone()
    if old:
        drop_notifications(con, "change:%d" % old["id"])
        con.execute("DELETE FROM lesson_changes WHERE id=?", (old["id"],))
    note = (body.get("note") or "").strip()[:200]
    cur = con.execute("INSERT INTO lesson_changes(timetable_id,class_id,date,kind,teacher_id,room,note,author_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                      (slot["id"], slot["class_id"], iso(day), kind, substitute, room, note, me["id"], now))
    r = con.execute("SELECT * FROM lesson_changes WHERE id=?", (cur.lastrowid,)).fetchone()
    text = " · ".join(x for x in ("%s, %s" % (date_text(iso(day)), slot_time(slot)), note) if x)
    for sid in audience(con, me["school_id"], slot["class_id"]):
        notify(con, sid, "change", "%s: %s" % (subj_name(slot["subject"]), change_label(r, con)), text, "change:%d" % r["id"])
    return {"id": r["id"]}

def school_modules(con, school_id):
    rows = con.execute("SELECT * FROM school_modules WHERE school_id=? ORDER BY number", (school_id,)).fetchall()
    return [{"number": r["number"], "start": r["start"], "end": r["end"]} for r in rows] or \
        [{"number": n, "start": a, "end": b} for n, a, b in DEFAULT_MODULES]

def module_of(modules, day):
    """Number of the module a date falls in, or None for a holiday."""
    for m in modules:
        if m["start"] <= day <= m["end"]:
            return m["number"]
    return None

def module_status(modules, day):
    number = module_of(modules, day)
    if number:
        return {"number": number, "label": "Modulul %d" % number, "holiday": False}
    following = [m for m in modules if m["start"] > day]
    return {"number": None, "label": "Vacanță", "holiday": True,
            "resumes": date_text(following[0]["start"]) if following else None}

def save_modules(con, school_id, modules):
    rows = []
    for number, m in enumerate(modules, 1):
        try:
            start, end = iso(parse_iso(m["start"])), iso(parse_iso(m["end"]))
        except (KeyError, TypeError, ValueError):
            raise HttpError(400, "Modulul %d are o dată greșită." % number)
        if end < start:
            raise HttpError(400, "Modulul %d se termină înainte să înceapă." % number)
        if rows and start <= rows[-1][2]:
            raise HttpError(400, "Modulul %d începe înainte să se termine modulul %d." % (number, number - 1))
        rows.append((number, start, end))
    if len(rows) != 5:
        raise HttpError(400, "Anul școlar are 5 module.")
    con.execute("DELETE FROM school_modules WHERE school_id=?", (school_id,))
    con.executemany("INSERT INTO school_modules(school_id,number,start,end) VALUES(?,?,?,?)",
                    [(school_id, n, a, b) for n, a, b in rows])

def annual_average(values):
    """Whole-number annual average: x.50 rounds up, in integer maths."""
    return (2 * sum(values) + len(values)) // (2 * len(values))

def subject_average(con, student_id, subject):
    v = con.execute("SELECT AVG(value) a FROM grades WHERE student_id=? AND subject=?", (student_id, subject)).fetchone()["a"]
    return round(v, 2) if v is not None else None

def alert_if_at_risk(con, student_id, subject):
    """One risk alert per subject while the average is below the line; it goes away once the
    average recovers (or the grade that caused it is deleted), so a later drop warns again."""
    ref = "risk:%d:%s" % (student_id, subject)
    after = subject_average(con, student_id, subject)
    if not below_risk(con.execute("SELECT AVG(value) a FROM grades WHERE student_id=? AND subject=?", (student_id, subject)).fetchone()["a"]):
        drop_notifications(con, ref)
    elif not con.execute("SELECT 1 FROM notifications WHERE student_id=? AND ref=?", (student_id, ref)).fetchone():
        notify(con, student_id, "risk", "Risc de corigență la %s" % subj_name(subject), "Media ta este acum %.2f." % after, ref)

def unread_count(con, uid):
    return con.execute("SELECT COUNT(*) n FROM notifications WHERE student_id=? AND read=0", (uid,)).fetchone()["n"]

def build_notifications(con, uid, class_id):
    if class_id:
        add_due_reminders(con, uid, class_id)
    rows = con.execute("SELECT * FROM notifications WHERE student_id=? ORDER BY id DESC LIMIT 100", (uid,)).fetchall()
    return {"unread": unread_count(con, uid),
            "items": [{"id": r["id"], "kind": r["kind"], "title": r["title"], "body": r["body"] or "",
                       "createdAt": r["created_at"], "read": bool(r["read"])} for r in rows]}

def announcement_class_ids(con, uid):
    """Classes a teacher can post to: the ones they teach, plus the ones they're diriginte of."""
    ids = teacher_class_ids(con, uid)
    ids += [c["id"] for c in con.execute("SELECT id FROM classes WHERE homeroom_teacher_id=?", (uid,)).fetchall() if c["id"] not in ids]
    return ids

def audience(con, school_id, class_id):
    """Ids of the students an announcement reaches."""
    if class_id:
        rows = con.execute("SELECT id FROM users WHERE role='student' AND class_id=?", (class_id,)).fetchall()
    else:
        rows = con.execute("SELECT id FROM users WHERE role='student' AND school_id=?", (school_id,)).fetchall()
    return [r["id"] for r in rows]

def delete_announcement(con, announcement_id):
    con.execute("DELETE FROM announcement_reads WHERE announcement_id=?", (announcement_id,))
    con.execute("DELETE FROM announcements WHERE id=?", (announcement_id,))
    drop_notifications(con, "announcement:%d" % announcement_id)

def post_announcement(con, me, body, now):
    title, text = (body.get("title") or "").strip(), (body.get("body") or "").strip()
    priority, subject = body.get("priority", "normal"), body.get("subject") or None
    link = (body.get("link") or "").strip() or None
    if link and (len(link) > 500 or not re.match(r"^https?://\S+$", link)):
        raise HttpError(400, "Linkul trebuie să înceapă cu http:// sau https://.")
    class_id = int(body["classId"]) if body.get("classId") else None
    if not title or len(title) > 120:
        raise HttpError(400, "Titlul este obligatoriu și are cel mult 120 de caractere.")
    if len(text) > 2000:
        raise HttpError(400, "Textul are cel mult 2000 de caractere.")
    if priority not in PRIORITIES:
        raise HttpError(400, "Prioritatea nu este validă.")
    if me["role"] == "admin":
        school_id = int(body["schoolId"])
        if not con.execute("SELECT 1 FROM schools WHERE id=?", (school_id,)).fetchone():
            raise HttpError(404, "Școala nu există.")
        if class_id and not con.execute("SELECT 1 FROM classes WHERE id=? AND school_id=?", (class_id, school_id)).fetchone():
            raise HttpError(400, "Clasa nu face parte din această școală.")
        subject = None
    else:
        school_id = me["school_id"]
        if class_id not in announcement_class_ids(con, me["id"]):  # teachers can't post to the whole school
            raise HttpError(403, "Nu ai acces la această clasă.")
        if subject and subject not in teacher_subjects(con, me["id"], class_id):
            raise HttpError(403, "Nu predai această materie la clasa aleasă.")
    cur = con.execute("INSERT INTO announcements(school_id,class_id,subject,author_id,title,body,priority,created_at,link) VALUES(?,?,?,?,?,?,?,?,?)",
                      (school_id, class_id, subject, me["id"], title, text, priority, now[:19], link))
    heading = "%s: %s" % ("Anunț urgent" if priority == "urgent" else "Anunț", title)
    target = class_name(con, class_id) if class_id else "Toată școala"
    for sid in audience(con, school_id, class_id):
        notify(con, sid, "announcement", heading, "%s · %s" % (me["name"], target), "announcement:%d" % cur.lastrowid)
    return {"id": cur.lastrowid}

def build_announcements(con, me, school_id=None):
    uid = me["id"]
    if me["role"] == "admin":
        rows = con.execute("SELECT * FROM announcements WHERE school_id=? ORDER BY id DESC LIMIT 100", (school_id,)).fetchall()
    elif me["role"] == "teacher":
        ids = announcement_class_ids(con, uid)
        rows = con.execute("SELECT * FROM announcements WHERE school_id=? AND (class_id IS NULL OR class_id IN (%s)) ORDER BY id DESC LIMIT 100"
                           % (",".join("?" * len(ids)) or "NULL"), [me["school_id"]] + ids).fetchall()
    else:
        rows = con.execute("SELECT * FROM announcements WHERE school_id=? AND (class_id IS NULL OR class_id=?) ORDER BY id DESC LIMIT 100",
                           (me["school_id"], me["class_id"])).fetchall()
    items = []
    for r in rows:
        item = {"id": r["id"], "title": r["title"], "body": r["body"] or "", "link": r["link"], "priority": r["priority"], "createdAt": r["created_at"],
                "author": (user_row(con, r["author_id"]) or {"name": ""})["name"] if r["author_id"] else "",
                "classId": r["class_id"], "className": class_name(con, r["class_id"]) if r["class_id"] else None,
                "subjectName": subj_name(r["subject"]) if r["subject"] else None,
                "canDelete": me["role"] == "admin" or r["author_id"] == uid}
        if me["role"] == "student":
            item["read"] = bool(con.execute("SELECT 1 FROM announcement_reads WHERE announcement_id=? AND student_id=?", (r["id"], uid)).fetchone())
        elif item["canDelete"]:
            item["seen"] = con.execute("SELECT COUNT(*) n FROM announcement_reads WHERE announcement_id=?", (r["id"],)).fetchone()["n"]
            item["total"] = len(audience(con, r["school_id"], r["class_id"]))
        items.append(item)
    out = {"items": items}
    if me["role"] == "teacher":
        out["targets"] = [{"id": c, "name": class_name(con, c),
                           "subjects": [{"id": s, "label": subj_name(s)} for s in teacher_subjects(con, uid, c)]}
                          for c in announcement_class_ids(con, uid)]
    return out

def teacher_class_ids(con, uid):
    return [r["class_id"] for r in con.execute("SELECT DISTINCT class_id FROM timetable WHERE teacher_id=?", (uid,)).fetchall()]

def need(me, *roles):
    if me["role"] not in roles:
        raise HttpError(403, "Nu ai acces la această acțiune.")

def need_class(con, me, cid):
    if me["role"] == "admin":
        return
    if me["role"] == "teacher" and cid in teacher_class_ids(con, me["id"]):
        return
    if me["role"] == "student" and me["class_id"] == cid:
        return
    raise HttpError(403, "Nu ai acces la această clasă.")

def teacher_subjects(con, teacher_id, class_id):
    """Subjects this teacher teaches in this class, according to the timetable."""
    return [r["subject"] for r in con.execute(
        "SELECT DISTINCT subject FROM timetable WHERE teacher_id=? AND class_id=? ORDER BY subject",
        (teacher_id, class_id)).fetchall()]

def need_subject(con, me, class_id, subject):
    need(me, "teacher")
    if subject not in teacher_subjects(con, me["id"], class_id):
        raise HttpError(403, "Nu predai această materie la această clasă.")

def need_student_subject(con, me, student_id, subject):
    """The teacher may grade/mark this student only for a subject they teach in the student's class."""
    need(me, "teacher")
    s = user_row(con, int(student_id))
    if not s or s["role"] != "student" or not s["class_id"]:
        raise HttpError(404, "Elevul nu există.")
    need_subject(con, me, s["class_id"], subject)

def school_day(con, school_id, value):
    """An ISO date from the request that is today or later, a weekday and inside a module."""
    try:
        d = parse_iso(value)
    except (TypeError, ValueError):
        raise HttpError(400, "Data nu este validă.")
    if d < today():
        raise HttpError(400, "Alege o dată de azi încolo.")
    if d.weekday() > 4 or not module_of(school_modules(con, school_id), iso(d)):
        raise HttpError(400, "În ziua aleasă nu sunt ore (weekend sau vacanță).")
    return iso(d)

def entry_date(value, modules=None, weekday=False):
    """A past or present date for a grade or absence, within this school year."""
    try:
        d = parse_iso(value) if value else today()
    except (TypeError, ValueError):
        raise HttpError(400, "Data nu este validă.")
    if d > today():
        raise HttpError(400, "Data nu poate fi în viitor.")
    if modules:
        if iso(d) < modules[0]["start"]:
            raise HttpError(400, "Data este dinaintea începutului anului școlar (%s)." % date_text(modules[0]["start"]))
        if weekday and (d.weekday() > 4 or not module_of(modules, iso(d))):
            raise HttpError(400, "În ziua aleasă nu au fost ore (weekend sau vacanță).")
    return iso(d)

def grade_value(value):
    if str(value).strip() not in [str(v) for v in range(1, 11)]:
        raise HttpError(400, "Nota trebuie să fie un număr întreg de la 1 la 10.")
    return int(value)

def clean_note(value):
    return (str(value).strip()[:80] or None) if value else None

def owned_row(con, table, row_id, me):
    """A grade or absence, only if this teacher entered it."""
    need(me, "teacher")
    r = con.execute("SELECT * FROM %s WHERE id=?" % table, (row_id,)).fetchone()
    if not r:
        raise HttpError(404, "Înregistrarea nu există.")
    if r["teacher_id"] != me["id"]:
        raise HttpError(403, "Poți modifica doar ce ai introdus tu.")
    return r

# --------------------------------------------------------------------------- #
#  Serializers / derived
# --------------------------------------------------------------------------- #
def subjects_catalog():
    return [{"code": c, "name": n, "hue": hue, "short": s} for c, (n, hue, s) in SUBJECTS.items()]

def subj_name(code):
    return SUBJECTS.get(code, (code, "#636B86", code))[0]

def subj_hue(code):
    return SUBJECTS.get(code, (code, "#636B86", code))[1]

def subj_short(code):
    return SUBJECTS.get(code, (code, "#636B86", code))[2]

def heat_of(score):
    if score <= 0:
        return {"k": "none", "label": "Liber"}
    if score <= 2:
        return {"k": "calm", "label": "Ușor"}
    if score <= 4:
        return {"k": "light", "label": "Moderat"}
    if score <= 6:
        return {"k": "busy", "label": "Încărcat"}
    return {"k": "heavy", "label": "Supraîncărcat"}

def user_row(con, uid):
    return con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()

def school_name(con, sid):
    r = con.execute("SELECT name FROM schools WHERE id=?", (sid,)).fetchone()
    return r["name"] if r else None

def class_name(con, cid):
    r = con.execute("SELECT name FROM classes WHERE id=?", (cid,)).fetchone()
    return r["name"] if r else None

def teacher_name(con, tid):
    if not tid:
        return None
    r = con.execute("SELECT name FROM users WHERE id=?", (tid,)).fetchone()
    return r["name"] if r else None

# ---- the signed-in account ----
def build_me(con, me, must_change):
    return {"id": me["id"], "role": me["role"], "name": me["name"], "email": me["email"],
            "school": school_name(con, me["school_id"]) if me["school_id"] else None,
            "class": class_name(con, me["class_id"]) if me["class_id"] else None,
            "mustChangePassword": must_change}

# ---- admin snapshot ----
def build_admin(con):
    schools = []
    for s in con.execute("SELECT * FROM schools ORDER BY id").fetchall():
        sid = s["id"]
        classes = [{"id": c["id"], "name": c["name"], "homeroomTeacherId": c["homeroom_teacher_id"],
                    "students": con.execute("SELECT COUNT(*) n FROM users WHERE role='student' AND class_id=?", (c["id"],)).fetchone()["n"],
                    "slots": con.execute("SELECT COUNT(*) n FROM timetable WHERE class_id=?", (c["id"],)).fetchone()["n"]}
                   for c in con.execute("SELECT * FROM classes WHERE school_id=? ORDER BY name", (sid,)).fetchall()]
        teachers = [{"id": t["id"], "name": t["name"], "subjects": json.loads(t["subjects"] or "[]"),
                     "email": t["email"], "hasLogin": bool(t["auth_id"])}
                    for t in con.execute("SELECT * FROM users WHERE role='teacher' AND school_id=? ORDER BY name", (sid,)).fetchall()]
        students = [{"id": u["id"], "name": u["name"], "classId": u["class_id"],
                     "className": class_name(con, u["class_id"]), "email": u["email"], "hasLogin": bool(u["auth_id"])}
                    for u in con.execute("SELECT * FROM users WHERE role='student' AND school_id=? ORDER BY name", (sid,)).fetchall()]
        for c in classes:
            c["insights"] = class_insights(con, c["id"])
        schools.append({"id": sid, "name": s["name"], "classes": classes,
                        "teachers": teachers, "students": students, "modules": school_modules(con, sid)})
    return {"schools": schools, "subjects": subjects_catalog(), "periods": PERIODS}

def slot_time(r):
    """Start time of a timetable row: the one the admin set, else the period's default."""
    return r["time"] or (PERIODS[r["period"]] if 0 <= r["period"] < len(PERIODS) else "")

def minutes(hhmm):
    return int(hhmm[:2]) * 60 + int(hhmm[3:])

def slot_end(r):
    """End time of a timetable row: the one the admin set, else a standard lesson's length."""
    if r["end_time"]:
        return r["end_time"]
    start = slot_time(r)
    if not start:
        return ""
    total = (minutes(start) + LESSON_MINUTES) % 1440
    return "%02d:%02d" % (total // 60, total % 60)

def clean_time(value, what="de început"):
    value = (value or "").strip()
    if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", value):
        raise HttpError(400, "Ora %s nu este validă." % what)
    return value

def build_timetable(con, class_id):
    grid = [[None] * len(PERIODS) for _ in range(5)]
    for r in con.execute("SELECT * FROM timetable WHERE class_id=? ORDER BY day,period", (class_id,)).fetchall():
        if 0 <= r["day"] < 5 and 0 <= r["period"] < len(PERIODS):
            grid[r["day"]][r["period"]] = {
                "id": r["id"], "subject": r["subject"], "subjectName": subj_name(r["subject"]),
                "short": subj_short(r["subject"]), "hue": subj_hue(r["subject"]),
                "teacherId": r["teacher_id"], "teacher": teacher_name(con, r["teacher_id"]),
                "room": r["room"] or "", "time": slot_time(r), "end": slot_end(r),
            }
    return grid

# ---- workload for a class ----
def class_workload(con, class_id):
    rows = con.execute("SELECT * FROM assessments WHERE class_id=? ORDER BY date", (class_id,)).fetchall()
    by_day = {}
    for r in rows:
        by_day.setdefault(r["date"], []).append(r)
    mon = week_monday()
    weeks = []
    for w in range(2):
        days = []
        for i in range(5):
            d = mon + timedelta(days=w * 7 + i)
            items = by_day.get(iso(d), [])
            score = sum(TYPE_W.get(it["type"], 0) for it in items)
            graded = [it for it in items if it["type"] != "tema"]
            days.append({"date": iso(d), "dateLabel": day_label(d), "score": score,
                         "heat": heat_of(score), "clash": len(graded) >= 2,
                         "items": [{"id": it["id"], "teacherId": it["teacher_id"], "subject": it["subject"], "type": it["type"],
                                    "short": subj_short(it["subject"]), "title": it["title"]} for it in items]})
        weeks.append({"label": "Săptămâna aceasta" if w == 0 else "Săptămâna viitoare", "days": days})
    flat = [d for wk in weeks for d in wk["days"]]
    graded_of = lambda day: [it for it in day["items"] if it["type"] != "tema"]
    collisions = []
    # two+ graded assessments on the same day
    for day in flat:
        graded = graded_of(day)
        if len(graded) >= 2:
            collisions.append({"kind": "day", "date": day["date"], "dateLabel": day["dateLabel"], "items": graded})
    # three+ graded within 48h, i.e. on two consecutive days (dates have no time).
    # A window whose items all sit on one day is already covered above.
    for a, b in zip(flat, flat[1:]):
        if (parse_iso(b["date"]) - parse_iso(a["date"])).days != 1:
            continue
        ga, gb = graded_of(a), graded_of(b)
        if ga and gb and len(ga) + len(gb) >= 3:
            a["clash"] = b["clash"] = True
            collisions.append({"kind": "window", "date": a["date"],
                               "dateLabel": "%s – %s" % (a["dateLabel"], b["dateLabel"]),
                               "items": [{**it, "dateLabel": a["dateLabel"]} for it in ga] +
                                        [{**it, "dateLabel": b["dateLabel"]} for it in gb]})
    collisions.sort(key=lambda c: c["date"])
    upcoming = [d for d in flat if parse_iso(d["date"]) >= today()]
    suggestions = sorted(upcoming, key=lambda d: d["score"])[:3]
    return {"weeks": weeks, "collisions": collisions, "suggestions": suggestions}

# ---- teacher snapshot ----
def build_teacher(con, uid):
    u = user_row(con, uid)
    slots = con.execute("SELECT * FROM timetable WHERE teacher_id=? ORDER BY day,period", (uid,)).fetchall()
    class_ids = []
    schedule = [[] for _ in range(5)]
    for r in slots:
        if r["class_id"] not in class_ids:
            class_ids.append(r["class_id"])
        if 0 <= r["day"] < 5:
            schedule[r["day"]].append({
                "id": r["id"], "day": r["day"], "period": r["period"], "time": slot_time(r), "end": slot_end(r),
                "subject": r["subject"], "subjectName": subj_name(r["subject"]), "hue": subj_hue(r["subject"]),
                "className": class_name(con, r["class_id"]), "classId": r["class_id"], "room": r["room"] or "",
            })
    for d in schedule:
        d.sort(key=lambda x: (x["time"], x["period"]))
    classes = [{"id": cid, "name": class_name(con, cid), "subjects": teacher_subjects(con, uid, cid)} for cid in class_ids]
    homerooms = [{"id": c["id"], "name": c["name"]}
                 for c in con.execute("SELECT * FROM classes WHERE homeroom_teacher_id=? ORDER BY name", (uid,)).fetchall()]
    wd = today().weekday()
    return {
        "teacher": {"id": uid, "name": u["name"], "school": school_name(con, u["school_id"]),
                    "subjects": json.loads(u["subjects"] or "[]")},
        "classes": classes, "homerooms": homerooms, "schedule": schedule, "periods": PERIODS,
        "todayIdx": wd if wd <= 4 else None,
        "unreadMessages": unread_messages(con, uid),
        "subjectCatalog": subjects_catalog(),
        "colleagues": [{"id": c["id"], "name": c["name"]} for c in con.execute(
            "SELECT id,name FROM users WHERE role='teacher' AND school_id=? AND id!=? ORDER BY name", (u["school_id"], uid)).fetchall()],
        "changes": [{**change_row(con, r), "mine": r["author_id"] == uid} for r in con.execute(
            "SELECT * FROM lesson_changes WHERE (author_id=? OR teacher_id=?) AND date>=? ORDER BY date", (uid, uid, iso(today()))).fetchall()],
    }

# ---- teacher catalog: one class + subject ----
def build_catalog(con, me, class_id, subject):
    uid = me["id"]
    wd = today().weekday()
    modules = school_modules(con, user_row(con, uid)["school_id"])
    in_module = module_of(modules, iso(today()))
    lessons = sorted(slot_time(r) for r in con.execute(
        "SELECT period,time FROM timetable WHERE class_id=? AND subject=? AND teacher_id=? AND day=?",
        (class_id, subject, uid, wd)).fetchall()) if wd <= 4 and in_module else []
    cls = con.execute("SELECT * FROM classes WHERE id=?", (class_id,)).fetchone()
    students = []
    for s in con.execute("SELECT * FROM users WHERE role='student' AND class_id=? ORDER BY name", (class_id,)).fetchall():
        grades = con.execute("SELECT * FROM grades WHERE student_id=? AND subject=? ORDER BY date, id", (s["id"], subject)).fetchall()
        absences = con.execute("SELECT * FROM absences WHERE student_id=? AND subject=? ORDER BY date DESC, id DESC", (s["id"], subject)).fetchall()
        students.append({
            "id": s["id"], "name": s["name"],
            "avg": round(sum(g["value"] for g in grades) / len(grades), 2) if grades else None,
            "grades": [{"id": g["id"], "v": g["value"], "d": g["date"], "note": g["note"], "module": module_of(modules, g["date"]),
                        "teacher": teacher_name(con, g["teacher_id"]), "mine": g["teacher_id"] == uid} for g in grades],
            "absences": [{"id": a["id"], "d": a["date"], "excused": a["kind"] == "excused",
                          "teacher": teacher_name(con, a["teacher_id"]), "mine": a["teacher_id"] == uid} for a in absences],
        })
    return {"classId": class_id, "className": cls["name"], "subject": subject, "subjectName": subj_name(subject),
            "today": iso(today()), "lessonToday": lessons[0] if lessons else None,
            "isHomeroom": cls["homeroom_teacher_id"] == uid, "students": students,
            "modules": [m["number"] for m in modules], "currentModule": in_module}

def build_motivari(con, uid):
    out = []
    for c in con.execute("SELECT * FROM classes WHERE homeroom_teacher_id=? ORDER BY name", (uid,)).fetchall():
        rows = con.execute("""SELECT a.*, u.name AS student FROM absences a JOIN users u ON u.id=a.student_id
                              WHERE u.class_id=? AND a.kind='unexcused' ORDER BY a.date DESC, u.name""", (c["id"],)).fetchall()
        out.append({"classId": c["id"], "className": c["name"],
                    "absences": [{"id": r["id"], "student": r["student"], "subjectName": subj_name(r["subject"]),
                                  "short": subj_short(r["subject"]), "d": r["date"],
                                  "teacher": teacher_name(con, r["teacher_id"])} for r in rows]})
    return {"classes": out}

# ---- student snapshot ----
def pack_list(lessons, last_item):
    pack, seen = [], set()
    for c in lessons:
        rule = PACK_RULES.get(c["subject"])
        if rule and rule not in seen:
            seen.add(rule)
            pack.append(rule)
    return pack + [last_item] if lessons else pack

def next_day_brief(tt, modules, hour):
    """In the evening: the next school day's lessons and what to pack for them."""
    if hour < EVENING_HOUR:
        return None
    weekday = today().weekday()
    idx = weekday + 1 if weekday < 4 else 0
    if not module_of(modules, iso(today() + timedelta(days=(idx - weekday) % 7))):
        return None
    lessons = sorted((c for c in tt[idx] if c), key=lambda c: c["time"])
    if not lessons:
        return None
    return {"label": "Mâine" if (idx - weekday) % 7 == 1 else FULLDAYS[idx], "count": len(lessons),
            "first": lessons[0]["time"], "pack": pack_list(lessons, "Caietele pentru %s" % FULLDAYS[idx].lower())}

def stress_forecast(collisions, subjects):
    """The next clash of tests in the class, and which subject to start revising first."""
    t = today()
    ahead = [c for c in collisions if parse_iso(c["date"]) >= t]
    if not ahead:
        return None
    c = ahead[0]
    averages = {s["code"]: s["avg"] for s in subjects}
    names = sorted({(averages.get(i["subject"], 11), i["subject"]) for i in c["items"]})
    start = parse_iso(c["date"]) - timedelta(days=2)
    when = "azi" if start <= t else "de %s" % FULLDAYS[start.weekday()].lower()
    text = "%s: %d evaluări (%s)." % (c["dateLabel"], len(c["items"]), ", ".join(i["short"] for i in c["items"]))
    return {"text": text, "advice": "Începe recapitularea cu %s %s." % (subj_name(names[0][1]), when)}

def build_student(con, uid):
    u = user_row(con, uid)
    cid = u["class_id"]
    cls = class_name(con, cid)
    tt = build_timetable(con, cid) if cid else [[None] * len(PERIODS) for _ in range(5)]
    if cid:
        add_due_reminders(con, uid, cid)
    wd = today().weekday()
    is_weekend = wd > 4
    idx = wd if not is_weekend else 0
    now = datetime.now()
    now_min = now.hour * 60 + now.minute
    modules = school_modules(con, u["school_id"])
    shown = week_monday() if is_weekend else today()  # weekends preview Monday: its module and its changes
    module = module_status(modules, iso(shown))
    changes = class_changes(con, cid) if cid else []
    change_today = {c["timetableId"]: c for c in changes if c["date"] == iso(shown)}
    classes_today = sorted(({**cell, "change": change_today.get(cell["id"]), "current": (not is_weekend) and minutes(cell["time"]) <= now_min < minutes(cell["end"])}
                            for cell in tt[idx] if cell and not module["holiday"]), key=lambda c: c["time"])
    pack = pack_list(classes_today, "Caietele de azi")
    # assessments for the class
    assess = con.execute("SELECT * FROM assessments WHERE class_id=? ORDER BY date", (cid,)).fetchall() if cid else []
    t = today()
    due = []
    for a in assess:
        dd = parse_iso(a["date"])
        delta = (dd - t).days
        if t <= dd <= next_school_day(t):
            due.append({"id": "a%d" % a["id"], "title": a["title"], "subject": a["subject"],
                        "short": subj_short(a["subject"]), "typeLabel": TYPE_LABEL.get(a["type"], "Evaluare"),
                        "bucket": "today" if delta == 0 else "tomorrow",
                        "dueLabel": "azi" if delta == 0 else ("mâine" if delta == 1 else "luni"), "kind": "assessment"})
    # personal tasks
    tasks = []
    for r in con.execute("SELECT * FROM tasks WHERE student_id=? ORDER BY done, due", (uid,)).fetchall():
        bucket, dl = "later", ""
        if r["due"]:
            delta = (parse_iso(r["due"]) - t).days
            if delta < 0:
                bucket, dl = "today", "întârziată · %s" % day_label(parse_iso(r["due"]))
            elif delta == 0:
                bucket, dl = "today", "azi"
            elif delta == 1:
                bucket, dl = "tomorrow", "mâine"
            else:
                bucket, dl = "later", day_label(parse_iso(r["due"]))
        tasks.append({"id": r["id"], "title": r["title"], "subject": r["subject"],
                      "short": subj_short(r["subject"]) if r["subject"] else None,
                      "typeLabel": TYPE_LABEL.get(r["type"], r["type"]), "bucket": bucket,
                      "dueLabel": dl, "done": bool(r["done"]), "kind": "task"})
    due_tasks = [x for x in tasks if x["bucket"] in ("today", "tomorrow") and not x["done"]]
    # timetable view payload
    days = []
    amap = {}
    for a in assess:
        amap.setdefault(a["date"], {})[a["subject"]] = a["type"]
    mon = week_monday()
    for di in range(5):
        dkey = iso(mon + timedelta(days=di))
        col = []
        for p, cell in enumerate(tt[di]):
            if not cell:
                col.append(None)
            else:
                col.append({**cell, "assessment": amap.get(dkey, {}).get(cell["subject"])})
        days.append(col)
    fri = mon + timedelta(days=4)
    week_lbl = ("%d–%d %s" % (mon.day, fri.day, MONTHS[fri.month]) if mon.month == fri.month
                else "%d %s – %d %s" % (mon.day, MONTHS[mon.month], fri.day, MONTHS[fri.month]))
    # grades
    grades = build_grades(con, uid)
    absences = build_absences(con, uid)
    cutoff = iso(t - timedelta(days=3))
    new_grades = sorted(({**v, "subject": sub["code"], "short": sub["short"], "hue": sub["hue"]}
                         for sub in grades["subjects"] for v in sub["values"]
                         if ISO_RE.match(v["d"]) and v["d"] >= cutoff),
                        key=lambda g: (g["d"], g["id"]), reverse=True)
    label = "%s, %d %s" % (FULLDAYS[wd], t.day, MONTHS[t.month])
    workload = class_workload(con, cid) if cid else None
    upcoming = [{"id": a["id"], "date": a["date"], "subject": a["subject"], "subjectName": subj_name(a["subject"]), "hue": subj_hue(a["subject"]),
                 "type": a["type"], "typeLabel": TYPE_LABEL.get(a["type"], "Evaluare"), "title": a["title"]}
                for a in assess if a["date"] >= iso(t)]
    excuse_due = [{"id": r["id"], "subjectName": subj_name(r["subject"]), "date": r["date"], "until": iso(parse_iso(r["date"]) + timedelta(days=7))}
                  for r in con.execute("SELECT * FROM absences WHERE student_id=? AND kind='unexcused' AND date>=? ORDER BY date",
                                       (uid, iso(t - timedelta(days=7)))).fetchall()]
    recent = iso(t - timedelta(days=3))
    recent_announcements = [a for a in build_announcements(con, u)["items"] if a["createdAt"] >= recent][:3]
    return {
        "student": {"id": uid, "name": u["name"], "class": cls, "classId": cid,
                    "school": school_name(con, u["school_id"])},
        "subjects": {c: {"name": n, "hue": hue, "short": s} for c, (n, hue, s) in SUBJECTS.items()},
        "typeLabel": TYPE_LABEL,
        "today": {"weekdayIdx": idx, "isWeekend": is_weekend, "dateLabel": label,
                  "classes": classes_today, "announcements": recent_announcements, "pack": pack,
                  "nextDay": next_day_brief(tt, modules, now.hour), "module": module, "changes": changes[:5], "excuseDue": excuse_due,
                  "forecast": stress_forecast(workload["collisions"], grades["subjects"]) if workload else None,
                  "due": due + due_tasks, "newGrades": new_grades},
        "timetable": {"periods": PERIODS, "days": days, "weekLabel": week_lbl, "todayIdx": None if is_weekend else idx},
        "tasks": tasks,
        "grades": grades, "absences": absences,
        "workload": workload, "upcoming": upcoming, "unreadMessages": unread_messages(con, uid),
        "hasTimetable": bool(cid and any(any(row) for row in tt)),
        "unread": unread_count(con, uid),
    }

def build_grades(con, student_id):
    rows = con.execute("SELECT * FROM grades WHERE student_id=? ORDER BY date, id", (student_id,)).fetchall()
    modules = school_modules(con, user_row(con, student_id)["school_id"])
    bysub = {}
    for r in rows:
        bysub.setdefault(r["subject"], []).append(r)
    subs = []
    for code, lst in bysub.items():
        vals = [r["value"] for r in lst]
        avg = round(sum(vals) / len(vals), 2)
        subs.append({"code": code, "name": subj_name(code), "hue": subj_hue(code), "short": subj_short(code),
                     "avg": avg, "annual": annual_average(vals), "risk": below_risk(sum(vals) / len(vals)),
                     "values": [{"id": r["id"], "v": r["value"], "d": r["date"], "note": r["note"], "module": module_of(modules, r["date"]),
                                 "teacher": teacher_name(con, r["teacher_id"])} for r in lst]})
    goals = {r["subject"]: r["target"] for r in con.execute("SELECT * FROM subject_goals WHERE student_id=?", (student_id,)).fetchall()}
    for sub in subs:
        target = goals.get(sub["code"])
        if target:
            sub["goal"] = {"target": target, "reached": sub["annual"] >= target,
                           **grades_needed([v["v"] for v in sub["values"]], target, 10)}
    subs.sort(key=lambda s: s["name"])
    # mean of the rounded annual averages, kept to two decimals without rounding (9, 10, 10 -> 9.66)
    overall = (sum(s["annual"] for s in subs) * 100 // len(subs)) / 100 if subs else 0
    best = max(subs, key=lambda s: s["avg"]) if subs else None
    worst = min(subs, key=lambda s: s["avg"]) if subs else None
    return {"overall": overall, "subjects": subs, "modules": [m["number"] for m in modules],
            "best": {"short": best["short"], "avg": best["avg"]} if best else None,
            "worst": {"short": worst["short"], "avg": worst["avg"]} if worst else None}

def build_absences(con, student_id):
    rows = con.execute("SELECT subject, kind, COUNT(*) n FROM absences WHERE student_id=? GROUP BY subject, kind", (student_id,)).fetchall()
    bysub = {}
    for r in rows:
        bysub.setdefault(r["subject"], {"excused": 0, "unexcused": 0})[r["kind"]] = r["n"]
    subs, tu, te = [], 0, 0
    for code, v in bysub.items():
        tu += v["unexcused"]; te += v["excused"]
        subs.append({"code": code, "name": subj_name(code), "hue": subj_hue(code),
                     "unexcused": v["unexcused"], "excused": v["excused"]})
    subs.sort(key=lambda s: -s["unexcused"])
    return {"totUn": tu, "totEx": te, "threshold": 10, "subjects": subs}

def what_if(values, target, n):
    """Minimum whole grade (1-10), given n times, so the average rounds to `target`.

    Romanian averages round half-up to a whole number, so target T needs a raw
    average >= T - 0.5:  (sum + g*n) / total >= (2T - 1) / 2.  Integer maths
    avoids float edge cases at exactly x.50.
    """
    n = max(1, int(n))
    target = int(target)
    total = len(values) + n
    num = (2 * target - 1) * total - 2 * sum(values)
    need = -(-num // (2 * n))  # ceil
    return {"need": min(10, max(1, need)), "reachable": need <= 10, "trivial": need <= 1}

def grades_needed(values, target, grade):
    """How many future grades of value `grade` are needed for the subject average to
    round (half-up) to `target`. Grades are unbounded — no cap on how many you may get.

    Returns the minimum count, `already` when the average is already there, or
    `reachable=False` when `grade` is too low to ever reach the target (as the count
    grows, the average only tends toward `grade`, so `grade` must clear `target`).
    """
    target = max(1, min(10, int(target)))
    grade = max(1, min(10, int(grade)))
    n0, s = len(values), sum(values)
    th2 = 2 * target - 1                       # need 2*average >= th2  (half-up rounding)
    if n0 and 2 * s >= th2 * n0:               # average already rounds to >= target
        return {"count": 0, "already": True, "reachable": True, "target": target, "grade": grade}
    if 2 * grade <= th2:                        # grade not above the target threshold -> never reaches
        return {"count": None, "already": False, "reachable": False, "target": target, "grade": grade}
    k = -(-(th2 * n0 - 2 * s) // (2 * grade - th2))  # ceil(num/den), both > 0 here
    return {"count": int(max(1, k)), "already": False, "reachable": True, "target": target, "grade": grade}

# --------------------------------------------------------------------------- #
#  HTTP
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    server_version = "SchoolPilot/2.0"

    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            return {}

    def _query(self):
        return parse_qs(urlparse(self.path).query)

    def _static(self):
        path = unquote(urlparse(self.path).path)
        if path in ("", "/", "/index.html"):
            return self._send(page_html(), "text/html; charset=utf-8", "no-cache")
        target = os.path.normpath(os.path.join(PUBLIC, path.lstrip("/")))
        if not target.startswith(PUBLIC + os.sep) or not os.path.isfile(target):
            if os.path.splitext(path)[1]:  # a missing file (e.g. /favicon.ico), not a page
                return self._send(b"not found", "text/plain", "no-cache", 404)
            return self._send(page_html(), "text/html; charset=utf-8", "no-cache")
        ext = os.path.splitext(target)[1]
        rel = os.path.relpath(target, PUBLIC).split(os.sep)[0]
        cache = {"build": "public, max-age=31536000, immutable",  # always requested with ?v=<hash>
                 "media": "public, max-age=86400", "vendor": "public, max-age=86400"}.get(rel, "no-cache")
        with open(target, "rb") as f:
            self._send(f.read(), CTYPES.get(ext, "application/octet-stream"), cache)

    def _send(self, data, ctype, cache, code=200):
        if ctype.split(";")[0] in COMPRESSIBLE and "gzip" in self.headers.get("Accept-Encoding", ""):
            data = gzipped(data)
            self.send_response(code)
            self.send_header("Content-Encoding", "gzip")
        else:
            self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", cache)
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _me(self, con, p):
        """The local user behind the request's Supabase access token.
        Identity comes only from the token; ids in the request are never trusted."""
        h = self.headers.get("Authorization", "")
        if not h.startswith("Bearer ") or not h[7:].strip():
            raise HttpError(401, "Autentificare necesară.")
        if h[7:].startswith("demo."):
            uid = demo_identity(h[7:].strip())
            me = user_row(con, uid) if uid else None
            if not me or me["role"] != "student":
                raise HttpError(401, "Sesiunea demo a expirat. Scanează din nou codul.")
            return me, {"must_change": False, "email": me["email"], "auth_id": None, "demo": True}
        info = token_identity(h[7:].strip())
        me = con.execute("SELECT * FROM users WHERE email=?", (info["email"],)).fetchone()
        if not me:
            raise HttpError(403, "Acest email nu are cont în SchoolPilot.")
        if me["role"] == "admin" and info["email"] != ADMIN_EMAIL:
            raise HttpError(403, "Nu ai acces la această acțiune.")
        if me["auth_id"] != info["auth_id"]:
            if me["auth_id"]:  # same email, different Supabase user (e.g. recreated outside the app)
                raise HttpError(403, "Contul nu corespunde. Cere administratorului o resetare.")
            con.execute("UPDATE users SET auth_id=? WHERE id=?", (info["auth_id"], me["id"]))
            con.commit()
            me = user_row(con, me["id"])
        if info["must_change"] and p != "/api/me":
            raise HttpError(403, MUST_CHANGE_MSG)
        return me, info

    def _api(self, fn):
        with _lock:
            con = connect()
            try:
                res = fn(con)
                con.commit()
                self._json(res if res is not None else {"ok": True})
            except HttpError as e:
                payload = {"error": e.msg}
                if e.msg == MUST_CHANGE_MSG:  # the app then shows "Setează o parolă nouă"
                    payload["mustChangePassword"] = True
                self._json(payload, e.code)
            except KeyError as e:
                self._json({"error": "missing field %s" % e}, 400)
            except Exception as e:
                self._json({"error": str(e)}, 400)
            finally:
                con.close()

    def do_GET(self):
        p = urlparse(self.path).path
        if p == "/api/demo":  # public: hands out a demo pass only while demo mode is on
            uid, want_pass = demo_student_id(), "pass" in self._query()
            with _lock:
                con = connect()
                try:
                    u = user_row(con, uid) if uid else None
                finally:
                    con.close()
            if not u or u["role"] != "student":
                return self._json({"enabled": False, "publicUrl": public_url()}, 404 if want_pass else 200)
            out = {"enabled": True, "name": u["name"], "publicUrl": public_url()}
            if want_pass:
                out["token"] = demo_pass(uid)
            return self._json(out)
        if p == "/api/config":  # public: never add the secret key here
            return self._json({"supabaseUrl": SUPABASE_URL, "supabasePublishableKey": SUPABASE_PUBLISHABLE_KEY})
        if p.startswith("/api/"):
            return self._api(lambda con: self.get_api(p, con))
        try:
            self._static()
        except Exception as e:
            self._json({"error": str(e)}, 500)

    def get_api(self, p, con):
        q = self._query()
        me, info = self._me(con, p)
        if p == "/api/me":
            return {**build_me(con, me, info["must_change"]), "demo": bool(info.get("demo"))}
        if p == "/api/subjects":
            return {"subjects": subjects_catalog()}
        if p == "/api/admin":
            need(me, "admin")
            return build_admin(con)
        if p == "/api/timetable":
            cid = int(q["classId"][0])
            need_class(con, me, cid)
            return {"classId": cid, "className": class_name(con, cid),
                    "periods": PERIODS, "grid": build_timetable(con, cid),
                    "todayIdx": today().weekday() if today().weekday() <= 4 else None}
        if p == "/api/teacher":
            need(me, "teacher")
            return build_teacher(con, me["id"])
        if p == "/api/teacher/workload":
            need(me, "teacher", "admin")
            cid = int(q["classId"][0])
            need_class(con, me, cid)
            return class_workload(con, cid)
        if p == "/api/teacher/catalog":
            cid, subject = int(q["classId"][0]), q["subject"][0]
            need_subject(con, me, cid, subject)
            return build_catalog(con, me, cid, subject)
        if p == "/api/teacher/motivari":
            need(me, "teacher")
            return build_motivari(con, me["id"])
        if p == "/api/student":
            need(me, "student")
            return build_student(con, me["id"])
        if p == "/api/events":
            return build_events(con, me, int(q["schoolId"][0]) if me["role"] == "admin" else None)
        if p == "/api/calendar":
            need(me, "student")
            return build_calendar(con, me)
        if p == "/api/messages":
            need(me, "student", "teacher")
            return build_threads(con, me)
        if p == "/api/messages/thread":
            need(me, "student", "teacher")
            rows = thread_rows(con, me, q["key"][0])
            ids = [r["id"] for r in rows if r["recipient_id"] == me["id"]]
            con.execute("UPDATE messages SET read_at=? WHERE recipient_id=? AND read_at IS NULL AND id IN (%s)" % (",".join(map(str, ids)) or "NULL"),
                        (datetime.now().isoformat(timespec="seconds"), me["id"]))
            if ids:  # the bell's "Mesaj de la …" entries for this thread are read too
                con.executemany("UPDATE notifications SET read=1 WHERE student_id=? AND ref=?", [(me["id"], "message:%d" % i) for i in ids])
            return {"messages": [message_row(r, me["id"]) for r in rows]}
        if p == "/api/announcements":
            if me["role"] == "admin":
                return build_announcements(con, me, int(q["schoolId"][0]))
            return build_announcements(con, me)
        if p == "/api/notifications":
            need(me, "student")
            return build_notifications(con, me["id"], me["class_id"])
        raise HttpError(404, "not found")

    def do_POST(self):
        return self._mutate("POST")

    def do_DELETE(self):
        return self._mutate("DELETE")

    def do_PATCH(self):
        return self._mutate("PATCH")

    def _mutate(self, method):
        p = urlparse(self.path).path
        if not p.startswith("/api/"):
            return self._json({"error": "not found"}, 404)
        body = self._body()
        self._api(lambda con: self.route(method, p, body, con))

    def route(self, method, p, body, con):
        now = datetime.now().isoformat()
        me, _ = self._me(con, p)
        if re.match(r"^/api/(schools|classes|teachers|students|users|timetable|reset)(/|$)", p):
            need(me, "admin")

        # ---------- admin: schools ----------
        if p == "/api/schools" and method == "POST":
            name = (body.get("name") or "").strip()
            if not name:
                raise ValueError("name required")
            cur = con.execute("INSERT INTO schools(name,created_at) VALUES(?,?)", (name, now))
            return {"id": cur.lastrowid}
        m = re.match(r"^/api/schools/(\d+)/modules$", p)
        if m and method == "POST":
            save_modules(con, int(m.group(1)), body.get("modules") or [])
            return {"ok": True}
        m = re.match(r"^/api/schools/(\d+)$", p)
        if m and method == "DELETE":
            sid = int(m.group(1))
            con.execute("DELETE FROM school_modules WHERE school_id=?", (sid,))
            con.execute("DELETE FROM school_events WHERE school_id=?", (sid,))
            for a in con.execute("SELECT id FROM announcements WHERE school_id=?", (sid,)).fetchall():
                delete_announcement(con, a["id"])
            cids = [r["id"] for r in con.execute("SELECT id FROM classes WHERE school_id=?", (sid,)).fetchall()]
            for cid in cids:
                con.execute("DELETE FROM lesson_changes WHERE class_id=?", (cid,))
                con.execute("DELETE FROM timetable WHERE class_id=?", (cid,))
                con.execute("DELETE FROM assessments WHERE class_id=?", (cid,))
            remove_users(con, con.execute("SELECT * FROM users WHERE school_id=? AND role!='admin'", (sid,)).fetchall())
            con.execute("DELETE FROM classes WHERE school_id=?", (sid,))
            con.execute("DELETE FROM schools WHERE id=?", (sid,))
            return {"ok": True}

        # ---------- admin: classes ----------
        if p == "/api/classes" and method == "POST":
            name = (body.get("name") or "").strip()[:20]
            if not name:
                raise HttpError(400, "Scrie numele clasei.")
            if con.execute("SELECT 1 FROM classes WHERE school_id=? AND lower(name)=lower(?)", (int(body["schoolId"]), name)).fetchone():
                raise HttpError(400, "Clasa %s există deja." % name)
            cur = con.execute("INSERT INTO classes(school_id,name) VALUES(?,?)", (int(body["schoolId"]), name))
            return {"id": cur.lastrowid}
        m = re.match(r"^/api/classes/(\d+)$", p)
        if m and method == "DELETE":
            cid = int(m.group(1))
            con.execute("DELETE FROM timetable WHERE class_id=?", (cid,))
            for a in con.execute("SELECT id FROM announcements WHERE class_id=?", (cid,)).fetchall():
                delete_announcement(con, a["id"])
            for c in con.execute("SELECT id FROM lesson_changes WHERE class_id=?", (cid,)).fetchall():
                drop_notifications(con, "change:%d" % c["id"])
            con.execute("DELETE FROM lesson_changes WHERE class_id=?", (cid,))
            for a in con.execute("SELECT id FROM assessments WHERE class_id=?", (cid,)).fetchall():
                drop_notifications(con, "assessment:%d" % a["id"], "reminder:%d" % a["id"])
            con.execute("DELETE FROM assessments WHERE class_id=?", (cid,))
            con.execute("UPDATE users SET class_id=NULL WHERE class_id=?", (cid,))
            con.execute("DELETE FROM classes WHERE id=?", (cid,))
            return {"ok": True}
        if m and method == "PATCH":  # set or clear the diriginte
            cid, tid = int(m.group(1)), body.get("homeroomTeacherId")
            cls = con.execute("SELECT * FROM classes WHERE id=?", (cid,)).fetchone()
            if not cls:
                raise HttpError(404, "Clasa nu există.")
            if tid is not None:
                tid = int(tid)
                t = user_row(con, tid)
                if not t or t["role"] != "teacher" or t["school_id"] != cls["school_id"]:
                    raise HttpError(400, "Dirigintele trebuie să fie profesor la această școală.")
            con.execute("UPDATE classes SET homeroom_teacher_id=? WHERE id=?", (tid, cid))
            return {"ok": True}

        # ---------- admin: teachers ----------
        if p == "/api/teachers" and method == "POST":
            return add_account(con, "teacher", body.get("name"), body.get("email"), int(body["schoolId"]),
                               subjects=body.get("subjects", []))

        # ---------- admin: students ----------
        if p == "/api/students" and method == "POST":
            return add_account(con, "student", body.get("name"), body.get("email"), int(body["schoolId"]),
                               class_id=body.get("classId"))

        m = re.match(r"^/api/users/(\d+)$", p)
        if m and method == "DELETE":
            r = user_row(con, int(m.group(1)))
            if r:
                remove_users(con, [r])
            return {"ok": True}
        m = re.match(r"^/api/users/(\d+)/reset-password$", p)
        if m and method == "POST":
            r = user_row(con, int(m.group(1)))
            if not r or r["role"] == "admin":
                raise HttpError(400, "Parola acestui cont nu poate fi resetată de aici.")
            if not r["auth_id"]:
                raise HttpError(400, "Acest cont nu are login (a fost creat fără email).")
            pw = reset_auth_password(r["auth_id"])
            forget_email(r["email"])
            return {"id": r["id"], "email": r["email"], "tempPassword": pw}

        # ---------- admin: timetable ----------
        if p == "/api/timetable" and method == "POST":
            cid = int(body["classId"]); day = int(body["day"]); period = int(body["period"])
            start = clean_time(body.get("time"))
            end = clean_time(body.get("end"), "de sfârșit")
            if minutes(end) <= minutes(start):
                raise HttpError(400, "Ora de sfârșit trebuie să fie după ora de început.")
            con.execute("DELETE FROM timetable WHERE class_id=? AND day=? AND period=?", (cid, day, period))
            cur = con.execute("INSERT INTO timetable(class_id,day,period,subject,teacher_id,room,time,end_time) VALUES(?,?,?,?,?,?,?,?)",
                              (cid, day, period, body["subject"], body.get("teacherId"), (body.get("room") or "").strip(), start, end))
            return {"id": cur.lastrowid}
        m = re.match(r"^/api/timetable/(\d+)$", p)
        if m and method == "DELETE":
            for c in con.execute("SELECT id FROM lesson_changes WHERE timetable_id=?", (int(m.group(1)),)).fetchall():
                drop_notifications(con, "change:%d" % c["id"])
            con.execute("DELETE FROM lesson_changes WHERE timetable_id=?", (int(m.group(1)),))
            con.execute("DELETE FROM timetable WHERE id=?", (int(m.group(1)),))
            return {"ok": True}

        # ---------- last-minute lesson changes ----------
        if p == "/api/lesson-changes" and method == "POST":
            return save_lesson_change(con, me, body, now)
        m = re.match(r"^/api/lesson-changes/(\d+)$", p)
        if m and method == "DELETE":
            need(me, "teacher")
            if not con.execute("DELETE FROM lesson_changes WHERE id=? AND author_id=?", (int(m.group(1)), me["id"])).rowcount:
                raise HttpError(404, "not found")
            drop_notifications(con, "change:%s" % m.group(1))
            return {"ok": True}

        # ---------- events and messages ----------
        if p == "/api/events" and method == "POST":
            return post_event(con, me, body, now)
        m = re.match(r"^/api/events/(\d+)$", p)
        if m and method == "DELETE":
            need(me, "teacher", "admin")
            r = con.execute("SELECT * FROM school_events WHERE id=?", (int(m.group(1)),)).fetchone()
            if not r or (me["role"] != "admin" and r["author_id"] != me["id"]):
                raise HttpError(404, "not found")
            con.execute("DELETE FROM school_events WHERE id=?", (r["id"],))
            drop_notifications(con, "event:%d" % r["id"])
            return {"ok": True}
        if p == "/api/messages" and method == "POST":
            return send_message(con, me, body)

        # ---------- student goals ----------
        if p == "/api/goals" and method == "POST":
            need(me, "student")
            con.execute("DELETE FROM subject_goals WHERE student_id=? AND subject=?", (me["id"], body["subject"]))
            if body.get("target"):
                target = int(body["target"])
                if not 2 <= target <= 10:
                    raise HttpError(400, "Obiectivul este o notă de la 2 la 10.")
                con.execute("INSERT INTO subject_goals(student_id,subject,target) VALUES(?,?,?)", (me["id"], body["subject"], target))
            return {"ok": True}

        # ---------- announcements ----------
        if p == "/api/announcements" and method == "POST":
            need(me, "teacher", "admin")
            return post_announcement(con, me, body, now)
        if p == "/api/announcements/read" and method == "POST":
            need(me, "student")
            for a in build_announcements(con, me)["items"]:
                con.execute("INSERT OR IGNORE INTO announcement_reads(announcement_id,student_id,read_at) VALUES(?,?,?)", (a["id"], me["id"], now))
            return {"ok": True}
        m = re.match(r"^/api/announcements/(\d+)$", p)
        if m and method == "DELETE":
            need(me, "teacher", "admin")
            r = con.execute("SELECT * FROM announcements WHERE id=?", (int(m.group(1)),)).fetchone()
            if not r or (me["role"] != "admin" and r["author_id"] != me["id"]):
                raise HttpError(404, "not found")
            delete_announcement(con, r["id"])
            return {"ok": True}

        # ---------- teacher: assessments ----------
        if p == "/api/assessments" and method == "POST":
            need(me, "teacher")
            cid = int(body["classId"])
            need_subject(con, me, cid, body.get("subject"))  # only a subject they teach in this class
            kind = body.get("type", "test")
            if kind not in TYPE_W:
                raise HttpError(400, "Tipul evaluării nu este valid.")
            day = school_day(con, me["school_id"], body.get("date"))
            title = (body.get("title") or "").strip()[:120] or TYPE_LABEL[kind]
            cur = con.execute("INSERT INTO assessments(class_id,subject,type,date,title,teacher_id) VALUES(?,?,?,?,?,?)",
                              (cid, body["subject"], kind, day, title, me["id"]))
            notify_class_assessment(con, cur.lastrowid, cid, body["subject"], kind, day, title)
            return {"ok": True}
        m = re.match(r"^/api/assessments/(\d+)$", p)
        if m and method == "DELETE":
            need(me, "teacher", "admin")
            if me["role"] == "admin":
                con.execute("DELETE FROM assessments WHERE id=?", (int(m.group(1)),))
            elif not con.execute("DELETE FROM assessments WHERE id=? AND teacher_id=?", (int(m.group(1)), me["id"])).rowcount:
                raise HttpError(404, "not found")
            drop_notifications(con, "assessment:%s" % m.group(1), "reminder:%s" % m.group(1))
            return {"ok": True}

        # ---------- student: own tasks + calculator (grades and absences are read-only) ----------
        if p.startswith("/api/tasks") or p == "/api/grades/what-if":
            need(me, "student")
        if p == "/api/notifications/read" and method == "POST":
            need(me, "student")
            con.execute("UPDATE notifications SET read=1 WHERE student_id=?", (me["id"],))
            return {"ok": True}
        m = re.match(r"^/api/tasks/(\d+)$", p)
        if m and method in ("PATCH", "DELETE"):
            tid = int(m.group(1))
            if method == "PATCH":
                cur = con.execute("UPDATE tasks SET done=? WHERE id=? AND student_id=?", (1 if body.get("done") else 0, tid, me["id"]))
            else:
                cur = con.execute("DELETE FROM tasks WHERE id=? AND student_id=?", (tid, me["id"]))
            if not cur.rowcount:
                raise HttpError(404, "not found")
            return {"ok": True}

        if p == "/api/grades/what-if" and method == "POST":
            rows = con.execute("SELECT value FROM grades WHERE student_id=? AND subject=?",
                               (me["id"], body["subject"])).fetchall()
            return grades_needed([r["value"] for r in rows], int(body.get("target", 8)), int(body.get("grade", 10)))

        # ---------- teacher: grades ----------
        if p == "/api/grades" and method == "POST":
            need_student_subject(con, me, body["studentId"], body["subject"])
            value, when, note = grade_value(body["value"]), entry_date(body.get("date"), school_modules(con, me["school_id"])), clean_note(body.get("note"))
            cur = con.execute("INSERT INTO grades(student_id,subject,value,date,teacher_id,note) VALUES(?,?,?,?,?,?)",
                              (int(body["studentId"]), body["subject"], value, when, me["id"], note))
            notify(con, int(body["studentId"]), "grade", "Notă nouă la %s: %s" % (subj_name(body["subject"]), value),
                   " · ".join(x for x in (date_text(when), note, me["name"]) if x), "grade:%d" % cur.lastrowid)
            alert_if_at_risk(con, int(body["studentId"]), body["subject"])
            return {"ok": True}
        m = re.match(r"^/api/grades/(\d+)$", p)
        if m and method == "PATCH":
            r = owned_row(con, "grades", int(m.group(1)), me)
            value = grade_value(body.get("value", r["value"]))
            con.execute("UPDATE grades SET value=?, date=?, note=? WHERE id=?",
                        (value, entry_date(body.get("date", r["date"]), school_modules(con, me["school_id"])), clean_note(body.get("note", r["note"])), r["id"]))
            if value != r["value"]:
                drop_notifications(con, "grade:%d" % r["id"])  # replaces "Notă nouă …: <old value>"
                notify(con, r["student_id"], "grade", "Notă modificată la %s: %s" % (subj_name(r["subject"]), value),
                       "Era %s · %s" % (r["value"], me["name"]), "grade:%d" % r["id"])
                alert_if_at_risk(con, r["student_id"], r["subject"])
            return {"ok": True}
        if m and method == "DELETE":
            g = owned_row(con, "grades", int(m.group(1)), me)
            con.execute("DELETE FROM grades WHERE id=?", (g["id"],))
            drop_notifications(con, "grade:%s" % m.group(1))
            alert_if_at_risk(con, g["student_id"], g["subject"])
            return {"ok": True}

        # ---------- teacher: absences ----------
        if p == "/api/absences" and method == "POST":  # studentId, or studentIds for the whole roll call
            ids = [int(i) for i in body.get("studentIds") or [body["studentId"]]]
            when = entry_date(body.get("date"), school_modules(con, me["school_id"]), weekday=True)
            added = 0
            for sid in ids:
                need_student_subject(con, me, sid, body["subject"])
                if not con.execute("SELECT 1 FROM absences WHERE student_id=? AND subject=? AND date=?",
                                   (sid, body["subject"], when)).fetchone():
                    cur = con.execute("INSERT INTO absences(student_id,subject,kind,date,teacher_id) VALUES(?,?,'unexcused',?,?)",
                                      (sid, body["subject"], when, me["id"]))
                    notify(con, sid, "absence", "Absență nouă la %s" % subj_name(body["subject"]),
                           "%s · %s" % (date_text(when), me["name"]), "absence:%d" % cur.lastrowid)
                    added += 1
            return {"added": added, "alreadyMarked": len(ids) - added}
        m = re.match(r"^/api/absences/(\d+)$", p)
        if m and method == "PATCH":
            need(me, "teacher")
            r = con.execute("SELECT * FROM absences WHERE id=?", (int(m.group(1)),)).fetchone()
            if not r:
                raise HttpError(404, "Înregistrarea nu există.")
            if "excused" in body:  # the diriginte, or whoever recorded it
                cls = con.execute("""SELECT c.homeroom_teacher_id h FROM classes c JOIN users u ON u.class_id=c.id
                                     WHERE u.id=?""", (r["student_id"],)).fetchone()
                if r["teacher_id"] != me["id"] and not (cls and cls["h"] == me["id"]):
                    raise HttpError(403, "Doar dirigintele sau profesorul care a notat absența o poate motiva.")
                con.execute("UPDATE absences SET kind=? WHERE id=?",
                            ("excused" if body["excused"] else "unexcused", r["id"]))
                if not body["excused"] and r["kind"] == "excused":
                    con.execute("DELETE FROM notifications WHERE ref=? AND kind='excused'", ("absence:%d" % r["id"],))
                if body["excused"] and r["kind"] != "excused":
                    notify(con, r["student_id"], "excused", "Absență motivată la %s" % subj_name(r["subject"]),
                           "%s · %s" % (date_text(r["date"]), me["name"]), "absence:%d" % r["id"])
            if "date" in body:
                owned_row(con, "absences", r["id"], me)
                when = entry_date(body["date"], school_modules(con, me["school_id"]), weekday=True)
                if con.execute("SELECT 1 FROM absences WHERE student_id=? AND subject=? AND date=? AND id!=?",
                               (r["student_id"], r["subject"], when, r["id"])).fetchone():
                    raise HttpError(400, "Elevul are deja o absență la această dată.")
                con.execute("UPDATE absences SET date=? WHERE id=?", (when, r["id"]))
            return {"ok": True}
        if m and method == "DELETE":
            con.execute("DELETE FROM absences WHERE id=?", (owned_row(con, "absences", int(m.group(1)), me)["id"],))
            drop_notifications(con, "absence:%s" % m.group(1))
            return {"ok": True}

        # ---------- danger: wipe everything ----------
        if p == "/api/reset" and method == "POST":
            need(me, "admin")
            if os.environ.get("ALLOW_RESET") != "1":
                raise HttpError(403, "Resetarea este dezactivată pe acest server.")
            remove_users(con, con.execute("SELECT * FROM users WHERE role!='admin'").fetchall())
            for t in ["timetable", "assessments", "grades", "absences", "tasks", "notifications", "announcements", "announcement_reads", "school_modules", "lesson_changes", "subject_goals", "school_events", "messages", "classes", "schools"]:
                con.execute("DELETE FROM %s" % t)
            return {"ok": True}

        raise ValueError("unknown route %s %s" % (method, p))


def main():
    init_db()
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("SchoolPilot running on http://localhost:%d  (db: %s)" % (PORT, DB_PATH))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()


if __name__ == "__main__":
    main()
