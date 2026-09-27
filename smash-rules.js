// Super Smash Rolls rules engine. Plain data in, plain data out: no sockets.
// smash-server.js calls these and broadcasts whatever changed.
// Rooms here are separate from the race game's rooms.

const H = require('./smash-heroes');
const { HEROES, CARDS, fx } = H;

// Bump this with every update. Every screen shows it at the bottom.
const VERSION = '0.6';
const MAX_FIGHTERS = 4;
const HAND_START = 4;
const HAND_LIMIT = 6;
const START_CP = 2;
const AWAY_MS = 15 * 1000;       // an away phone's turn is played for it after this
const DEFEND_IDLE_MS = 45 * 1000; // a defender who never rolls gets rolled for
const BOT_STEP_MS = 1400;         // how fast bots act, so the TV can follow
const ROOM_TTL_MS = 30 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPRTUVWXYZ';
const COLORS = ['#19B6C9', '#E0604F', '#7FB069', '#B98AE8', '#F08A3C', '#4FA3E0', '#E87FB0', '#F2C230'];
const BOT_NAMES = ['Sparring Bot', 'Training Bot', 'Practice Bot'];

let rng = Math.random;
function setRng(fn) { rng = fn || Math.random; }
const d6 = () => 1 + Math.floor(rng() * 6);

const rooms = new Map();

// ------------------------------------------------------------------ helpers

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}
const shortId = () => Math.random().toString(36).slice(2, 10);
function cleanName(raw) {
  const name = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 12);
  return name || 'Player';
}
const normalizeCode = (raw) => String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const get = (code) => rooms.get(normalizeCode(code)) || null;
const roster = (room) => [...room.players.values()].sort((a, b) => a.seq - b.seq);
const heroIds = Object.keys(HEROES);
const randomHero = () => heroIds[Math.floor(Math.random() * heroIds.length)];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function draw(f, n) {
  for (let i = 0; i < n; i++) {
    if (!f.deck.length) {
      if (!f.discard.length) return;
      f.deck = shuffle(f.discard);
      f.discard = [];
    }
    f.hand.push(f.deck.pop());
  }
}

function setEvent(room, text, extra = {}) {
  room.event = { n: (room.event ? room.event.n : 0) + 1, text, ...extra };
  room.log.unshift(text);
  room.log.length = Math.min(room.log.length, 8);
}

const fighterOf = (room, token) => (room.fighters || []).find((f) => f.token === token && !f.bot) || null;
const fighterById = (room, id) => (room.fighters || []).find((f) => f.id === id) || null;
const active = (room) => (room.phase === 'play' ? room.fighters[room.turn] : null);
const alive = (room) => room.fighters.filter((f) => f.alive);
const opponents = (room, f) => room.fighters.filter((o) => o.alive && o.id !== f.id);
const lvlOf = (f, abilityId) => f.upgrades[abilityId] || 1;
const isConnected = (room, f) => {
  if (f.bot) return true;
  const p = room.players.get(f.token);
  return !!(p && p.connected);
};

// ------------------------------------------------------------------ seats

function attach(room, token, name, socketId) {
  let p = room.players.get(token);
  if (p) {
    p.connected = true;
    p.socketId = socketId;
    if (name) p.name = cleanName(name);
    const f = fighterOf(room, token);
    if (f) f.name = p.name;
  } else {
    const used = new Set(roster(room).map((x) => x.color));
    p = {
      token, id: shortId(), name: cleanName(name), connected: true, socketId,
      seq: room.nextSeq++, color: COLORS.find((c) => !used.has(c)) || COLORS[0], hero: null
    };
    room.players.set(token, p);
  }
  room.lastActive = Date.now();
  return p;
}

// A player may pick their own 4-letter code. Blank → a random one.
function create(token, name, socketId, wanted = '') {
  const c = normalizeCode(wanted);
  if (c && c.length !== 4) return { error: 'Your own code needs exactly 4 letters, or leave it blank for a random one.' };
  if (c && rooms.has(c)) return { error: `The code ${c} is already in use. Pick another, or leave it blank.` };
  const room = {
    code: c || makeCode(), players: new Map(), hostToken: token, nextSeq: 0,
    phase: 'lobby', bots: [], fighters: [], turn: 0, turnNo: 0, step: null,
    dice: null, pending: null, turnFlags: {}, skipRoll: false,
    winnerId: null, event: null, log: [], stepAt: 0, gameNo: 0, lastActive: Date.now()
  };
  rooms.set(room.code, room);
  return { room, player: attach(room, token, name, socketId) };
}

function seatsTaken(room) { return room.players.size + room.bots.length; }

function join(code, token, name, socketId) {
  const room = get(code);
  if (!room) return { error: 'No game with that code. Check the code on the TV.' };
  if (!room.players.has(token) && room.phase === 'lobby' && seatsTaken(room) >= MAX_FIGHTERS) {
    return { error: 'That game is full. Four fighters is the limit.' };
  }
  return { room, player: attach(room, token, name, socketId) };
}

function markAway(code, token) {
  const room = get(code);
  const p = room && room.players.get(token);
  if (!p) return null;
  p.connected = false;
  room.lastActive = Date.now();
  return room;
}

