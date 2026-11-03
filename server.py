#!/usr/bin/env python3
"""
SchoolPilot backend — zero dependencies (Python 3.8+ standard library only).

Run:  python3 server.py           # http://localhost:8000
Env:  PORT=8000  DB=schoolpilot.db

A small HTTP server that serves the SPA in ./public and a JSON REST API
backed by SQLite.  Data is seeded relative to the current week on first run,
so the demo is always populated and dates stay fresh.
"""
import json
import os
import re
import sqlite3
import threading
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
DB_PATH = os.environ.get("DB", os.path.join(ROOT, "schoolpilot.db"))
PORT = int(os.environ.get("PORT", "8000"))

_lock = threading.Lock()

# --------------------------------------------------------------------------- #
#  Reference data
# --------------------------------------------------------------------------- #
SUBJECTS = {
    "mate":  ("Matematică", "d-na Ionescu", "#4B3BE8", "Mate", "A24"),
    "rom":   ("Limba română", "d-na Marin", "#D9488A", "Rom", "B12"),
    "fiz":   ("Fizică", "d-l Pop", "#0E8FB0", "Fiz", "Lab F"),
    "chim":  ("Chimie", "d-na Dima", "#16A34A", "Chim", "Lab C"),
    "bio":   ("Biologie", "d-l Stan", "#6B8E23", "Bio", "Lab B"),
    "ist":   ("Istorie", "d-l Georgescu", "#A1552B", "Ist", "A31"),
    "geo":   ("Geografie", "d-na Radu", "#2E8B8B", "Geo", "A19"),
    "eng":   ("Engleză", "d-na Barbu", "#7C3AED", "Eng", "B07"),
    "info":  ("Informatică", "d-l Albu", "#1F2937", "Info", "IT-2"),
    "sport": ("Educație fizică", "d-l Neagu", "#E8650E", "Sport", "Sala"),
}
PERIODS = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00"]
# timetable[day 0=Mon..4=Fri][period] -> subject code or None
TIMETABLE = [
    ["mate", "rom", "eng", "chim", "ist", None],
    ["fiz", "mate", "bio", "rom", "sport", "info"],
    ["rom", "geo", "mate", "eng", "chim", None],
    ["mate", "fiz", "chim", "ist", "bio", "eng"],
    ["info", "eng", "rom", "geo", "mate", "sport"],
]
TYPE_W = {"test": 3, "quiz": 2, "tema": 1}
TYPE_LABEL = {"test": "Lucrare", "quiz": "Ascultare", "tema": "Temă"}
DAYNAMES = ["Lun", "Mar", "Mie", "Joi", "Vin", "Sâm", "Dum"]
PACK_RULES = {"sport": "Echipament sport", "chim": "Halat de laborator",
              "fiz": "Caiet de laborator", "info": "Laptop / cont"}

# --------------------------------------------------------------------------- #
#  Dates
# --------------------------------------------------------------------------- #
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

