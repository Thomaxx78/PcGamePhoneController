const express = require('express');
const http    = require('http');
const QRCode  = require('qrcode');
const { Server } = require('socket.io');

const PORT      = process.env.PORT || 3000;
const GAMES     = ['Football'];          // liste extensible
const CD_MS     = 5000;                 // durée du compte à rebours

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static('public'));
app.get('/', (_req, res) => res.sendFile(__dirname + '/public/game.html'));

function getControllerUrl(socket) {
  const proto = socket.handshake.secure ? 'https' : 'http';
  return `${proto}://${socket.handshake.headers.host}/controller.html`;
}

// ── État global ───────────────────────────────────────────────────────────────
let hostSocketId    = null;
let nextNumber      = 1;
let appState        = 'lobby';   // lobby | menu | team_select | game
let menuIndex       = 0;
let menuCtrlId      = null;      // premier joueur = contrôleur du menu
let cdTimer         = null;
const players       = new Map(); // id → { id, number, name, team }

// ── Diffusion ─────────────────────────────────────────────────────────────────
function statePayload() {
  return { state: appState, games: GAMES, menuIndex, players: [...players.values()] };
}

function broadcastState() {
  const base = statePayload();
  if (hostSocketId) io.to(hostSocketId).emit('state-change', base);
  for (const [sid] of players)
    io.to(sid).emit('state-change', { ...base, isMenuCtrl: sid === menuCtrlId });
}

// ── Compte à rebours ──────────────────────────────────────────────────────────
function startCd() {
  if (cdTimer) return;
  io.emit('cd-start', { ms: CD_MS });
  cdTimer = setTimeout(() => {
    cdTimer = null;
    appState = 'game';
    broadcastState();
  }, CD_MS);
}

function cancelCd() {
  if (!cdTimer) return;
  clearTimeout(cdTimer);
  cdTimer = null;
  io.emit('cd-cancel');
}

function checkAllChosen() {
  if (appState !== 'team_select') return;
  const list = [...players.values()];
  if (list.length > 0 && list.every(p => p.team)) startCd();
}

// ── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('register-host', async () => {
    hostSocketId = socket.id;
    const url = getControllerUrl(socket);
    const qr  = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    socket.emit('host-ready', { controllerUrl: url, qr });
    socket.emit('state-change', statePayload());
  });

  socket.on('join-player', (data) => {
    const number = nextNumber++;
    const player = {
      id:   socket.id,
      number,
      name: data?.name ? String(data.name).slice(0, 12) : `J${number}`,
      team: null,
    };
    players.set(socket.id, player);
    if (!menuCtrlId)        menuCtrlId = socket.id;
    if (appState === 'lobby') appState = 'menu';
    if (hostSocketId) io.to(hostSocketId).emit('player-joined', player);
    socket.emit('joined', { ...player, isMenuCtrl: socket.id === menuCtrlId });
    broadcastState();
  });

  // Navigation menu (1er joueur uniquement)
  socket.on('menu-nav', ({ dir }) => {
    if (socket.id !== menuCtrlId || appState !== 'menu') return;
    menuIndex = (menuIndex + (dir === 'up' ? -1 : 1) + GAMES.length) % GAMES.length;
    broadcastState();
  });

  socket.on('menu-select', () => {
    if (socket.id !== menuCtrlId || appState !== 'menu') return;
    appState = 'team_select';
    for (const p of players.values()) p.team = null;
    cancelCd();
    broadcastState();
  });

  // Choix d'équipe — tout changement repart le compte à zéro
  socket.on('team-select', ({ team }) => {
    if (appState !== 'team_select') return;
    const p = players.get(socket.id);
    if (!p || p.team === team) return;
    cancelCd();
    p.team = team;
    broadcastState();
    checkAllChosen();
  });

  socket.on('input', (vec) => {
    if (appState === 'game' && hostSocketId && players.has(socket.id))
      io.to(hostSocketId).emit('player-input', { id: socket.id, x: vec.x, y: vec.y });
  });

  socket.on('action', (type) => {
    if (appState === 'game' && hostSocketId && players.has(socket.id))
      io.to(hostSocketId).emit('player-action', { id: socket.id, type });
  });

  socket.on('disconnect', () => {
    if (socket.id === hostSocketId) { hostSocketId = null; return; }
    if (!players.has(socket.id)) return;
    players.delete(socket.id);
    if (socket.id === menuCtrlId)
      menuCtrlId = players.size ? [...players.keys()][0] : null;
    cancelCd();
    if (players.size === 0 && appState !== 'game') { appState = 'lobby'; menuIndex = 0; }
    if (hostSocketId) io.to(hostSocketId).emit('player-left', { id: socket.id });
    broadcastState();
    checkAllChosen();
  });
});

server.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
