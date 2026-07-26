# A Portable Memory & Collaboration System for Claude Projects

This document describes a lightweight, file-based system for giving a Claude
coding assistant **durable memory and a consistent working rhythm across
sessions**. It was refined over a long-running project and is written to be
**dropped into any new, unrelated project**. Paste it (or the bootstrap prompt
at the bottom) into a new project's first session and ask Claude to adopt it.

Nothing here is project-specific. Wherever you see a bracketed placeholder like
`<project-slug>`, substitute your own.

---

## 1. Why this exists

Claude's context window resets between sessions (and gets compacted within a
long one). Without durable notes, every session re-discovers the same facts,
re-litigates settled decisions, and loses the thread of a backlog. This system
fixes that with a **small set of plain-markdown files that persist across
sessions**, plus a few **standing rules** that keep those files trustworthy and
current without the user having to babysit them.

The whole thing is just markdown files + habits. No tools, no database.

---

## 2. Where the files live

Claude Code exposes a persistent per-project memory directory:

```
~/.claude/projects/<project-slug>/memory/
```

Everything below lives in that folder. It sits **outside the code repository**,
so these notes are never committed and can hold working context freely. (If you
want the notes shareable/versioned, that's a separate, deliberate copy — don't
put secrets in them either way.)

---

## 3. The files and their roles

Think of it as **one index, one canonical snapshot, one backlog, and as many
topic files as the project needs.**

### `MEMORY.md` — the index (loaded every session)
- One line per memory file: `- [Title](file.md) — short hook`.
- **Never put content here** — only pointers. This is the table of contents that
  gets read into context at the start of each session, so it must stay short.
- Keep every line current when the underlying file changes.

### `session-state.md` — the canonical living snapshot
- The **single source of truth** for "where the project is right now": what's
  built, how it's wired, how to run it, and where to pick up next.
- Kept **complete and current** — not scattered. When something material
  changes, this file is updated. The user resumes work from here.
- It's fine (encouraged) to keep detail in a dedicated topic file, but
  `session-state.md` must still reflect the change at a summary level.

### `future-features.md` — the backlog
- A **numbered list of active (not-yet-built) items** at the top, each with
  enough context to start cold: what it is, open questions, known gotchas,
  likely approach.
- A **`## Annex — completed`** section at the bottom. When an item ships, it
  **moves down to the Annex** with a `✅ **Name** (done YYYY-MM-DD): …`
  implementation note (what was built, key files, how it was verified). The
  Annex becomes a durable changelog.