function leave(code, token) {
  const room = get(code);
  if (!room || !room.players.has(token)) return null;
  const p = room.players.get(token);
  const f = fighterOf(room, token);
  if (f && room.phase === 'play') {
    f.bot = true; // a bot finishes the game for them
    f.token = null;
    setEvent(room, `${p.name} left. A bot takes over their fighter.`);
  }
  room.players.delete(token);
  if (token === room.hostToken) {
    const next = roster(room)[0];
    room.hostToken = next ? next.token : null;
  }
  room.lastActive = Date.now();
  return room;
}

function sweep(now = Date.now()) {
  for (const [code, room] of rooms) {
    const anyone = [...room.players.values()].some((p) => p.connected);
    if (!anyone && now - room.lastActive > ROOM_TTL_MS) rooms.delete(code);
  }
}

// ------------------------------------------------------------------ lobby

function pickHero(code, token, hero) {
  const room = get(code);
  if (!room) return { error: 'No game with that code.' };
  if (room.phase !== 'lobby') return { error: 'Heroes are picked in the lobby.' };
  if (!HEROES[hero]) return { error: 'Pick one of the heroes shown.' };
  const p = room.players.get(token);
  if (!p) return { error: 'Join the game first.' };
  p.hero = hero;
  return { room };
}

function addBot(code, token, hero) {
  const room = get(code);
  if (!room) return { error: 'No game with that code.' };
  if (token !== room.hostToken) return { error: 'Only the host can add a bot.' };
  if (room.phase !== 'lobby') return { error: 'Add bots in the lobby.' };
  if (seatsTaken(room) >= MAX_FIGHTERS) return { error: 'The game is full.' };
  const n = room.bots.length;
  room.bots.push({ id: 'bot' + shortId(), name: BOT_NAMES[n % BOT_NAMES.length] + (n >= BOT_NAMES.length ? ' ' + (n + 1) : ''), hero: HEROES[hero] ? hero : randomHero() });
  return { room };
}

function removeBot(code, token, id) {
  const room = get(code);
  if (!room) return { error: 'No game with that code.' };
  if (token !== room.hostToken) return { error: 'Only the host can remove a bot.' };
  if (room.phase !== 'lobby') return { error: 'Remove bots in the lobby.' };
  room.bots = room.bots.filter((b) => b.id !== id);
  return { room };
}

function makeFighter(base, hp) {
  const f = {
    id: base.id, token: base.token || null, bot: !!base.bot, name: base.name, color: base.color,
    hero: base.hero, hp, maxHp: hp, cp: START_CP, hand: [], deck: shuffle(H.deckFor(base.hero)), discard: [],
    tokens: {}, status: { burn: 0, knockdown: false, frozen: false }, upgrades: {}, alive: true,
    shield: 0, thorns: 0, noKnockdown: false, noInstants: false, lastDamage: 0, sealed: false, peek: null
  };
  draw(f, HAND_START);
  return f;
}

function start(code, token, now = Date.now()) {
  const room = get(code);
  if (!room) return { error: 'No game with that code.' };
  if (token !== room.hostToken) return { error: 'Only the host can start the fight.' };
  if (room.phase === 'play') return { error: 'The fight is already on.' };
  const people = roster(room).slice(0, MAX_FIGHTERS);
  const total = people.length + room.bots.length;
  if (total < 2) return { error: 'You need at least two fighters. Add a bot to practice.' };
  const hp = total === 2 ? 50 : 40;
  const bases = people.map((p) => ({ id: p.id, token: p.token, name: p.name, color: p.color, hero: p.hero || (p.hero = randomHero()) }))
    .concat(room.bots.map((b, i) => ({ id: b.id, bot: true, name: b.name, color: COLORS[(people.length + i) % COLORS.length], hero: b.hero })));
  room.fighters = bases.map((b) => makeFighter(b, hp + (HEROES[b.hero].hpMod || 0))); // Marcus: glass cannon
  room.phase = 'play';
  room.turn = Math.floor(rng() * room.fighters.length);
  room.turnNo = 0;
  room.winnerId = null;
  room.log = [];
  room.gameNo++;
  setEvent(room, `Fight! ${room.fighters[room.turn].name} goes first.`, { kind: 'start' });
  startTurn(room, now, true);
  room.lastActive = now;
  return { room };
}

function rematch(code, token) {
  const room = get(code);
  if (!room) return { error: 'No game with that code.' };
  if (token !== room.hostToken) return { error: 'Only the host can start a rematch.' };
  room.phase = 'lobby';
  room.fighters = [];
  room.dice = null;
  room.pending = null;
  room.step = null;
  room.event = null;
  room.log = [];
  return { room };
}

// ------------------------------------------------------------------ turn flow

