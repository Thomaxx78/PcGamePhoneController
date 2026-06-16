/* ============================================================
   CONTROLLER.JS — manette (téléphone)
   UI contextuelle selon l'état du jeu :
   waiting → menu (leader/follower) → team_select → game
   ============================================================ */

const socket = io();

// ── État local ────────────────────────────────────────────────────────────────
let myTeam       = null;
let isMenuCtrl   = false;
let currentState = 'waiting';
let leaderName   = '';
let gamesList    = [];
let menuIdx      = 0;
let cdInterval   = null;

// ── Écrans ────────────────────────────────────────────────────────────────────
function showCtrl(name) {
  const ids = ['waiting', 'menu-leader', 'menu-follower', 'team', 'game'];
  for (const id of ids)
    document.getElementById(`ctrl-${id}`).classList.toggle('hidden', id !== name);
}

// ── Connexion ─────────────────────────────────────────────────────────────────
socket.on('connect', () => {
  showCtrl('waiting');
  document.getElementById('topbar-status').textContent = 'Connecté…';
  socket.emit('join-player', {});
});

socket.on('joined', (player) => {
  isMenuCtrl = player.isMenuCtrl;
  myTeam     = player.team;
  document.getElementById('topbar-status').textContent =
    `${player.name} · J${player.number}`;
});

socket.on('disconnect', () => {
  document.getElementById('topbar-status').textContent = 'Déconnecté';
  showCtrl('waiting');
});

// ── Changement d'état ─────────────────────────────────────────────────────────
socket.on('state-change', ({ state, games, menuIndex, players, isMenuCtrl: imc }) => {
  if (imc !== undefined) isMenuCtrl = imc;
  gamesList = games || [];
  menuIdx   = menuIndex || 0;

  currentState = state;

  if (state === 'lobby') {
    showCtrl('waiting');
    document.getElementById('topbar-status').textContent = 'En attente…';
    return;
  }

  if (state === 'menu') {
    const gameName = gamesList[menuIdx] || '—';
    if (isMenuCtrl) {
      showCtrl('menu-leader');
      document.getElementById('leader-game-name').textContent = gameName;
    } else {
      showCtrl('menu-follower');
      // Trouver le nom du leader
      const leader = players && players[0];
      document.getElementById('follower-leader-name').textContent =
        leader ? leader.name : '—';
    }
    return;
  }

  if (state === 'team_select') {
    showCtrl('team');
    renderTeamButtons();
    return;
  }

  if (state === 'game') {
    const badge = document.getElementById('badge');
    badge.className = 'badge' + (myTeam ? ` ${myTeam.toLowerCase()}` : '');
    showCtrl('game');
    return;
  }
});

// ── Mise à jour du menu (index change) ───────────────────────────────────────
// state-change arrive déjà avec le bon menuIndex, donc géré ci-dessus.

// ── MENU LEADER ──────────────────────────────────────────────────────────────
let navCooldown = false;

function sendNav(dir) {
  if (!isMenuCtrl || currentState !== 'menu' || navCooldown) return;
  socket.emit('menu-nav', { dir });
  navCooldown = true;
  setTimeout(() => { navCooldown = false; }, 220);
}

document.getElementById('btn-up').addEventListener('touchstart', (e) => {
  sendNav('up'); e.preventDefault();
}, { passive: false });
document.getElementById('btn-down').addEventListener('touchstart', (e) => {
  sendNav('down'); e.preventDefault();
}, { passive: false });
document.getElementById('btn-up').addEventListener('mousedown', () => sendNav('up'));
document.getElementById('btn-down').addEventListener('mousedown', () => sendNav('down'));

document.getElementById('btn-validate').addEventListener('touchstart', (e) => {
  if (currentState === 'menu' && isMenuCtrl) socket.emit('menu-select');
  e.preventDefault();
}, { passive: false });
document.getElementById('btn-validate').addEventListener('mousedown', () => {
  if (currentState === 'menu' && isMenuCtrl) socket.emit('menu-select');
});

// ── TEAM SELECT ───────────────────────────────────────────────────────────────
function renderTeamButtons() {
  const btnA = document.getElementById('btn-team-a');
  const btnB = document.getElementById('btn-team-b');
  const chkA = document.getElementById('check-a');
  const chkB = document.getElementById('check-b');
  btnA.classList.toggle('chosen-a', myTeam === 'A');
  btnB.classList.toggle('chosen-b', myTeam === 'B');
  chkA.textContent = myTeam === 'A' ? '✓' : '';
  chkB.textContent = myTeam === 'B' ? '✓' : '';
}

