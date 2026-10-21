// Express backend: serves the game + REST API for tracks and leaderboard
const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- scoring (client uses the same formula for display) ----
function computeScore(track, timeMs, trickPoints, crashes) {
  const timeScore = Math.max(0, Math.round((track.par_ms * 2 - timeMs) / 10));
  return Math.max(0, timeScore + trickPoints - crashes * 300);
}

const NAME_RE = /^[\p{L}\p{N} _.\-]{2,16}$/u;
const lastPost = new Map(); // ip -> timestamp (very small rate limit)

const qTracks = db.prepare('SELECT * FROM tracks ORDER BY id');
const qTrack = db.prepare('SELECT * FROM tracks WHERE id = ?');
const qPlayer = db.prepare('SELECT id FROM players WHERE name = ?');
const qNewPlayer = db.prepare('INSERT INTO players (name) VALUES (?)');
const qInsertScore = db.prepare(`INSERT INTO scores
  (player_id, track_id, time_ms, trick_points, crashes, total_score)
  VALUES (?,?,?,?,?,?)`);
const qBoard = db.prepare(`
  SELECT p.name, MAX(s.total_score) AS total_score,
         s.time_ms, s.trick_points, s.crashes
  FROM scores s JOIN players p ON p.id = s.player_id
  WHERE s.track_id = ?
  GROUP BY s.player_id
  ORDER BY total_score DESC, s.time_ms ASC
  LIMIT ?`);
const qRank = db.prepare(`
  SELECT COUNT(*) + 1 AS rank FROM (
    SELECT MAX(total_score) AS m FROM scores WHERE track_id = ? GROUP BY player_id
  ) WHERE m > ?`);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/tracks', (_req, res) => {
  res.json(qTracks.all().map(t => ({
    id: t.id, name: t.name, seed: t.seed, length: t.length_px,
    slope: t.slope, rough: t.rough, ramps: t.ramps, rocks: t.rocks, par: t.par_ms
  })));
});

app.get('/api/leaderboard/:trackId', (req, res) => {
  const trackId = parseInt(req.params.trackId, 10);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  if (!qTrack.get(trackId)) return res.status(404).json({ error: 'Unknown track' });
  res.json(qBoard.all(trackId, limit));
});

app.post('/api/scores', (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  if (now - (lastPost.get(ip) || 0) < 3000) {
    return res.status(429).json({ error: 'Too many submissions, wait a few seconds.' });
  }
  lastPost.set(ip, now);

  const { name, trackId, timeMs, trickPoints, crashes } = req.body || {};
  const cleanName = String(name || '').trim();
  if (!NAME_RE.test(cleanName)) {
    return res.status(400).json({ error: 'Name must be 2-16 letters, numbers, spaces, _ . or -' });
  }
  const track = qTrack.get(parseInt(trackId, 10));
  if (!track) return res.status(404).json({ error: 'Unknown track' });

  const t = Math.round(Number(timeMs));
  const tp = Math.round(Number(trickPoints));
  const c = Math.round(Number(crashes));
  if (![t, tp, c].every(Number.isFinite) || tp < 0 || c < 0) {
    return res.status(400).json({ error: 'Invalid score data' });
  }
  // basic anti-cheat
  if (t < track.min_ms) return res.status(422).json({ error: 'Time is not believable.' });
  if (tp > (t / 1000) * 400) return res.status(422).json({ error: 'Trick points are not believable.' });

  const total = computeScore(track, t, tp, c);
  const tx = db.transaction(() => {
    let p = qPlayer.get(cleanName);
    if (!p) p = { id: qNewPlayer.run(cleanName).lastInsertRowid };
    qInsertScore.run(p.id, track.id, t, tp, c, total);
  });
  tx();

  res.json({ totalScore: total, rank: qRank.get(track.id, total).rank });
});

app.listen(PORT, () => console.log(`Downhill Rush running at http://localhost:${PORT}`));
