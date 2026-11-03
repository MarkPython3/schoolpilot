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
}
PERIODS = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00"]
TYPE_W = {"test": 3, "quiz": 2, "tema": 1}
TYPE_LABEL = {"test": "Lucrare", "quiz": "Ascultare", "tema": "Temă"}
DAYNAMES = ["Lun", "Mar", "Mie", "Joi", "Vin", "Sâm", "Dum"]
FULLDAYS = ["Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"]
MONTHS = ["", "ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "nov", "dec"]
PACK_RULES = {"sport": "Echipament sport", "chim": "Halat de laborator",
              "fiz": "Caiet de laborator", "info": "Laptop / cont", "art": "Trusă de desen"}

def today():
    return date.today()

def week_monday(d=None):
    d = d or today()
    return d - timedelta(days=d.weekday())

def iso(d):
    return d.isoformat()

def parse_iso(s):
    return date.fromisoformat(s)

def day_label(d):
    return "%s %d" % (DAYNAMES[d.weekday()], d.day)

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
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL, name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, name TEXT NOT NULL,
  school_id INTEGER, class_id INTEGER, subjects TEXT NOT NULL DEFAULT '[]',
  email TEXT, auth_id TEXT
);
CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY AUTOINCREMENT, class_id INTEGER NOT NULL,
  day INTEGER NOT NULL, period INTEGER NOT NULL,
  subject TEXT NOT NULL, teacher_id INTEGER, room TEXT
);
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, class_id INTEGER NOT NULL,
  subject TEXT NOT NULL, type TEXT NOT NULL, date TEXT NOT NULL,
  title TEXT NOT NULL, teacher_id INTEGER
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  subject TEXT NOT NULL, value INTEGER NOT NULL, date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  subject TEXT NOT NULL, kind TEXT NOT NULL, date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
  title TEXT NOT NULL, subject TEXT, type TEXT NOT NULL DEFAULT 'tema',
  due TEXT, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
