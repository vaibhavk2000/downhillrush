(() => {
'use strict';

/* ================= Config ================= */
const API = '/api';
const STEP = 10;            // terrain sample spacing (px)
const GRAV = 1400;          // px/s^2
const CHECKPOINT_EVERY = 3000;
const CRASH_PENALTY_MS = 2000;

const FALLBACK_TRACKS = [
  { id: 1, name: 'Rookie Ridge', seed: 1337, length: 24000, slope: 0.22, rough: 0.6, ramps: 0.35, rocks: 0.25, par: 40000 },
  { id: 2, name: 'Pine Plunge',  seed: 4242, length: 30000, slope: 0.28, rough: 0.9, ramps: 0.45, rocks: 0.40, par: 48000 },
  { id: 3, name: "Devil's Drop", seed: 9001, length: 36000, slope: 0.34, rough: 1.2, ramps: 0.55, rocks: 0.55, par: 55000 },
];

/* ================= DOM ================= */
const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const el = {
  hud: $('hud'), hSpeed: $('hSpeed'), hTime: $('hTime'), hScore: $('hScore'), hDist: $('hDist'),
  menu: $('menu'), result: $('result'), tracks: $('tracks'), board: $('board'), name: $('name'),
  offline: $('offline'), touch: $('touch'),
};

/* ================= Helpers ================= */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapPi = a => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const fmtTime = ms => (ms / 1000).toFixed(1);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ================= Terrain ================= */
let terrain = null;

function buildTerrain(track) {
  const rnd = mulberry32(track.seed);
  const n = Math.ceil(track.length / STEP) + 300;
  const ys = new Float32Array(n);
  const rocks = [];
  let i = 0, y = 0, slope = track.slope;
  ys[i++] = 0;
  const push = dy => { if (i < n) { y += dy; ys[i++] = y; } };

  while (i < n) {
    const canRamp = i > 80;
    if (canRamp && rnd() < track.ramps * 0.35) {
      // ramp: climb, then a sudden steep drop (this is what launches the bike)
      const up = 10 + Math.floor(rnd() * 8), upSlope = -(0.4 + rnd() * 0.35);
      for (let k = 0; k < up; k++) push(STEP * upSlope);
      const down = 22 + Math.floor(rnd() * 16), dSlope = 0.75 + rnd() * 0.5;
      for (let k = 0; k < down; k++) push(STEP * dSlope);
    } else {
      const len = 15 + Math.floor(rnd() * 35);
      const target = track.slope + (rnd() - 0.5) * 0.3 * track.rough;
      const startX = i * STEP;
      for (let k = 0; k < len; k++) {
        slope += (target - slope) * 0.12;
        push(STEP * clamp(slope, 0.02, 0.8));
      }
      if (i > 120 && rnd() < track.rocks * 0.5) {
        rocks.push({ x: startX + (len / 2) * STEP, r: 9 + rnd() * 8 });
      }
    }
  }
  // smooth to remove hard corners
  for (let pass = 0; pass < 2; pass++) {
    const c = ys.slice();
    for (let k = 1; k < n - 1; k++) ys[k] = (c[k - 1] + 2 * c[k] + c[k + 1]) / 4;
  }
  // decorative trees
  const trees = [];
  let tx = 200;
  while (tx < track.length + 600) { trees.push({ x: tx, s: 0.7 + rnd() * 0.9, dx: (rnd() - 0.5) * 30 }); tx += 60 + rnd() * 110; }

  return { track, ys, rocks, trees, length: track.length };
}

function heightAt(x) {
  const f = clamp(x / STEP, 0, terrain.ys.length - 2);
  const i = Math.floor(f), t = f - i;
  return terrain.ys[i] * (1 - t) + terrain.ys[i + 1] * t;
}
function thetaAt(x) { return Math.atan2(heightAt(x + 6) - heightAt(x - 6), 12); }

/* ================= Game state ================= */
let tracks = FALLBACK_TRACKS;
let selected = 0;
let g = null;          // run state
let state = 'menu';    // menu | countdown | running | crashed | finished
const input = { pedal: false, brake: false, left: false, right: false };
const cam = { x: 0, y: 0 };
let popups = [];
let lastT = 0;

function newRun() {
  const bike = { x: 100, y: 0, s: 0, vx: 0, vy: 0, angle: 0, angVel: 0, rot: 0, grounded: true, airTime: 0, wheel: 0 };
  bike.y = heightAt(bike.x);
  bike.angle = thetaAt(bike.x);
  g = {
    bike, time: 0, trick: 0, crashes: 0, combo: 1, checkpoint: 100,
    countdown: 3.2, crashT: 0, rider: null, finishT: 0,
  };
  cam.x = bike.x + 120; cam.y = bike.y;
  popups = [];
}

function startRace() {
  terrain = buildTerrain(tracks[selected]);
  newRun();
  state = 'countdown';
  el.menu.classList.add('hidden');
  el.result.classList.add('hidden');
  el.hud.classList.remove('hidden');
  if (matchMedia('(pointer:coarse)').matches) el.touch.classList.remove('hidden');
}

function toMenu() {
  state = 'menu';
  el.hud.classList.add('hidden');
  el.touch.classList.add('hidden');
  el.result.classList.add('hidden');
  el.menu.classList.remove('hidden');
  loadBoard();
}

function popup(text, color = '#fff') { popups.push({ text, color, t: 0 }); if (popups.length > 4) popups.shift(); }

/* ================= Physics ================= */
function crash(reason) {
  const b = g.bike;
  state = 'crashed';
  g.crashT = 0;
  g.crashes++;
  g.combo = 1;
  g.rider = { x: b.x, y: b.y - 20, vx: b.grounded ? b.s * 0.9 : b.vx, vy: -350, rot: 0, vr: 9 };
  if (b.grounded) { b.vx = b.s * 0.6; b.vy = -200; b.grounded = false; }
  b.angVel = (Math.random() > 0.5 ? 1 : -1) * 6;
  popup(reason, '#ff5a1f');
}

function scoreLanding(b) {
  let pts = 0, label = '';
  const flips = Math.floor(Math.abs(b.rot) / (Math.PI * 2) + 0.15);
  if (flips > 0) {
    const name = b.rot < 0 ? 'Backflip' : 'Frontflip';
    pts += Math.round(flips * 400 * g.combo);
    label = `${flips > 1 ? flips + 'x ' : ''}${name}  x${g.combo.toFixed(1)}`;
    g.combo = Math.min(3, g.combo + 0.5);
  }
  if (b.airTime > 0.7) { pts += Math.round(b.airTime * 100); label = (label ? label + ' + ' : '') + 'Big air'; }
  if (pts > 0) { g.trick += pts; popup(`${label}  +${pts}`, '#ffd23f'); }
}

function updateRunning(dt) {
  const b = g.bike;
  g.time += dt * 1000;

  if (b.grounded) {
    const th = thetaAt(b.x);
    let a = GRAV * Math.sin(th) - 0.0008 * b.s * b.s - 40;
    if (input.pedal) a += 260;
    if (input.brake) a -= 1000;
    b.s = clamp(b.s + a * dt, 0, 1100);

    // look ahead to detect a crest steep enough to throw the bike off the ground
    const ahead = thetaAt(b.x + b.s * Math.cos(th) * 0.05);
    const dTh = (ahead - th) / 0.05;
    const dx = b.s * Math.cos(th) * dt;

    if (b.s > 250 && b.s * dTh > GRAV * Math.cos(th)) {
      b.grounded = false;
      b.vx = b.s * Math.cos(th);
      b.vy = b.s * Math.sin(th);
      b.airTime = 0; b.rot = 0; b.angVel = 0;
      b.x += b.vx * dt; b.y += b.vy * dt;
    } else {
      b.x += dx;
      b.y = heightAt(b.x);
      b.angle += wrapPi(th - b.angle) * Math.min(1, dt * 12);
    }
    b.wheel += b.s * dt / 12;
    if (b.grounded && b.x > g.checkpoint + CHECKPOINT_EVERY) g.checkpoint = Math.floor(b.x / CHECKPOINT_EVERY) * CHECKPOINT_EVERY;
  } else {
    b.vy += GRAV * dt;
    if (input.left) b.angVel += (-5 - b.angVel) * Math.min(1, dt * 5);
    else if (input.right) b.angVel += (5 - b.angVel) * Math.min(1, dt * 5);
    else b.angVel *= 1 - Math.min(1, dt * 1.5);
    b.angle += b.angVel * dt;
    b.rot += b.angVel * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.airTime += dt;
    b.wheel += 6 * dt;

    const gy = heightAt(b.x);
    if (b.y >= gy) {
      const th = thetaAt(b.x);
      const diff = wrapPi(b.angle - th);
      if (Math.abs(diff) > 0.95) { b.y = gy; crash('Bad landing'); return; }
      b.y = gy;
      const s = b.vx * Math.cos(th) + b.vy * Math.sin(th);
      b.s = Math.max(80, s * (1 - Math.abs(diff) * 0.35));
      b.grounded = true;
      scoreLanding(b);
    }
  }

  // rocks
  for (const r of terrain.rocks) {
    if (Math.abs(r.x - b.x) > 60) continue;
    const ry = heightAt(r.x) - r.r * 0.6;
    if (Math.hypot(r.x - b.x, ry - (b.y - 14)) < r.r * 0.9 + 11) { crash('Hit a rock'); return; }
  }

  if (b.x >= terrain.length) finish();
}

function updateCrashed(dt) {
  const b = g.bike, r = g.rider;
  g.time += dt * 1000;
  g.crashT += dt;
  // tumbling bike
  b.vy += GRAV * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.angle += b.angVel * dt;
  let gy = heightAt(b.x);
  if (b.y > gy) { b.y = gy; b.vy *= -0.3; b.vx *= 0.6; b.angVel *= 0.6; }
  // rider
  r.vy += GRAV * dt; r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.vr * dt;
  gy = heightAt(r.x);
  if (r.y > gy - 6) { r.y = gy - 6; r.vy *= -0.25; r.vx *= 0.7; r.vr *= 0.6; }

  if (g.crashT > 1.4) {
    // respawn at checkpoint
    const cx = g.checkpoint;
    Object.assign(b, { x: cx, y: heightAt(cx), s: 250, vx: 0, vy: 0, angVel: 0, rot: 0, grounded: true, airTime: 0 });
    b.angle = thetaAt(cx);
    g.time += CRASH_PENALTY_MS;
    g.rider = null;
    popup('+2s penalty', '#9db4bd');
    state = 'running';
  }
}

function finish() {
  state = 'finished';
  g.finishT = 0;
  const t = tracks[selected];
  const total = Math.max(0, Math.round((t.par * 2 - g.time) / 10) + g.trick - g.crashes * 300);
  showResult(total);
}

/* ================= Rendering ================= */
function drawSky(sc) {
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#2b4a63'); grd.addColorStop(0.6, '#8fb3c2'); grd.addColorStop(1, '#dbe7e6');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
  const layers = [
    { f: 0.05, base: 0.55, amp: 90, col: '#6d8da0' },
    { f: 0.12, base: 0.68, amp: 70, col: '#4c6f73' },
    { f: 0.22, base: 0.80, amp: 50, col: '#34574f' },
  ];
  for (const L of layers) {
    ctx.fillStyle = L.col; ctx.beginPath(); ctx.moveTo(0, H);
    for (let px = 0; px <= W + 8; px += 8) {
      const wx = px + cam.x * L.f;
      const y = H * L.base - (Math.sin(wx * 0.004) * L.amp + Math.sin(wx * 0.011 + 2) * L.amp * 0.4 + Math.abs(Math.sin(wx * 0.0021)) * L.amp) - cam.y * L.f * 0.2;
      ctx.lineTo(px, y);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }
}

function drawTree(x, y, s) {
  ctx.fillStyle = '#4a3226'; ctx.fillRect(x - 3 * s, y - 14 * s, 6 * s, 14 * s);
  ctx.fillStyle = '#2f5d3a';
  for (let k = 0; k < 3; k++) {
    const by = y - (10 + k * 20) * s, w = (30 - k * 7) * s;
    ctx.beginPath(); ctx.moveTo(x - w, by); ctx.lineTo(x + w, by); ctx.lineTo(x, by - 32 * s); ctx.closePath(); ctx.fill();
  }
}

function drawBike(b, spin) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  const wr = 12;
  // wheels
  for (const wx of [-22, 22]) {
    ctx.save(); ctx.translate(wx, -wr); ctx.rotate(b.wheel);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, wr - 2, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-wr + 3, 0); ctx.lineTo(wr - 3, 0); ctx.moveTo(0, -wr + 3); ctx.lineTo(0, wr - 3); ctx.stroke();
    ctx.restore();
  }
  // frame
  ctx.strokeStyle = '#ff5a1f'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-22, -wr); ctx.lineTo(-6, -30); ctx.lineTo(14, -30); ctx.lineTo(22, -wr);
  ctx.moveTo(-6, -30); ctx.lineTo(2, -wr); ctx.lineTo(14, -30); ctx.stroke();
  ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(14, -30); ctx.lineTo(18, -40); ctx.moveTo(12, -40); ctx.lineTo(24, -40); ctx.stroke();
  if (!spin) {
    // rider
    ctx.strokeStyle = '#eef4f5'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-4, -34); ctx.lineTo(6, -56); ctx.lineTo(18, -42); ctx.stroke();           // torso+arm
    ctx.beginPath(); ctx.moveTo(-4, -34); ctx.lineTo(4, -20); ctx.lineTo(2, -12); ctx.stroke();            // leg
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(8, -64, 7, 0, Math.PI * 2); ctx.fill();            // helmet
  }
  ctx.restore();
}

