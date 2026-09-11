import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "moodboard.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    create table if not exists boards (
      id text primary key,
      name text not null,
      kind text default '',
      blurb text default '',
      intent text default '',
      sort integer default 0
    );
    create table if not exists tiles (
      id text primary key,
      board_id text not null references boards(id) on delete cascade,
      type text not null,
      title text default '',
      note text default '',
      tag text default '',
      sort integer default 0,
      pinned integer default 0,
      data text default '{}',
      created_at text default (datetime('now'))
    );
    create table if not exists gels (
      id text primary key,
      code text not null unique,
      name text default '',
      hex text not null,
      rgbw text,
      sort integer default 0
    );
    create table if not exists sessions (
      token text primary key,
      created_at integer not null,
      expires_at integer not null
    );
    create index if not exists tiles_board on tiles(board_id, sort);
  `);

  seedIfEmpty(db);
  return db;
}

function seedIfEmpty(db) {
  const n = db.prepare("select count(*) as c from boards").get().c;
  if (n > 0) return;

  const boards = [
    ["cinderella", "Cinderella", "Pantomime", 1,
      "Big, warm and fast. Every cue has to land for an audience who talk back.",
      "Saturated colour and hard changes. The transformation is the one moment the lighting and sound have to sell entirely on their own, so everything before it stays warmer and simpler to make the contrast bigger."],
    ["two", "Two", "Jim Cartwright", 2,
      "One pub, two actors, fourteen characters. Nothing can be showy.",
      "Naturalistic tungsten look with practicals doing most of the work. Tight specials isolate characters when they step out of the pub, and sound is almost entirely ambience so the silences count."],
    ["devised", "Devised piece", "Original work", 3,
      "Nothing decided yet. This board is for the ideas that come out of the room.",
      "Write this once the group has a starting point."],
  ];
  const gels = [
    ["L201", "Full CT blue", "#7fa6d9"], ["L106", "Primary red", "#d8262a"],
    ["L104", "Deep amber", "#d97a2a"], ["L119", "Dark blue", "#1b3fa0"],
    ["L181", "Congo blue", "#3a2ea3"], ["L139", "Primary green", "#2fa34a"],
    ["L058", "Lavender", "#9a86d6"], ["L134", "Golden amber", "#e8a33a"],
    ["L206", "Quarter CT orange", "#f0b97a"],
  ];
  const tiles = [
    ["cinderella", "light", "Ballroom wash", "Warm golds from the front, LEE 134 on the top bars. Should feel expensive.", "lighting", { gel: "L134", hex: "#e8a33a" }],
    ["cinderella", "sound", "Midnight clock", "Twelve chimes, slowed and pitched down. Cut hard on the last strike.", "sound", {}],
    ["cinderella", "palette", "Kitchen to ballroom", "Dull to bright. The palette shift is the story.", "colour", { colors: ["#3a2f28", "#6b5a44", "#c9902e", "#f2c14e", "#ffe9a3"] }],
    ["cinderella", "note", "Transformation", "Blackout is too easy. Try a slow blue build with a strobe burst at the peak, then snap to full ballroom state.", "notes", {}],
    ["cinderella", "light", "Fairy Godmother", "Congo blue with lilac fill so faces still read.", "lighting", { gel: "L181", hex: "#3a2ea3" }],
    ["two", "light", "Pub base state", "Tungsten warm, low level. Quarter CT orange to take the edge off the LEDs.", "lighting", { gel: "L206", hex: "#f0b97a" }],
    ["two", "sound", "Pub ambience bed", "Glasses, low chatter, a fruit machine somewhere. Runs under the whole show.", "sound", {}],
    ["two", "palette", "Nicotine and brass", "Muddy warms. Nothing clean.", "colour", { colors: ["#1f1a15", "#4a3a2a", "#8a6a3f", "#b08a4a", "#d9c29b"] }],
    ["two", "note", "Last orders", "The bell is the only loud sound in the play. Keep it that way.", "notes", {}],
    ["devised", "note", "Starting question", "What do we want the audience to feel in the first 30 seconds before anyone speaks?", "notes", {}],
  ];

  const insBoard = db.prepare("insert into boards (id,name,kind,sort,blurb,intent) values (?,?,?,?,?,?)");
  const insGel = db.prepare("insert into gels (id,code,name,hex,sort) values (?,?,?,?,?)");
  const insTile = db.prepare("insert into tiles (id,board_id,type,title,note,tag,sort,data) values (?,?,?,?,?,?,?,?)");
  db.transaction(() => {
    boards.forEach(b => insBoard.run(...b));
    gels.forEach((g, i) => insGel.run(newId(), g[0], g[1], g[2], i));
    const counters = {};
    tiles.forEach(t => {
      const sort = counters[t[0]] = (counters[t[0]] ?? -1) + 1;
      insTile.run(newId(), t[0], t[1], t[2], t[3], t[4], sort, JSON.stringify(t[5]));
    });
  })();
}

export function newId() {
  return crypto.randomUUID();
}

export function rowTile(r) {
  return { ...r, pinned: !!r.pinned, data: safeJson(r.data, {}) };
}
export function rowGel(r) {
  return { ...r, rgbw: r.rgbw ? safeJson(r.rgbw, null) : null };
}
function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
