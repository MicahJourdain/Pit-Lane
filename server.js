const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const G = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// All files sit next to this one, so the project uploads to GitHub by drag-and-drop.
const page = (file) => (req, res) => res.sendFile(path.join(__dirname, file));
app.get('/', page('home.html'));        // game menu
app.get('/race', page('index.html'));
app.get('/join/:code', page('index.html'));
app.get('/tv', page('tv.html'));
app.get('/tv/:code', page('tv.html'));
app.get('/healthz', (req, res) => res.send('ok'));
require('./smash-server')(app, io); // Super Smash Rolls at /smash

// Send the shared view to the whole room, then each phone its own hand.
function broadcast(room) {
  if (!room) return;
  io.to(room.code).emit('state', G.publicState(room));
  for (const [token, p] of room.players) {
    if (p.connected && p.socketId) {
      io.to(p.socketId).emit('me', G.privateState(room, token));
    }
  }
}

function seat(socket, room, player, ack) {
  socket.join(room.code);
  socket.data.code = room.code;
  socket.data.token = player.token;
  ack({ ok: true, code: room.code, you: player.id });
  broadcast(room);
}

io.on('connection', (socket) => {
  const reply = (ack) => (typeof ack === 'function' ? ack : () => {});

  socket.on('room:create', ({ token, name, code } = {}, ack) => {
    ack = reply(ack);
    if (!token) return ack({ error: 'This phone has no player id. Reload the page.' });
    const res = G.create(String(token), name, socket.id, Math.random, code);
    if (res.error) return ack(res);
    seat(socket, res.room, res.player, ack);
  });

  socket.on('room:join', ({ token, name, code } = {}, ack) => {
    ack = reply(ack);
    if (!token) return ack({ error: 'This phone has no player id. Reload the page.' });
    const res = G.join(code, String(token), name, socket.id);
    if (res.error) return ack(res);
    seat(socket, res.room, res.player, ack);
  });

  // A TV only watches. Any number of TVs, anywhere, can watch one game.
  socket.on('tv:watch', ({ code } = {}, ack) => {
    ack = reply(ack);
    const room = G.get(code);
    if (!room) return ack({ error: 'No game with that code. Start one on a phone first.' });
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.isTv = true;
    ack({ ok: true, code: room.code });
    socket.emit('state', G.publicState(room));
  });

  socket.on('race:start', (_, ack) => {
    ack = reply(ack);
    const res = G.start(socket.data.code, socket.data.token);
    if (res.error) return ack(res);
    ack({ ok: true });
    broadcast(res.room);
  });

  socket.on('race:turn', ({ card } = {}, ack) => {
    ack = reply(ack);
    const idx = card === null || card === undefined ? null : Number(card);
    const res = G.takeTurn(socket.data.code, socket.data.token, idx);
    if (res.error) return ack(res);
    ack({ ok: true, roll: res.roll });
    broadcast(res.room);
  });

  socket.on('player:leave', () => {
    const room = G.leave(socket.data.code, socket.data.token);
    socket.leave(socket.data.code || '');
    socket.data.code = null;
    socket.data.token = null;
    broadcast(room);
  });

  socket.on('disconnect', () => {
    if (socket.data.isTv) return;
    const room = G.get(socket.data.code);
    const p = room && room.players.get(socket.data.token);
    // Only mark away if this socket is still the player's current one.
    if (p && p.socketId === socket.id) broadcast(G.markAway(room.code, socket.data.token));
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of G.rooms.values()) {
    if (G.skipIfAway(room, now)) broadcast(room);
  }
}, 2000);

setInterval(() => G.sweep(), 60 * 1000);

server.listen(PORT, () => {
  console.log(`Pit Lane is running on port ${PORT}`);
});

