/* ===========================================================
   FOOT — moteur du jeu (tourne sur l'ordi)
   - Reçoit les entrées des téléphones via Socket.IO
   - Simule joueurs + ballon, gère passe / tir / tacle / buts
   - Dessine le terrain vu de haut
   =========================================================== */

const socket = io();

// --- Constantes du terrain ---
const W = 900, H = 600;          // résolution interne du canvas
const MARGIN = 40;               // bordure entre le bord et la ligne de touche
const GOAL_H = 180;              // hauteur de la cage
const FIELD = { left: MARGIN, right: W - MARGIN, top: MARGIN, bottom: H - MARGIN };

// --- Réglages de gameplay (à bidouiller pour le feeling) ---
const PLAYER_R = 16;
const BALL_R = 9;
const BASE_SPEED = 3.4;          // vitesse de déplacement
const TACKLE_BOOST = 1.9;        // multiplicateur de vitesse pendant un tacle
const TACKLE_FRAMES = 16;        // durée du tacle (frames)
const TACKLE_CD = 40;            // recharge du tacle
const PASS_SPEED = 7.5;
const SHOOT_SPEED = 13;
const FRICTION = 0.985;          // freinage du ballon
const POSSESS_DIST = PLAYER_R + BALL_R + 7;
const REGRAB_CD = 14;            // frames avant de pouvoir reprendre le ballon après une passe

const TEAM_COLORS = { A: '#38bdf8', B: '#fb7237' };

// --- État du jeu ---
const players = new Map();   // id -> player
const ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, owner: null };
const score = { A: 0, B: 0 };
let countByTeam = { A: 0, B: 0 };

const canvas = document.getElementById('pitch');
const ctx = canvas.getContext('2d');

// =========================================================
//  CONNEXION
// =========================================================
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const modal = document.getElementById('modal');

socket.on('connect', () => socket.emit('register-host'));

socket.on('host-ready', ({ controllerUrl, qr }) => {
  document.getElementById('qrImg').src = qr;
  document.getElementById('urlText').textContent = controllerUrl;
  statusDot.classList.add('on');
  statusText.textContent = 'En attente de joueurs';
});

socket.on('player-joined', (p) => {
  const spawn = spawnFor(p.team);
  players.set(p.id, {
    id: p.id, number: p.number, name: p.name, team: p.team,
    x: spawn.x, y: spawn.y,
    vx: 0, vy: 0,
    aimX: p.team === 'A' ? 1 : -1, aimY: 0,
    input: { x: 0, y: 0 },
    tackle: 0, tackleCd: 0, regrab: 0,
  });
  countByTeam[p.team]++;
  modal.classList.add('hidden');
  statusText.textContent = `${players.size} joueur(s)`;
});

socket.on('player-left', ({ id }) => {
  const p = players.get(id);
  if (p) {
    countByTeam[p.team]--;
    if (ball.owner === id) ball.owner = null;
    players.delete(id);
  }
  statusText.textContent = players.size ? `${players.size} joueur(s)` : 'En attente de joueurs';
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
      ball.vx = p.aimX * speed;
      ball.vy = p.aimY * speed;
      ball.owner = null;
      p.regrab = REGRAB_CD;
    }
  }
});

// Point d'apparition selon l'équipe (A à gauche, B à droite)
function spawnFor(team) {
  const idx = countByTeam[team]; // 0,1,2…
  const x = team === 'A' ? W * 0.30 : W * 0.70;
  const slots = [H / 2, H / 2 - 110, H / 2 + 110, H / 2 - 200, H / 2 + 200];
  return { x, y: slots[idx % slots.length] };
}

// Bouton pour rouvrir le QR
document.getElementById('joinPill').addEventListener('click', () => modal.classList.remove('hidden'));