function startTurn(room, now, first = false) {
  const f = active(room);
  room.turnNo++;
  room.turnFlags = {};
  room.skipRoll = false;
  room.dice = null;
  room.pending = null;
  room.stepAt = now;
  const notes = [];

  // Upkeep: a Frag Tag goes off (can't be blocked)
  if (fx.has(f, 'tagged')) {
    fx.drop(f, 'tagged');
    fx.hurt(f, H.MT.tagDmg, notes);
    f.lastDamage = H.MT.tagDmg;
    notes.push(`The frag on ${f.name} goes off for ${H.MT.tagDmg}`);
    if (checkDeaths(room)) { setEvent(room, notes.join('. ') + '.', { kind: 'burn' }); return; }
    if (!f.alive) { setEvent(room, notes.join('. ') + '.', { kind: 'burn' }); nextTurn(room, now); return; }
  }
  // Upkeep: Burn
  if (f.status.burn) {
    const dmg = 2 * f.status.burn;
    f.status.burn = 0;
    fx.hurt(f, dmg, notes);
    notes.unshift(`${f.name} burns for ${dmg}`);
    if (checkDeaths(room)) { setEvent(room, notes.join('. ') + '.', { kind: 'burn' }); return; }
    if (!f.alive) { setEvent(room, notes.join('. ') + '.', { kind: 'burn' }); nextTurn(room, now); return; }
  }
  // Income: the very first turn of the game skips it
  if (!first) {
    fx.cp(f, 1);
    draw(f, Math.max(0, HAND_START - f.hand.length)); // refill to 4
  }
  if (fx.has(f, 'drained')) {
    fx.drop(f, 'drained');
    room.skipRoll = true;
    notes.push(`${f.name} is Drained and skips their roll`);
  }
  room.step = 'main1';
  if (notes.length) setEvent(room, notes.join('. ') + '.', { kind: 'upkeep' });
  else if (!first) setEvent(room, `${f.name}'s turn.`, { kind: 'turn' });
}

function nextTurn(room, now) {
  if (room.phase !== 'play') return;
  for (let i = 1; i <= room.fighters.length; i++) {
    const idx = (room.turn + i) % room.fighters.length;
    if (room.fighters[idx].alive) { room.turn = idx; break; }
  }
  startTurn(room, now);
}

function checkDeaths(room) {
  room.fighters.forEach((f) => {
    if (f.alive && f.hp <= 0) { f.alive = false; f.hp = 0; }
  });
  const left = alive(room);
  if (left.length <= 1) {
    room.phase = 'finished';
    room.step = null;
    room.winnerId = left.length ? left[0].id : null;
    const text = left.length ? `${left[0].name} wins the fight!` : 'Everyone went down. It\'s a draw!';
    setEvent(room, text, { kind: 'win', by: room.winnerId });
    return true;
  }
  return false;
}

function mustBeActive(room, token) {
  if (!room) return { error: 'No game with that code.' };
  if (room.phase !== 'play') return { error: 'The fight is not on.' };
  const f = active(room);
  if (!f || f.token !== token || f.bot) return { error: 'It is not your turn.' };
  return { f };
}

function toRoll(code, token, now = Date.now()) {
  const room = get(code);
  const chk = mustBeActive(room, token);
  if (chk.error) return chk;
  return doToRoll(room, chk.f, now);
}
function doToRoll(room, f, now) {
  if (room.step !== 'main1') return { error: 'You can only start rolling from your first main phase.' };
  if (room.skipRoll) return { error: 'You are Drained: no roll this turn. End your turn.' };
  let n = 5;
  let rolls = 3;
  const notes = [];
  if (fx.has(f, 'hammerLock')) { n = 4; fx.drop(f, 'hammerLock'); notes.push('Hammer Lock: 4 dice'); }
  if (f.status.knockdown) { rolls = 2; f.status.knockdown = false; notes.push('Knocked Down: 2 rolls'); }
  room.dice = { owner: f.id, kind: 'offense', values: Array(n).fill(0), kept: Array(n).fill(false), rollsLeft: rolls, rolled: 0, done: false };
  room.step = 'roll';
  room.stepAt = now;
  setEvent(room, `${f.name} is rolling${notes.length ? ' (' + notes.join(', ') + ')' : ''}.`, { kind: 'toRoll' });
  return { room };
}

function roll(code, token, now = Date.now()) {
  const room = get(code);
  const chk = mustBeActive(room, token);
  if (chk.error) return chk;
  return doRoll(room, chk.f, now);
}
function doRoll(room, f, now) {
  const d = room.dice;
  if (room.step !== 'roll' || !d || d.done) return { error: 'You are not rolling right now.' };
  if (d.rollsLeft <= 0) return { error: 'No rolls left. Pick an attack or pass.' };
  // First roll: all dice. After that: only the dice the player tapped (kept = false).
  if (d.rolled && d.kept.every(Boolean)) return { error: 'Tap the dice you want to reroll first.' };
  d.values = d.values.map((v, i) => (d.kept[i] && d.rolled ? v : d6()));
  d.kept = d.values.map(() => true);
  d.rollsLeft--;
  d.rolled++;
  room.stepAt = now;
  setEvent(room, `${f.name} rolls: ${d.values.join(' ')}`, { kind: 'roll', by: f.id });
  return { room };
}

function keep(code, token, i) {
  const room = get(code);
  const chk = mustBeActive(room, token);
  if (chk.error) return chk;
  const d = room.dice;
  if (room.step !== 'roll' || !d || !d.rolled || d.done) return { error: 'Roll first.' };
  if (!Number.isInteger(i) || i < 0 || i >= d.values.length) return { error: 'No such die.' };
  d.kept[i] = !d.kept[i];
  return { room };
}

// Which abilities the current offensive dice qualify for.
function qualifying(room) {
  const f = active(room);
  const d = room.dice;
  if (!f || !d || d.kind !== 'offense' || !d.rolled) return [];
  const h = HEROES[f.hero];
  const ctx = { room, att: f, dice: d.values };
  const out = [];
  h.abilities.forEach((a) => { const t = a.match(ctx); if (t >= 0) out.push({ id: a.id, tier: t }); });
  if (!f.sealed) { const t = h.ultimate.match(ctx); if (t >= 0) out.push({ id: h.ultimate.id, tier: t, ult: true }); }
  return out;
}

