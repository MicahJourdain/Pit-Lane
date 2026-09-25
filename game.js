// Pit Lane game rules. Plain data in, plain data out: no sockets, no network.
// server.js calls these functions and broadcasts whatever they change.
// When Garage Table moves onto this system, its rules replace the race rules
// below and everything else (rooms, seats, reconnection) stays the same.

const MAX_PLAYERS = 8;
const TRACK = 30;
const HAND_SIZE = 3;
const AWAY_SKIP_MS = 15 * 1000;
const ROOM_TTL_MS = 30 * 60 * 1000;

// No I, O, Q or S: they get misread aloud and mistyped on a TV remote.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPRTUVWXYZ';

const COLORS = ['#f2c230', '#4fa3e0', '#e0604f', '#7fb069',
                '#b98ae8', '#f08a3c', '#46c7b8', '#e87fb0'];

// Board spaces. Landing on one moves you again.
const SPACES = {
  5: { kind: 'boost', move: 3 },
  9: { kind: 'slick', move: -3 },
  14: { kind: 'boost', move: 3 },
  18: { kind: 'slick', move: -3 },
  23: { kind: 'boost', move: 3 },
  27: { kind: 'slick', move: -3 }
};

const CARDS = {
  nitro: { name: 'Nitro', text: '+3 to this roll' },
  draft: { name: 'Draft', text: '+2 to this roll' },
  bump:  { name: 'Bump',  text: 'The leader drops back 2' }
};
const DECK = ['nitro', 'nitro', 'nitro', 'draft', 'draft', 'draft', 'draft', 'bump', 'bump'];

const rooms = new Map();

// ------------------------------------------------------------------ helpers

function makeCode(rng = Math.random) {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

function cleanName(raw) {
  const name = String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 12);
  return name || 'Driver';
}

function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

function get(code) {
  return rooms.get(normalizeCode(code)) || null;
}

function roster(room) {
  return [...room.players.values()].sort((a, b) => a.seq - b.seq);
}

