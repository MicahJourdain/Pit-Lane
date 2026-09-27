// Super Smash Rolls: pages and realtime events.
// server.js turns this on with one line:  require('./smash-server')(app, io);
// It uses its own Socket.IO namespace (/smash), so the race game is untouched.

const path = require('path');
const S = require('./smash-rules');

module.exports = function smash(app, io) {
  const page = (file) => (req, res) => res.sendFile(path.join(__dirname, file));
  app.get('/smash', page('smash.html'));
  app.get('/smash/join/:code', page('smash.html'));
  app.get('/smash/tv', page('smash-tv.html'));
  app.get('/smash/tv/:code', page('smash-tv.html'));
  app.get('/smash/ui.js', page('smash-ui.js'));   // shared board + HUD drawing
  app.get('/smash/ui.css', page('smash-ui.css'));
  app.get('/smash/version', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ version: S.VERSION }); });
  // Hero art: flat files like aang-whip.jpg next to this one. Only those names are served.
  app.get('/smash/art/:file', (req, res) => {
    const f = String(req.params.file || '');
    if (!/^(aang|link|onua)-[a-z]+\.jpg$/.test(f)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(__dirname, f), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });

  const nsp = io.of('/smash');

  function broadcast(room) {
    if (!room) return;
    nsp.to(room.code).emit('state', S.publicState(room));
    for (const [token, p] of room.players) {
      if (p.connected && p.socketId) nsp.to(p.socketId).emit('me', S.privateState(room, token));
    }
  }

  nsp.on('connection', (socket) => {
    const reply = (ack) => (typeof ack === 'function' ? ack : () => {});

    function seat(room, player, ack) {
      socket.join(room.code);
      socket.data.code = room.code;
      socket.data.token = player.token;
      ack({ ok: true, code: room.code, you: player.id });
      broadcast(room);
    }

    socket.on('room:create', ({ token, name, code } = {}, ack) => {
      ack = reply(ack);
      if (!token) return ack({ error: 'This phone has no player id. Reload the page.' });
      const res = S.create(String(token), name, socket.id, code);
      if (res.error) return ack(res);
      seat(res.room, res.player, ack);
    });

    socket.on('room:join', ({ token, name, code } = {}, ack) => {
      ack = reply(ack);
      if (!token) return ack({ error: 'This phone has no player id. Reload the page.' });
      const res = S.join(code, String(token), name, socket.id);
      if (res.error) return ack(res);
      seat(res.room, res.player, ack);
    });

    socket.on('tv:watch', ({ code } = {}, ack) => {
      ack = reply(ack);
      const room = S.get(code);
      if (!room) return ack({ error: 'No game with that code. Start one on a phone first.' });
      socket.join(room.code);
      socket.data.code = room.code;
      socket.data.isTv = true;
      (room.tvs = room.tvs || new Set()).add(socket.id);
      ack({ ok: true, code: room.code });
      broadcast(room); // phones learn a TV is watching
      socket.emit('state', S.publicState(room));
    });

    // Every game action: call the rule, reply with the error or ok, then show everyone.
    const act = (event, fn) => socket.on(event, (args = {}, ack) => {
      ack = reply(ack);
      if (socket.data.isTv || !socket.data.code) return ack({ error: 'Join a game first.' });
      let res;
      try {
        res = fn(socket.data.code, socket.data.token, args || {});
      } catch (err) {
        console.error(event, err);
        return ack({ error: 'Something went wrong with that move. Try again.' });
      }
      if (!res || res.error) return ack(res || { error: 'That did not work.' });
      ack({ ok: true });
      broadcast(res.room);
    });

    act('smash:hero', (c, t, a) => S.pickHero(c, t, a.hero));
    act('smash:addBot', (c, t, a) => S.addBot(c, t, a.hero));
    act('smash:removeBot', (c, t, a) => S.removeBot(c, t, a.id));
    act('smash:start', (c, t) => S.start(c, t));
    act('smash:rematch', (c, t) => S.rematch(c, t));
    act('smash:toRoll', (c, t) => S.toRoll(c, t));
    act('smash:roll', (c, t) => S.roll(c, t));
    act('smash:keep', (c, t, a) => S.keep(c, t, Number(a.i)));
    act('smash:attack', (c, t, a) => S.attack(c, t, a));
    act('smash:pass', (c, t) => S.skipAttack(c, t));
    act('smash:defRoll', (c, t) => S.defRoll(c, t));
    act('smash:defAccept', (c, t) => S.defAccept(c, t));
    act('smash:play', (c, t, a) => S.play(c, t, Number(a.i), a.args || {}));
    act('smash:sell', (c, t, a) => S.sell(c, t, Number(a.i)));
    act('smash:end', (c, t) => S.endTurn(c, t));
    act('smash:continue', (c, t) => S.continueBots(c, t));

    socket.on('player:leave', () => {
      const room = S.leave(socket.data.code, socket.data.token);
      socket.leave(socket.data.code || '');
      socket.data.code = null;
      socket.data.token = null;
      broadcast(room);
    });

    socket.on('disconnect', () => {
      if (socket.data.isTv) {
        const tvRoom = S.get(socket.data.code);
        if (tvRoom && tvRoom.tvs) { tvRoom.tvs.delete(socket.id); broadcast(tvRoom); }
        return;
      }
      const room = S.get(socket.data.code);
      const p = room && room.players.get(socket.data.token);
      if (p && p.socketId === socket.id) broadcast(S.markAway(room.code, socket.data.token));
    });
  });

  // Bots and quiet phones.
  setInterval(() => {
    const now = Date.now();
    for (const room of S.rooms.values()) {
      try {
        if (S.tick(room, now)) broadcast(room);
      } catch (err) {
        console.error('tick', err);
      }
    }
  }, 500);

  setInterval(() => S.sweep(), 60 * 1000);
};
