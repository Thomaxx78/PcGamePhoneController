/*
 * Serveur du jeu de foot.
 * Rôle : servir les pages web et faire le pont entre les téléphones (manettes)
 * et l'ordinateur (qui affiche et calcule le jeu).
 *
 * Le serveur ne calcule PAS le jeu : il se contente de relayer les entrées.
 * Toute la simulation tourne dans le navigateur de l'ordi (public/game.js).
 */

const express = require('express');
const http = require('http');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.get('/', (_req, res) => res.sendFile(__dirname + '/public/game.html'));

// Dérive l'URL publique depuis la requête du socket (fonctionne en local et en prod)
function getControllerUrl(socket) {
  const host = socket.handshake.headers.host;
  const proto = socket.handshake.secure ? 'https' : 'http';
  return `${proto}://${host}/controller.html`;
}

// --- État du serveur ---
let hostSocketId = null;
const players = new Map();
let nextPlayerNumber = 1;

io.on('connection', (socket) => {
  socket.on('register-host', async () => {
    hostSocketId = socket.id;
    const controllerUrl = getControllerUrl(socket);
    const qr = await QRCode.toDataURL(controllerUrl, { margin: 1, width: 320 });
    socket.emit('host-ready', { controllerUrl, qr });
    for (const p of players.values()) socket.emit('player-joined', p);
  });

  socket.on('join-player', (data) => {
    const team = players.size % 2 === 0 ? 'A' : 'B';
    const number = nextPlayerNumber++;
    const player = {
      id: socket.id,
      number,
      name: data && data.name ? String(data.name).slice(0, 12) : `J${number}`,
      team,
    };
    players.set(socket.id, player);
    socket.emit('joined', player);
    if (hostSocketId) io.to(hostSocketId).emit('player-joined', player);
  });

  socket.on('input', (vec) => {
    if (hostSocketId && players.has(socket.id)) {
      io.to(hostSocketId).emit('player-input', { id: socket.id, x: vec.x, y: vec.y });
    }
  });

  socket.on('action', (type) => {
    if (hostSocketId && players.has(socket.id)) {
      io.to(hostSocketId).emit('player-action', { id: socket.id, type });
    }
  });

  socket.on('disconnect', () => {
    if (socket.id === hostSocketId) hostSocketId = null;
    if (players.has(socket.id)) {
      players.delete(socket.id);
      if (hostSocketId) io.to(hostSocketId).emit('player-left', { id: socket.id });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
