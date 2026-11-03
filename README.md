# SchoolPilot

**The app that stops your school week from ambushing you.**

A smart companion app for middle- and high-school students that brings their whole
school life into one place — schedule, homework, tests, grades, absences, teacher
announcements and messaging — and *understands* it: it warns you before a bad week
hits, tells you exactly what grade you need to reach your goals, and turns scattered
teacher messages into clear daily tasks.

This repo is the **hackathon MVP**: a single, self-contained web app (no build step).

🔗 **Live demo:** https://claude.ai/artifact/4pCnHXAcDwacRBmp7UQQAN

## MVP features

1. **Morning brief** — today's classes, what's due, what to pack, new announcements.
2. **Weekly timetable** — rooms, teachers, assessment markers; today highlighted.
3. **AI announcement → tasks** — paste a messy teacher message and get structured
   tasks with detected type, dates and page numbers.
4. **Collision detector + workload heatmap** — flags too many assessments too close
   together; teacher view suggests the class's calmest days for a new test.
5. **Grades + "what do I need?"** — per-subject averages (Romanian 1–10 rules) and a
   calculator for the minimum next grade to reach a target.
6. **Absence tracker** — excused / unexcused per subject, with conduct-grade warnings.
7. **Messaging with quiet hours** — student↔teacher chat that holds messages overnight.
8. **Roles + privacy** — Student / Teacher / Parent views and GDPR-for-minors basics.

## Design

- **Graph-paper canvas** (the squared-notebook motif) as the signature.
- The **workload heat scale** (green → red) is the one functional colour system; the
  rest stays quiet — indigo ink, one violet brand, a single highlighter accent.
- **Bricolage Grotesque** for display + **Inter** (tabular figures) for data.
- Motion-based animations (sliding-pill tabs, shimmer button, shared-layout cards),
  with `prefers-reduced-motion`, keyboard focus and a mobile bottom-nav.

## Tech

- React 18 + Tailwind (Play CDN) + Framer Motion, all via CDN — just open `index.html`.
- UI patterns follow the [Watermelon UI](https://ui.watermelon.sh) idiom. To use the
  real components in a Vite/Next project:
  `npx shadcn@latest add https://registry.watermelon.sh/r/fluid-tabs.json`

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

> Working name / placeholder branding. Content is in Romanian for the target school context.
