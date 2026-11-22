#!/usr/bin/env python3
"""
Fill the SchoolPilot database with a demo school.

WIPES the existing data first (everything except the admin account), then adds:
class 10B with 25 students, 9 teachers, a full Mon-Fri timetable (7 lessons Mon-Thu), an upcoming
Thursday with three tests (a collision), grades, absences and a few tasks.
One student (Matei Constantin) has a physics average close to failing.
Seeded people have no email, so they can't log in; they only populate the views.

Run:  python3 seed.py            # same DB as server.py (env DB=... respected)
Dates are relative to today, so re-run it before a demo.
"""
import json
import random
from datetime import datetime, timedelta

from server import connect, init_db, iso, today, week_monday

SCHOOL = "Liceul Teoretic Demo"
CLASS = "10B"

STUDENTS = [
    "Ana Popa", "Andrei Dumitru", "Bianca Stoica", "Cristian Rusu", "Daria Moldovan",
    "David Gheorghe", "Elena Mihăilă", "Ștefan Tănase", "Ioana Lungu", "Luca Barbu",
    "Maria Ilie", "Matei Constantin", "Alexandra Dobre", "Mihai Neagu", "Natalia Cristea",
    "Patricia Toma", "Răzvan Enache", "Sara Oprea", "Sebastian Nistor", "Sofia Petrescu",
    "Tudor Vasilescu", "Irina Bălan", "Vlad Ciobanu", "Teodora Avram", "Alexandru Țurcanu",
]
AT_RISK = "Matei Constantin"

TEACHERS = [  # (name, subjects)
    ("Elena Popescu", ["mate"]),
    ("Mihai Ionescu", ["fiz"]),
    ("Ioana Dumitrescu", ["rom"]),
    ("Andrei Stan", ["chim", "bio"]),
    ("Cristina Marin", ["eng", "fra"]),
    ("Radu Georgescu", ["ist", "geo"]),
    ("Gabriela Tudor", ["info"]),
    ("Victor Munteanu", ["sport", "art"]),
    ("Daniela Iordache", ["rel", "muz"]),
]

TIMETABLE = [  # one row per weekday, periods from 08:00
    ["rom", "mate", "fiz", "eng", "ist", "sport", "rel"],    # Luni
    ["mate", "rom", "chim", "bio", "geo", "info", "eng"],    # Marți
    ["rom", "mate", "fra", "info", "art", "eng", "muz"],     # Miercuri
    ["mate", "fiz", "chim", "rom", "bio", "sport", "ist"],   # Joi
    ["fiz", "ist", "fra", "geo", "eng", "bio"],              # Vineri
]
ROOMS = {"fiz": "Lab F", "chim": "Lab C", "bio": "Lab B", "info": "Lab Info",
         "sport": "Sala de sport", "art": "Atelier"}
HOMEROOM = "Sala 12"


def wipe(con):
    real = con.execute("SELECT COUNT(*) FROM users WHERE role!='admin' AND auth_id IS NOT NULL").fetchone()[0]
    if real:
        raise SystemExit("Refusing to wipe: %d accounts have a Supabase login. Delete them from the admin "
                         "panel first (that also removes them in Supabase)." % real)
    for t in ["timetable", "assessments", "grades", "absences", "tasks", "notifications", "announcements", "announcement_reads", "school_modules", "lesson_changes", "subject_goals", "school_events", "messages", "classes", "schools"]:
        con.execute("DELETE FROM %s" % t)
    con.execute("DELETE FROM users WHERE role!='admin'")


