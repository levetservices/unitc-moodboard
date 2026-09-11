# CLAUDE.md

Handoff for working on this repo. Read this before touching anything.

## What this is

A self-hosted moodboard for Hayden Stevens, a BTEC Level 3 Production Arts student (lighting and sound). One board per production for Unit C (Cinderella, *Two* by Jim Cartwright, a devised piece, then a final production). Public can view, one owner login can edit. It will be hosted on Hayden's Proxmox server and linked from his personal site.

Built 11 Sept 2026. First commit is a complete, tested v1. Revised the same day: Production Arts Practice logo, board banner images, filter tabs moved out of the sidebar, board blurbs and the intention statement dropped, real audio player.

## Stack, on purpose kept small

- `server/index.js`: Express 4. Serves `public/`, the API under `/api`, and uploaded files under `/uploads`.
- `server/db.js`: better-sqlite3. Schema is created on first run, seed content inserted if the boards table is empty. Tables: `boards`, `tiles`, `gels`, `sessions`.
- `server/auth.js`: scrypt password hashing (`scrypt$salt$hash`), random session tokens in an httpOnly cookie `mb_session`, in-memory login rate limiting.
- `public/index.html`: the whole front end. Vanilla JS, no framework, no build step. Fonts from Google (Quando for display, Plus Jakarta Sans for body, Archivo for the wordmark).
- `scripts/smoke-test.mjs`: starts a throwaway server on port 3999 and checks the API end to end. `npm test`. Keep it green.
- `scripts/hash-password.mjs`: prints an `ADMIN_PASSWORD_HASH` line for `.env`.
- Docker: `Dockerfile` (node:22-bookworm-slim), `docker-entrypoint.sh` (fixes `/data` ownership, then drops to `node`) and `docker-compose.yml` (binds `./data`).

No TypeScript, no bundler, no ORM. Don't add them without asking.

## Run and test

```bash
npm install
npm run dev   # reads .env, http://localhost:3000
npm test
```

`npm start` and `npm run dev` pass `--env-file-if-exists=.env` to node, so `.env` is loaded without a shell. That matters: the scrypt hash contains `$`, so `source .env` silently corrupts it and every login fails with "wrong username or password". Don't reintroduce a shell export in the docs.

`ADMIN_PASSWORD` still works as a dev convenience; production uses `ADMIN_PASSWORD_HASH`. See `.env.example`.

## Data model

Tile `type` is one of `light, sound, video, image, palette, link, file, note`. Tile `tag` is the filter label (`lighting, sound, video, colour, reference, links, files, notes`). Type and tag are separate on purpose: type decides how it renders, tag decides where it filters.

Tile `data` is JSON, validated by `cleanData()` in `server/index.js`. Fields in use:

- `url` (external link or `/uploads/...`), `path` (only set for uploads, used to delete the file), `name`, `mime`
- `gel`, `hex`, `rgbw` `{r,g,b,w}` for light tiles (snapshotted from the gel at save time so deleting a gel doesn't break tiles)
- `colors` array of hex for palette tiles

Boards have `id`, `name`, `kind`, `image`, `sort`. `image` is the banner behind the board name, always one of our own `/uploads/...` paths (`cleanUploadUrl()` rejects anything else, so a board banner can't be pointed at a third-party URL).

There used to be a `blurb` (a one-line subtitle) and an `intent` (the design intention statement). Hayden asked for both gone, so they are out of the schema, the API and the front end. Databases created before that keep the orphan columns and nothing reads them, so the old intention text is still recoverable from a live database if he ever wants it back.

`openDb()` ends with a small hand-rolled migration: `create table if not exists` does nothing to an existing table, so any column added after the first release needs an explicit `alter table`. That is how `image` reaches a database that predates it. Add to that block, don't assume a schema edit is enough.

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
- Board layout is banner, filter tabs, tiles. `.boardhead` carries the banner as a CSS background with a gradient `::after` so the name stays legible over any photo, and gets `.has-image` only when the board actually has one. The filter tabs live in `.filterbar` under it, not in the sidebar.
- The sidebar logo is `public/logo.svg`, Hayden's own artwork. If that file is missing the `onerror` on the `<img>` falls back to the inline SVG wordmark, which is two `<text>` lines with `textLength="240"` and `lengthAdjust="spacingAndGlyphs"` so both justify to the same width. That fallback needs an explicit `font-size` in the CSS: without one it inherits the body's 15px and `textLength` stretches the glyphs to about twice their natural width.
- That fallback uses `removeAttribute("hidden")`, not `.hidden = false`. `hidden` is an `HTMLElement` property and `<svg>` is an `SVGElement`, so assigning to `.hidden` silently sets a useless JS expando while the attribute, and `[hidden]{display:none}`, stay put.
- Sound tiles with a file render `.wave.player`: a play button, 28 bars that double as a scrubber, and a hidden `<audio>`. `initPlayers()` binds one delegated capture listener per root (`#board` and `#overlay`) because `timeupdate` and friends don't bubble. Tiles without a file keep the decorative `.wave.static`.

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
5. Optional second reader account (the tutor) with view-only login if the board is ever made private.
6. Cue sheet tile type: a small table of cue number, trigger, description. Would map nicely to the QLab and lighting desk work in Unit C.

## Things to watch

- `/data` is a bind mount, which shadows whatever the image did to that path, so it arrives owned by the host's user (root). `docker-entrypoint.sh` starts as root purely to chown it, then drops to `node` with `setpriv`. Without that the container crash-loops on `EACCES: mkdir '/data/uploads'`, nothing listens, and anything proxying to it returns 502. Docker Desktop on a Mac fakes bind mount ownership and hides this, so test container changes on Linux or against a root-owned named volume.
- `better-sqlite3` is a native module, pinned to ^13. Versions before 12 use V8 APIs that Node 26 removed, so 11.x cannot even compile on a current Mac. The Dockerfile uses glibc (bookworm) so prebuilt binaries work. Switching to alpine will probably break the build.
- `npm audit` reports two moderate `qs` advisories that cannot be fixed on Express 4: 4.22.2 is the last of the line and it pins a vulnerable `qs` range. Only an Express 5 migration clears them. Not done, not urgent at this scale.
- `multer` is still on 1.4.5-lts.2, which is end of life. 2.x exists when someone wants to do it.
- Range requests work because `express.static` handles them, which is what makes seeking in audio and video work. Don't replace it with a hand-rolled file handler without implementing `Range`.
- Uploads are public by URL, which is intended (visitors need to play them). Don't put anything private in there.
- The reverse proxy's body size limit will cap uploads before `MAX_UPLOAD_MB` does. README mentions `client_max_body_size` for Nginx.
- Login rate limiting is in memory, so it resets on restart and is per-process. Fine for one owner.
- Session table isn't purged on a schedule, only on successful login. Not a problem at this scale.

## Context on the wider project

Separate from this repo, Hayden has a Framer site called Cue2Career (cue2career.framer.media) for Module F, with the same type pairing and a dark navy palette. If asked to make this moodboard "match", that's the reference. This moodboard is a distinct thing: it should feel like the same person made both, not like the same site.