MONTHS = ["", "ian", "feb", "mar", "apr", "mai", "iun",
          "iul", "aug", "sep", "oct", "nov", "dec"]

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
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL, type TEXT NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, subject TEXT, type TEXT NOT NULL DEFAULT 'tema',
  due TEXT, done INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL, value INTEGER NOT NULL, date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL, kind TEXT NOT NULL, date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL, text TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal',
  pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL, name TEXT, text TEXT NOT NULL,
  created_at TEXT NOT NULL, deliver_at TEXT, scheduled INTEGER NOT NULL DEFAULT 0
);
"""

def init_db():
    con = connect()
    con.executescript(SCHEMA)
    row = con.execute("SELECT value FROM meta WHERE key='seeded'").fetchone()
    if not row:
        seed(con)
        con.execute("INSERT INTO meta(key,value) VALUES('seeded',?)", (datetime.now().isoformat(),))
    # settings default
    if not con.execute("SELECT 1 FROM meta WHERE key='quiet'").fetchone():
        con.execute("INSERT INTO meta(key,value) VALUES('quiet','1')")
    con.commit()
    con.close()

def seed(con):
    mon = week_monday()
    def d(offset):
        return iso(mon + timedelta(days=offset))
    assessments = [
        ("bio", "quiz", 1, "Ascultare — celula"),
        ("rom", "tema", 2, "Eseu — Ion"),
        ("mate", "test", 3, "Lucrare — funcții"),
        ("fiz", "test", 3, "Test — optică"),
        ("chim", "quiz", 3, "Ascultare — mol"),
        ("eng", "tema", 4, "Essay draft"),
        ("info", "tema", 1, "Temă — array-uri"),
        ("ist", "test", 8, "Test — Interbelic"),
        ("geo", "quiz", 9, "Ascultare — relief"),
    ]
    for s, t, off, title in assessments:
        con.execute("INSERT INTO assessments(subject,type,date,title) VALUES(?,?,?,?)",
                    (s, t, d(off), title))
    now = datetime.now().isoformat()
    tasks = [
        ("Fișa de la pag. 48–49", "mate", "tema", 0),
        ("Citește capitolul despre celulă", "bio", "tema", 0),
        ("Trimite tema cu array-uri (.cpp)", "info", "tema", 0),
        ("Pregătește eseul despre „Ion”", "rom", "tema", 1),
        ("Adu echerul și raportorul", "mate", "tema", 2),
    ]
    for title, s, t, off in tasks:
        con.execute("INSERT INTO tasks(title,subject,type,due,done,source,created_at) VALUES(?,?,?,?,0,'seed',?)",
                    (title, s, t, d(off), now))
    grades = {
        "mate": [(9, "08 oct"), (7, "15 oct"), (8, "24 oct")],
        "rom": [(10, "06 oct"), (9, "21 oct")],
        "fiz": [(6, "09 oct"), (5, "23 oct")],
        "chim": [(8, "07 oct"), (9, "28 oct")],
        "bio": [(9, "12 oct"), (10, "26 oct")],
        "eng": [(10, "05 oct"), (9, "19 oct"), (10, "30 oct")],
        "ist": [(8, "14 oct")],
        "info": [(10, "11 oct"), (9, "27 oct")],
    }
    for s, lst in grades.items():
        for v, dl in lst:
            con.execute("INSERT INTO grades(subject,value,date) VALUES(?,?,?)", (s, v, dl))
    absences = [("fiz", "excused", 1), ("fiz", "unexcused", 2),
                ("sport", "unexcused", 3), ("rom", "excused", 2), ("mate", "excused", 1)]
    for s, kind, n in absences:
        for _ in range(n):
            con.execute("INSERT INTO absences(subject,kind,date) VALUES(?,?,?)", (s, kind, d(0)))
    anns = [
        ("mate", "Lucrarea de joi acoperă funcția de gradul I și II. Rezolvați fișa de la pag. 48–49 până joi. Aduceți echer și raportor.", "urgent", 1),
        ("rom", "Eseul despre „Ion” (min. 400 cuvinte) se trimite miercuri pe platformă. Structura: temă, personaj, perspectivă.", "normal", 0),
        ("info", "Tema cu array-uri (ex. 3–7) e pe clasă. Deadline marți 23:59. Trimiteți un singur fișier .cpp.", "info", 0),
        ("sport", "Marți avem oră în sala mare. Nu uitați echipamentul: tricou, pantofi sport, apă.", "normal", 0),
    ]
    for i, (s, txt, pr, pin) in enumerate(anns):
        ts = (datetime.now() - timedelta(hours=i * 6)).isoformat()
        con.execute("INSERT INTO announcements(subject,text,priority,pinned,created_at) VALUES(?,?,?,?,?)",
                    (s, txt, pr, pin, ts))
    msgs = [
        ("teacher", "d-na Ionescu", "Bună! Da, puteți folosi calculatorul la lucrare, dar nu și la ultimul exercițiu.", 20),
        ("me", None, "Mulțumesc! Și formulele le primim pe fișă?", 17),
        ("teacher", "d-na Ionescu", "Da, formulele principale sunt pe fișă. Restul le știți. 🙂", 11),
    ]
    for sender, name, txt, hours_ago in msgs:
        ts = (datetime.now() - timedelta(hours=hours_ago)).isoformat()
        con.execute("INSERT INTO messages(sender,name,text,created_at,deliver_at,scheduled) VALUES(?,?,?,?,NULL,0)",
                    (sender, name, txt, ts))

# --------------------------------------------------------------------------- #
#  Derived computations
# --------------------------------------------------------------------------- #
def subj_obj(code):
    n, t, hue, short, room = SUBJECTS[code]
    return {"code": code, "name": n, "teacher": t, "hue": hue, "short": short, "room": room}

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

def rel_when(iso_ts):
    try:
        dt = datetime.fromisoformat(iso_ts)
    except Exception:
        return ""
    delta = datetime.now() - dt
    mins = int(delta.total_seconds() // 60)
    if mins < 1:
        return "acum"
    if mins < 60:
        return "acum %d min" % mins
    hrs = mins // 60
    if hrs < 24:
        return "acum %d %s" % (hrs, "oră" if hrs == 1 else "ore")
    days = hrs // 24
    if days == 1:
        return "ieri"
    return "acum %d zile" % days

def fmt_time(iso_ts):
    try:
        return datetime.fromisoformat(iso_ts).strftime("%H:%M")
    except Exception:
        return ""

def assessments_rows(con):
    rows = con.execute("SELECT * FROM assessments ORDER BY date").fetchall()
    return [dict(r) for r in rows]

def build_workload(con):
    rows = assessments_rows(con)
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
            days.append({
                "date": iso(d), "dateLabel": day_label(d), "score": score,
                "items": [{"subject": it["subject"], "type": it["type"],
                           "short": SUBJECTS[it["subject"]][3]} for it in items],
                "heat": heat_of(score), "clash": len(graded) >= 2,
            })
        weeks.append({"label": "Săptămâna aceasta" if w == 0 else "Săptămâna viitoare", "days": days})
    collisions = []
    for wk in weeks:
        for day in wk["days"]:
            graded = [it for it in day["items"] if it["type"] != "tema"]
            if len(graded) >= 2:
                collisions.append({"dateLabel": day["dateLabel"], "items": graded})
    flat = [day for wk in weeks for day in wk["days"]]
    upcoming = [d for d in flat if parse_iso(d["date"]) >= today()]
    suggestions = sorted(upcoming, key=lambda d: d["score"])[:3]
    return {"weeks": weeks, "collisions": collisions, "suggestions": suggestions}

def build_today(con):
    t = today()
    wd = t.weekday()
    is_weekend = wd > 4
    idx = wd if not is_weekend else 0
    classes = []
    for p, code in enumerate(TIMETABLE[idx]):
        if not code:
            continue
        classes.append({
            "subject": code, "name": SUBJECTS[code][0], "teacher": SUBJECTS[code][1],
            "hue": SUBJECTS[code][2], "short": SUBJECTS[code][3],
            "time": PERIODS[p], "room": SUBJECTS[code][4],
            "current": (not is_weekend) and p == min(1, len(PERIODS) - 1),
        })
    pack = []
    seen = set()
    for c in classes:
        rule = PACK_RULES.get(c["subject"])
        if rule and rule not in seen:
            seen.add(rule)
            pack.append(rule)
    pack.append("Caietele de azi")
    label = "%s, %d %s" % (["Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"][wd],
                           t.day, MONTHS[t.month])
    return {"weekdayIdx": idx, "isWeekend": is_weekend, "dateLabel": label,
            "dayName": ["Luni", "Marți", "Miercuri", "Joi", "Vineri", "Luni", "Luni"][wd],
            "classes": classes, "pack": pack}

def build_timetable(con):
    rows = assessments_rows(con)
    mon = week_monday()
    amap = {}
    for r in rows:
        amap.setdefault(r["date"], {})[r["subject"]] = r["type"]
    days = []
    for di in range(5):
        dkey = iso(mon + timedelta(days=di))
        col = []
        for p, code in enumerate(TIMETABLE[di]):
            if not code:
                col.append(None)
            else:
                at = amap.get(dkey, {}).get(code)
                col.append({"subject": code, "short": SUBJECTS[code][3],
                            "room": SUBJECTS[code][4], "hue": SUBJECTS[code][2],
                            "assessment": at})
        days.append(col)
    week_lbl = "%d–%d %s" % (mon.day, (mon + timedelta(days=4)).day, MONTHS[(mon + timedelta(days=4)).month])
    return {"periods": PERIODS, "days": days, "weekLabel": week_lbl, "todayIdx": build_today(con)["weekdayIdx"]}

def build_tasks(con):
    rows = con.execute("SELECT * FROM tasks ORDER BY done, due").fetchall()
    out = []
    t = today()
    for r in rows:
        due = r["due"]
        bucket = "later"
        due_label = ""
        if due:
            dd = parse_iso(due)
            delta = (dd - t).days
            if delta <= 0:
                bucket, due_label = "today", "azi"
            elif delta == 1:
                bucket, due_label = "tomorrow", "mâine"
            else:
                bucket, due_label = "later", day_label(dd)
        out.append({"id": r["id"], "title": r["title"], "subject": r["subject"],
                    "type": r["type"], "typeLabel": TYPE_LABEL.get(r["type"], r["type"]),
                    "due": due, "dueLabel": due_label, "bucket": bucket,
                    "done": bool(r["done"]), "source": r["source"]})
    return out

def build_grades(con):
    rows = con.execute("SELECT * FROM grades ORDER BY id").fetchall()
    bysub = {}
    for r in rows:
        bysub.setdefault(r["subject"], []).append(r)
    subs = []
    for code in SUBJECTS:
        lst = bysub.get(code, [])
        if not lst:
            continue
        vals = [r["value"] for r in lst]
        avg = round(sum(vals) / len(vals), 2)
        subs.append({"code": code, "name": SUBJECTS[code][0], "hue": SUBJECTS[code][2],
                     "short": SUBJECTS[code][3], "teacher": SUBJECTS[code][1],
                     "avg": avg, "risk": avg < 6,
                     "values": [{"v": r["value"], "d": r["date"]} for r in lst]})
    overall = round(sum(s["avg"] for s in subs) / len(subs), 2) if subs else 0
    best = max(subs, key=lambda s: s["avg"]) if subs else None
    worst = min(subs, key=lambda s: s["avg"]) if subs else None
    return {"overall": overall, "subjects": subs,
            "best": {"short": best["short"], "avg": best["avg"]} if best else None,
            "worst": {"short": worst["short"], "avg": worst["avg"]} if worst else None}

def build_absences(con):
    rows = con.execute("SELECT subject, kind, COUNT(*) n FROM absences GROUP BY subject, kind").fetchall()
    bysub = {}
    for r in rows:
        bysub.setdefault(r["subject"], {"excused": 0, "unexcused": 0})[r["kind"]] = r["n"]
    subs = []
    tot_un = tot_ex = 0
    for code, v in bysub.items():
        tot_un += v["unexcused"]
        tot_ex += v["excused"]
        subs.append({"code": code, "name": SUBJECTS[code][0], "hue": SUBJECTS[code][2],
                     "unexcused": v["unexcused"], "excused": v["excused"]})
    subs.sort(key=lambda s: -s["unexcused"])
    return {"totUn": tot_un, "totEx": tot_ex, "threshold": 10, "subjects": subs}

def build_announcements(con):
    rows = con.execute("SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC").fetchall()
    return [{"id": r["id"], "subject": r["subject"], "name": SUBJECTS[r["subject"]][0],
             "teacher": SUBJECTS[r["subject"]][1], "hue": SUBJECTS[r["subject"]][2],
             "text": r["text"], "priority": r["priority"], "pinned": bool(r["pinned"]),
             "when": rel_when(r["created_at"])} for r in rows]

def build_messages(con):
    quiet = con.execute("SELECT value FROM meta WHERE key='quiet'").fetchone()
    quiet_on = (quiet["value"] == "1") if quiet else True
    rows = con.execute("SELECT * FROM messages ORDER BY created_at").fetchall()
    items = []
    for r in rows:
        items.append({"id": r["id"], "from": r["sender"], "name": r["name"], "text": r["text"],
                      "time": rel_when(r["created_at"]) if r["sender"] == "teacher" else fmt_time(r["created_at"]),
                      "scheduled": bool(r["scheduled"]),
                      "deliverAt": fmt_time(r["deliver_at"]) if r["deliver_at"] else None})
    return {"quiet": quiet_on, "items": items}

def subjects_map():
    return {code: subj_obj(code) for code in SUBJECTS}

def full_state(con, role="student"):
    return {
        "role": role,
        "student": {"name": "Ana Popescu", "class": "10B"},
        "subjects": subjects_map(),
        "typeLabel": TYPE_LABEL,
        "today": build_today(con),
        "timetable": build_timetable(con),
        "workload": build_workload(con),
        "tasks": build_tasks(con),
        "grades": build_grades(con),
        "absences": build_absences(con),
        "announcements": build_announcements(con),
        "messages": build_messages(con),
    }

# --------------------------------------------------------------------------- #
#  "AI" announcement parser + what-if calculator
# --------------------------------------------------------------------------- #
DOW = {"luni": 0, "marți": 1, "marti": 1, "miercuri": 2, "joi": 3, "vineri": 4}

def parse_tasks(text):
    mon = week_monday()
    pieces = re.split(r"\n|(?<=[.!?])\s+(?=[A-ZĂÂÎȘȚ])", text)
    out = []
    for line in pieces:
        line = line.strip()
        if len(line) < 4:
            continue
        low = line.lower()
        typ = "tema"
        if re.search(r"lucrare|test|teză|teza|examen", low):
            typ = "test"
        elif re.search(r"ascultare|oral|verific", low):
            typ = "quiz"
        due = None
        date_label = None
        for k, v in DOW.items():
            if k in low:
                dd = mon + timedelta(days=v)
                due = iso(dd)
                date_label = day_label(dd)
                break
        if not date_label:
            m = re.search(r"\b(\d{1,2})[.\/](\d{1,2})\b", low)
            if m:
                date_label = "%s.%s" % (m.group(1), m.group(2))
        pages = None
        pm = re.search(r"pag\.?\s*([\d\s–\-]+\d)", low)
        if pm:
            pages = pm.group(1).strip()
        title = line if len(line) <= 90 else line[:88] + "…"
        out.append({"title": title, "type": typ, "typeLabel": TYPE_LABEL[typ],
                    "due": due, "dateLabel": date_label, "pages": pages})
    return out

def what_if(values, target, n):
    n = max(1, int(n))
    total = len(values) + n
    need = (target * total - sum(values)) / n
    return {"need": round(need + 0.004, 2), "reachable": need <= 10, "trivial": need <= 1}

# --------------------------------------------------------------------------- #
#  HTTP handler
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    server_version = "SchoolPilot/1.0"

    def log_message(self, fmt, *args):
        pass  # quiet

    # ---- helpers ----
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
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return {}

    def _role(self):
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        return (q.get("role", ["student"])[0]) or "student"

    def _state(self, con, code=200):
        self._json(full_state(con, self._role()), code)

    def _static(self):
        from urllib.parse import urlparse, unquote
        path = unquote(urlparse(self.path).path)
        if path == "/" or path == "":
            path = "/index.html"
        target = os.path.normpath(os.path.join(PUBLIC, path.lstrip("/")))
        if not target.startswith(PUBLIC) or not os.path.isfile(target):
            target = os.path.join(PUBLIC, "index.html")  # SPA fallback
        ctypes = {".html": "text/html; charset=utf-8", ".js": "text/javascript",
                  ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json",
                  ".png": "image/png", ".ico": "image/x-icon"}
        ext = os.path.splitext(target)[1]
        with open(target, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctypes.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ---- verbs ----
    def do_GET(self):
        if self.path.split("?")[0] == "/api/state":
            with _lock:
                con = connect()
                try:
                    self._state(con)
                finally:
                    con.close()
            return
        if self.path.startswith("/api/"):
            return self._json({"error": "not found"}, 404)
        try:
            self._static()
        except Exception as e:
            self._json({"error": str(e)}, 500)

    def do_POST(self):
        return self._mutate("POST")

    def do_PATCH(self):
        return self._mutate("PATCH")

    def do_DELETE(self):
        return self._mutate("DELETE")

    def _mutate(self, method):
        path = self.path.split("?")[0]
        if not path.startswith("/api/"):
            return self._json({"error": "not found"}, 404)
        body = self._body()
        with _lock:
            con = connect()
            try:
                result = self.route(method, path, body, con)
                con.commit()
                if result is None:
                    self._state(con)
                else:
                    self._json(result)
            except KeyError as e:
                self._json({"error": "bad field %s" % e}, 400)
            except Exception as e:
                self._json({"error": str(e)}, 400)
            finally:
                con.close()

    # ---- routing (returns None => respond with full state) ----
    def route(self, method, path, body, con):
        m = re.match(r"^/api/tasks/(\d+)$", path)
        if m:
            tid = int(m.group(1))
            if method == "PATCH":
                con.execute("UPDATE tasks SET done=? WHERE id=?", (1 if body.get("done") else 0, tid))
                return None
            if method == "DELETE":
                con.execute("DELETE FROM tasks WHERE id=?", (tid,))
                return None

        if path == "/api/tasks" and method == "POST":
            title = (body.get("title") or "").strip()
            if not title:
                raise ValueError("title required")
            con.execute("INSERT INTO tasks(title,subject,type,due,done,source,created_at) VALUES(?,?,?,?,0,'manual',?)",
                        (title, body.get("subject"), body.get("type", "tema"),
                         body.get("due"), datetime.now().isoformat()))
            return None

        if path == "/api/tasks/import" and method == "POST":
            now = datetime.now().isoformat()
            for t in body.get("tasks", []):
                con.execute("INSERT INTO tasks(title,subject,type,due,done,source,created_at) VALUES(?,?,?,?,0,'ai',?)",
                            (t.get("title", "Sarcină"), t.get("subject"), t.get("type", "tema"),
                             t.get("due"), now))
            return None

        if path == "/api/parse" and method == "POST":
            return {"tasks": parse_tasks(body.get("text", ""))}

        if path == "/api/grades" and method == "POST":
            v = int(body["value"])
            if not (1 <= v <= 10):
                raise ValueError("grade must be 1..10")
            con.execute("INSERT INTO grades(subject,value,date) VALUES(?,?,?)",
                        (body["subject"], v, "%d %s" % (today().day, MONTHS[today().month])))
            return None

        if path == "/api/grades/what-if" and method == "POST":
            rows = con.execute("SELECT value FROM grades WHERE subject=?", (body["subject"],)).fetchall()
            vals = [r["value"] for r in rows]
            return what_if(vals, float(body.get("target", 8)), int(body.get("n", 1)))

        if path == "/api/absences" and method == "POST":
            con.execute("INSERT INTO absences(subject,kind,date) VALUES(?,?,?)",
                        (body["subject"], body.get("kind", "unexcused"), iso(today())))
            return None

        if path == "/api/announcements" and method == "POST":
            con.execute("INSERT INTO announcements(subject,text,priority,pinned,created_at) VALUES(?,?,?,?,?)",
                        (body["subject"], body["text"], body.get("priority", "normal"),
                         1 if body.get("pinned") else 0, datetime.now().isoformat()))
            return None

        if path == "/api/assessments" and method == "POST":
            con.execute("INSERT INTO assessments(subject,type,date,title) VALUES(?,?,?,?)",
                        (body["subject"], body.get("type", "test"), body["date"],
                         body.get("title", "Evaluare")))
            return None

        if path == "/api/messages" and method == "POST":
            text = (body.get("text") or "").strip()
            if not text:
                raise ValueError("text required")
            quiet_row = con.execute("SELECT value FROM meta WHERE key='quiet'").fetchone()
            quiet_on = (quiet_row["value"] == "1") if quiet_row else True
            now = datetime.now()
            deliver_at, scheduled = None, 0
            if quiet_on and (now.hour >= 21 or now.hour < 7):
                nd = now.replace(hour=7, minute=0, second=0, microsecond=0)
                if now.hour >= 7:
                    nd = nd + timedelta(days=1)
                deliver_at, scheduled = nd.isoformat(), 1
            con.execute("INSERT INTO messages(sender,name,text,created_at,deliver_at,scheduled) VALUES('me',NULL,?,?,?,?)",
                        (text, now.isoformat(), deliver_at, scheduled))
            return None

        if path == "/api/settings" and method == "POST":
            if "quiet" in body:
                con.execute("INSERT INTO meta(key,value) VALUES('quiet',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                            ("1" if body["quiet"] else "0",))
            return None

        if path == "/api/reset" and method == "POST":
            for t in ["assessments", "tasks", "grades", "absences", "announcements", "messages"]:
                con.execute("DELETE FROM %s" % t)
            con.execute("DELETE FROM meta WHERE key='seeded'")
            seed(con)
            con.execute("INSERT INTO meta(key,value) VALUES('seeded',?)", (datetime.now().isoformat(),))
            return None

        raise ValueError("unknown route %s %s" % (method, path))


def main():
    init_db()
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("SchoolPilot running on http://localhost:%d  (db: %s)" % (PORT, DB_PATH))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
        httpd.shutdown()


if __name__ == "__main__":
    main()