// =========================================================
//  SIMULATION
// =========================================================
function update() {
  // 1) Déplacement des joueurs
  for (const p of players.values()) {
    if (p.tackle > 0) p.tackle--;
    if (p.tackleCd > 0) p.tackleCd--;
    if (p.regrab > 0) p.regrab--;

    const speed = BASE_SPEED * (p.tackle > 0 ? TACKLE_BOOST : 1);
    p.x += p.input.x * speed;
    p.y += p.input.y * speed;

    // Mise à jour de la visée (direction du joystick)
    const mag = Math.hypot(p.input.x, p.input.y);
    if (mag > 0.25) { p.aimX = p.input.x / mag; p.aimY = p.input.y / mag; }

    // Rester sur le terrain
    p.x = clamp(p.x, FIELD.left + PLAYER_R, FIELD.right - PLAYER_R);
    p.y = clamp(p.y, FIELD.top + PLAYER_R, FIELD.bottom - PLAYER_R);
  }

  // 2) Séparation douce entre joueurs (évite l'empilement)
  const list = [...players.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const min = PLAYER_R * 2;
      if (d < min) {
        const push = (min - d) / 2;
        const nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }

  // 3) Tacle : voler le ballon au porteur
  for (const p of players.values()) {
    if (p.tackle > 0 && ball.owner && ball.owner !== p.id) {
      const owner = players.get(ball.owner);
      if (owner && dist(p, owner) < POSSESS_DIST + 6) {
        owner.regrab = REGRAB_CD;
        ball.owner = null;
      }
    }
  }

  // 4) Prise de possession (ballon libre + joueur assez proche)
  if (!ball.owner) {
    let best = null, bestD = POSSESS_DIST;
    for (const p of players.values()) {
      if (p.regrab > 0) continue;
      const d = dist(p, ball);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) { ball.owner = best.id; ball.vx = 0; ball.vy = 0; }
  }

  // 5) Mouvement du ballon
  if (ball.owner) {
    const o = players.get(ball.owner);
    ball.x = o.x + o.aimX * (PLAYER_R + BALL_R + 3);
    ball.y = o.y + o.aimY * (PLAYER_R + BALL_R + 3);
    ball.vx = 0; ball.vy = 0;
  } else {
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vx *= FRICTION;
    ball.vy *= FRICTION;
    if (Math.abs(ball.vx) < 0.05) ball.vx = 0;
    if (Math.abs(ball.vy) < 0.05) ball.vy = 0;

    // Rebonds haut/bas
    if (ball.y < FIELD.top + BALL_R) { ball.y = FIELD.top + BALL_R; ball.vy *= -0.7; }
    if (ball.y > FIELD.bottom - BALL_R) { ball.y = FIELD.bottom - BALL_R; ball.vy *= -0.7; }

    // Bords gauche/droite : but si dans la cage, sinon rebond
    const goalTop = H / 2 - GOAL_H / 2, goalBot = H / 2 + GOAL_H / 2;
    if (ball.x < FIELD.left + BALL_R) {
      if (ball.y > goalTop && ball.y < goalBot) return goal('B'); // but pour B
      ball.x = FIELD.left + BALL_R; ball.vx *= -0.7;
    }
    if (ball.x > FIELD.right - BALL_R) {
      if (ball.y > goalTop && ball.y < goalBot) return goal('A'); // but pour A
      ball.x = FIELD.right - BALL_R; ball.vx *= -0.7;
    }
  }
}

function goal(team) {
  score[team]++;
  document.getElementById('scoreA').textContent = score.A;
  document.getElementById('scoreB').textContent = score.B;
  resetPositions();
}

function resetPositions() {
  ball.x = W / 2; ball.y = H / 2; ball.vx = 0; ball.vy = 0; ball.owner = null;
  const reset = { A: 0, B: 0 };
  for (const p of players.values()) {
    const s = (function () { const c = reset[p.team]++; const x = p.team === 'A' ? W * 0.30 : W * 0.70;
      const slots = [H / 2, H / 2 - 110, H / 2 + 110, H / 2 - 200, H / 2 + 200]; return { x, y: slots[c % slots.length] }; })();
    p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0; p.input = { x: 0, y: 0 };
    p.aimX = p.team === 'A' ? 1 : -1; p.aimY = 0;
  }
}

// =========================================================
//  RENDU
// =========================================================
function draw() {
  // Pelouse rayée
  const stripes = 10, sw = (FIELD.right - FIELD.left) / stripes;
  ctx.fillStyle = '#0a0f0d';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#0b3d2e' : '#0d4634';
    ctx.fillRect(FIELD.left + i * sw, FIELD.top, sw, FIELD.bottom - FIELD.top);
  }

  // Lignes
  ctx.strokeStyle = 'rgba(234,255,244,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(FIELD.left, FIELD.top, FIELD.right - FIELD.left, FIELD.bottom - FIELD.top);
  ctx.beginPath(); ctx.moveTo(W / 2, FIELD.top); ctx.lineTo(W / 2, FIELD.bottom); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 64, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(234,255,244,0.55)'; ctx.fill();

  // Cages
  const goalTop = H / 2 - GOAL_H / 2;
  drawGoal(FIELD.left, goalTop, -1);
  drawGoal(FIELD.right, goalTop, 1);

  // Ballon
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();

  // Joueurs
  for (const p of players.values()) {
    // ligne de visée
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + p.aimX * 26, p.y + p.aimY * 26);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.stroke();

    // corps
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLORS[p.team]; ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ball.owner === p.id ? '#ffd23f' : 'rgba(255,255,255,0.85)';
    ctx.stroke();

    // numéro
    ctx.fillStyle = '#06100c';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.number, p.x, p.y + 1);
  }
}

function drawGoal(x, top, dir) {
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 4;
  const depth = 16;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x - dir * depth, top);
  ctx.lineTo(x - dir * depth, top + GOAL_H);
  ctx.lineTo(x, top + GOAL_H);
  ctx.stroke();
}

// =========================================================
//  BOUCLE PRINCIPALE
// =========================================================
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- Petites fonctions utilitaires ---
function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
