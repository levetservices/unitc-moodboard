// Starts the server on a temp data dir and exercises the API. Usage: npm test
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "moodboard-"));
const port = 3999;
const srv = spawn(process.execPath, ["server/index.js"], {
  env: { ...process.env, PORT: port, DATA_DIR: dataDir, ADMIN_USER: "test", ADMIN_PASSWORD: "testpass123" },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise(r => srv.stdout.on("data", d => { if (String(d).includes("listening")) r(); }));

let cookie = "";
const base = `http://127.0.0.1:${port}`;
async function call(method, p, body, form) {
  const r = await fetch(base + p, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: form || (body ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) process.exitCode = 1; };

try {
  let r = await call("GET", "/api/state");
  check(r.status === 200 && r.json.boards.length === 3 && r.json.tiles.length > 0, "public state loads with seed content");
  r = await call("POST", "/api/tiles", { board_id: "two", type: "note", title: "x" });
  check(r.status === 401, "writes are blocked when signed out");
  r = await call("POST", "/api/login", { username: "test", password: "wrong" });
  check(r.status === 401, "wrong password rejected");
  r = await call("POST", "/api/login", { username: "test", password: "testpass123" });
  check(r.status === 200 && cookie.startsWith("mb_session="), "login sets session cookie");
  r = await call("GET", "/api/me");
  check(r.json.authenticated === true, "session recognised");
  r = await call("POST", "/api/boards", { name: "Test Show", kind: "Musical" });
  const boardId = r.json.id;
  check(r.status === 200 && boardId === "test-show", "board created with slug id");
  r = await call("POST", "/api/tiles", { board_id: boardId, type: "light", title: "Special", data: { gel: "L201", hex: "#7fa6d9" } });
  const tileId = r.json.id;
  check(r.status === 200 && r.json.data.gel === "L201", "light tile created");
  const fd = new FormData(); fd.append("file", new Blob(["hello"], { type: "text/plain" }), "cue sheet.txt");
  r = await call("POST", `/api/upload?board=${boardId}`, null, fd);
  check(r.status === 200 && r.json.url.startsWith("/uploads/test-show/"), "file upload stored under board folder");
  const up = r.json;
  r = await call("PUT", `/api/tiles/${tileId}`, { data: { ...up } });
  check(r.json.data.path === up.path, "tile updated with uploaded file");
  const rf = await fetch(base + up.url);
  check(rf.status === 200 && (await rf.text()) === "hello", "uploaded file is served publicly");
  r = await call("POST", "/api/tiles/import", { board_id: boardId, tiles: [
    { type: "note", title: "From CSV", note: "row one", tag: "notes" },
    { type: "light", title: "Imported wash", tag: "lighting", data: { gel: "L201", hex: "#7fa6d9" } }] });
  check(r.status === 200 && r.json.tiles.length === 2 && r.json.tiles[0].sort === 0, "csv import creates tiles in file order");
  r = await call("GET", "/api/state");
  const moved = r.json.tiles.find(t => t.id === tileId);
  check(moved.sort === 2, "import pushes existing tiles down the board");
  r = await call("POST", "/api/tiles/import", { board_id: boardId, tiles: [{ type: "note", title: "ok" }, { type: "nonsense", title: "bad" }] });
  check(r.status === 400, "import rejects an unknown tile type");
  r = await call("GET", "/api/state");
  check(!r.json.tiles.some(t => t.title === "ok"), "a rejected import writes nothing at all");
  r = await call("POST", "/api/tiles", { board_id: boardId, type: "link", title: "Bad link", data: { url: "javascript:alert(1)" } });
  check(r.status === 200 && r.json.data.url === undefined, "unsafe url is stripped from tile data");
  r = await call("POST", "/api/gels", { code: "wash-a", name: "House wash", rgbw: { r: 255, g: 180, b: 80, w: 120 }, hex: "#ffd39a" });
  check(r.status === 200 && r.json.code === "WASH-A" && r.json.rgbw.w === 120, "RGBW gel created");
  r = await call("POST", "/api/gels", { code: "WASH-A", hex: "#ffffff" });
  check(r.status === 409, "duplicate gel code rejected");
  r = await call("PUT", `/api/boards/${boardId}/order`, { ids: [tileId] });
  check(r.status === 200, "reorder accepted");
  r = await call("DELETE", `/api/tiles/${tileId}`);
  check(r.status === 200 && !fs.existsSync(path.join(dataDir, "uploads", up.path.replace("/uploads/", ""))), "deleting tile removes its file");
  r = await call("DELETE", `/api/boards/${boardId}`);
  check(r.status === 200, "board deleted");
  r = await call("POST", "/api/logout");
  r = await call("GET", "/api/me");
  check(r.json.authenticated === false, "logout clears session");
  const page = await fetch(base + "/");
  check(page.status === 200 && (await page.text()).includes("Production Arts Practice"), "front end served");
} catch (e) { console.error(e); process.exitCode = 1; }
finally { srv.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); }