function selectTeam(team) {
  if (currentState !== 'team_select') return;
  myTeam = team;
  renderTeamButtons();
  const badge = document.getElementById('badge');
  badge.className = `badge ${team.toLowerCase()}`;
  socket.emit('team-select', { team });
}

document.getElementById('btn-team-a').addEventListener('touchstart', (e) => {
  selectTeam('A'); e.preventDefault();
}, { passive: false });
document.getElementById('btn-team-b').addEventListener('touchstart', (e) => {
  selectTeam('B'); e.preventDefault();
}, { passive: false });
document.getElementById('btn-team-a').addEventListener('mousedown', () => selectTeam('A'));
document.getElementById('btn-team-b').addEventListener('mousedown', () => selectTeam('B'));

// ── COUNTDOWN ────────────────────────────────────────────────────────────────
socket.on('cd-start', ({ ms }) => {
  const wrap = document.getElementById('ctrl-cd');
  const num  = document.getElementById('ctrl-cd-num');
  const fill = document.getElementById('ctrl-cd-fill');
  wrap.classList.remove('hidden');
  clearInterval(cdInterval);
  let remaining = ms;
  num.textContent = Math.ceil(remaining / 1000);
  cdInterval = setInterval(() => {
    remaining -= 100;
    num.textContent = Math.max(1, Math.ceil(remaining / 1000));
    if (remaining <= 0) clearInterval(cdInterval);
  }, 100);
  fill.style.transition = 'none';
  fill.style.width = '100%';
  fill.offsetWidth;
  fill.style.transition = `width ${ms}ms linear`;
  fill.style.width = '0%';
});

socket.on('cd-cancel', () => {
  clearInterval(cdInterval);
  document.getElementById('ctrl-cd').classList.add('hidden');
  const fill = document.getElementById('ctrl-cd-fill');
  fill.style.transition = 'none';
  fill.style.width = '100%';
});

// ── JOYSTICK (in-game) ───────────────────────────────────────────────────────
const zone  = document.getElementById('stickZone');
const base  = document.getElementById('stickBase');
const thumb = document.getElementById('stickThumb');
const RADIUS = 90;

let activeId = null, centerX = 0, centerY = 0;
let vec = { x: 0, y: 0 }, lastSent = { x: 0, y: 0 };

function startStick(x, y, id) {
  activeId = id;
  const rect = zone.getBoundingClientRect();
  centerX = x; centerY = y;
  base.style.left  = `${x - rect.left}px`;
  base.style.top   = `${y - rect.top}px`;
  thumb.style.left = `${x - rect.left}px`;
  thumb.style.top  = `${y - rect.top}px`;
  moveStick(x, y);
}

function moveStick(x, y) {
  let dx = x - centerX, dy = y - centerY;
  const d = Math.hypot(dx, dy);
  if (d > RADIUS) { dx = dx/d * RADIUS; dy = dy/d * RADIUS; }
  const rect = zone.getBoundingClientRect();
  thumb.style.left = `${centerX - rect.left + dx}px`;
  thumb.style.top  = `${centerY - rect.top  + dy}px`;
  vec = { x: +(dx/RADIUS).toFixed(3), y: +(dy/RADIUS).toFixed(3) };
}

function endStick() {
  activeId = null; vec = { x: 0, y: 0 };
  base.style.left  = '50%'; base.style.top  = '50%';
  thumb.style.left = '50%'; thumb.style.top = '50%';
}

zone.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  if (activeId === null) startStick(t.clientX, t.clientY, t.identifier);
  e.preventDefault();
}, { passive: false });
zone.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) if (t.identifier === activeId) moveStick(t.clientX, t.clientY);
  e.preventDefault();
}, { passive: false });
zone.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) if (t.identifier === activeId) endStick();
  e.preventDefault();
}, { passive: false });
zone.addEventListener('touchcancel', endStick, { passive: false });

setInterval(() => {
  if (vec.x !== lastSent.x || vec.y !== lastSent.y) {
    socket.emit('input', vec);
    lastSent = { ...vec };
  }
}, 33);

// ── BOUTONS ACTION ────────────────────────────────────────────────────────────
function bindAction(id, type) {
  const el = document.getElementById(id);
  el.addEventListener('touchstart', (e) => { socket.emit('action', type); e.preventDefault(); }, { passive: false });
  el.addEventListener('mousedown', () => socket.emit('action', type));
}
bindAction('btnPass',   'pass');
bindAction('btnShoot',  'shoot');
bindAction('btnTackle', 'tackle');
