# SchoolPilot

**The app that stops your school week from ambushing you.**

A school companion app with three kinds of account — **admin**, **teacher**, and
**student** — each with its own UI. The admin builds everything (schools, classes,
teachers, students, timetable) from an empty database; teachers see only their own
classes and the workload heatmap; students get the morning brief, timetable and
catalog.

Full-stack, zero dependencies: a Python backend (SQLite + REST API) and a React SPA.

## Run it

**Requirements:** Python 3.8+ and a Supabase project (for login). No `pip install`, no Node, no build step.

Copy `.env.example` to `.env` and fill in `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY` (server-only, never commit it) and `ADMIN_EMAIL`. Create the admin
user in Supabase Auth with that email and **disable public sign-ups** — the admin creates
every other account from the app.

```bash
python3 server.py            # → http://localhost:8000
PORT=5000 python3 server.py  # custom port
python3 seed.py              # demo data: wipes the DB, then adds class 10B (see below)
```

`seed.py` builds a demo school: class **10B** with 25 students, 8 teachers, a full
timetable, an upcoming **Thursday with three tests**, and a student
(**Matei Constantin**) whose physics average is close to failing. Dates are
relative to today, so re-run it before a demo.

Open **http://localhost:8000**. The database starts with a **single admin account**
and nothing else — you build the rest.

## First run (how to test everything)

1. **Log in with the admin email and password** (the only account at first).
2. **Add a school** → open it.
3. **Clase** → add a class (e.g. `10B`).
4. **Profesori** → add a teacher with their email, tick the subjects they teach. The app
   shows a **temporary password once** — pass it on; they must set their own at first login.
5. **Elevi** → add a student (with email), assign them to the class. **Resetează parola**
   issues a new temporary password.
6. **Orar** → pick the class, tap cells to place subject + teacher + room.
7. **Log out → log in as the teacher**: see only your own lessons, open **Încărcare**,
   and **schedule a test** — the app suggests the class's calmest days; two graded
   assessments on one day raise a **collision** warning.
8. **Log out → log in as the student**: the **morning brief** shows today's lessons,
   what to pack, and what's due; add grades to try the **"what do I need?"** calculator.

> `POST /api/reset` wipes everything back to just the admin account.

## Roles & capabilities

### Admin
- Add / delete **schools**.
- Per school: add / delete **classes** (and set each class's **diriginte**), **teachers** (with subjects), **students** (assigned to a class).
- Build the **timetable** per class (place/replace/remove any slot: subject, teacher, room, start time).
- Starts empty — nothing is seeded except the admin account.

### Teacher
- **Orarul meu** — weekly schedule showing only the lessons they teach (class, subject, room, time; today highlighted).
- **Catalog** — per class + subject they teach: student list with grades, average and absences; add/edit/delete their own grades and absences; **Prezența de azi** roll call for today's lesson; **Motivări** for the diriginte.
- **Încărcare** — per-class workload heatmap + collision detector; schedule assessments with calmest-day suggestions.

### Student
- **Azi** — morning brief: today's lessons, what to pack, what's due (add/tick personal tasks), and new grades from the last 3 days.
- **Orar** — their class timetable with assessment markers.
- **Catalog** — read-only grades (date, note and teacher on tap/hover, averages, "what do I need?" calculator) and absences.

## Architecture

```
schoolpilot/
├── server.py          # stdlib HTTP server + SQLite + REST API (zero deps)
├── public/
│   └── index.html     # React SPA (React + Tailwind + Framer Motion via CDN)
└── schoolpilot.db     # created on first run, admin-only seed (git-ignored)
```

### API (selected)

| Method | Path | Role |
| --- | --- | --- |
| GET | `/api/accounts` | login picker |
| GET | `/api/admin` | admin snapshot (schools/classes/teachers/students) |
| POST/DELETE | `/api/schools`, `/api/classes`, `/api/teachers`, `/api/students` | admin |
| GET/POST/DELETE | `/api/timetable` | admin builds, everyone reads |
| GET | `/api/teacher?userId=` · `/api/teacher/workload?classId=` | teacher |
| POST/DELETE | `/api/assessments` | teacher |
| GET | `/api/student?userId=` | student |
| POST | `/api/tasks` · PATCH/DELETE `/api/tasks/:id` | student |
| POST | `/api/grades/what-if` | student |
| GET | `/api/teacher/catalog?classId=&subject=` · `/api/teacher/motivari` | teacher |
| POST · PATCH/DELETE `/:id` | `/api/grades`, `/api/absences` | teacher (own entries; diriginte can excuse) |
| PATCH | `/api/classes/:id` (diriginte) | admin |
| POST | `/api/reset` | wipe to admin-only |

## Design

- **Teal** brand on a cool graph-paper canvas (the squared-notebook motif).
- The **workload heat scale** (green → red) is the one functional colour system.
- **Bricolage Grotesque** display + **Inter** (tabular figures) for data.
- Motion animations (sliding-pill tabs, shimmer button), `prefers-reduced-motion`,
  keyboard focus, mobile bottom-nav. UI follows the [Watermelon UI](https://ui.watermelon.sh) idiom.

### Not in this build
No self-service password reset by email (the admin resets passwords), and no
messaging/announcements.

> Working name / placeholder branding. UI is in Romanian for the target school context.