def seed(con):
    rnd = random.Random(10)
    now = datetime.now().isoformat()
    t = today()

    sid = con.execute("INSERT INTO schools(name,created_at) VALUES(?,?)", (SCHOOL, now)).lastrowid
    cid = con.execute("INSERT INTO classes(school_id,name) VALUES(?,?)", (sid, CLASS)).lastrowid

    teacher_of = {}
    for name, subs in TEACHERS:
        tid = con.execute("INSERT INTO users(role,name,school_id,subjects) VALUES('teacher',?,?,?)",
                          (name, sid, json.dumps(subs))).lastrowid
        for s in subs:
            teacher_of[s] = tid

    students = {}
    for name in STUDENTS:
        students[name] = con.execute("INSERT INTO users(role,name,school_id,class_id) VALUES('student',?,?,?)",
                                     (name, sid, cid)).lastrowid

    con.execute("UPDATE classes SET homeroom_teacher_id=? WHERE id=?", (teacher_of["mate"], cid))

    for day, row in enumerate(TIMETABLE):
        for period, subj in enumerate(row):
            con.execute("INSERT INTO timetable(class_id,day,period,subject,teacher_id,room) VALUES(?,?,?,?,?,?)",
                        (cid, day, period, subj, teacher_of[subj], ROOMS.get(subj, HOMEROOM)))

    # --- assessments: the next Thursday (today if it is Thursday) gets three tests ---
    mon = week_monday()
    thu = mon + timedelta(days=3)
    if thu < t:
        mon, thu = mon + timedelta(days=7), thu + timedelta(days=7)
    assessments = [
        (thu, "mate", "test", "Lucrare — funcții"),
        (thu, "fiz", "test", "Lucrare — optică"),
        (thu, "chim", "test", "Lucrare — soluții"),
        (mon, "info", "tema", "Proiect — pagină web"),
        (mon + timedelta(days=1), "rom", "quiz", "Ascultare — Ion"),
        (mon + timedelta(days=2), "eng", "tema", "Eseu — My town"),
        (mon + timedelta(days=2), "bio", "tema", "Fișă — sistemul nervos"),
        (mon + timedelta(days=4), "ist", "tema", "Fișă — Unirea"),
        (mon + timedelta(days=4), "fra", "tema", "Fișă — passé composé"),
        (mon + timedelta(days=7), "geo", "tema", "Hartă — relieful României"),
        (mon + timedelta(days=8), "bio", "quiz", "Ascultare — celula"),
        (mon + timedelta(days=9), "mate", "quiz", "Test scurt — ecuații"),
        (mon + timedelta(days=10), "info", "test", "Lucrare — tablouri"),
        (mon + timedelta(days=11), "geo", "test", "Lucrare — relief"),
    ]
    for d, subj, typ, title in assessments:
        con.execute("INSERT INTO assessments(class_id,subject,type,date,title,teacher_id) VALUES(?,?,?,?,?,?)",
                    (cid, subj, typ, iso(d), title, teacher_of[subj]))

    # --- grades: 2-4 per subject over the past six weeks ---
    graded_subjects = ["mate", "rom", "fiz", "chim", "bio", "eng", "ist", "info"]
    for name, uid in students.items():
        level = rnd.uniform(6.5, 9.5)  # each student has a typical level
        for subj in graded_subjects:
            if name == AT_RISK and subj == "fiz":
                values = [5, 4, 6, 4]  # average 4.75 → rounds to 5, one bad grade from failing
            else:
                values = [max(4, min(10, round(rnd.gauss(level, 1.1)))) for _ in range(rnd.randint(2, 4))]
                if subj == "fiz":  # keep the at-risk student the only one near failing physics
                    values = [max(v, 6) for v in values]
            for i, v in enumerate(values):
                d = t - timedelta(days=42 - i * 10 - rnd.randint(0, 5))
                con.execute("INSERT INTO grades(student_id,subject,value,date,teacher_id,note) VALUES(?,?,?,?,?,?)",
                            (uid, subj, v, iso(d), teacher_of[subj], rnd.choice(["lucrare", "ascultare", "temă"])))

    # --- absences ---
    for name, uid in students.items():
        n_un = 7 if name == AT_RISK else rnd.choice([0, 0, 1, 2, 3])
        n_ex = rnd.choice([0, 1, 2, 4])
        for kind, count in (("unexcused", n_un), ("excused", n_ex)):
            for _ in range(count):
                d = t - timedelta(days=rnd.randint(3, 40))
                subj = rnd.choice(graded_subjects)
                con.execute("INSERT INTO absences(student_id,subject,kind,date,teacher_id) VALUES(?,?,?,?,?)",
                            (uid, subj, kind, iso(d), teacher_of[subj]))

    # --- personal tasks: the at-risk student, and Ana Popa (the student shown on the welcome page) ---
    for who, items in [(AT_RISK, [("Exerciții optică pag. 54", "fiz", thu - timedelta(days=1)),
                                  ("Recapitulare funcții", "mate", thu - timedelta(days=1)),
                                  ("Citește capitolul 3 din Ion", "rom", t)]),
                       ("Ana Popa", [("Recapitulare funcții — fișa 2", "mate", thu - timedelta(days=1)),
                                     ("Probleme optică pag. 61", "fiz", thu - timedelta(days=1)),
                                     ("Vocabular unitatea 4", "eng", t + timedelta(days=1))])]:
        for title, subj, due in items:
            con.execute("INSERT INTO tasks(student_id,title,subject,type,due,done,created_at) VALUES(?,?,?,?,?,0,?)",
                        (students[who], title, subj, "tema", iso(max(due, t)), now))

    # --- this week's life of the class: a room change, announcements, events, a message ---
    if t.weekday() <= 4:  # today's history lesson moves room (shows on Azi)
        slot = con.execute("SELECT id FROM timetable WHERE class_id=? AND day=? AND subject IN ('ist','geo','eng') ORDER BY period LIMIT 1",
                           (cid, t.weekday())).fetchone()
        if slot:
            con.execute("INSERT INTO lesson_changes(timetable_id,class_id,date,kind,room,note,author_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
                        (slot[0], cid, iso(t), "room", "Sala 21", "Sala 12 e ocupată azi.", teacher_of["mate"], now))
    admin = con.execute("SELECT id FROM users WHERE role='admin'").fetchone()[0]
    stamp = lambda days_ago, hour: (datetime.combine(t - timedelta(days=days_ago), datetime.min.time()) + timedelta(hours=hour)).isoformat(timespec="seconds")
    for class_id, author, title, body, prio, at in [
        (None, admin, "Simularea la matematică, vineri", "Simularea pentru clasele a X-a are loc vineri, de la 9:00, în sălile 12–16. Aduceți calculator și instrumente de geometrie.", "urgent", stamp(1, 18)),
        (cid, teacher_of["mate"], "Ședința cu părinții, joi la 18:00", "Ne vedem joi, la 18:00, în Sala 12. Discutăm situația de la jumătatea semestrului și excursia din primăvară.", "normal", stamp(0, 7.5)),
        (cid, teacher_of["info"], "Proiectul de informatică se predă azi", "Încărcați link-ul către pagina voastră până la ora 20:00. Cine are nevoie de ajutor, mă găsește în pauza mare.", "info", stamp(2, 16)),
    ]:
        con.execute("INSERT INTO announcements(school_id,class_id,author_id,title,body,priority,created_at) VALUES(?,?,?,?,?,?,?)",
                    (sid, class_id, author, title, body, prio, at))
    for title, days, kind, note in [("Olimpiada de matematică — etapa pe școală", 12, "olimpiada", "Înscrieri la doamna Popescu."),
                                    ("Club de robotică", 2, "club", "Miercuri, după ore, în Lab Info."),
                                    ("Termen: înscrieri la concursul de eseuri", 5, "termen", None)]:
        con.execute("INSERT INTO school_events(school_id,title,date,kind,note,author_id,created_at) VALUES(?,?,?,?,?,?,?)",
                    (sid, title, iso(t + timedelta(days=days)), kind, note, admin, now))
    con.execute("INSERT INTO messages(sender_id,recipient_id,body,anonymous,created_at,visible_at) VALUES(?,?,?,0,?,?)",
                (teacher_of["mate"], students["Ana Popa"], "Bună, Ana! Am pus baremul pentru lucrarea de joi pe grup. Spor la recapitulare!", stamp(0, 7.75), stamp(0, 7.75)))

    return thu


def main():
    init_db()
    con = connect()
    wipe(con)
    thu = seed(con)
    con.commit()
    con.close()
    print("Seeded %s, class %s: %d students, %d teachers." % (SCHOOL, CLASS, len(STUDENTS), len(TEACHERS)))
    print("Three tests on Thursday %s. At-risk student (physics): %s." % (iso(thu), AT_RISK))


if __name__ == "__main__":
    main()