function drawRider(r) {
  ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.rot);
  ctx.strokeStyle = '#eef4f5'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, 10); ctx.moveTo(-10, -6); ctx.lineTo(10, -6);
  ctx.moveTo(0, 10); ctx.lineTo(-8, 22); ctx.moveTo(0, 10); ctx.lineTo(9, 22); ctx.stroke();
  ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(0, -22, 7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function render() {
  const sc = Math.max(0.5, H / 720) * (g && g.bike ? clamp(1.02 - g.bike.s / 4500, 0.78, 1) : 1);
  drawSky(sc);
  if (!terrain || !g) return;
  const b = g.bike;

  cam.x += ((b.x + 160 + b.s * 0.18) - cam.x) * 0.1;
  cam.y += (b.y - cam.y) * 0.08;

  ctx.save();
  ctx.translate(W * 0.33, H * 0.6);
  ctx.scale(sc, sc);
  ctx.translate(-cam.x, -cam.y);

  const left = cam.x - (W * 0.33) / sc - 80, right = cam.x + (W * 0.67) / sc + 80;
  const bottom = cam.y + (H * 0.4) / sc + 200;

  // trees behind ground line
  for (const t of terrain.trees) {
    if (t.x < left - 60 || t.x > right + 60) continue;
    drawTree(t.x + t.dx, heightAt(t.x) + 2, t.s);
  }

  // ground
  const x0 = Math.max(0, Math.floor(left / STEP) * STEP);
  ctx.beginPath(); ctx.moveTo(x0, bottom);
  for (let x = x0; x <= right; x += STEP) ctx.lineTo(x, heightAt(x));
  ctx.lineTo(right, bottom); ctx.closePath();
  const gg = ctx.createLinearGradient(0, cam.y - 200, 0, bottom);
  gg.addColorStop(0, '#7a5238'); gg.addColorStop(1, '#3e281c');
  ctx.fillStyle = gg; ctx.fill();
  ctx.beginPath();
  for (let x = x0; x <= right; x += STEP) { const y = heightAt(x); x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
  ctx.strokeStyle = '#6aa04a'; ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.stroke();

  // rocks
  for (const r of terrain.rocks) {
    if (r.x < left || r.x > right) continue;
    const y = heightAt(r.x);
    ctx.fillStyle = '#6b6f73'; ctx.beginPath(); ctx.ellipse(r.x, y - r.r * 0.5, r.r, r.r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8b9095'; ctx.beginPath(); ctx.ellipse(r.x - r.r * 0.25, y - r.r * 0.7, r.r * 0.45, r.r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  }

  // checkpoints + finish
  for (let cx = CHECKPOINT_EVERY; cx < terrain.length; cx += CHECKPOINT_EVERY) flag(cx, '#ffd23f');
  finishLine(terrain.length);

  // bike / rider
  drawBike(b, state === 'crashed');
  if (g.rider) drawRider(g.rider);
  ctx.restore();

  // popups + countdown (screen space)
  ctx.textAlign = 'center';
  popups.forEach((p, i) => {
    ctx.globalAlpha = clamp(1 - p.t / 1.8, 0, 1);
    ctx.fillStyle = p.color; ctx.font = 'italic bold 26px "Trebuchet MS",sans-serif';
    ctx.fillText(p.text, W / 2, H * 0.22 + i * 32 - p.t * 14);
  });
  ctx.globalAlpha = 1;
  if (state === 'countdown') {
    const n = Math.ceil(g.countdown - 0.2);
    ctx.fillStyle = '#fff'; ctx.font = 'italic bold 110px "Trebuchet MS",sans-serif';
    ctx.fillText(n > 0 ? String(n) : 'GO!', W / 2, H * 0.4);
  }
}

function flag(x, color) {
  const y = heightAt(x);
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 70); ctx.stroke();
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - 70); ctx.lineTo(x + 34, y - 60); ctx.lineTo(x, y - 50); ctx.fill();
}
function finishLine(x) {
  const y = heightAt(x);
  ctx.fillStyle = '#ddd'; ctx.fillRect(x - 4, y - 120, 6, 120);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
    ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff';
    ctx.fillRect(x + c * 8, y - 120 + r * 8, 8, 8);
  }
}

/* ================= Main loop ================= */
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
addEventListener('resize', resize); resize();

function frame(ts) {
  const dt = Math.min(0.033, (ts - lastT) / 1000 || 0);
  lastT = ts;

  if (g) {
    popups.forEach(p => p.t += dt); popups = popups.filter(p => p.t < 1.8);
    if (state === 'countdown') {
      g.countdown -= dt;
      if (g.countdown <= 0) state = 'running';
    } else if (state === 'running') updateRunning(dt);
    else if (state === 'crashed') updateCrashed(dt);

    if (state !== 'menu') {
      el.hSpeed.textContent = Math.round(g.bike.s / 10 * 3.6);
      el.hTime.textContent = fmtTime(g.time);
      el.hScore.textContent = g.trick;
      el.hDist.textContent = clamp(Math.round(g.bike.x / terrain.length * 100), 0, 100);
    }
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ================= Input ================= */
const KEYMAP = {
  ArrowUp: 'pedal', KeyW: 'pedal', Space: 'pedal',
  ArrowDown: 'brake', KeyS: 'brake',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};
addEventListener('keydown', e => {
  if (e.target === el.name) return;
  if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyR' && state !== 'menu') startRace();
  if (e.code === 'Escape' && state !== 'menu') toMenu();
});
addEventListener('keyup', e => { if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false; });
addEventListener('blur', () => { for (const k in input) input[k] = false; });

el.touch.querySelectorAll('button').forEach(btn => {
  const k = btn.dataset.k;
  const on = e => { e.preventDefault(); input[k] = true; btn.classList.add('on'); };
  const off = e => { e.preventDefault(); input[k] = false; btn.classList.remove('on'); };
  btn.addEventListener('pointerdown', on);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => btn.addEventListener(ev, off));
});

/* ================= Menu + API ================= */
function renderTracks() {
  el.tracks.innerHTML = '';
  tracks.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = 'track' + (i === selected ? ' sel' : '');
    b.innerHTML = `<b>${esc(t.name)}</b><span>${(t.length / 10).toFixed(0)} m</span>`;
    b.onclick = () => { selected = i; renderTracks(); loadBoard(); };
    el.tracks.appendChild(b);
  });
}

