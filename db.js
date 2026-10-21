// SQLite database setup + seed data
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });

const db = new Database(path.join(dir, 'game.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS tracks (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  seed       INTEGER NOT NULL,
  length_px  INTEGER NOT NULL,
  slope      REAL    NOT NULL,   -- average steepness
  rough      REAL    NOT NULL,   -- terrain bumpiness
  ramps      REAL    NOT NULL,   -- ramp frequency 0..1
  rocks      REAL    NOT NULL,   -- rock frequency 0..1
  par_ms     INTEGER NOT NULL,   -- reference time used for scoring
  min_ms     INTEGER NOT NULL    -- fastest believable time (anti-cheat)
);

CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    INTEGER NOT NULL REFERENCES players(id),
  track_id     INTEGER NOT NULL REFERENCES tracks(id),
  time_ms      INTEGER NOT NULL,
  trick_points INTEGER NOT NULL,
  crashes      INTEGER NOT NULL,
  total_score  INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scores_track ON scores(track_id, total_score DESC);
`);

if (db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n === 0) {
  const ins = db.prepare(`INSERT INTO tracks
    (id,name,seed,length_px,slope,rough,ramps,rocks,par_ms,min_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  ins.run(1, 'Rookie Ridge', 1337, 24000, 0.22, 0.6, 0.35, 0.25, 40000, 15000);
  ins.run(2, 'Pine Plunge',  4242, 30000, 0.28, 0.9, 0.45, 0.40, 48000, 20000);
  ins.run(3, "Devil's Drop", 9001, 36000, 0.34, 1.2, 0.55, 0.55, 55000, 24000);
}

module.exports = db;
