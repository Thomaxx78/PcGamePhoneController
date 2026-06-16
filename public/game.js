/* ============================================================
   GAME.JS — écran de jeu (ordinateur)
   Gère les écrans : lobby / menu / team_select / game
   La simulation physique ne tourne que pendant l'état "game".
   ============================================================ */

const socket = io();

// ── Terrain ──────────────────────────────────────────────────────────────────
const W = 900, H = 600;
const MARGIN = 40;
const GOAL_H = 180;
const FIELD  = { left: MARGIN, right: W - MARGIN, top: MARGIN, bottom: H - MARGIN };

const PLAYER_R    = 16;
const BALL_R      = 9;
const BASE_SPEED  = 3.4;
const TACKLE_BOOST  = 1.9;
const TACKLE_FRAMES = 16;
const TACKLE_CD     = 40;
const PASS_SPEED    = 7.5;
const SHOOT_SPEED   = 13;
const FRICTION      = 0.985;
const POSSESS_DIST  = PLAYER_R + BALL_R + 7;
const REGRAB_CD     = 14;
const TEAM_COLORS   = { A: '#38bdf8', B: '#fb7237' };

// ── État jeu ─────────────────────────────────────────────────────────────────
const players = new Map();
const ball    = { x: W/2, y: H/2, vx: 0, vy: 0, owner: null };
const score   = { A: 0, B: 0 };
let countByTeam = { A: 0, B: 0 };
let gameActive  = false;

const canvas = document.getElementById('pitch');
const ctx    = canvas.getContext('2d');

// ── Données QR (réutilisées pour le modal in-game) ───────────────────────────
let savedQr  = '';
let savedUrl = '';

// ── Screens ──────────────────────────────────────────────────────────────────
const SCREENS = ['lobby', 'menu', 'team', 'game'];
function showScreen(name) {
  for (const s of SCREENS)
    document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name);
}

// ── Connexion ─────────────────────────────────────────────────────────────────
socket.on('connect', () => socket.emit('register-host'));

socket.on('host-ready', ({ controllerUrl, qr }) => {
  savedQr  = qr;
  savedUrl = controllerUrl;
  document.getElementById('qr-img').src   = qr;
  document.getElementById('ctrl-url').textContent = controllerUrl;
  document.getElementById('qr-img2').src  = qr;
  document.getElementById('ctrl-url2').textContent = controllerUrl;
  document.getElementById('statusDot').classList.add('on');
});

// ── État global ───────────────────────────────────────────────────────────────
socket.on('state-change', (payload) => {
  const { state, games, menuIndex, players: pList } = payload;

  if (state === 'lobby')       renderLobby();
  else if (state === 'menu')   renderMenu(games, menuIndex, pList);
  else if (state === 'team_select') renderTeamSelect(games, menuIndex, pList);
  else if (state === 'game')   enterGame(pList);
});

// ── LOBBY ─────────────────────────────────────────────────────────────────────
function renderLobby() {
  showScreen('lobby');
}

// ── MENU ─────────────────────────────────────────────────────────────────────
function renderMenu(games, menuIndex, pList) {
  showScreen('menu');

  // Liste des jeux
  const ul = document.getElementById('games-list');
  ul.innerHTML = '';
  games.forEach((g, i) => {
    const li = document.createElement('li');
    li.className = 'game-item' + (i === menuIndex ? ' selected' : '');
    li.textContent = g;
    ul.appendChild(li);
  });

  // Joueurs connectés
  const pl = document.getElementById('players-list');
  pl.innerHTML = '';
  pList.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-pill';
    div.innerHTML = `<span class="player-dot"></span>${p.name}`;
    pl.appendChild(div);
  });

  document.getElementById('menu-hint').textContent =
    pList.length ? `${pList[0].name} choisit le jeu` : 'En attente de joueurs…';
}

// ── TEAM SELECT ───────────────────────────────────────────────────────────────
function renderTeamSelect(games, menuIndex, pList) {
  showScreen('team');
  document.getElementById('team-game-title').textContent = games[menuIndex] || '';

  const teamA = pList.filter(p => p.team === 'A');
  const teamB = pList.filter(p => p.team === 'B');
  const none  = pList.filter(p => !p.team);

  function renderCol(id, list) {
    const el = document.getElementById(id);
    el.innerHTML = '';
    list.forEach(p => {
      const d = document.createElement('div');
      d.className = 'team-player-item';
      d.textContent = p.name;
      el.appendChild(d);
    });
  }
  renderCol('team-a-list', teamA);
  renderCol('team-b-list', teamB);

  const hint = document.getElementById('unchosen-hint');
  hint.textContent = none.length
    ? `${none.map(p => p.name).join(', ')} n'a pas encore choisi`
    : '';
}

// ── COUNTDOWN ────────────────────────────────────────────────────────────────
let cdInterval = null;