function planFor(room, f, abilityId, opts = {}) {
  const h = HEROES[f.hero];
  const isUlt = h.ultimate.id === abilityId;
  const a = isUlt ? h.ultimate : h.abilities.find((x) => x.id === abilityId);
  if (!a) return { error: 'That is not one of your abilities.' };
  if (isUlt && f.sealed) return { error: 'Your Ultimate is sealed this turn.' };
  const tier = a.match({ room, att: f, dice: room.dice.values });
  if (tier < 0) return { error: `Your dice don't make ${a.name}.` };
  const lvl = lvlOf(f, a.id);
  const plan = a.plan({ room, att: f, lvl, tier, opts: opts || {}, d6 });
  plan.name = a.name;
  plan.ult = isUlt;
  if (plan.dmg > 0) {
    let bonus = 0;
    if (fx.has(f, 'avatarState')) bonus += 5;
    if (fx.has(f, 'biggoron')) bonus += 2;
    if (fx.has(f, 'weaponUp')) bonus += H.MT.upBonus * f.tokens.weaponUp; // Marcus: all spent on this attack
    if (room.turnFlags.torque) bonus += 3;                        // Torque Bow Charge
    plan.bonus = bonus;
    plan.dmg += bonus;
  }
  return { plan, lvl, tier };
}

function attack(code, token, args = {}, now = Date.now()) {
  const room = get(code);
  const chk = mustBeActive(room, token);
  if (chk.error) return chk;
  return doAttack(room, chk.f, args, now);
}

function doAttack(room, f, args, now) {
  const d = room.dice;
  if (room.step !== 'roll' || !d || d.done) return { error: 'You are not rolling right now.' };
  if (!d.rolled) return { error: 'Roll first.' };
  const res = planFor(room, f, args.ability, args);
  if (res.error) return res;
  const plan = res.plan;

  // Might: spend any number for +2 each
  const might = Math.max(0, Math.min(f.tokens.might || 0, Number(args.might) || 0));
  if (might && plan.dmg > 0) {
    f.tokens.might -= might;
    if (!f.tokens.might) delete f.tokens.might;
    plan.dmg += might * 2;
    plan.might = might;
  }

  let targets;
  const opp = opponents(room, f);
  if (plan.all) targets = opp;
  else {
    const t = args.target ? opp.find((o) => o.id === args.target) : (opp.length === 1 ? opp[0] : null);
    if (!t) return { error: 'Pick who to attack.' };
    targets = [t];
  }
  if (room.turnFlags.cheapShot && !plan.ult) plan.undefendable = true;

  if (plan.dmg > 0 && fx.has(f, 'weaponUp')) { plan.spentUp = f.tokens.weaponUp; delete f.tokens.weaponUp; }
  d.done = true;
  room.stepAt = now;
  const label = `${f.name} uses ${plan.name}${plan.note ? ' (' + plan.note + ')' : ''}${plan.dmg ? ' for ' + plan.dmg : ''}`;

  // No damage (like Air Scooter I): nothing to defend against, so no defensive roll.
  if (plan.pure || plan.all || plan.undefendable || !(plan.dmg > 0)) {
    const notes = [];
    targets.forEach((t) => landHit(room, f, t, plan, null, notes));
    finishAttack(room, f, plan, notes, label + (targets.length > 1 ? ' on everyone' : ` on ${targets[0].name}`), now);
    return { room };
  }

  // One target defends.
  const t = targets[0];
  const hDef = HEROES[t.hero].defense;
  let n = hDef.dice[lvlOf(t, hDef.id) - 1];
  const why = [];
  if (t.status.frozen) { n -= 1; t.status.frozen = false; why.push('Frozen'); }
  if (plan.defMinus) { n -= plan.defMinus; why.push(plan.name); }
  n = Math.max(1, n);
  let dodge = false;
  let dodgeRoll = null;
  if (fx.has(t, 'airborne') || fx.has(t, 'cover')) {
    fx.drop(t, 'airborne'); fx.drop(t, 'cover');
    dodgeRoll = d6();
    dodge = dodgeRoll <= 2;
  }
  room.pending = { attackerId: f.id, defenderId: t.id, plan, dodge, dodgeRoll };
  room.dice = { owner: t.id, kind: 'defense', values: Array(n).fill(0), kept: Array(n).fill(false), rollsLeft: 1, rolled: 0, done: false, offense: d.values };
  room.step = 'defend';
  let text = `${label} on ${t.name}! ${t.name} defends with ${hDef.name} (${n} dice${why.length ? ', ' + why.join(', ') : ''}).`;
  if (dodgeRoll !== null) text += dodge ? ` In Cover: rolled ${dodgeRoll}, the attack misses!` : ` In Cover: rolled ${dodgeRoll}, no luck.`;
  setEvent(room, text, { kind: 'attack', by: f.id, target: t.id, ability: args.ability });
  return { room };
}

function skipAttack(code, token, now = Date.now()) {
  const room = get(code);
  const chk = mustBeActive(room, token);
  if (chk.error) return chk;
  if (room.step !== 'roll') return { error: 'You are not rolling right now.' };
  if (room.dice) room.dice.done = true;
  room.step = 'main2';
  room.stepAt = now;
  setEvent(room, `${chk.f.name} holds back this turn.`, { kind: 'pass' });
  return { room };
}