function freeColor(room) {
  const used = new Set([...room.players.values()].map((p) => p.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[room.players.size % COLORS.length];
}

function deal(rng) {
  return Array.from({ length: HAND_SIZE }, () => DECK[Math.floor(rng() * DECK.length)]);
}

function currentToken(room) {
  return room.phase === 'race' ? room.order[room.turn] : null;
}

function setEvent(room, text, extra = {}) {
  room.event = { n: (room.event ? room.event.n : 0) + 1, text, ...extra };
  room.log.unshift(text);
  room.log.length = Math.min(room.log.length, 6);
}

function advanceTurn(room, now) {
  if (!room.order.length) {
    room.phase = 'lobby';
    return;
  }
  room.turn = (room.turn + 1) % room.order.length;
  room.turnStartedAt = now;
}

// ------------------------------------------------------------------ seats

function attach(room, token, name, socketId) {
  let p = room.players.get(token);
  if (p) {
    p.connected = true;
    p.socketId = socketId;
    if (name) p.name = cleanName(name);
  } else {
    p = {
      token,
      id: shortId(),
      name: cleanName(name),
      connected: true,
      socketId,
      seq: room.nextSeq++,
      color: freeColor(room),
      pos: 0,
      hand: [],
      inRace: false
    };
    room.players.set(token, p);
  }
  room.lastActive = Date.now();
  return p;
}

function create(token, name, socketId, rng = Math.random) {
  const room = {
    code: makeCode(rng),
    players: new Map(),
    hostToken: token,
    nextSeq: 0,
    phase: 'lobby',
    order: [],
    turn: 0,
    turnStartedAt: 0,
    winner: null,
    event: null,
    log: [],
    raceNo: 0,
    lastActive: Date.now()
  };
  rooms.set(room.code, room);
  return { room, player: attach(room, token, name, socketId) };
}

function join(code, token, name, socketId) {
  const room = get(code);
  if (!room) return { error: 'No game with that code. Check the code on the TV.' };
  if (!room.players.has(token) && room.players.size >= MAX_PLAYERS) {
    return { error: 'That game is full. Eight drivers is the limit.' };
  }
  return { room, player: attach(room, token, name, socketId) };
}

// A locked phone is not a player leaving. Keep the seat.
function markAway(code, token) {
  const room = get(code);
  const p = room && room.players.get(token);
  if (!p) return null;
  p.connected = false;
  room.lastActive = Date.now();
  return room;
}

function leave(code, token, now = Date.now()) {
  const room = get(code);
  if (!room || !room.players.has(token)) return null;
  const p = room.players.get(token);

  if (room.phase === 'race') {
    const idx = room.order.indexOf(token);
    if (idx !== -1) {
      const wasTurn = idx === room.turn;
      room.order.splice(idx, 1);
      if (idx < room.turn) room.turn--;
      if (room.order.length === 0) {
        room.phase = 'lobby';
      } else {
        if (room.turn >= room.order.length) room.turn = 0;
        if (wasTurn) room.turnStartedAt = now;
      }
      setEvent(room, `${p.name} left the race.`);
    }
  }

  room.players.delete(token);
  if (token === room.hostToken) {
    const next = roster(room)[0];
    room.hostToken = next ? next.token : null;
  }
  room.lastActive = now;
  return room;
}

// ------------------------------------------------------------------ race

function start(code, token, rng = Math.random, now = Date.now()) {
  const room = get(code);
  if (!room) return { error: 'No game with that code.' };
  if (token !== room.hostToken) return { error: 'Only the host can start the race.' };
  if (room.phase === 'race') return { error: 'The race is already running.' };

  const drivers = roster(room);
  if (!drivers.length) return { error: 'Nobody is on the grid.' };

  room.order = drivers.map((p) => p.token);
  for (const p of room.players.values()) {
    p.pos = 0;
    p.hand = deal(rng);
    p.inRace = true;
  }
  room.phase = 'race';
  room.turn = 0;
  room.turnStartedAt = now;
  room.winner = null;
  room.raceNo++;
  room.log = [];
  setEvent(room, `Lights out! ${room.players.get(room.order[0]).name} rolls first.`, { kind: 'start' });
  room.lastActive = now;
  return { room };
}

function takeTurn(code, token, cardIndex, rng = Math.random, now = Date.now()) {
  const room = get(code);
  if (!room) return { error: 'No game with that code.' };
  if (room.phase !== 'race') return { error: 'The race has not started.' };
  if (currentToken(room) !== token) return { error: 'It is not your turn yet.' };

  const p = room.players.get(token);
  let card = null;
  if (cardIndex !== null && cardIndex !== undefined) {
    if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= p.hand.length) {
      return { error: 'That card is not in your hand.' };
    }
    card = p.hand.splice(cardIndex, 1)[0];
  }

  const roll = 1 + Math.floor(rng() * 6);
  const bonus = card === 'nitro' ? 3 : card === 'draft' ? 2 : 0;
  const from = p.pos;
  const parts = [`${p.name} rolled ${roll}`];

  let bumped = null;
  if (card === 'bump') {
    const rivals = room.order
      .filter((t) => t !== token)
      .map((t) => room.players.get(t))
      .filter((r) => r.pos > 0)
      .sort((a, b) => b.pos - a.pos);
    if (rivals.length) {
      bumped = rivals[0];
      bumped.pos = Math.max(0, bumped.pos - 2);
      parts.push(`bumped ${bumped.name} back 2`);
    } else {
      parts.push('played Bump, but nobody was ahead to hit');
    }
  }
  if (bonus) parts.push(`+${bonus} ${CARDS[card].name}`);

  let to = Math.min(TRACK, from + roll + bonus);
  let effect = null;
  if (to < TRACK && SPACES[to]) {
    effect = SPACES[to].kind;
    to = Math.max(0, Math.min(TRACK, to + SPACES[to].move));
    parts.push(effect === 'boost' ? 'hit a boost pad, +3' : 'hit an oil slick, -3');
  }
  p.pos = to;

  if (to >= TRACK) {
    room.phase = 'finished';
    room.winner = p.id;
    setEvent(room, `${parts.join(', ')} and takes the checkered flag!`,
      { kind: 'win', by: p.id, roll, card, from, to, effect });
  } else {
    advanceTurn(room, now);
    const next = room.players.get(currentToken(room));
    setEvent(room, `${parts.join(', ')}. Now on ${to}.`,
      { kind: 'move', by: p.id, roll, card, from, to, effect, bumped: bumped && bumped.id, next: next.id });
  }
  room.lastActive = now;
  return { room, roll };
}

// Called on a timer. Skips a driver whose phone has been gone for a while.
function skipIfAway(room, now = Date.now()) {
  if (room.phase !== 'race') return false;
  const p = room.players.get(currentToken(room));
  if (!p || p.connected || now - room.turnStartedAt < AWAY_SKIP_MS) return false;
  advanceTurn(room, now);
  const next = room.players.get(currentToken(room));
  setEvent(room, `${p.name}'s phone is away, so their turn was skipped. ${next.name} is up.`,
    { kind: 'skip', next: next.id });
  return true;
}

// ------------------------------------------------------------------ views

// Everything the TV and all phones may see. Tokens and hands never go here.
function publicState(room) {
  const turnToken = currentToken(room);
  return {
    code: room.code,
    phase: room.phase,
    track: TRACK,
    spaces: SPACES,
    maxPlayers: MAX_PLAYERS,
    raceNo: room.raceNo,
    turnId: turnToken ? room.players.get(turnToken).id : null,
    winnerId: room.winner,
    event: room.event,
    log: room.log,
    players: roster(room).map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      grid: i + 1,
      connected: p.connected,
      isHost: p.token === room.hostToken,
      pos: p.pos,
      cards: p.hand.length,
      inRace: room.phase !== 'lobby' && room.order.includes(p.token)
    }))
  };
}

// What only one phone sees: its own hand.
function privateState(room, token) {
  const p = room.players.get(token);
  if (!p) return null;
  return {
    id: p.id,
    isHost: token === room.hostToken,
    hand: p.hand.map((c) => ({ id: c, ...CARDS[c] }))
  };
}

function sweep(now = Date.now()) {
  let removed = 0;
  for (const [code, room] of rooms) {
    const anyone = [...room.players.values()].some((p) => p.connected);
    if (!anyone && now - room.lastActive > ROOM_TTL_MS) {
      rooms.delete(code);
      removed++;
    }
  }
  return removed;
}

module.exports = {
  MAX_PLAYERS, TRACK, HAND_SIZE, AWAY_SKIP_MS, ROOM_TTL_MS, SPACES, CARDS,
  rooms, get, create, join, leave, markAway, start, takeTurn, skipIfAway,
  publicState, privateState, sweep, cleanName, normalizeCode, currentToken
};