socket.on('cd-start', ({ ms }) => {
  const wrap  = document.getElementById('cd-wrap');
  const num   = document.getElementById('cd-num');
  const fill  = document.getElementById('cd-fill');
  wrap.classList.remove('hidden');
  num.textContent = Math.ceil(ms / 1000);
  clearInterval(cdInterval);
  let remaining = ms;
  cdInterval = setInterval(() => {
    remaining -= 100;
    num.textContent = Math.max(1, Math.ceil(remaining / 1000));
    if (remaining <= 0) clearInterval(cdInterval);
  }, 100);
  // CSS bar
  fill.style.transition = 'none';
  fill.style.width = '100%';
  fill.offsetWidth; // reflow
  fill.style.transition = `width ${ms}ms linear`;
  fill.style.width = '0%';
});

socket.on('cd-cancel', () => {
  clearInterval(cdInterval);
  const wrap = document.getElementById('cd-wrap');
  const fill = document.getElementById('cd-fill');
  wrap.classList.add('hidden');
  fill.style.transition = 'none';
  fill.style.width = '100%';
});

// ── GAME INIT ─────────────────────────────────────────────────────────────────
function enterGame(pList) {
  gameActive = true;
  showScreen('game');
  // Reset score & ball
  score.A = 0; score.B = 0;
  document.getElementById('scoreA').textContent = '0';
  document.getElementById('scoreB').textContent = '0';
  ball.x = W/2; ball.y = H/2; ball.vx = 0; ball.vy = 0; ball.owner = null;
  // Init players from team assignments
  players.clear();
  countByTeam = { A: 0, B: 0 };
  for (const p of pList) {
    const spawn = spawnFor(p.team);
    players.set(p.id, {
      id: p.id, number: p.number, name: p.name, team: p.team,
      x: spawn.x, y: spawn.y, vx: 0, vy: 0,
      aimX: p.team === 'A' ? 1 : -1, aimY: 0,
      input: { x: 0, y: 0 },
      tackle: 0, tackleCd: 0, regrab: 0,
    });
    countByTeam[p.team]++;
  }
  document.getElementById('statusText').textContent = `${players.size} joueur(s)`;
}

// in-game: quelqu'un rejoint en cours de partie
socket.on('player-joined', (p) => {
  if (!gameActive) return;
  if (players.has(p.id)) return;
  const spawn = spawnFor(p.team || 'A');
  players.set(p.id, {
    ...p,
    x: spawn.x, y: spawn.y, vx: 0, vy: 0,
    aimX: 1, aimY: 0, input: { x: 0, y: 0 },
    tackle: 0, tackleCd: 0, regrab: 0,
  });
  countByTeam[p.team || 'A']++;
  document.getElementById('statusText').textContent = `${players.size} joueur(s)`;
});

socket.on('player-left', ({ id }) => {
  if (!gameActive) return;
  const p = players.get(id);
  if (p) { countByTeam[p.team]--; if (ball.owner === id) ball.owner = null; players.delete(id); }
  document.getElementById('statusText').textContent = `${players.size} joueur(s)`;
});

socket.on('player-input', ({ id, x, y }) => {
  const p = players.get(id);
  if (p) p.input = { x, y };
});

socket.on('player-action', ({ id, type }) => {
  const p = players.get(id);
  if (!p) return;
  if (type === 'tackle') {
    if (p.tackleCd <= 0) { p.tackle = TACKLE_FRAMES; p.tackleCd = TACKLE_CD; }
  } else if (type === 'pass' || type === 'shoot') {
    if (ball.owner === id) {
      const speed = type === 'pass' ? PASS_SPEED : SHOOT_SPEED;
      ball.vx = p.aimX * speed; ball.vy = p.aimY * speed;
      ball.owner = null; p.regrab = REGRAB_CD;
    }
  }
});

// ── Bouton "ajouter" in-game ──────────────────────────────────────────────────
document.getElementById('joinPill').addEventListener('click', () =>
  document.getElementById('join-modal').classList.remove('hidden'));
document.getElementById('join-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget)
    e.currentTarget.classList.add('hidden');
});

// ── Spawn ─────────────────────────────────────────────────────────────────────
function spawnFor(team) {
  const idx   = countByTeam[team] || 0;
  const x     = team === 'A' ? W * 0.30 : W * 0.70;
  const slots = [H/2, H/2-110, H/2+110, H/2-200, H/2+200];
  return { x, y: slots[idx % slots.length] };
}