// Apply one attack to one target. defRes is the defense result or null.
function landHit(room, att, t, plan, defRes, notes) {
  let dmg = plan.dmg;
  let prevented = 0;
  const blocks = []; // what cut the damage, in order: [label, amount]
  const cut = (label, n) => { if (n > 0) { blocks.push([label, n]); dmg -= n; } };
  // Some hits act before any blocking (the Hookshot grabs a token before it can be used).
  if (plan.preHit) plan.preHit({ room, att, draw }, t, notes);
  if (!plan.pure) {
    if (defRes && defRes.dodge) cut('Dodged', dmg);
    if (defRes && defRes.prevent) { prevented = Math.min(dmg, defRes.prevent); cut(HEROES[t.hero].defense.name, prevented); }
    if (fx.has(t, 'airScooter') && dmg > 0) {
      t.tokens.airScooter -= 1; if (!t.tokens.airScooter) delete t.tokens.airScooter;
      cut('Air Scooter token', Math.min(2, dmg));
    }
    if (fx.has(t, 'avatarState') && dmg > 0) cut('Avatar State', Math.min(2, dmg));
    if (t.shield && dmg > 0) { const s = Math.min(t.shield, dmg); t.shield -= s; cut('Shield card', s); }
    if (fx.has(t, 'burrowed')) { fx.drop(t, 'burrowed'); cut('Burrowed (half)', dmg - Math.floor(dmg / 2)); }
  }
  const hpBefore = t.hp;
  fx.hurt(t, dmg, notes);
  t.lastDamage = dmg;
  const blocked = blocks.reduce((a, b) => a + b[1], 0);
  notes.push(`${t.name} takes ${dmg}` + (blocked ? ` (${plan.dmg} − ${blocked} blocked)` : ''));
  const rec = { targetId: t.id, raw: plan.dmg, blocks, taken: dmg, heal: 0, back: 0, hpBefore, hpAfter: 0, pure: !!plan.pure, gains: [] };
  (room.hitLog = room.hitLog || []).push(rec);
  if (dmg >= 10 && fx.has(t, 'avatarState')) { fx.drop(t, 'avatarState'); notes.push(`${t.name} is knocked out of the Avatar State`); }

  if (defRes) {
    if (defRes.heal) { const before = t.hp; fx.heal(t, defRes.heal); rec.heal = t.hp - before; notes.push(`${t.name} heals ${defRes.heal}`); }
    (defRes.gain || []).forEach((g) => { fx.gain(t, g); rec.gains.push(H.TOKENS[g].name); notes.push(`${t.name} gains ${H.TOKENS[g].name}`); });
  }
  let back = (defRes && defRes.reflect) || 0;
  if (defRes && defRes.mirror) back += Math.floor(prevented / 2);
  if (t.thorns && !plan.pure) { back += t.thorns; t.thorns = 0; }
  if (back > 0 && t.alive) { fx.hurt(att, back, notes); rec.back = back; notes.push(`${att.name} takes ${back} back`); }

  if (plan.hit) plan.hit({ room, att, draw }, t, notes);
  rec.hpAfter = Math.max(0, t.hp);
}

function finishAttack(room, f, plan, notes, label, now) {
  const hpBefore = f.hp;
  if (plan.self) plan.self({ room, att: f, draw }, notes);
  setEvent(room, label + '. ' + notes.join('. ') + '.', { kind: 'hit', by: f.id, abilityName: plan.name });
  // A clear result card for the TV and phones.
  room.result = {
    n: room.event.n, attackerId: f.id, ability: plan.name, raw: plan.dmg,
    bonus: plan.bonus || 0, might: plan.might || 0, extraDice: plan.extraDice || null,
    selfChange: f.hp - hpBefore, hits: room.hitLog || []
  };
  room.hitLog = [];
  room.pending = null;
  room.stepAt = now;
  if (checkDeaths(room)) return;
  if (!f.alive) { nextTurn(room, now); return; }
  room.step = 'main2';
}

function defRoll(code, token, now = Date.now()) {
  const room = get(code);
  if (!room || room.phase !== 'play' || room.step !== 'defend') return { error: 'Nobody is defending right now.' };
  const t = fighterById(room, room.pending.defenderId);
  if (!t || t.token !== token || t.bot) return { error: 'You are not the one defending.' };
  return doDefRoll(room, t, now);
}
function doDefRoll(room, t, now) {
  const d = room.dice;
  if (d.rolled) return { error: 'You already rolled your defense.' };
  d.values = d.values.map(() => d6());
  d.rolled = 1;
  d.rollsLeft = 0;
  room.stepAt = now;
  setEvent(room, `${t.name} defends: ${d.values.join(' ')}`, { kind: 'defRoll', by: t.id });
  return { room };
}

