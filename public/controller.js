/* ===========================================================
   MANETTE (tourne sur le téléphone)
   - Joystick tactile -> envoie un vecteur { x, y } au serveur
   - Boutons -> envoient une action ('pass' | 'shoot' | 'tackle')
   =========================================================== */

const socket = io();

const statusEl = document.getElementById('status');
const badge = document.getElementById('badge');

socket.on('connect', () => {
  statusEl.textContent = 'Connecté…';
  socket.emit('join-player', {});
});

socket.on('joined', (player) => {
  statusEl.textContent = `${player.name} · Équipe ${player.team}`;
  badge.classList.add(player.team === 'A' ? 'a' : 'b');
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Déconnecté';
});

// ----- Joystick -----
const zone = document.getElementById('stickZone');
const base = document.getElementById('stickBase');
const thumb = document.getElementById('stickThumb');
const RADIUS = 90; // amplitude max du pouce en px

let activeId = null;     // identifiant du doigt qui contrôle le stick
let centerX = 0, centerY = 0;
let vec = { x: 0, y: 0 };
let lastSent = { x: 0, y: 0 };

function setThumb(dx, dy) {
  thumb.style.left = `calc(50% + ${dx}px)`;
  thumb.style.top = `calc(50% + ${dy}px)`;
}

function startStick(x, y, id) {
  activeId = id;
  // Recentrer la base là où le doigt se pose (plus agréable au pouce)
  const rect = zone.getBoundingClientRect();
  centerX = x; centerY = y;
  base.style.left = `${x - rect.left}px`;
  base.style.top = `${y - rect.top}px`;
  thumb.style.left = `${x - rect.left}px`;
  thumb.style.top = `${y - rect.top}px`;
  moveStick(x, y);
}

function moveStick(x, y) {
  let dx = x - centerX, dy = y - centerY;
  const d = Math.hypot(dx, dy);
  if (d > RADIUS) { dx = dx / d * RADIUS; dy = dy / d * RADIUS; }
  const rect = zone.getBoundingClientRect();
  thumb.style.left = `${centerX - rect.left + dx}px`;
  thumb.style.top = `${centerY - rect.top + dy}px`;
  vec = { x: +(dx / RADIUS).toFixed(3), y: +(dy / RADIUS).toFixed(3) };
}

function endStick() {
  activeId = null;
  vec = { x: 0, y: 0 };
  base.style.left = '50%'; base.style.top = '50%';
  thumb.style.left = '50%'; thumb.style.top = '50%';
}

zone.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  if (activeId === null) startStick(t.clientX, t.clientY, t.identifier);
  e.preventDefault();
}, { passive: false });

zone.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === activeId) moveStick(t.clientX, t.clientY);
  }
  e.preventDefault();
}, { passive: false });

zone.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === activeId) endStick();
  }
  e.preventDefault();
}, { passive: false });

zone.addEventListener('touchcancel', endStick, { passive: false });

// Envoi des entrées à ~30 Hz (seulement si ça a changé)
setInterval(() => {
  if (vec.x !== lastSent.x || vec.y !== lastSent.y) {
    socket.emit('input', vec);
    lastSent = { ...vec };
  }
}, 33);

// ----- Boutons d'action -----
function bindAction(id, type) {
  const el = document.getElementById(id);
  el.addEventListener('touchstart', (e) => { socket.emit('action', type); e.preventDefault(); }, { passive: false });
  // fallback souris pour tester sur ordi
  el.addEventListener('mousedown', () => socket.emit('action', type));
}
bindAction('btnPass', 'pass');
bindAction('btnShoot', 'shoot');
bindAction('btnTackle', 'tackle');
