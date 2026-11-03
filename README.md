# SchoolPilot

**The app that stops your school week from ambushing you.**

A smart companion app for middle- and high-school students that brings their whole
school life into one place — schedule, homework, tests, grades, absences, teacher
announcements and messaging — and *understands* it: it warns you before a bad week
hits, tells you exactly what grade you need to reach your goals, and turns scattered
teacher messages into clear daily tasks.

This repo is the **hackathon MVP**: a real full-stack app — a Python backend with a
SQLite database and REST API, plus a React single-page frontend.

## Run it

**Requirements:** Python 3.8+ only. No `pip install`, no Node, no build step —
the backend uses just the standard library.

```bash
python3 server.py
# → SchoolPilot running on http://localhost:8000
```

Then open **http://localhost:8000**. The database (`schoolpilot.db`) is created and
seeded on first run, relative to the current week so the demo is always populated.

```bash
PORT=5000 python3 server.py      # custom port
# POST /api/reset  re-seeds the database from scratch
```

## MVP features (all backed by the database)

1. **Morning brief** — today's classes, what's due, what to pack, new announcements.
   Tasks toggle and persist; quick-add creates new ones.
2. **Weekly timetable** — rooms, teachers, assessment markers; today highlighted.
3. **AI announcement → tasks** — `POST /api/parse` turns a messy teacher message into
   structured tasks (detected type, dates, page numbers); import saves them.
4. **Collision detector + workload heatmap** — computed server-side from the
   assessments table. The teacher role schedules a test and the API recommends the
   class's calmest days; new tests immediately recompute the heatmap and collisions.
5. **Grades + "what do I need?"** — averages by Romanian 1–10 rules; the calculator
   (`POST /api/grades/what-if`) returns the minimum next grade for a target, or flags
   it unreachable. You can also record a new grade.
6. **Absence tracker** — excused / unexcused per subject, with conduct-grade warnings.
7. **Messaging with quiet hours** — the server holds messages sent during quiet hours
   (21:00–07:00) and stamps them with a real 07:00 delivery time; toggle is persisted.
8. **Roles + privacy** — Student / Teacher / Parent views and GDPR-for-minors basics.

## Architecture

```
schoolpilot/
├── server.py          # stdlib HTTP server + SQLite + REST API (zero deps)
├── public/
│   └── index.html     # React SPA (React + Tailwind + Framer Motion via CDN)
└── schoolpilot.db     # created & seeded on first run (git-ignored)
```

### API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/state?role=` | Full snapshot: today, timetable, workload, tasks, grades, absences, announcements, messages |
| POST | `/api/tasks` · PATCH `/api/tasks/:id` · DELETE `/api/tasks/:id` | Task CRUD |
| POST | `/api/parse` | Parse free text → structured tasks (no persist) |
| POST | `/api/tasks/import` | Persist parsed tasks |
| POST | `/api/grades` · `/api/grades/what-if` | Add a grade · target-grade calculator |
| POST | `/api/assessments` | Schedule a test (teacher) → recomputes workload |
| POST | `/api/absences` | Record an absence |
| POST | `/api/announcements` | Post an announcement (teacher) |
| POST | `/api/messages` | Send a message (applies quiet-hours logic) |
| POST | `/api/settings` · `/api/reset` | Toggle quiet hours · re-seed the DB |

## Design

- **Graph-paper canvas** (the squared-notebook motif) as the signature.
- The **workload heat scale** (green → red) is the one functional colour system; the
  rest stays quiet — indigo ink, one violet brand, a single highlighter accent.
- **Bricolage Grotesque** for display + **Inter** (tabular figures) for data.
- Motion-based animations (sliding-pill tabs, shimmer button, shared-layout cards),
  with `prefers-reduced-motion`, keyboard focus and a mobile bottom-nav.
- UI patterns follow the [Watermelon UI](https://ui.watermelon.sh) component idiom.

> Working name / placeholder branding. Content is in Romanian for the target school context.