function defAccept(code, token, now = Date.now()) {
  const room = get(code);
  if (!room || room.phase !== 'play' || room.step !== 'defend') return { error: 'Nobody is defending right now.' };
  const t = fighterById(room, room.pending.defenderId);
  if (!t || t.token !== token || t.bot) return { error: 'You are not the one defending.' };
  return doDefAccept(room, t, now);
}
function doDefAccept(room, t, now) {
  const d = room.dice;
  if (!d.rolled) return { error: 'Roll your defense first.' };
  const p = room.pending;
  const att = fighterById(room, p.attackerId);
  const hDef = HEROES[t.hero].defense;
  const res = hDef.resolve(d.values, lvlOf(t, hDef.id), t);
  res.dodge = p.dodge;
  const notes = [];
  if (res.prevent) notes.push(`${hDef.name} blocks ${Math.min(res.prevent, p.plan.dmg)}`);
  landHit(room, att, t, p.plan, res, notes);
  room.dice.done = true;
  finishAttack(room, att, p.plan, notes, `${p.plan.name} lands`, now);
  return { room };
}

function sell(code, token, idx) {
  const room = get(code);
  if (!room || room.phase !== 'play') return { error: 'The fight is not on.' };
  const f = fighterOf(room, token);
  if (!f || !f.alive) return { error: 'You are not fighting.' };
  if (active(room) !== f) return { error: 'Sell cards on your own turn.' };
  if (!Number.isInteger(idx) || idx < 0 || idx >= f.hand.length) return { error: 'That card is not in your hand.' };
  // Cards sell for BP only before you start rolling. After that, the only way to
  // get rid of one is to discard (no BP) when you're over the hand limit.
  const overLimit = f.hand.length > HAND_LIMIT;
  if (room.step !== 'main1' && !overLimit) return { error: 'Cards can only be sold before you roll.' };
  const [card] = f.hand.splice(idx, 1);
  f.discard.push(card);
  if (room.step === 'main1') {
    fx.cp(f, 1);
    setEvent(room, `${f.name} sells ${CARDS[card].name} for 1 BP.`, { kind: 'sell' });
  } else {
    setEvent(room, `${f.name} discards ${CARDS[card].name} (hand limit).`, { kind: 'sell' });
  }
  return { room };
}

function endTurn(code, token, now = Date.now()) {
  const room = get(code);
  const chk = mustBeActive(room, token);
  if (chk.error) return chk;
  return doEndTurn(room, chk.f, now);
}
function doEndTurn(room, f, now) {
  if (room.step !== 'main1' && room.step !== 'main2') return { error: 'Finish your roll first (attack or pass).' };
  if (f.hand.length > HAND_LIMIT) return { error: `Discard down to ${HAND_LIMIT} cards first (tap Discard on a card).` };
  room.fighters.forEach((x) => { x.shield = 0; x.thorns = 0; x.noKnockdown = false; x.noInstants = false; x.peek = null; });
  if (f.sealed) f.sealed = false;
  nextTurn(room, now);
  return { room };
}

// ------------------------------------------------------------------ cards

// Why a card can't be played right now, or null if it can (before picking targets).
function whyNot(room, f, cardId) {
  const c = CARDS[cardId];
  if (!c) return 'Unknown card.';
  if (room.phase !== 'play' || !f.alive) return 'The fight is not on.';
  if (f.cp < c.cost) return `Needs ${c.cost} BP.`;
  const mine = active(room) === f;
  const d = room.dice;
  if (c.type === 'main' || c.type === 'upgrade') {
    if (!mine || (room.step !== 'main1' && room.step !== 'main2')) return 'Main phase only.';
    if (c.type === 'upgrade') {
      if (c.hero !== f.hero) return 'Not your hero.';
      if (lvlOf(f, c.ability) >= 2) return 'Already upgraded.';
    }
  } else if (c.type === 'instant') {
    if (f.noInstants) return 'Earthen Grip: no Instants this turn.';
  } else if (c.type === 'roll') {
    if (c.roll === 'offense') {
      if (!mine || room.step !== 'roll' || !d || d.done) return 'During your roll only.';
    } else if (c.roll === 'own') {
      if (!d || !d.rolled || d.done || d.owner !== f.id) return 'Only while your dice are showing.';
    } else if (c.roll === 'enemy') {
      if (!d || !d.rolled || d.done || d.owner === f.id) return "Only while an opponent's dice are showing.";
    }
  }
  if (c.hero && c.hero !== f.hero) return 'Not your hero.';
  return null;
}

function play(code, token, idx, args = {}, now = Date.now()) {
  const room = get(code);
  if (!room || room.phase !== 'play') return { error: 'The fight is not on.' };
  const f = fighterOf(room, token);
  if (!f) return { error: 'You are not fighting.' };
  return doPlay(room, f, idx, args || {}, now);
}