async function loadTracks() {
  try {
    const r = await fetch(`${API}/tracks`);
    if (!r.ok) throw new Error();
    tracks = await r.json();
    el.offline.classList.add('hidden');
  } catch { tracks = FALLBACK_TRACKS; el.offline.classList.remove('hidden'); }
  renderTracks();
}

async function loadBoard() {
  el.board.innerHTML = '<li class="note">Loading...</li>';
  try {
    const r = await fetch(`${API}/leaderboard/${tracks[selected].id}?limit=10`);
    if (!r.ok) throw new Error();
    const rows = await r.json();
    el.board.innerHTML = rows.length
      ? rows.map(x => `<li><b>${esc(x.name)}</b> <span>${x.total_score} pts &middot; ${fmtTime(x.time_ms)}s</span></li>`).join('')
      : '<li class="note">No scores yet. Be the first rider.</li>';
  } catch { el.board.innerHTML = '<li class="note">Leaderboard unavailable.</li>'; }
}

async function showResult(localTotal) {
  const t = tracks[selected];
  $('rTitle').textContent = 'Finish!';
  $('rTime').textContent = fmtTime(g.time) + ' s';
  $('rTricks').textContent = g.trick;
  $('rCrashes').textContent = g.crashes;
  $('rTotal').textContent = localTotal;
  $('rRank').textContent = '-';
  $('rMsg').textContent = 'Saving score...';
  el.hud.classList.add('hidden'); el.touch.classList.add('hidden');
  el.result.classList.remove('hidden');

  const name = el.name.value.trim();
  if (!name) { $('rMsg').textContent = 'Enter a rider name in the menu to save scores.'; return; }
  try {
    const r = await fetch(`${API}/scores`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, trackId: t.id, timeMs: Math.round(g.time), trickPoints: g.trick, crashes: g.crashes }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not save score');
    $('rTotal').textContent = data.totalScore;
    $('rRank').textContent = '#' + data.rank;
    $('rMsg').textContent = 'Score saved.';
  } catch (err) { $('rMsg').textContent = err.message || 'Score not saved (server offline).'; }
}

$('startBtn').onclick = () => {
  localStorage.setItem('dr_name', el.name.value.trim());
  startRace();
};
$('againBtn').onclick = startRace;
$('menuBtn').onclick = toMenu;
el.name.value = localStorage.getItem('dr_name') || '';
el.name.addEventListener('keydown', e => { if (e.key === 'Enter') $('startBtn').click(); });

loadTracks().then(loadBoard);
})();