"""

def init_db():
    con = connect()
    con.executescript(SCHEMA)
    cols = [r["name"] for r in con.execute("PRAGMA table_info(users)").fetchall()]
    for col in ("email", "auth_id"):  # databases created before login existed
        if col not in cols:
            con.execute("ALTER TABLE users ADD COLUMN %s TEXT" % col)
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
        for t in ("grades", "absences", "tasks"):
            con.execute("DELETE FROM %s WHERE student_id=?" % t, (uid,))
        con.execute("UPDATE timetable SET teacher_id=NULL WHERE teacher_id=?", (uid,))
        con.execute("UPDATE assessments SET teacher_id=NULL WHERE teacher_id=?", (uid,))
        con.execute("DELETE FROM users WHERE id=?", (uid,))

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
        classes = [{"id": c["id"], "name": c["name"],
                    "students": con.execute("SELECT COUNT(*) n FROM users WHERE role='student' AND class_id=?", (c["id"],)).fetchone()["n"],
                    "slots": con.execute("SELECT COUNT(*) n FROM timetable WHERE class_id=?", (c["id"],)).fetchone()["n"]}
                   for c in con.execute("SELECT * FROM classes WHERE school_id=? ORDER BY name", (sid,)).fetchall()]
        teachers = [{"id": t["id"], "name": t["name"], "subjects": json.loads(t["subjects"] or "[]"),
                     "email": t["email"], "hasLogin": bool(t["auth_id"])}
                    for t in con.execute("SELECT * FROM users WHERE role='teacher' AND school_id=? ORDER BY name", (sid,)).fetchall()]
        students = [{"id": u["id"], "name": u["name"], "classId": u["class_id"],
                     "className": class_name(con, u["class_id"]), "email": u["email"], "hasLogin": bool(u["auth_id"])}
                    for u in con.execute("SELECT * FROM users WHERE role='student' AND school_id=? ORDER BY name", (sid,)).fetchall()]
        schools.append({"id": sid, "name": s["name"], "classes": classes,
                        "teachers": teachers, "students": students})
    return {"schools": schools, "subjects": subjects_catalog(), "periods": PERIODS}

def build_timetable(con, class_id):
    grid = [[None] * len(PERIODS) for _ in range(5)]
    for r in con.execute("SELECT * FROM timetable WHERE class_id=? ORDER BY day,period", (class_id,)).fetchall():
        if 0 <= r["day"] < 5 and 0 <= r["period"] < len(PERIODS):
            grid[r["day"]][r["period"]] = {
                "id": r["id"], "subject": r["subject"], "subjectName": subj_name(r["subject"]),
                "short": subj_short(r["subject"]), "hue": subj_hue(r["subject"]),
                "teacherId": r["teacher_id"], "teacher": teacher_name(con, r["teacher_id"]),
                "room": r["room"] or "",
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
            score = sum(TYPE_W[it["type"]] for it in items)
            graded = [it for it in items if it["type"] != "tema"]
            days.append({"date": iso(d), "dateLabel": day_label(d), "score": score,
                         "heat": heat_of(score), "clash": len(graded) >= 2,
                         "items": [{"subject": it["subject"], "type": it["type"],
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
                "period": r["period"], "time": PERIODS[r["period"]] if r["period"] < len(PERIODS) else "",
                "subject": r["subject"], "subjectName": subj_name(r["subject"]), "hue": subj_hue(r["subject"]),
                "className": class_name(con, r["class_id"]), "classId": r["class_id"], "room": r["room"] or "",
            })
    for d in schedule:
        d.sort(key=lambda x: x["period"])
    classes = [{"id": cid, "name": class_name(con, cid)} for cid in class_ids]
    wd = today().weekday()
    return {
        "teacher": {"id": uid, "name": u["name"], "school": school_name(con, u["school_id"]),
                    "subjects": json.loads(u["subjects"] or "[]")},
        "classes": classes, "schedule": schedule, "periods": PERIODS,
        "todayIdx": wd if wd <= 4 else None,
        "subjectCatalog": subjects_catalog(),
    }

# ---- student snapshot ----
def build_student(con, uid):
    u = user_row(con, uid)
    cid = u["class_id"]
    cls = class_name(con, cid)
    tt = build_timetable(con, cid) if cid else [[None] * len(PERIODS) for _ in range(5)]
    wd = today().weekday()
    is_weekend = wd > 4
    idx = wd if not is_weekend else 0
    now_hour = datetime.now().hour
    classes_today = []
    for p, cell in enumerate(tt[idx]):
        if not cell:
            continue
        ptime = PERIODS[p]
        classes_today.append({**cell, "time": ptime,
                              "current": (not is_weekend) and int(ptime.split(":")[0]) == now_hour})
    pack, seen = [], set()
    for c in classes_today:
        rule = PACK_RULES.get(c["subject"])
        if rule and rule not in seen:
            seen.add(rule)
            pack.append(rule)
    if classes_today:
        pack.append("Caietele de azi")
    # assessments for the class
    assess = con.execute("SELECT * FROM assessments WHERE class_id=? ORDER BY date", (cid,)).fetchall() if cid else []
    t = today()
    due = []
    for a in assess:
        dd = parse_iso(a["date"])
        delta = (dd - t).days
        if 0 <= delta <= 1:
            due.append({"id": "a%d" % a["id"], "title": a["title"], "subject": a["subject"],
                        "short": subj_short(a["subject"]), "typeLabel": TYPE_LABEL[a["type"]],
                        "bucket": "today" if delta == 0 else "tomorrow",
                        "dueLabel": "azi" if delta == 0 else "mâine", "kind": "assessment"})
    # personal tasks
    tasks = []
    for r in con.execute("SELECT * FROM tasks WHERE student_id=? ORDER BY done, due", (uid,)).fetchall():
        bucket, dl = "later", ""
        if r["due"]:
            delta = (parse_iso(r["due"]) - t).days
            if delta <= 0:
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
    week_lbl = "%d–%d %s" % (mon.day, (mon + timedelta(days=4)).day, MONTHS[(mon + timedelta(days=4)).month])
    # grades
    grades = build_grades(con, uid)
    absences = build_absences(con, uid)
    label = "%s, %d %s" % (FULLDAYS[wd], t.day, MONTHS[t.month])
    return {
        "student": {"id": uid, "name": u["name"], "class": cls, "classId": cid,
                    "school": school_name(con, u["school_id"])},
        "subjects": {c: {"name": n, "hue": hue, "short": s} for c, (n, hue, s) in SUBJECTS.items()},
        "typeLabel": TYPE_LABEL,
        "today": {"weekdayIdx": idx, "isWeekend": is_weekend, "dateLabel": label,
                  "classes": classes_today, "pack": pack, "due": due + due_tasks},
        "timetable": {"periods": PERIODS, "days": days, "weekLabel": week_lbl, "todayIdx": idx},
        "tasks": tasks,
        "grades": grades, "absences": absences,
        "hasTimetable": bool(cid and any(any(row) for row in tt)),
    }

def build_grades(con, student_id):
    rows = con.execute("SELECT * FROM grades WHERE student_id=? ORDER BY id", (student_id,)).fetchall()
    bysub = {}
    for r in rows:
        bysub.setdefault(r["subject"], []).append(r)
    subs = []
    for code, lst in bysub.items():
        vals = [r["value"] for r in lst]
        avg = round(sum(vals) / len(vals), 2)
        subs.append({"code": code, "name": subj_name(code), "hue": subj_hue(code), "short": subj_short(code),
                     "avg": avg, "risk": avg < 6, "values": [{"v": r["value"], "d": r["date"]} for r in lst]})
    subs.sort(key=lambda s: s["name"])
    overall = round(sum(s["avg"] for s in subs) / len(subs), 2) if subs else 0
    best = max(subs, key=lambda s: s["avg"]) if subs else None
    worst = min(subs, key=lambda s: s["avg"]) if subs else None
    return {"overall": overall, "subjects": subs,
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
        if path in ("", "/"):
            path = "/index.html"
        target = os.path.normpath(os.path.join(PUBLIC, path.lstrip("/")))
        if not target.startswith(PUBLIC) or not os.path.isfile(target):
            target = os.path.join(PUBLIC, "index.html")
        ctypes = {".html": "text/html; charset=utf-8", ".js": "text/javascript",
                  ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json"}
        ext = os.path.splitext(target)[1]
        with open(target, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctypes.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _me(self, con, p):
        """The local user behind the request's Supabase access token.
        Identity comes only from the token; ids in the request are never trusted."""
        h = self.headers.get("Authorization", "")
        if not h.startswith("Bearer ") or not h[7:].strip():
            raise HttpError(401, "Autentificare necesară.")
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
            raise HttpError(403, "Trebuie să îți setezi o parolă nouă.")
        return me, info

    def _api(self, fn):
        with _lock:
            con = connect()
            try:
                res = fn(con)
                con.commit()
                self._json(res if res is not None else {"ok": True})
            except HttpError as e:
                self._json({"error": e.msg}, e.code)
            except KeyError as e:
                self._json({"error": "missing field %s" % e}, 400)
            except Exception as e:
                self._json({"error": str(e)}, 400)
            finally:
                con.close()

    def do_GET(self):
        p = urlparse(self.path).path
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
            return build_me(con, me, info["must_change"])
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
        if p == "/api/student":
            need(me, "student")
            return build_student(con, me["id"])
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
        m = re.match(r"^/api/schools/(\d+)$", p)
        if m and method == "DELETE":
            sid = int(m.group(1))
            cids = [r["id"] for r in con.execute("SELECT id FROM classes WHERE school_id=?", (sid,)).fetchall()]
            for cid in cids:
                con.execute("DELETE FROM timetable WHERE class_id=?", (cid,))
                con.execute("DELETE FROM assessments WHERE class_id=?", (cid,))
            remove_users(con, con.execute("SELECT * FROM users WHERE school_id=? AND role!='admin'", (sid,)).fetchall())
            con.execute("DELETE FROM classes WHERE school_id=?", (sid,))
            con.execute("DELETE FROM schools WHERE id=?", (sid,))
            return {"ok": True}

        # ---------- admin: classes ----------
        if p == "/api/classes" and method == "POST":
            cur = con.execute("INSERT INTO classes(school_id,name) VALUES(?,?)",
                              (int(body["schoolId"]), (body["name"] or "").strip()))
            return {"id": cur.lastrowid}
        m = re.match(r"^/api/classes/(\d+)$", p)
        if m and method == "DELETE":
            cid = int(m.group(1))
            con.execute("DELETE FROM timetable WHERE class_id=?", (cid,))
            con.execute("DELETE FROM assessments WHERE class_id=?", (cid,))
            con.execute("UPDATE users SET class_id=NULL WHERE class_id=?", (cid,))
            con.execute("DELETE FROM classes WHERE id=?", (cid,))
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
            con.execute("DELETE FROM timetable WHERE class_id=? AND day=? AND period=?", (cid, day, period))
            cur = con.execute("INSERT INTO timetable(class_id,day,period,subject,teacher_id,room) VALUES(?,?,?,?,?,?)",
                              (cid, day, period, body["subject"], body.get("teacherId"), (body.get("room") or "").strip()))
            return {"id": cur.lastrowid}
        m = re.match(r"^/api/timetable/(\d+)$", p)
        if m and method == "DELETE":
            con.execute("DELETE FROM timetable WHERE id=?", (int(m.group(1)),))
            return {"ok": True}

        # ---------- teacher: assessments ----------
        if p == "/api/assessments" and method == "POST":
            need(me, "teacher")
            cid = int(body["classId"])
            need_class(con, me, cid)
            con.execute("INSERT INTO assessments(class_id,subject,type,date,title,teacher_id) VALUES(?,?,?,?,?,?)",
                        (cid, body["subject"], body.get("type", "test"),
                         body["date"], (body.get("title") or TYPE_LABEL.get(body.get("type", "test"), "Evaluare")),
                         me["id"]))
            return {"ok": True}
        m = re.match(r"^/api/assessments/(\d+)$", p)
        if m and method == "DELETE":
            need(me, "teacher", "admin")
            if me["role"] == "admin":
                con.execute("DELETE FROM assessments WHERE id=?", (int(m.group(1)),))
            elif not con.execute("DELETE FROM assessments WHERE id=? AND teacher_id=?", (int(m.group(1)), me["id"])).rowcount:
                raise HttpError(404, "not found")
            return {"ok": True}

        # ---------- student: own tasks, grades, absences ----------
        if re.match(r"^/api/(tasks|grades|absences)(/|$)", p):
            need(me, "student")
        if p == "/api/tasks" and method == "POST":
            con.execute("INSERT INTO tasks(student_id,title,subject,type,due,done,created_at) VALUES(?,?,?,?,?,0,?)",
                        (me["id"], (body["title"] or "").strip(), body.get("subject"),
                         body.get("type", "tema"), body.get("due"), now))
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

        if p == "/api/grades" and method == "POST":
            v = int(body["value"])
            if not (1 <= v <= 10):
                raise ValueError("grade 1..10")
            con.execute("INSERT INTO grades(student_id,subject,value,date) VALUES(?,?,?,?)",
                        (me["id"], body["subject"], v,
                         "%d %s" % (today().day, MONTHS[today().month])))
            return {"ok": True}
        if p == "/api/grades/what-if" and method == "POST":
            rows = con.execute("SELECT value FROM grades WHERE student_id=? AND subject=?",
                               (me["id"], body["subject"])).fetchall()
            return what_if([r["value"] for r in rows], float(body.get("target", 8)), int(body.get("n", 1)))
        if p == "/api/absences" and method == "POST":
            con.execute("INSERT INTO absences(student_id,subject,kind,date) VALUES(?,?,?,?)",
                        (me["id"], body["subject"], body.get("kind", "unexcused"), iso(today())))
            return {"ok": True}

        # ---------- danger: wipe everything ----------
        if p == "/api/reset" and method == "POST":
            remove_users(con, con.execute("SELECT * FROM users WHERE role!='admin'").fetchall())
            for t in ["timetable", "assessments", "grades", "absences", "tasks", "classes", "schools"]:
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
