import crypto from "node:crypto";

const SESSION_DAYS = 30;
const COOKIE = "mb_session";

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, "hex");
  return test.length === ref.length && crypto.timingSafeEqual(test, ref);
}

export function makeAuth(db, opts) {
  const { adminUser, adminHash, cookieSecure } = opts;
  const failures = new Map(); // ip -> {count, until}

  const insert = db.prepare("insert into sessions (token, created_at, expires_at) values (?,?,?)");
  const find = db.prepare("select expires_at from sessions where token = ?");
  const remove = db.prepare("delete from sessions where token = ?");
  const purge = db.prepare("delete from sessions where expires_at < ?");

  function readToken(req) {
    const raw = req.headers.cookie || "";
    const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function isAuthed(req) {
    const t = readToken(req);
    if (!t) return false;
    const row = find.get(t);
    if (!row) return false;
    if (row.expires_at < Date.now()) { remove.run(t); return false; }
    return true;
  }

  function setCookie(res, token, maxAgeSec) {
    const parts = [`${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
    if (cookieSecure) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
  }

  function login(req, res) {
    const ip = req.ip || "unknown";
    const f = failures.get(ip);
    if (f && f.until > Date.now()) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });

    const { username, password } = req.body || {};
    const ok = typeof username === "string" && typeof password === "string"
      && username === adminUser && verifyPassword(password, adminHash);
    if (!ok) {
      const next = { count: (f?.count || 0) + 1, until: 0 };
      if (next.count >= 5) { next.until = Date.now() + 15 * 60 * 1000; next.count = 0; }
      failures.set(ip, next);
      return res.status(401).json({ error: "Wrong username or password." });
    }
    failures.delete(ip);
    purge.run(Date.now());
    const token = crypto.randomBytes(32).toString("hex");
    const ttl = SESSION_DAYS * 24 * 60 * 60;
    insert.run(token, Date.now(), Date.now() + ttl * 1000);
    setCookie(res, token, ttl);
    res.json({ ok: true, user: adminUser });
  }

  function logout(req, res) {
    const t = readToken(req);
    if (t) remove.run(t);
    setCookie(res, "", 0);
    res.json({ ok: true });
  }

  function me(req, res) {
    res.json({ authenticated: isAuthed(req), user: isAuthed(req) ? adminUser : null });
  }

  function requireAuth(req, res, next) {
    if (isAuthed(req)) return next();
    res.status(401).json({ error: "Sign in to do that." });
  }

  return { login, logout, me, requireAuth, isAuthed };
}
