# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Run

```bash
python3 server.py            # http://localhost:8000
PORT=5000 DB=other.db python3 server.py
python3 seed.py              # WIPES data, then builds the demo school (class 10B); dates are relative to today
```

No dependencies, no build step, no test suite. Verify changes by running the server and using the app in a browser. `POST /api/reset` wipes everything except the admin account; deleting `schoolpilot.db` also resets.

## Architecture

- `server.py` — single-file stdlib `http.server` + SQLite backend. Schema is the `SCHEMA` string (created on startup by `init_db()`; only the admin user is seeded). GET routes live in `Handler.get_api`, all mutations in `Handler.route`. The server computes view-ready "snapshots" (`build_admin`, `build_teacher`, `build_student`, `class_workload`), so most logic (heatmap, collisions, averages, absences, what-if calculator) is in Python, not the client.
- `public/index.html` — entire React SPA in one `<script type="text/babel">` block, transpiled in the browser by Babel standalone. React, ReactDOM, Framer Motion (`window.Motion`), Babel and the Tailwind play script are vendored in `public/vendor/` so the app works offline (only the Google Fonts link is remote; it falls back to system fonts). Tailwind theme tokens (brand teal, heat colours) are in the inline `tailwind.config`.
- Login is an account picker, with no passwords. The chosen account is stored in `localStorage` under `sp_user`. `Root` switches between `AdminApp`, `TeacherApp` and `StudentApp`, each wrapped in the shared `Shell`.
- Subjects are a fixed catalogue (`SUBJECTS` in `server.py`, keyed by code such as `mate` or `fiz`). Assessment types `test`/`quiz`/`tema` have weights in `TYPE_W`; only `test` and `quiz` count as graded for collisions.
- Dates: assessments and absences are stored as ISO `YYYY-MM-DD`; grade dates are stored as display strings such as `"3 nov"`.

## Conventions

- All UI text is Romanian with correct diacritics (ă â î ș ț). Keep it that way.
- Romanian averages round to whole numbers, with x.50 rounding up.
- "SchoolPilot" is a placeholder name; don't rebrand or restyle without being asked.