- Also a good home for **meta / non-feature to-dos** (e.g. "put project on
  GitHub", "write docs") in their own sub-section.

### Topic / reference files — one concern each
- Deep detail that would bloat `session-state.md`: a subsystem, an external data
  source and its quirks, a recurring operational procedure (e.g. "how to refresh
  an expired token"), etc.
- Each is focused and self-contained. `session-state.md` links to it and
  `MEMORY.md` indexes it.

### Special-purpose small files
- **User profile** (who the user is: role, expertise, preferences).
- **Feedback / working-agreement files** (how the user wants Claude to work —
  corrections and confirmed approaches, *with the reason why*). The standing
  rules in §5 are themselves stored this way.

---

## 4. File format

Every memory file starts with YAML frontmatter, then the content:

```markdown
---
name: <short-kebab-case-slug>          # matches the filename; used for [[links]]
description: <one-line summary>        # used to judge relevance on recall
metadata:
  type: user | feedback | project | reference
---

<the fact / snapshot / backlog>
```

**The `type` field:**
- `user` — who the user is (role, expertise, durable preferences).
- `feedback` — how Claude should work (guidance, corrections, confirmed
  approaches). Follow the fact with **Why:** and **How to apply:** lines.
- `project` — ongoing work, goals, constraints not derivable from the code or
  git history (e.g. `session-state.md`, `future-features.md`).
- `reference` — pointers to external resources or repeatable procedures.

**Cross-linking:** reference other memories inline with `[[their-slug]]`. Link
liberally — a `[[slug]]` that doesn't exist yet is a fine marker of something
worth writing later, not an error.

---

## 5. Standing rules (the part that makes it work)

These are the habits that keep memory trustworthy. Store them as a `feedback`
memory so they survive too.

1. **On "write to memory" / "save to memory" / "record this":** update **both**
   `session-state.md` (the relevant detail) **and** `MEMORY.md` (keep the index
   line current). Never update only a side file.

2. **Proactively — without being asked — after any *material* change:** a feature
   shipped, a bug fixed, a decision or preference made, a new constraint or
   direction set. Don't wait to be told. Same both-files rule applies.

3. **Don't spam memory** for trivial or in-progress steps. Good cadence = natural
   stopping points (a feature working, a decision settled).

4. **Absolute dates, always.** Convert "today", "last week", "in 3 days" to a
   concrete `YYYY-MM-DD` before saving. Relative dates rot.

5. **Completed backlog items move to the Annex** with an implementation note —
   they don't just get deleted. The Annex is the project's memory of *how*.

6. **Don't duplicate what the repo already records** (code structure, git
   history, obvious file layout). Memory is for what's *not* derivable from the
   code: decisions, constraints, gotchas, the "why".

7. **Recalled memory is a point-in-time note, not live truth.** Before asserting
   a file path, function name, or behavior a memory claims, verify it against the
   current code. Fix or delete memories found to be wrong.

8. **De-duplicate on write.** Before creating a file, check whether an existing
   one already covers the topic and update that instead.

---

## 6. Working cadence (how sessions run)

Beyond memory hygiene, these working habits carried the project:

- **Verify visible changes, don't assume them.** For UI work, take a screenshot
  (e.g. drive a headless browser) and actually look. For logic, run the
  typecheck / tests / a quick query and report the real result.
- **Read the project's own docs before writing framework code.** If the repo
  ships bundled docs or a `CLAUDE.md`/`AGENTS.md` with conventions (or pins an
  unusual framework version), read the relevant part first — training-data
  assumptions may be wrong for this repo.
- **Ask scoping questions before big features.** A few sharp questions up front
  (which surface? which data source? persist where?) beats building the wrong
  thing. For small choices with an obvious default, just proceed and say so.
- **Report outcomes faithfully.** If a step was skipped or a test failed, say so
  with the evidence. State "done and verified" only when it is.
- **One feature at a time, then update memory.** The rhythm that worked:
  build → typecheck/verify → screenshot → update `session-state.md` + `MEMORY.md`
  (+ move the backlog item to the Annex if it shipped).
- **Guard secrets.** Keep credentials in gitignored local files
  (`.env.local` and friends); never commit them and never paste them into memory
  files. Scrub before any first push.

---

## 7. Bootstrap prompt for a new project

Paste this into the **first session** of a new project to stand the system up:

> Adopt a file-based memory system for this project, stored in your per-project
> memory directory (`~/.claude/projects/<slug>/memory/`). Create:
> - `MEMORY.md` — a one-line-per-file index (pointers only, never content).
> - `session-state.md` (`type: project`) — the canonical living snapshot of what's
>   built, how it's wired, how to run it, and where to pick up. Keep it complete
>   and current.
> - `future-features.md` (`type: project`) — a numbered active backlog at the top
>   and a `## Annex — completed` section at the bottom; shipped items move to the
>   Annex with a dated implementation note.
> - Topic/reference files as needed for deep detail, each indexed in `MEMORY.md`.
>
> Each file gets frontmatter (`name`, `description`, `metadata.type` =
> user|feedback|project|reference) and links to others with `[[slug]]`.
>
> Standing rules: (1) on "write to memory", update BOTH `session-state.md` and
> `MEMORY.md`; (2) do that proactively after any material change too; (3) use
> absolute `YYYY-MM-DD` dates; (4) move completed backlog items to the Annex;
> (5) don't duplicate what the code/git already shows; (6) treat recalled memory
> as point-in-time and verify against current code before asserting it.
>
> Working cadence: verify UI changes with screenshots and logic with a real
> typecheck/test run; read any bundled project docs before writing framework
> code; ask scoping questions before large features; keep secrets in gitignored
> local files. Start by creating `MEMORY.md` and `session-state.md`.

---

*This system is deliberately minimal: a handful of markdown files and a few
consistent habits. Its whole value is that the files stay **current** and
**trustworthy** — which is what the standing rules in §5 enforce.*
