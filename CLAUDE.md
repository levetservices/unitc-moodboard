# CLAUDE.md

Handoff for working on this repo. Read this before touching anything.

## What this is

A self-hosted moodboard for Hayden Stevens, a BTEC Level 3 Production Arts student (lighting and sound). One board per production for Unit C (Cinderella, *Two* by Jim Cartwright, a devised piece, then a final production). Public can view, one owner login can edit. It will be hosted on Hayden's Proxmox server and linked from his personal site.

Built 11 Sept 2026. First commit is a complete, tested v1.

## Stack, on purpose kept small

- `server/index.js`: Express 4. Serves `public/`, the API under `/api`, and uploaded files under `/uploads`.
- `server/db.js`: better-sqlite3. Schema is created on first run, seed content inserted if the boards table is empty. Tables: `boards`, `tiles`, `gels`, `sessions`.
- `server/auth.js`: scrypt password hashing (`scrypt$salt$hash`), random session tokens in an httpOnly cookie `mb_session`, in-memory login rate limiting.
- `public/index.html`: the whole front end. Vanilla JS, no framework, no build step. Fonts from Google (Quando for display, Plus Jakarta Sans for body).
- `scripts/smoke-test.mjs`: starts a throwaway server on port 3999 and checks the API end to end. `npm test`. Keep it green.
- `scripts/hash-password.mjs`: prints an `ADMIN_PASSWORD_HASH` line for `.env`.
- Docker: `Dockerfile` (node:22-bookworm-slim, runs as `node`, data in `/data`) and `docker-compose.yml` (binds `./data`).

No TypeScript, no bundler, no ORM. Don't add them without asking.

## Run and test

```bash
npm install
ADMIN_USER=dev ADMIN_PASSWORD=devpass123 npm run dev   # http://localhost:3000
npm test
```

`ADMIN_PASSWORD` is a dev convenience; production uses `ADMIN_PASSWORD_HASH`. See `.env.example`.

## Data model

Tile `type` is one of `light, sound, video, image, palette, link, file, note`. Tile `tag` is the filter label (`lighting, sound, video, colour, reference, links, files, notes`). Type and tag are separate on purpose: type decides how it renders, tag decides where it filters.

Tile `data` is JSON, validated by `cleanData()` in `server/index.js`. Fields in use:

- `url` (external link or `/uploads/...`), `path` (only set for uploads, used to delete the file), `name`, `mime`
- `gel`, `hex`, `rgbw` `{r,g,b,w}` for light tiles (snapshotted from the gel at save time so deleting a gel doesn't break tiles)
- `colors` array of hex for palette tiles

Gels: `code` is unique and uppercased. `rgbw` is nullable. `hex` is the screen colour; for RGBW gels it's computed by `rgbwToHex()` in the front end (white channel blended in linearly, an approximation, and it says so in the UI).

Board `id` is a slug from the name. Deleting a board cascades tiles and removes `data/uploads/<board>/`.

## API summary

Reads are public: `GET /api/state` (everything in one call), `GET /api/me`.
Writes need a session: boards (`POST`, `PUT /:id`, `DELETE /:id`, `PUT /:id/order`), tiles (`POST`, `PUT /:id`, `DELETE /:id`), gels (`POST`, `DELETE /:id`), `POST /api/upload?board=<id>` (multipart, field `file`), `POST /api/login`, `POST /api/logout`.

Front end keeps state in memory, calls the API, and re-renders. `renderAll()` is sidebar plus board. Modals are one `#overlay` div filled with HTML strings; every modal action is a `data-*` attribute on a button handled in the single `#overlay` click listener.

## Front-end conventions

- Escape everything user-provided with `esc()`. Tile content comes from the database.
- Only render edit controls when `canEdit()` (owner signed in). Server enforces it regardless.
- Modal is centred by flex on `#overlay`. Keep it that way; Hayden asked for it specifically.
- Dark background is deliberate: lighting colours are meant to read like gels against a dark stage. Don't add a light theme without being asked.
- One structural rule from the design pass: tiles carry the colour, chrome stays quiet.

## Writing style for anything user-facing

Hayden's preferences, they matter:

- Plain, direct, conversational. No romanticised or corporate phrasing.
- Never use em dashes. Use commas, colons, brackets or a new sentence.
- Sentence case. No all-caps labels.
- Copy says what the button does: "Save changes", "Add to board", "Delete tile".

## Likely next work

Nobody has asked for these yet. Confirm before building.

1. Export a board to PDF for the Unit C visual diary (the assessed evidence for C7.2). Server-side render of tiles plus intention would do.
2. Bulk upload (drop several photos, get several tiles).
3. Search across tiles.
4. Per-tile "which production moment" field, so a lighting state can say "Act 2 transformation" and sort by it.
5. Optional second reader account (tutor, Mr Wagstaff) with view-only login if the board is ever made private.
6. Cue sheet tile type: a small table of cue number, trigger, description. Would map nicely to the QLab and lighting desk work in Unit C.

## Things to watch

- `better-sqlite3` is a native module. The Dockerfile uses glibc (bookworm) so prebuilt binaries work. Switching to alpine will probably break the build.
- Uploads are public by URL, which is intended (visitors need to play them). Don't put anything private in there.
- The reverse proxy's body size limit will cap uploads before `MAX_UPLOAD_MB` does. README mentions `client_max_body_size` for Nginx.
- Login rate limiting is in memory, so it resets on restart and is per-process. Fine for one owner.
- Session table isn't purged on a schedule, only on successful login. Not a problem at this scale.

## Context on the wider project

Separate from this repo, Hayden has a Framer site called Cue2Career (cue2career.framer.media) for Module F, with the same type pairing and a dark navy palette. If asked to make this moodboard "match", that's the reference. This moodboard is a distinct thing: it should feel like the same person made both, not like the same site.