function doPlay(room, f, idx, args, now) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= f.hand.length) return { error: 'That card is not in your hand.' };
  const id = f.hand[idx];
  const c = CARDS[id];
  const why = whyNot(room, f, id);
  if (why) return { error: why };

  // Check the picks the phone sent.
  const d = room.dice;
  const picks = c.pick || [];
  const dice = Array.isArray(args.dice) ? args.dice.map(Number) : [];
  const faces = Array.isArray(args.faces) ? args.faces.map(Number) : [];
  const needDie = picks.filter((p) => p.k === 'ownDie' || p.k === 'enemyDie').length;
  const multi = picks.find((p) => p.k === 'ownDice' || p.k === 'enemyDice');
  if (needDie && dice.length !== needDie) return { error: 'Pick the dice first.' };
  if (multi && (dice.length < 1 || dice.length > multi.max || new Set(dice).size !== dice.length)) return { error: `Pick 1 to ${multi.max} dice.` };
  if ((needDie || multi) && dice.some((i) => !Number.isInteger(i) || i < 0 || i >= d.values.length)) return { error: 'No such die.' };
  const needFaces = picks.filter((p) => p.k === 'face').length;
  if (needFaces && (faces.length !== needFaces || faces.some((v) => !Number.isInteger(v) || v < 1 || v > 6))) return { error: 'Pick a face.' };
  let target = null;
  if (picks.some((p) => p.k === 'target')) {
    target = opponents(room, f).find((o) => o.id === args.target);
    if (!target) return { error: 'Pick an opponent.' };
  }
  const notes = [];
  const ctx = {
    room, me: f, target, dice, faces, dir: Number(args.dir), notes, draw,
    die: (k) => d.values[dice[k]],
    reroll: (list) => list.forEach((i) => { d.values[i] = d6(); }),
    setDie: (i, v) => { d.values[i] = v; },
    cardName: (cid) => CARDS[cid].name
  };
  if (c.check) { const e = c.check(ctx); if (e) return { error: e }; }

  f.hand.splice(idx, 1);
  f.discard.push(id);
  fx.cp(f, -c.cost);
  if (c.type === 'upgrade') f.upgrades[c.ability] = 2;
  else c.play(ctx);
  room.stepAt = now;
  const on = target ? ` on ${target.name}` : '';
  const diceNow = (c.type === 'roll' && d && c.roll !== 'offense') ? ` Dice: ${d.values.join(' ')}` : '';
  setEvent(room, `${f.name} plays ${c.name}${on}.${notes.length ? ' ' + notes.join('. ') + '.' : ''}${diceNow}`, { kind: 'card', by: f.id, card: id, cardInfo: { name: c.name, type: c.type, cost: c.cost, text: c.text }, target: target ? target.id : null });
  if (checkDeaths(room)) return { room };
  return { room };
}

// ------------------------------------------------------------------ bots and timeouts

// Keep the dice of whichever symbol shows most (Aang's Avatar counts as every element).
function botKeep(room, f, d) {
  const h = HEROES[f.hero];
  if (h.smartBot) return smartKeep(room, f, d);
  const wild = f.hero === 'aang';
  let best = null;
  for (const sym of Object.keys(h.symbols)) {
    const n = d.values.filter((v) => h.faces[v] === sym || (wild && v === 6)).length;
    if (!best || n > best.n) best = { sym, n };
  }
  d.kept = d.values.map((v) => h.faces[v] === best.sym || (wild && v === 6));
}

// For heroes with unusual combos (two pair, sums, exact runs): try every keep choice,
// reroll the rest a few times in our heads, and keep what scores best on average.
function diceScore(room, f, vals) {
  const h = HEROES[f.hero];
  const ctx = { room, att: f, dice: vals };
  let best = 0;
  h.abilities.forEach((a) => {
    if (a.match(ctx) < 0) return;
    const p = a.plan({ room, att: f, lvl: lvlOf(f, a.id), tier: 0, opts: {}, d6: () => 3 });
    best = Math.max(best, (p.dmg || 0) + (a.bot ? a.bot({ room, att: f }) : 0));
  });
  if (!f.sealed && h.ultimate.match(ctx) >= 0) best = Math.max(best, 100);
  return best;
}
function smartKeep(room, f, d) {
  const n = d.values.length;
  const tries = 16;
  let bestMask = 0, bestAvg = -1;
  for (let mask = 0; mask < (1 << n); mask++) {
    let total = 0;
    for (let t = 0; t < tries; t++) {
      const v = d.values.map((x, i) => ((mask >> i) & 1 ? x : 1 + Math.floor(Math.random() * 6)));
      total += diceScore(room, f, v);
    }
    if (total / tries > bestAvg) { bestAvg = total / tries; bestMask = mask; }
  }
  d.kept = d.values.map((x, i) => !!((bestMask >> i) & 1));
}

function botChoose(room, f) {
  let best = null;
  qualifying(room).forEach((q) => {
    const r = planFor(room, f, q.id, {});
    if (r.error) return;
    const a = HEROES[f.hero].abilities.find((x) => x.id === q.id);
    const extra = a && a.bot ? a.bot({ room, att: f }) : 0;
    const score = r.plan.dmg * (r.plan.all ? opponents(room, f).length : 1) + extra + (q.ult ? 100 : 0);
    if (!best || score > best.score) best = { id: q.id, score };
  });
  return best;
}

// After a bot's attack lands (or it passes), bots wait until a person taps Continue.
const PAUSE_KINDS = ['hit', 'pass'];
function botInvolved(room) {
  const f = active(room);
  if (!f) return false;
  if (f.bot) return true;
  return room.step === 'defend' && room.pending && fighterById(room, room.pending.defenderId).bot;
}
function needsContinue(room) {
  if (room.phase !== 'play' || !room.event || !PAUSE_KINDS.includes(room.event.kind)) return false;
  if (room.ackN === room.event.n) return false;
  const by = fighterById(room, room.event.by);
  const next = active(room);
  // Pause only when a bot is about to act next, or a bot just made the move.
  return !!((by && by.bot) || (next && next.bot));
}
function continueBots(code, token) {
  const room = get(code);
  if (!room) return { error: 'No game with that code.' };
  if (!room.players.has(token)) return { error: 'Join the game first.' };
  if (room.event) room.ackN = room.event.n;
  room.stepAt = 0;
  return { room };
}