// ── Simulation ────────────────────────────────────────────────────────────────
function update() {
  if (!gameActive) return;

  for (const p of players.values()) {
    if (p.tackle > 0) p.tackle--;
    if (p.tackleCd > 0) p.tackleCd--;
    if (p.regrab  > 0) p.regrab--;
    const speed = BASE_SPEED * (p.tackle > 0 ? TACKLE_BOOST : 1);
    p.x += p.input.x * speed;
    p.y += p.input.y * speed;
    const mag = Math.hypot(p.input.x, p.input.y);
    if (mag > 0.25) { p.aimX = p.input.x / mag; p.aimY = p.input.y / mag; }
    p.x = clamp(p.x, FIELD.left + PLAYER_R, FIELD.right  - PLAYER_R);
    p.y = clamp(p.y, FIELD.top  + PLAYER_R, FIELD.bottom - PLAYER_R);
  }

  const list = [...players.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i+1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x-a.x, dy = b.y-a.y;
      const d  = Math.hypot(dx, dy) || 0.001;
      const min = PLAYER_R*2;
      if (d < min) {
        const push = (min-d)/2, nx = dx/d, ny = dy/d;
        a.x -= nx*push; a.y -= ny*push;
        b.x += nx*push; b.y += ny*push;
      }
    }
  }

  for (const p of players.values()) {
    if (p.tackle > 0 && ball.owner && ball.owner !== p.id) {
      const owner = players.get(ball.owner);
      if (owner && dist(p, owner) < POSSESS_DIST + 6) { owner.regrab = REGRAB_CD; ball.owner = null; }
    }
  }

  if (!ball.owner) {
    let best = null, bestD = POSSESS_DIST;
    for (const p of players.values()) {
      if (p.regrab > 0) continue;
      const d = dist(p, ball);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) { ball.owner = best.id; ball.vx = 0; ball.vy = 0; }
  }

  if (ball.owner) {
    const o = players.get(ball.owner);
    ball.x = o.x + o.aimX * (PLAYER_R + BALL_R + 3);
    ball.y = o.y + o.aimY * (PLAYER_R + BALL_R + 3);
  } else {
    ball.x += ball.vx; ball.y += ball.vy;
    ball.vx *= FRICTION; ball.vy *= FRICTION;
    if (Math.abs(ball.vx) < 0.05) ball.vx = 0;
    if (Math.abs(ball.vy) < 0.05) ball.vy = 0;
    if (ball.y < FIELD.top  + BALL_R) { ball.y = FIELD.top  + BALL_R; ball.vy *= -0.7; }
    if (ball.y > FIELD.bottom - BALL_R) { ball.y = FIELD.bottom - BALL_R; ball.vy *= -0.7; }
    const gt = H/2 - GOAL_H/2, gb = H/2 + GOAL_H/2;
    if (ball.x < FIELD.left  + BALL_R) { if (ball.y > gt && ball.y < gb) return goal('B'); ball.x = FIELD.left  + BALL_R; ball.vx *= -0.7; }
    if (ball.x > FIELD.right - BALL_R) { if (ball.y > gt && ball.y < gb) return goal('A'); ball.x = FIELD.right - BALL_R; ball.vx *= -0.7; }
  }
}

function goal(team) {
  score[team]++;
  document.getElementById('score' + team).textContent = score[team];
  ball.x = W/2; ball.y = H/2; ball.vx = 0; ball.vy = 0; ball.owner = null;
  const r = { A: 0, B: 0 };
  for (const p of players.values()) {
    const c = r[p.team]++;
    const x = p.team === 'A' ? W*0.30 : W*0.70;
    const slots = [H/2, H/2-110, H/2+110, H/2-200, H/2+200];
    p.x = x; p.y = slots[c % slots.length];
    p.vx = 0; p.vy = 0; p.input = { x:0, y:0 };
    p.aimX = p.team === 'A' ? 1 : -1; p.aimY = 0;
  }
}

// ── Rendu ─────────────────────────────────────────────────────────────────────
function draw() {
  const stripes = 10, sw = (FIELD.right - FIELD.left) / stripes;
  ctx.fillStyle = '#0a0f0d';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i%2===0 ? '#0b3d2e' : '#0d4634';
    ctx.fillRect(FIELD.left + i*sw, FIELD.top, sw, FIELD.bottom - FIELD.top);
  }
  ctx.strokeStyle = 'rgba(234,255,244,0.55)'; ctx.lineWidth = 2;
  ctx.strokeRect(FIELD.left, FIELD.top, FIELD.right-FIELD.left, FIELD.bottom-FIELD.top);
  ctx.beginPath(); ctx.moveTo(W/2, FIELD.top); ctx.lineTo(W/2, FIELD.bottom); ctx.stroke();
  ctx.beginPath(); ctx.arc(W/2, H/2, 64, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W/2, H/2, 3, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(234,255,244,0.55)'; ctx.fill();
  const gt = H/2 - GOAL_H/2;
  drawGoal(FIELD.left, gt, -1); drawGoal(FIELD.right, gt, 1);
  // Ballon
  ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI*2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
  // Joueurs
  for (const p of players.values()) {
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.aimX*26, p.y + p.aimY*26);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI*2);
    ctx.fillStyle = TEAM_COLORS[p.team]; ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ball.owner === p.id ? '#ffd23f' : 'rgba(255,255,255,0.85)'; ctx.stroke();
    ctx.fillStyle = '#06100c'; ctx.font = 'bold 15px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.number, p.x, p.y+1);
  }
}

function drawGoal(x, top, dir) {
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 4;
  const depth = 16;
  ctx.beginPath();
  ctx.moveTo(x, top); ctx.lineTo(x - dir*depth, top);
  ctx.lineTo(x - dir*depth, top + GOAL_H); ctx.lineTo(x, top + GOAL_H);
  ctx.stroke();
}

// ── Boucle ────────────────────────────────────────────────────────────────────
function loop() {
  update();
  if (gameActive) draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
