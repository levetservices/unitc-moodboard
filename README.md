# Unit C moodboard

A self-hosted lighting and sound moodboard. Anyone can view it. One owner login can add, edit, reorder and delete. Files (audio, video, photos, PDFs) are stored on the server. Nothing depends on a third-party service.

Built for BTEC Production Arts Unit C (Task 1): one board per production, an intention statement per board mapped to C7.2, and tiles for lighting states (with LEE gel codes or your own RGBW colours), sound cues, video, photos, palettes, links, files and notes.

## What's in the box

```
server/     Node + Express + SQLite. API, login, uploads.
public/     The site. One HTML file, no build step.
scripts/    Password hashing and a smoke test.
data/       Created on first run. Database and uploads live here. Back this up.
```

## Run it on Proxmox

The simplest route is a Debian LXC container running Docker. If you already have a Docker host, skip to step 2.

### 1. Make a container

In Proxmox, create an LXC from a Debian 12 template. 1 CPU, 1 GB RAM and 20 GB disk is plenty, but give it more disk if you'll upload lots of video. Tick **Nesting** under Options > Features (Docker needs it). Start it and open a shell.

```bash
apt update && apt install -y curl git
curl -fsSL https://get.docker.com | sh
```

### 2. Get the code

```bash
git clone <your repo url> /opt/moodboard
cd /opt/moodboard
cp .env.example .env
```

### 3. Set your login

```bash
docker compose run --rm moodboard npm run hash-password
```

Type a password when asked. It prints a line starting `ADMIN_PASSWORD_HASH=`. Put that line in `.env`, and set `ADMIN_USER` to whatever username you want.

### 4. Start it

```bash
docker compose up -d --build
```

The site is now on `http://<container-ip>:3000`. Sign in from the sidebar with the username and password you set.

### 5. Put it on your domain

Point a reverse proxy at port 3000. Any of these work:

- **Nginx Proxy Manager**: add a proxy host for `moodboard.yourdomain`, forward to the container IP and port 3000, request a Let's Encrypt certificate. Set the upload size limit in the Advanced tab if you want files over 100 MB: `client_max_body_size 600m;`
- **Caddy**: `moodboard.yourdomain { reverse_proxy <container-ip>:3000 }` and Caddy handles HTTPS itself.
- **Cloudflare Tunnel**: works, but Cloudflare caps uploads at 100 MB on the free plan.

Once it's on HTTPS, set `COOKIE_SECURE=1` and `TRUST_PROXY=1` in `.env` and run `docker compose up -d` again.

To show it inside your Framer site, add an Embed block with the URL, or just link to it from the nav.

## Everyday use

- **Viewing**: switch productions, filter by tag, click a tile to see it large, play audio and video, open links and files.
- **Editing**: sign in, then use the sidebar buttons. Add or edit productions, add tiles, manage gels. Drag tiles to reorder, star to pin, click to edit or delete. The intention box saves when you click away from it.
- **Gels and colours**: add by code and name. Set the colour with the picker, or type RGBW values (0 to 255 each) for an LED fixture. RGBW numbers are stored exactly and shown on lighting tiles. The on-screen swatch is an approximation.
- **Files**: anything up to `MAX_UPLOAD_MB`. YouTube and Vimeo links embed instead of needing an upload.

## Backups

Everything is in `data/`: `moodboard.db` (SQLite) and `uploads/`. Copy that folder and you have a full backup. Proxmox's own container backups will catch it too.

```bash
tar czf moodboard-backup-$(date +%F).tgz -C /opt/moodboard data
```

## Updating

```bash
cd /opt/moodboard
git pull
docker compose up -d --build
```

## Running without Docker

Node 20 or newer.

```bash
npm install
cp .env.example .env      # then edit it
export $(grep -v '^#' .env | xargs)
npm start
```

## Development

```bash
npm install
ADMIN_USER=dev ADMIN_PASSWORD=devpass123 npm run dev
npm test                  # starts a throwaway server and checks the API
```

## Security notes

- Passwords are hashed with scrypt. The hash lives in `.env`, which git ignores.
- Sessions are httpOnly cookies, 30 days, stored in the database. Sign out to revoke.
- Five wrong logins from one IP locks that IP out for 15 minutes.
- Everything under `/api` except reads requires a session. Uploaded files are public by design, because visitors need to play them.
- Keep the container behind HTTPS before signing in over the internet.
