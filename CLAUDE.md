# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Run

```bash
python3 server.py            # http://localhost:8000
PORT=5000 DB=other.db python3 server.py
python3 seed.py              # WIPES data, then builds the demo school (class 10B); dates are relative to today
```

Needs a `.env` (copy `.env.example`). No Python dependencies (Supabase is called with `urllib`), no test suite.

```bash
node build.mjs               # after changing public/app.jsx or public/tailwind.config.js (first time: npm install)
DEV=1 python3 server.py      # force in-browser compilation even when public/build is current
```

The build is optional while developing: `page_html()` in `server.py` serves the precompiled `public/build/` (app.js + app.css) only while `build/stamp.json` matches the hash of `app.jsx` + `tailwind.config.js`; otherwise the page falls back to Babel + Tailwind Play in the browser, so edit-and-refresh still works. Run the build and commit `public/build/` before deploying, or visitors get the slow path. Verify changes by running the server and using the app in a browser. `POST /api/reset` wipes everything except the admin account; deleting `schoolpilot.db` also resets.

## Architecture

- `server.py` — single-file stdlib `http.server` + SQLite backend. Schema is the `SCHEMA` string (created on startup by `init_db()`; only the admin user is seeded). GET routes live in `Handler.get_api`, all mutations in `Handler.route`. The server computes view-ready "snapshots" (`build_admin`, `build_teacher`, `build_student`, `class_workload`), so most logic (heatmap, collisions, averages, absences, what-if calculator) is in Python, not the client.
- `public/app.jsx` — the entire React SPA. `public/index.html` is only the shell (global CSS); `server.py` fills its `<!--APP-HEAD-->` / `<!--APP-BODY-->` markers with either the precompiled build or the in-browser Babel path. React, ReactDOM, Framer Motion (`window.Motion`), Babel and the Tailwind play script are vendored in `public/vendor/` so the app works offline (only the Google Fonts link is remote; it falls back to system fonts). Tailwind theme tokens (brand teal, heat colours) are in `public/tailwind.config.js`, shared by the browser and `build.mjs`. Static text files are served gzipped.
- `public/media/` — the welcome page film (`hero/`, frames load after the page) and real app screenshots (`app/`), captured from the `seed.py` demo school (fictional names only; never screenshot real accounts).
- Auth is Supabase Auth (email + password); app data stays in SQLite. `.env` (git-ignored; see `.env.example`) holds `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ADMIN_EMAIL` and is read by `load_env()` at startup. The secret key is server-only: never send it to the client, log it, or commit `.env`. The client gets the URL + publishable key from the public `/api/config` endpoint.
- Every other `/api/*` call needs `Authorization: Bearer <access_token>`. `Handler._me` validates the token with `GET /auth/v1/user` (cached `TOKEN_TTL`), maps the email to a local `users` row and derives identity only from that; ids in the request (`userId`, `studentId`, …) are ignored. `need()` / `need_class()` enforce roles: admin = `role='admin'` with `ADMIN_EMAIL`; teachers see only classes they teach in the timetable; students only their own data. Accounts with `user_metadata.must_change_password` get 403 everywhere except `/api/me`.
- Only the admin creates accounts (public sign-up is off in Supabase): `add_account` / `reset_auth_password` / `remove_users` call the Auth Admin API (`/auth/v1/admin/users`, `apikey: <secret>`) and return a one-time temporary password.
- Frontend: `Root` boots supabase-js (vendored), shows `Login` → `ChangePassword` (when `mustChangePassword`) → `AdminApp` / `TeacherApp` / `StudentApp`, each wrapped in `Shell`. `jfetch` adds the bearer token and logs out on 401.
- Subjects are a fixed catalogue (`SUBJECTS` in `server.py`, keyed by code such as `mate` or `fiz`). Assessment types `test`/`quiz`/`tema` have weights in `TYPE_W`; only `test` and `quiz` count as graded for collisions.
- Grades and absences are entered only by teachers; students read them. `need_student_subject` checks the timetable (a teacher may act only on subjects they teach in that student's class), `owned_row` limits edit/delete to the teacher who entered the row, and an absence can be excused by its recorder or the class's diriginte (`classes.homeroom_teacher_id`, set by the admin).
- A timetable row has `time` / `end_time`; `slot_time()` and `slot_end()` fall back to `PERIODS[period]` and a 50-minute lesson. `period` is only a free storage slot: `TimetableGrid` lists each day by start time.
- Announcements: teachers post to a class from `announcement_class_ids()` (taught or diriginte), only the admin posts school-wide (`class_id` NULL). `announcement_reads` backs the "văzut de X din Y" count.
- Messages are one-to-one between a student and the teachers of their class (`message_contacts()`), never student to student. For anonymous questions the sender stays in the row, but `build_threads` and `thread_rows` must keep them off the teacher's named threads.
- Student notifications are rows in `notifications`, written by `notify()` in the same route as the change. `ref` (`grade:12`, `absence:3`, `assessment:7`, `reminder:7`) links them to their source so deleting it removes them; `add_due_reminders()` creates reminders when the student's data is read, so there is no background job.
- Shared UI in `index.html`: `toast.success/error/info` (every save, delete and API error), `await askConfirm({ title, body, action })` (never the browser `confirm()`), `SearchSelect` (pass `inline` inside sheets). They were adapted by hand from Watermelon UI; there is no shadcn CLI here.
- The year has 5 modules per school (`school_modules`, else `DEFAULT_MODULES`, which the admin must renew each year). A grade's module comes from its date. Official averages stay annual: `annual_average()` rounds each subject and the general average is the mean of those. Outside a module students see no lessons, so `seed.py` shows an empty Azi during holidays.
- Dates are stored as ISO `YYYY-MM-DD`; the frontend formats them with `fmtDate`.
- Schema changes for existing databases go in `ADDED_COLUMNS` / `migrate()`, which run on every start and back up the DB to `<db>.pre-migration.db` the first time.

## Conventions

- All UI text is Romanian with correct diacritics (ă â î ș ț). Keep it that way.
- Romanian averages round to whole numbers, with x.50 rounding up.
- "SchoolPilot" is a placeholder name; don't rebrand or restyle without being asked.
