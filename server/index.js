import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, newId, rowTile, rowGel } from "./db.js";
import { makeAuth, hashPassword } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/* ---------- config ---------- */
const PORT = +(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const MAX_UPLOAD_MB = +(process.env.MAX_UPLOAD_MB || 500);
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const COOKIE_SECURE = /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE || "");
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || "");

let ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH || "";
if (!ADMIN_HASH && process.env.ADMIN_PASSWORD) {
  ADMIN_HASH = hashPassword(process.env.ADMIN_PASSWORD);
  console.warn("[moodboard] Using ADMIN_PASSWORD from the environment. For a live server, prefer ADMIN_PASSWORD_HASH (run: npm run hash-password).");
}
if (!ADMIN_HASH) {
  console.error("[moodboard] No admin password set. Set ADMIN_PASSWORD_HASH (or ADMIN_PASSWORD) in the environment.");
  process.exit(1);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = openDb(DATA_DIR);
const auth = makeAuth(db, { adminUser: ADMIN_USER, adminHash: ADMIN_HASH, cookieSecure: COOKIE_SECURE });

/* ---------- app ---------- */
const app = express();
if (TRUST_PROXY) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d", index: false, dotfiles: "deny" }));
app.use(express.static(path.join(ROOT, "public"), { index: "index.html" }));

/* ---------- auth ---------- */
app.post("/api/login", auth.login);
app.post("/api/logout", auth.logout);
app.get("/api/me", auth.me);

/* ---------- read ---------- */
app.get("/api/state", (req, res) => {
  const boards = db.prepare("select * from boards order by sort, name").all();
  const tiles = db.prepare("select * from tiles order by board_id, sort").all().map(rowTile);
  const gels = db.prepare("select * from gels order by sort, code").all().map(rowGel);
  res.json({ boards, tiles, gels, authenticated: auth.isAuthed(req), user: auth.isAuthed(req) ? ADMIN_USER : null });
});

/* ---------- everything below needs the owner ---------- */
app.use("/api", (req, res, next) => (req.method === "GET" ? next() : auth.requireAuth(req, res, next)));

const str = (v, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");
const slug = s => str(s, 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// board banners are always our own uploads, never an arbitrary external URL
const cleanUploadUrl = v => (typeof v === "string" && v.startsWith("/uploads/") && !v.includes("..") ? v.slice(0, 2000) : "");

/* boards */
app.post("/api/boards", (req, res) => {
  const name = str(req.body.name, 120).trim();
  if (!name) return res.status(400).json({ error: "Give the production a name." });
  let id = slug(req.body.id || name) || newId().slice(0, 8);
  if (db.prepare("select 1 from boards where id=?").get(id)) id = `${id}-${newId().slice(0, 4)}`;
  const sort = (db.prepare("select coalesce(max(sort),0) as m from boards").get().m) + 1;
  db.prepare("insert into boards (id,name,kind,image,sort) values (?,?,?,?,?)")
    .run(id, name, str(req.body.kind, 120), cleanUploadUrl(req.body.image), sort);
  res.json(db.prepare("select * from boards where id=?").get(id));
});
app.put("/api/boards/:id", (req, res) => {
  const b = db.prepare("select * from boards where id=?").get(req.params.id);
  if (!b) return res.status(404).json({ error: "Board not found." });
  const patch = {
    name: req.body.name !== undefined ? str(req.body.name, 120).trim() || b.name : b.name,
    kind: req.body.kind !== undefined ? str(req.body.kind, 120) : b.kind,
    image: req.body.image !== undefined ? cleanUploadUrl(req.body.image) : b.image,
  };
  // a replaced or cleared banner leaves its file behind otherwise
  if (b.image && b.image !== patch.image) removeUpload(b.image);
  db.prepare("update boards set name=?,kind=?,image=? where id=?").run(patch.name, patch.kind, patch.image, b.id);
  res.json(db.prepare("select * from boards where id=?").get(b.id));
});
app.delete("/api/boards/:id", (req, res) => {
  // the whole board upload folder goes below, which covers the banner too
  const tiles = db.prepare("select data from tiles where board_id=?").all(req.params.id).map(rowTile);
  tiles.forEach(t => removeUpload(t.data?.path));
  const r = db.prepare("delete from boards where id=?").run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: "Board not found." });
  fs.rmSync(path.join(UPLOAD_DIR, safeSeg(req.params.id)), { recursive: true, force: true });
  res.json({ ok: true });
});
app.put("/api/boards/:id/order", (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
  const upd = db.prepare("update tiles set sort=? where id=? and board_id=?");
  db.transaction(() => ids.forEach((id, i) => upd.run(i, id, req.params.id)))();
  res.json({ ok: true });
});

/* tiles */
const TYPES = new Set(["light", "sound", "video", "image", "palette", "link", "file", "note"]);
function cleanData(d) {
  if (!d || typeof d !== "object") return {};
  const out = {};
  if (typeof d.url === "string" && d.url.length < 2000) out.url = d.url;
  if (typeof d.path === "string" && d.path.startsWith("/uploads/") && !d.path.includes("..")) out.path = d.path;
  if (typeof d.name === "string") out.name = d.name.slice(0, 200);
  if (typeof d.mime === "string") out.mime = d.mime.slice(0, 100);
  if (typeof d.gel === "string") out.gel = d.gel.slice(0, 40);
  if (typeof d.hex === "string" && /^#[0-9a-f]{6}$/i.test(d.hex)) out.hex = d.hex;
  if (d.rgbw && typeof d.rgbw === "object") out.rgbw = cleanRgbw(d.rgbw);
  if (Array.isArray(d.colors)) out.colors = d.colors.filter(c => typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c)).slice(0, 12);
  return out;
}
function cleanRgbw(v) {
  const n = k => Math.max(0, Math.min(255, Math.round(+v[k] || 0)));
  return { r: n("r"), g: n("g"), b: n("b"), w: n("w") };
}
app.post("/api/tiles", (req, res) => {
  const { board_id, type } = req.body;
  if (!db.prepare("select 1 from boards where id=?").get(board_id)) return res.status(400).json({ error: "Unknown board." });
  if (!TYPES.has(type)) return res.status(400).json({ error: "Unknown tile type." });
  const id = newId();
  db.prepare("update tiles set sort = sort + 1 where board_id=?").run(board_id);
  db.prepare("insert into tiles (id,board_id,type,title,note,tag,sort,pinned,data) values (?,?,?,?,?,?,0,?,?)")
    .run(id, board_id, type, str(req.body.title, 200) || "Untitled", str(req.body.note), str(req.body.tag, 40), req.body.pinned ? 1 : 0, JSON.stringify(cleanData(req.body.data)));
  res.json(rowTile(db.prepare("select * from tiles where id=?").get(id)));
});
app.put("/api/tiles/:id", (req, res) => {
  const t = db.prepare("select * from tiles where id=?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "Tile not found." });
  const cur = rowTile(t);
  const data = req.body.data !== undefined ? cleanData(req.body.data) : cur.data;
  if (cur.data?.path && cur.data.path !== data.path) removeUpload(cur.data.path);
  db.prepare("update tiles set title=?,note=?,tag=?,pinned=?,data=? where id=?").run(
    req.body.title !== undefined ? str(req.body.title, 200) || cur.title : cur.title,
    req.body.note !== undefined ? str(req.body.note) : cur.note,
    req.body.tag !== undefined ? str(req.body.tag, 40) : cur.tag,
    req.body.pinned !== undefined ? (req.body.pinned ? 1 : 0) : t.pinned,
    JSON.stringify(data), t.id);
  res.json(rowTile(db.prepare("select * from tiles where id=?").get(t.id)));
});
app.delete("/api/tiles/:id", (req, res) => {
  const t = db.prepare("select * from tiles where id=?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "Tile not found." });
  removeUpload(rowTile(t).data?.path);
  db.prepare("delete from tiles where id=?").run(t.id);
  res.json({ ok: true });
});

/* gels */
app.post("/api/gels", (req, res) => {
  const code = str(req.body.code, 40).trim().toUpperCase();
  const hex = str(req.body.hex, 7);
  if (!code) return res.status(400).json({ error: "Give the gel a code." });
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return res.status(400).json({ error: "Colour must be a hex value." });
  if (db.prepare("select 1 from gels where code=?").get(code)) return res.status(409).json({ error: "That code already exists." });
  const id = newId();
  const sort = (db.prepare("select coalesce(max(sort),0) as m from gels").get().m) + 1;
  const rgbw = req.body.rgbw && typeof req.body.rgbw === "object" ? JSON.stringify(cleanRgbw(req.body.rgbw)) : null;
  db.prepare("insert into gels (id,code,name,hex,rgbw,sort) values (?,?,?,?,?,?)").run(id, code, str(req.body.name, 120), hex, rgbw, sort);
  res.json(rowGel(db.prepare("select * from gels where id=?").get(id)));
});
app.delete("/api/gels/:id", (req, res) => {
  const r = db.prepare("delete from gels where id=?").run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: "Gel not found." });
  res.json({ ok: true });
});

/* uploads */
function safeSeg(s) { return String(s || "misc").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60) || "misc"; }
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(UPLOAD_DIR, safeSeg(req.query.board));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_").slice(-120);
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 } });
app.post("/api/upload", (req, res) => {
  upload.single("file")(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? `File is over the ${MAX_UPLOAD_MB} MB limit.` : "Upload failed." });
    if (!req.file) return res.status(400).json({ error: "No file received." });
    const rel = "/uploads/" + path.relative(UPLOAD_DIR, req.file.path).split(path.sep).join("/");
    res.json({ url: rel, path: rel, name: req.file.originalname, mime: req.file.mimetype, size: req.file.size });
  });
});
function removeUpload(rel) {
  if (!rel || !rel.startsWith("/uploads/") || rel.includes("..")) return;
  const abs = path.join(UPLOAD_DIR, rel.slice("/uploads/".length));
  try { fs.rmSync(abs, { force: true }); } catch {}
}

/* ---------- fallbacks ---------- */
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error." });
});

app.listen(PORT, () => {
  console.log(`[moodboard] listening on http://0.0.0.0:${PORT}  data: ${DATA_DIR}`);
});