// Called on a timer. Plays bot turns (people are never timed out).
function tick(room, now = Date.now()) {
  if (room.phase !== 'play') return false;
  if (now - room.stepAt < BOT_STEP_MS) return false;
  const f = active(room);

  if (needsContinue(room)) return false; // a person taps Continue first

  if (room.step === 'defend') {
    const t = fighterById(room, room.pending.defenderId);
    if (!t.bot) return false; // people are never rolled for
    if (!room.dice.rolled) doDefRoll(room, t, now);
    else doDefAccept(room, t, now);
    return true;
  }

  if (!f.bot) return false; // no timeouts: people take as long as they like

  // Bot
  if (room.step === 'main1') {
    // Buy one affordable upgrade per step, then roll.
    const up = f.hand.findIndex((cid) => CARDS[cid].type === 'upgrade' && !whyNot(room, f, cid));
    if (up >= 0 && !doPlay(room, f, up, {}, now).error) return true;
    if (room.skipRoll) { botEnd(room, f, now); return true; }
    doToRoll(room, f, now);
    return true;
  }
  if (room.step === 'roll') {
    const d = room.dice;
    if (!d.rolled) { doRoll(room, f, now); return true; }
    const choice = botChoose(room, f);
    if (d.rollsLeft > 0 && !(choice && (choice.score >= 100 || choice.score >= 8))) {
      botKeep(room, f, d);
      if (!doRoll(room, f, now).error) return true;
    }
    if (choice) {
      const opp = opponents(room, f).sort((a, b) => a.hp - b.hp);
      const humans = opp.filter((o) => !o.bot);
      const target = (humans[0] || opp[0]).id;
      const r = doAttack(room, f, { ability: choice.id, target, might: f.tokens.might || 0 }, now);
      if (!r.error) return true;
    }
    room.dice.done = true;
    room.step = 'main2';
    room.stepAt = now;
    setEvent(room, `${f.name} holds back this turn.`, { kind: 'pass' });
    return true;
  }
  if (room.step === 'main2') { botEnd(room, f, now); return true; }
  return false;
}

function botEnd(room, f, now) {
  while (f.hand.length > HAND_LIMIT) f.discard.push(f.hand.pop()); // over the limit after rolling: discard, no BP
  doEndTurn(room, f, now);
}

// ------------------------------------------------------------------ views

function tokensOf(f) {
  return Object.entries(f.tokens).filter(([, n]) => n > 0).map(([id, n]) => ({ id, n }));
}

function publicState(room) {
  const act = active(room);
  const people = roster(room);
  return {
    code: room.code,
    phase: room.phase,
    maxFighters: MAX_FIGHTERS,
    gameNo: room.gameNo,
    heroes: H.catalog(),
    tokenInfo: H.TOKEN_INFO,
    players: people.map((p) => ({
      id: p.id, name: p.name, color: p.color, connected: p.connected, isHost: p.token === room.hostToken, hero: p.hero
    })),
    bots: room.bots.map((b) => ({ id: b.id, name: b.name, hero: b.hero })),
    fighters: room.fighters.map((f) => ({
      id: f.id, name: f.name, color: f.color, hero: f.hero, bot: f.bot, connected: isConnected(room, f),
      hp: f.hp, maxHp: f.maxHp, cp: f.cp, cards: f.hand.length, alive: f.alive,
      tokens: tokensOf(f), status: f.status, upgrades: f.upgrades, shield: f.shield, sealed: f.sealed
    })),
    activeId: act ? act.id : null,
    turnNo: room.turnNo,
    step: room.step,
    handLimit: HAND_LIMIT,
    skipRoll: room.skipRoll,
    dice: room.dice ? { ...room.dice } : null,
    qualifying: room.step === 'roll' ? qualifying(room) : [],
    pending: room.pending ? {
      attackerId: room.pending.attackerId, defenderId: room.pending.defenderId,
      ability: room.pending.plan.name, dmg: room.pending.plan.dmg, dodge: room.pending.dodge
    } : null,
    winnerId: room.winnerId,
    waiting: needsContinue(room),
    tvCount: room.tvs ? room.tvs.size : 0,
    result: room.result || null,
    event: room.event,
    log: room.log
  };
}

function privateState(room, token) {
  const p = room.players.get(token);
  if (!p) return null;
  const f = fighterOf(room, token);
  return {
    id: p.id,
    isHost: token === room.hostToken,
    fighterId: f ? f.id : null,
    peek: f ? f.peek : null,
    hand: f ? f.hand.map((cid, i) => {
      const c = CARDS[cid];
      return {
        i, id: cid, name: c.name, cost: c.cost, type: c.type, text: c.text,
        pick: c.pick || [], why: whyNot(room, f, cid)
      };
    }) : []
  };
}

module.exports = {
  VERSION, MAX_FIGHTERS, HAND_LIMIT, AWAY_MS, BOT_STEP_MS,
  rooms, get, create, join, leave, markAway, sweep, cleanName, normalizeCode,
  pickHero, addBot, removeBot, start, rematch,
  toRoll, roll, keep, attack, skipAttack, defRoll, defAccept, sell, endTurn, play,
  qualifying, tick, publicState, privateState, setRng, continueBots, needsContinue,
  _internal: { active, fighterById, fighterOf, draw }
};
