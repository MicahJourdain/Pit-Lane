// Super Smash Rolls: heroes, tokens and cards. Plain data plus small functions.
// smash-rules.js runs the turns; this file only says what each thing does.
// Every number here is a first-pass playtest value. Change freely.

const MAX_CP = 15;

// ------------------------------------------------------------------ tokens

const TOKENS = {
  avatarState: { name: 'Avatar State', max: 1, color: '#19B6C9', text: '+5 attack damage, prevent 2 per hit. Lost on 10+ damage from one attack.' },
  airScooter:  { name: 'Air Scooter', max: 2, color: '#F2B544', text: 'Each attack on you uses one: prevent 2 dmg.' },
  masteryAir:  { name: 'Air Mastery', max: 1, color: '#F2B544', text: 'One of four needed for Energybending.' },
  masteryWater:{ name: 'Water Mastery', max: 1, color: '#2A7FD4', text: 'One of four needed for Energybending.' },
  masteryEarth:{ name: 'Earth Mastery', max: 1, color: '#2F8A43', text: 'One of four needed for Energybending.' },
  masteryFire: { name: 'Fire Mastery', max: 1, color: '#C8362A', text: 'One of four needed for Energybending.' },
  biggoron:    { name: "Biggoron's Sword", max: 1, color: '#8A6BD1', text: '+2 attack damage. Shield faces prevent only 1.' },
  fairy:       { name: 'Fairy', max: 1, color: '#E87FB0', text: 'When you would drop to 0 health, go to 10 instead.' },
  hammerLock:  { name: 'Hammer Lock', max: 1, color: '#7A7488', text: 'Your next offensive roll uses 4 dice.' },
  might:       { name: 'Might', max: 5, color: '#C98A12', text: 'Spend when attacking: +2 damage each.' },
  burrowed:    { name: 'Burrowed', max: 1, color: '#6B5A3E', text: 'Halve the damage of the next attack against you.' },
  drained:     { name: 'Drained', max: 1, color: '#7A7488', text: 'Skip your next offensive roll.' }
};

const MASTERY = ['masteryAir', 'masteryWater', 'masteryEarth', 'masteryFire'];

// ------------------------------------------------------------------ helpers

const fx = {
  gain(f, tok, n = 1) {
    const max = TOKENS[tok] ? TOKENS[tok].max : 1;
    f.tokens[tok] = Math.min(max, (f.tokens[tok] || 0) + n);
  },
  drop(f, tok) { delete f.tokens[tok]; },
  has(f, tok) { return (f.tokens[tok] || 0) > 0; },
  heal(f, n) { if (f.alive) f.hp = Math.min(f.maxHp, f.hp + n); },
  cp(f, n) { f.cp = Math.max(0, Math.min(MAX_CP, f.cp + n)); },
  // Returns the damage actually taken. Fairy saves a fighter from 0.
  hurt(f, n, notes) {
    if (!f.alive || n <= 0) return 0;
    f.hp -= n;
    if (f.hp <= 0 && fx.has(f, 'fairy')) {
      fx.drop(f, 'fairy');
      f.hp = 10;
      if (notes) notes.push(`a Fairy saves ${f.name}`);
    }
    return n;
  },
  inflict(f, what, notes) {
    if (!f.alive) return;
    if (what === 'burn') {
      f.status.burn = Math.min(3, (f.status.burn || 0) + 1);
      if (notes) notes.push(`${f.name} is Burned`);
    } else if (what === 'knockdown') {
      if (f.noKnockdown) { if (notes) notes.push(`${f.name}'s Iron Boots hold`); return; }
      f.status.knockdown = true;
      if (notes) notes.push(`${f.name} is Knocked Down`);
    } else if (what === 'frozen') {
      f.status.frozen = true;
      if (notes) notes.push(`${f.name} is Frozen`);
    }
  },
  firstMissingMastery(f) { return MASTERY.find((m) => !fx.has(f, m)) || null; }
};

// ------------------------------------------------------------------ dice math

const count = (dice, faces) => dice.filter((d) => faces.includes(d)).length;
const hasRun = (dice, len) => {
  const s = new Set(dice);
  for (let lo = 1; lo + len - 1 <= 6; lo++) {
    let ok = true;
    for (let v = lo; v < lo + len; v++) if (!s.has(v)) { ok = false; break; }
    if (ok) return true;
  }
  return false;
};
const smallStraight = (dice) => hasRun(dice, 4);
const largeStraight = (dice) => dice.length >= 5 && hasRun(dice, 5);
const fullHouse = (dice) => {
  const c = {};
  dice.forEach((d) => { c[d] = (c[d] || 0) + 1; });
  const v = Object.values(c).sort();
  return v.length === 2 && v[0] === 2 && v[1] === 3;
};
// 3, 4 or 5 of a symbol → tier 0, 1, 2. Fewer than 3 → -1.
const tierOf = (n) => (n >= 5 ? 2 : n === 4 ? 1 : n === 3 ? 0 : -1);

// ------------------------------------------------------------------ heroes
// An ability: match(ctx) → tier (0+) or -1. plan(ctx) → the attack:
//   { dmg, pure, undefendable, all, defMinus, hit(ctx, target, notes), self(ctx, notes) }
// ctx = { room, att, dice, lvl (1 or 2), tier, opts, draw(f, n) }

const AANG_WILD = 6;
const aangCount = (dice, faces) => count(dice, faces.concat([AANG_WILD]));
const yes = (ok) => (ok ? 0 : -1);
// Aang's 6s are wild: each can stand in for any number, straights included.
const wildRun = (dice, len) => {
  const sixes = count(dice, [6]);
  const real = new Set(dice.filter((d) => d !== 6));
  if (dice.length < len) return false;
  for (let lo = 1; lo + len - 1 <= 6; lo++) {
    let missing = 0;
    for (let v = lo; v < lo + len; v++) if (!real.has(v)) missing++;
    if (missing <= sixes) return true;
  }
  return false;
};

// Board spaces: 1-4 across the top row, 5-8 across the bottom row.
// Every hero: four "ring" moves in spaces 1, 2, 5, 6 and three outer moves in 3, 4, 7.

// ---------------- Aang (Micah's v0.2 board)
const aang = {
  id: 'aang',
  name: 'Aang',
  title: 'The Avatar',
  color: '#19B6C9',
  accent: '#F2B544',
  blurb: 'Use all four elements to earn Mastery, then Energybend into the Avatar State.',
  faces: { 1: 'air', 2: 'air', 3: 'water', 4: 'earth', 5: 'fire', 6: 'avatar' },
  symbols: {
    air: { name: 'Air', color: '#F2B544' },
    water: { name: 'Water', color: '#2A7FD4' },
    earth: { name: 'Earth', color: '#2F8A43' },
    fire: { name: 'Fire', color: '#C8362A' },
    avatar: { name: 'Avatar', color: '#19B6C9' }
  },
  wildNote: 'Avatar (6) is wild: it can count as any number, straights included. Ring moves earn that element\'s Mastery, and Mastery can\'t be stolen.',
  abilities: [
    {
      id: 'whip', name: 'Water Whip', space: 1, ring: true, slot: 'Water', need: '3 Water (3, 3, 3)',
      text: ['Roll 3 dice: each 3 deals 3 dmg, each 6 heals 2. Earn Water Mastery.', 'Roll 4 dice: each 3 deals 3 dmg, each 6 heals 2. Earn Water Mastery.'],
      match: ({ dice }) => yes(aangCount(dice, [3]) >= 3),
      bot: ({ att }) => (fx.has(att, 'masteryWater') ? 0 : 5),
      plan: ({ lvl, d6 }) => {
        const r = Array.from({ length: lvl === 2 ? 4 : 3 }, d6);
        const hits = count(r, [3]);
        const heals = count(r, [6]);
        return {
          dmg: hits * 3, note: `rolls ${r.join(' ')}: ${hits} × 3 = ${hits * 3} dmg${heals ? ', heal ' + heals * 2 : ''}`, extraDice: r,
          self: ({ att }) => { if (heals) fx.heal(att, heals * 2); fx.gain(att, 'masteryWater'); }
        };
      }
    },
    {
      id: 'scooter', name: 'Air Scooter', space: 2, ring: true, slot: 'Air', need: '4 Air (1-2 ×4)',
      text: ['Gain 2 Air Scooter tokens. Earn Air Mastery.', 'Deal 3 dmg. Gain 2 Air Scooter tokens. Earn Air Mastery.'],
      match: ({ dice }) => yes(aangCount(dice, [1, 2]) >= 4),
      bot: ({ att }) => (fx.has(att, 'masteryAir') ? 0 : 6) + (2 - (att.tokens.airScooter || 0)) * 2,
      plan: ({ lvl }) => ({
        dmg: lvl === 2 ? 3 : 0,
        self: ({ att }) => { fx.gain(att, 'airScooter', 2); fx.gain(att, 'masteryAir'); }
      })
    },
    {
      id: 'flash', name: 'Flash Freeze', space: 3, need: 'Small straight',
      text: ['5 dmg. Gain 1 Air Scooter token. Knockdown.', '7 dmg. Gain 1 Air Scooter token. Knockdown.'],
      match: ({ dice }) => yes(wildRun(dice, 4)),
      plan: ({ lvl }) => ({
        dmg: lvl === 2 ? 7 : 5,
        hit: (ctx, t, notes) => fx.inflict(t, 'knockdown', notes),
        self: ({ att }) => fx.gain(att, 'airScooter', 1)
      })
    },
    {
      id: 'fists', name: 'Metal Fists', space: 4, need: '4 Avatar (6, 6, 6, 6)',
      text: ['9 dmg. Draw 1 card. Gain 1 BP.', '11 dmg. Draw 1 card. Gain 1 BP.'],
      match: ({ dice }) => yes(count(dice, [6]) >= 4),
      plan: ({ lvl }) => ({
        dmg: lvl === 2 ? 11 : 9,
        self: ({ att, draw }) => { draw(att, 1); fx.cp(att, 1); }
      })
    },
    {
      id: 'avalanche', name: 'Rock Avalanche', space: 5, ring: true, slot: 'Earth', need: '3 Earth (4, 4, 4)',
      text: ['8 dmg. Knockdown. Earn Earth Mastery.', '10 dmg. Knockdown. Earn Earth Mastery.'],
      match: ({ dice }) => yes(aangCount(dice, [4]) >= 3),
      bot: ({ att }) => (fx.has(att, 'masteryEarth') ? 0 : 5),
      plan: ({ lvl }) => ({
        dmg: lvl === 2 ? 10 : 8,
        hit: (ctx, t, notes) => fx.inflict(t, 'knockdown', notes),
        self: ({ att }) => fx.gain(att, 'masteryEarth')
      })
    },
    {
      id: 'dragon', name: 'Dancing Dragon', space: 6, ring: true, slot: 'Fire', need: '3 Fire (5, 5, 5)',
      text: ['5 dmg. Burn. Earn Fire Mastery.', '7 dmg. Burn. Earn Fire Mastery.'],
      match: ({ dice }) => yes(aangCount(dice, [5]) >= 3),
      bot: ({ att }) => (fx.has(att, 'masteryFire') ? 0 : 5),
      plan: ({ lvl }) => ({
        dmg: lvl === 2 ? 7 : 5,
        hit: (ctx, t, notes) => fx.inflict(t, 'burn', notes),
        self: ({ att }) => fx.gain(att, 'masteryFire')
      })
    },
    {
      id: 'combust', name: 'Combust', space: 7, need: 'Large straight',
      text: ['7 dmg. Burn.', '9 dmg. Burn twice.'],
      match: ({ dice }) => yes(wildRun(dice, 5)),
      plan: ({ lvl }) => ({
        dmg: lvl === 2 ? 9 : 7,
        hit: (ctx, t, notes) => { fx.inflict(t, 'burn', notes); if (lvl === 2) fx.inflict(t, 'burn'); }
      })
    }
  ],
  ultimate: {
    id: 'energy', name: 'Energybending', need: 'All 4 Mastery + 5 Avatar',
    text: ['13 dmg, cannot be defended or reduced. Then gain Avatar State. Uses up your 4 Mastery.'],
    match: ({ dice, att, room }) => {
      if (!MASTERY.every((m) => fx.has(att, m))) return -1;
      const need = room.turnFlags.lionTurtle ? 4 : 5;
      return yes(count(dice, [6]) >= need);
    },
    plan: () => ({
      dmg: 13, pure: true,
      self: ({ att }) => { MASTERY.forEach((m) => fx.drop(att, m)); fx.gain(att, 'avatarState'); }
    })
  },
  defense: {
    id: 'sidestep', name: 'Spirit Sidestep', dice: [4, 5],
    text: ['Roll 4. Each Air: prevent 1. Each Avatar: prevent 2. Each Water: heal 1. 3+ Air: gain an Air Scooter token.', 'Roll 5. Same effects.'],
    resolve: (dice) => {
      const air = count(dice, [1, 2]);
      return { prevent: air + count(dice, [6]) * 2, heal: count(dice, [3]), gain: air >= 3 ? ['airScooter'] : [] };
    }
  },
  upgrades: [
    ['whip', 'Water Whip II', 2], ['scooter', 'Air Scooter II', 2], ['flash', 'Flash Freeze II', 2],
    ['fists', 'Metal Fists II', 3], ['avalanche', 'Rock Avalanche II', 3], ['dragon', 'Dancing Dragon II', 2],
    ['combust', 'Combust II', 3], ['sidestep', 'Spirit Sidestep II', 3]
  ],
  cards: [
    { id: 'appa', name: 'Appa, Yip Yip!', cost: 2, type: 'main', text: 'Gain 1 Air Scooter token. Draw 1 card.',
      play: ({ me, draw }) => { fx.gain(me, 'airScooter'); draw(me, 1); } },
    { id: 'momo', name: "Momo's Mischief", cost: 1, type: 'instant', text: 'Steal 1 BP from an opponent.',
      pick: [{ k: 'target', label: 'Steal from who?' }],
      play: ({ me, target }) => { const n = Math.min(1, target.cp); fx.cp(target, -n); fx.cp(me, n); } },
    { id: 'team', name: 'Team Avatar', cost: 3, type: 'main', text: 'Earn one Mastery you are missing.',
      check: ({ me }) => (fx.firstMissingMastery(me) ? null : 'You already have all four Mastery tokens.'),
      play: ({ me }) => fx.gain(me, fx.firstMissingMastery(me)) },
    { id: 'iroh', name: 'Tea with Iroh', cost: 1, type: 'main', text: 'Heal 3. Remove Burn from yourself.',
      play: ({ me }) => { fx.heal(me, 3); me.status.burn = 0; } },
    { id: 'sokka', name: "Sokka's Plan", cost: 1, type: 'roll', roll: 'own', text: 'Reroll up to 3 of your dice.',
      pick: [{ k: 'ownDice', max: 3, label: 'Pick up to 3 dice to reroll' }],
      play: ({ reroll, dice }) => reroll(dice) },
    { id: 'toph', name: "Toph's Seismic Sense", cost: 1, type: 'instant', text: "See an opponent's hand. Draw 1 card.",
      pick: [{ k: 'target', label: 'Whose hand?' }],
      play: ({ me, target, draw, cardName }) => { me.peek = { name: target.name, cards: target.hand.map(cardName) }; draw(me, 1); } },
    { id: 'lion', name: "Lion Turtle's Lesson", cost: 2, type: 'roll', roll: 'offense', text: 'This turn, Energybending needs only 4 Avatar.',
      play: ({ room }) => { room.turnFlags.lionTurtle = true; } }
  ]
};

// ---------------- Link (same layout, tuned against Aang)
const LT = {
  slash: [7, 9], hookshot: [8, 10], hammer: [10, 12], bombs: [11, 13],
  boomerang: [5, 6], spin: [7, 9], bow: [8, 9], ult: 15
};
const link = {
  id: 'link',
  name: 'Link',
  title: 'Hero of Time',
  color: '#2F8A43',
  accent: '#E0B83A',
  blurb: 'An item for every job. Big hits have a price.',
  faces: { 1: 'rupee', 2: 'sword', 3: 'sword', 4: 'shield', 5: 'shield', 6: 'triforce' },
  symbols: {
    rupee: { name: 'Rupee', color: '#3FA36B' },
    sword: { name: 'Sword', color: '#4A78C8' },
    shield: { name: 'Shield', color: '#B33A3A' },
    triforce: { name: 'Triforce', color: '#E0B83A' }
  },
  abilities: [
    {
      id: 'slash', name: 'Master Sword Slash', space: 1, ring: true, slot: 'Sword', need: '3 Sword (2-3 ×3)',
      get text() { return [`${LT.slash[0]} dmg.`, `${LT.slash[1]} dmg.`]; },
      match: ({ dice }) => yes(count(dice, [2, 3]) >= 3),
      plan: ({ lvl }) => ({ dmg: LT.slash[lvl - 1] })
    },
    {
      id: 'hookshot', name: 'Hookshot', space: 2, ring: true, slot: 'Triforce', need: '4 Triforce (6, 6, 6, 6)',
      get text() { return [`${LT.hookshot[0]} dmg. First, take 1 token from the target (not Mastery).`, `${LT.hookshot[1]} dmg. First, take up to 2 tokens from the target (not Mastery).`]; },
      match: ({ dice }) => yes(count(dice, [6]) >= 4),
      bot: ({ room, att }) => (room.fighters.some((o) => o.alive && o.id !== att.id && STEAL_ORDER.some((k) => fx.has(o, k))) ? 4 : -2),
      plan: ({ lvl }) => ({
        dmg: LT.hookshot[lvl - 1],
        // Grabs the token before damage, so an Air Scooter token can't block this hit.
        preHit: (ctx, t, notes) => { for (let i = 0; i < lvl; i++) stealToken(ctx.att, t, notes); }
      })
    },
    {
      id: 'boomerang', name: 'Boomerang', space: 3, need: 'Small straight',
      get text() { return [`${LT.boomerang[0]} dmg. Knockdown.`, `${LT.boomerang[1]} dmg. Knockdown. Draw 1 card.`]; },
      match: ({ dice }) => yes(smallStraight(dice)),
      plan: ({ lvl }) => ({
        dmg: LT.boomerang[lvl - 1],
        hit: (ctx, t, notes) => fx.inflict(t, 'knockdown', notes),
        self: ({ att, draw }) => { if (lvl === 2) draw(att, 1); }
      })
    },
    {
      id: 'spin', name: 'Spin Attack', space: 4, all: true, need: '2 Rupee + 2 Triforce (1, 1, 6, 6)',
      get text() { return [`${LT.spin[0]} dmg to every opponent.`, `${LT.spin[1]} dmg to every opponent.`]; },
      match: ({ dice }) => yes(count(dice, [1]) >= 2 && count(dice, [6]) >= 2),
      plan: ({ lvl }) => ({ dmg: LT.spin[lvl - 1], all: true })
    },
    {
      id: 'hammer', name: 'Megaton Hammer', space: 5, ring: true, slot: 'Shield', need: '4 Shield (4-5 ×4)',
      get text() { return [`${LT.hammer[0]} dmg. Knockdown. Your next roll uses 4 dice.`, `${LT.hammer[1]} dmg. Knockdown. Your next roll uses 4 dice.`]; },
      match: ({ dice }) => yes(count(dice, [4, 5]) >= 4),
      plan: ({ lvl }) => ({
        dmg: LT.hammer[lvl - 1],
        hit: (ctx, t, notes) => fx.inflict(t, 'knockdown', notes),
        self: ({ att }) => fx.gain(att, 'hammerLock')
      })
    },
    {
      id: 'bombs', name: 'Bombs', space: 6, ring: true, slot: 'Bomb', need: 'Full house',
      get text() { return [`${LT.bombs[0]} dmg. You take 3 dmg.`, `Bombchus: ${LT.bombs[1]} dmg. You take 3 dmg.`]; },
      match: ({ dice }) => yes(fullHouse(dice)),
      plan: ({ lvl }) => ({
        dmg: LT.bombs[lvl - 1],
        self: ({ att }, notes) => { fx.hurt(att, 3, notes); notes.push(`${att.name} takes 3 from the blast`); }
      })
    },
    {
      id: 'bow', name: 'Fairy Bow', space: 7, need: 'Large straight',
      get text() { return [`${LT.bow[0]} dmg + one arrow: Fire (Burn), Ice (Frozen) or Light (+3 dmg).`, `${LT.bow[1]} dmg + two different arrows.`]; },
      options: [{ key: 'arrows', label: 'Arrows', multi: true, choices: [{ v: 'fire', label: 'Fire · Burn' }, { v: 'ice', label: 'Ice · Frozen' }, { v: 'light', label: 'Light · +3 dmg' }] }],
      match: ({ dice }) => yes(largeStraight(dice)),
      plan: ({ lvl, opts }) => {
        const want = lvl === 2 ? 2 : 1;
        let arrows = Array.isArray(opts.arrows) ? [...new Set(opts.arrows)].filter((a) => ['fire', 'ice', 'light'].includes(a)) : [];
        if (!arrows.length) arrows = ['light', 'fire'];
        arrows = arrows.slice(0, want);
        return {
          dmg: LT.bow[lvl - 1] + (arrows.includes('light') ? 3 : 0),
          hit: (ctx, t, notes) => {
            if (arrows.includes('fire')) fx.inflict(t, 'burn', notes);
            if (arrows.includes('ice')) fx.inflict(t, 'frozen', notes);
          }
        };
      }
    }
  ],
  ultimate: {
    id: 'triforce', name: 'Power of the Triforce', need: '5 Triforce',
    get text() { return [`${LT.ult} dmg, cannot be defended or reduced. Gain a Fairy.`]; },
    match: ({ dice }) => yes(count(dice, [6]) >= 5),
    plan: () => ({ dmg: LT.ult, pure: true, self: ({ att }) => fx.gain(att, 'fairy') })
  },
  defense: {
    id: 'shield', name: 'Hylian Shield', dice: [4, 4],
    text: ['Roll 4. Each Shield: prevent 2. Each Triforce: prevent 1.', 'Mirror Shield: same, and with 3+ Shield send back half of what you prevent.'],
    resolve: (dice, lvl, me) => {
      const shields = count(dice, [4, 5]);
      const each = fx.has(me, 'biggoron') ? 1 : 2;
      return { prevent: shields * each + count(dice, [6]), mirror: lvl === 2 && shields >= 3 };
    }
  },
  upgrades: [
    ['slash', 'Master Sword II', 2], ['hookshot', 'Longshot', 3], ['boomerang', 'Boomerang II', 2],
    ['spin', 'Great Spin Attack', 3], ['hammer', 'Megaton Hammer II', 3], ['bombs', 'Bombchus', 2],
    ['bow', 'Fairy Bow II', 3], ['shield', 'Mirror Shield', 3]
  ],
  cards: [
    { id: 'biggoron', name: "Biggoron's Sword", cost: 3, type: 'main', text: 'Gain Biggoron\'s Sword: +2 attack damage, but Shield faces prevent only 1.',
      check: ({ me }) => (fx.has(me, 'biggoron') ? 'You already carry it.' : null),
      play: ({ me }) => fx.gain(me, 'biggoron') },
    { id: 'bottle', name: 'Fairy in a Bottle', cost: 3, type: 'main', text: 'Gain a Fairy.',
      check: ({ me }) => (fx.has(me, 'fairy') ? 'You already have a Fairy.' : null),
      play: ({ me }) => fx.gain(me, 'fairy') },
    { id: 'songtime', name: 'Song of Time', cost: 2, type: 'instant', text: 'Heal the damage from the last attack on you (max 6).',
      check: ({ me }) => (me.lastDamage > 0 ? null : 'Nothing to undo yet.'),
      play: ({ me }) => { fx.heal(me, Math.min(6, me.lastDamage)); me.lastDamage = 0; } },
    { id: 'storms', name: 'Song of Storms', cost: 2, type: 'roll', roll: 'enemy', text: "Force an opponent to reroll up to 2 of their dice.",
      pick: [{ k: 'enemyDice', max: 2, label: 'Pick up to 2 of their dice' }],
      play: ({ reroll, dice }) => reroll(dice) },
    { id: 'potion', name: 'Red Potion', cost: 2, type: 'instant', text: 'Heal 5.',
      play: ({ me }) => fx.heal(me, 5) },
    { id: 'navi', name: 'Hey! Listen!', cost: 0, type: 'instant', text: 'Draw 1 card.',
      play: ({ me, draw }) => draw(me, 1) },
    { id: 'boots', name: 'Iron Boots', cost: 1, type: 'instant', text: "Prevent 2 dmg. You can't be Knocked Down this turn.",
      play: ({ me }) => { me.shield += 2; me.noKnockdown = true; } }
  ]
};

// ---------------- Onua (same layout, tuned against Aang)
const OT = {
  swipe: [5, 7], rockslide: [6, 7], rockMight: [1, 2], night: [6, 8], grip: [8, 10],
  tunnel: [6, 8], mask: [3, 4], maskMight: [2, 3], quake: [8, 10], ult: 18
};
const onua = {
  id: 'onua',
  name: 'Onua',
  title: 'Toa of Earth',
  color: '#3B3552',
  accent: '#7FD13B',
  blurb: 'Slow, heavy, unstoppable. Build Might, then bury them.',
  faces: { 1: 'claw', 2: 'claw', 3: 'stone', 4: 'stone', 5: 'eye', 6: 'pakari' },
  symbols: {
    claw: { name: 'Claw', color: '#3B3552' },
    stone: { name: 'Stone', color: '#8A6B45' },
    eye: { name: 'Night Eye', color: '#7FD13B' },
    pakari: { name: 'Pakari', color: '#1F1B2E' }
  },
  abilities: [
    {
      id: 'swipe', name: 'Quake Breaker Swipe', space: 1, ring: true, slot: 'Claw', need: '3 Claw (1-2 ×3)',
      get text() { return [`${OT.swipe[0]} dmg.`, `${OT.swipe[1]} dmg.`]; },
      match: ({ dice }) => yes(count(dice, [1, 2]) >= 3),
      plan: ({ lvl }) => ({ dmg: OT.swipe[lvl - 1] })
    },
    {
      id: 'rockslide', name: 'Rockslide', space: 2, ring: true, slot: 'Stone', need: '3 Stone (3-4 ×3)',
      get text() { return [`${OT.rockslide[0]} dmg. Gain ${OT.rockMight[0]} Might.`, `${OT.rockslide[1]} dmg. Gain ${OT.rockMight[1]} Might.`]; },
      match: ({ dice }) => yes(count(dice, [3, 4]) >= 3),
      plan: ({ lvl }) => ({ dmg: OT.rockslide[lvl - 1], self: ({ att }) => fx.gain(att, 'might', OT.rockMight[lvl - 1]) })
    },
    {
      id: 'tunnel', name: 'Tunnel Ambush', space: 3, need: 'Small straight',
      get text() { return [`${OT.tunnel[0]} dmg. Gain Burrowed.`, `${OT.tunnel[1]} dmg. Gain Burrowed.`]; },
      match: ({ dice }) => yes(smallStraight(dice)),
      plan: ({ lvl }) => ({ dmg: OT.tunnel[lvl - 1], self: ({ att }) => fx.gain(att, 'burrowed') })
    },
    {
      id: 'mask', name: 'Mask of Strength', space: 4, need: '3 Pakari (6, 6, 6)',
      get text() { return [`${OT.mask[0]} dmg. Gain ${OT.maskMight[0]} Might.`, `${OT.mask[1]} dmg. Gain ${OT.maskMight[1]} Might.`]; },
      match: ({ dice }) => yes(count(dice, [6]) >= 3),
      plan: ({ lvl }) => ({ dmg: OT.mask[lvl - 1], self: ({ att }) => fx.gain(att, 'might', OT.maskMight[lvl - 1]) })
    },
    {
      id: 'night', name: 'Night Vision', space: 5, ring: true, slot: 'Night Eye', need: '2 Night Eye + 2 Stone',
      get text() { return [`${OT.night[0]} dmg. Target defends with 2 fewer dice.`, `${OT.night[1]} dmg. Target defends with 2 fewer dice.`]; },
      match: ({ dice }) => yes(count(dice, [5]) >= 2 && count(dice, [3, 4]) >= 2),
      plan: ({ lvl }) => ({ dmg: OT.night[lvl - 1], defMinus: 2 })
    },
    {
      id: 'grip', name: 'Earthen Grip', space: 6, ring: true, slot: 'Grip', need: '3 Claw + 2 Stone',
      get text() { return [`${OT.grip[0]} dmg. Target can't play Instant cards this turn.`, `${OT.grip[1]} dmg. Target can't play Instant cards this turn.`]; },
      match: ({ dice }) => yes(count(dice, [1, 2]) >= 3 && count(dice, [3, 4]) >= 2),
      plan: ({ lvl }) => ({ dmg: OT.grip[lvl - 1], hit: (ctx, t) => { t.noInstants = true; } })
    },
    {
      id: 'quake', name: 'Earthquake', space: 7, all: true, need: 'Large straight',
      get text() { return [`${OT.quake[0]} dmg to every opponent. Knockdown each.`, `${OT.quake[1]} dmg to every opponent. Knockdown each.`]; },
      match: ({ dice }) => yes(largeStraight(dice)),
      plan: ({ lvl }) => ({ dmg: OT.quake[lvl - 1], all: true, hit: (ctx, t, notes) => fx.inflict(t, 'knockdown', notes) })
    }
  ],
  ultimate: {
    id: 'nova', name: 'Nova Blast', need: '5 Pakari', all: true,
    get text() { return [`${OT.ult} dmg to every opponent, cannot be defended or reduced. You become Drained.`]; },
    match: ({ dice }) => yes(count(dice, [6]) >= 5),
    plan: () => ({ dmg: OT.ult, pure: true, all: true, self: ({ att }) => fx.gain(att, 'drained') })
  },
  defense: {
    id: 'skin', name: 'Stone Skin', dice: [4, 5],
    text: ['Roll 4. Each Stone: prevent 1. Each Pakari: prevent 2. 2+ Claw: deal 2 back.', 'Roll 5. Same effects.'],
    resolve: (dice) => ({ prevent: count(dice, [3, 4]) + count(dice, [6]) * 2, reflect: count(dice, [1, 2]) >= 2 ? 2 : 0 })
  },
  upgrades: [
    ['swipe', 'Quake Breaker II', 2], ['rockslide', 'Rockslide II', 2], ['tunnel', 'Tunnel Ambush II', 2],
    ['mask', 'Mask of Strength II', 3], ['night', 'Night Vision II', 2], ['grip', 'Earthen Grip II', 2],
    ['quake', 'Earthquake II', 3], ['skin', 'Stone Skin II', 3]
  ],
  cards: [
    { id: 'surge', name: 'Pakari Surge', cost: 2, type: 'main', text: 'Gain 2 Might.',
      play: ({ me }) => fx.gain(me, 'might', 2) },
    { id: 'miners', name: 'Onu-Matoran Miners', cost: 1, type: 'main', text: 'Draw 1 card. Gain 1 BP.',
      play: ({ me, draw }) => { draw(me, 1); fx.cp(me, 1); } },
    { id: 'whenua', name: "Turaga Whenua's Counsel", cost: 1, type: 'main', text: 'Draw 1 card. Gain 1 Might.',
      play: ({ me, draw }) => { draw(me, 1); fx.gain(me, 'might', 1); } },
    { id: 'kaita', name: 'Akamai Kaita', cost: 4, type: 'roll', roll: 'own', text: 'Set any 2 of your dice to any faces.',
      pick: [{ k: 'ownDie', label: 'First die to set' }, { k: 'face', label: 'Set it to' }, { k: 'ownDie', label: 'Second die to set' }, { k: 'face', label: 'Set it to' }],
      check: ({ dice }) => (dice[0] === dice[1] ? 'Pick two different dice.' : null),
      play: ({ setDie, dice, faces }) => { setDie(dice[0], faces[0]); setDie(dice[1], faces[1]); } },
    { id: 'lantern', name: 'Lightstone Lantern', cost: 1, type: 'roll', roll: 'own', text: 'Set one of your dice to Night Eye (5).',
      pick: [{ k: 'ownDie', label: 'Which die?' }],
      play: ({ setDie, dice }) => setDie(dice[0], 5) },
    { id: 'bohrok', name: 'Bohrok Breaker', cost: 2, type: 'instant', text: 'Prevent 4 dmg. The next attacker takes 2.',
      play: ({ me }) => { me.shield += 4; me.thorns += 2; } },
    { id: 'cavein', name: 'Cave-In', cost: 3, type: 'main', text: 'Knock Down an opponent.',
      pick: [{ k: 'target', label: 'Who gets buried?' }],
      play: ({ target, notes }) => fx.inflict(target, 'knockdown', notes) }
  ]
};

const HEROES = { aang, link, onua };

// ------------------------------------------------------------------ shared deck (18 cards)

const GENERIC = [
  { id: 'pocket', n: 2, name: 'Pocket Change', cost: 0, type: 'main', text: 'Gain 2 BP.',
    play: ({ me }) => fx.cp(me, 2) },
  { id: 'wind', n: 2, name: 'Second Wind', cost: 1, type: 'main', text: 'Draw 2 cards.',
    play: ({ me, draw }) => draw(me, 2) },
  { id: 'nudge', n: 2, name: 'Nudge', cost: 1, type: 'roll', roll: 'own', text: 'Change one of your dice by +1 or -1.',
    pick: [{ k: 'ownDie', label: 'Which die?' }, { k: 'choice', key: 'dir', label: 'Which way?', options: [{ v: 1, label: '+1' }, { v: -1, label: '-1' }] }],
    check: ({ die, dir }) => {
      if (dir !== 1 && dir !== -1) return 'Pick +1 or -1.';
      const v = die(0) + dir;
      return v < 1 || v > 6 ? 'That die can\'t go that way.' : null;
    },
    play: ({ setDie, die, dice, dir }) => setDie(dice[0], die(0) + dir) },
  { id: 'loaded', n: 2, name: 'Loaded Die', cost: 2, type: 'roll', roll: 'own', text: 'Set one of your dice to any face.',
    pick: [{ k: 'ownDie', label: 'Which die?' }, { k: 'face', label: 'Set it to' }],
    play: ({ setDie, dice, faces }) => setDie(dice[0], faces[0]) },
  { id: 'mulligan', n: 2, name: 'Mulligan', cost: 1, type: 'roll', roll: 'own', text: 'Reroll up to 2 of your dice, even after your last roll.',
    pick: [{ k: 'ownDice', max: 2, label: 'Pick up to 2 dice to reroll' }],
    play: ({ reroll, dice }) => reroll(dice) },
  { id: 'brace', n: 2, name: 'Brace', cost: 1, type: 'instant', text: 'Prevent 3 dmg from the next attack on you this turn.',
    play: ({ me }) => { me.shield += 3; } },
  { id: 'jinx', n: 1, name: 'Jinx', cost: 1, type: 'roll', roll: 'enemy', text: 'Force an opponent to reroll one of their dice.',
    pick: [{ k: 'enemyDie', label: 'Which of their dice?' }],
    play: ({ reroll, dice }) => reroll(dice) },
  { id: 'extra', n: 1, name: 'Extra Roll', cost: 2, type: 'roll', roll: 'offense', text: 'Take one more roll this turn.',
    play: ({ room }) => { room.dice.rollsLeft += 1; } },
  { id: 'copycat', n: 1, name: 'Copycat', cost: 1, type: 'roll', roll: 'own', text: 'Set one of your dice to match another of your dice.',
    pick: [{ k: 'ownDie', label: 'Die to change' }, { k: 'ownDie', label: 'Copy which die?' }],
    check: ({ dice }) => (dice[0] === dice[1] ? 'Pick two different dice.' : null),
    play: ({ setDie, die, dice }) => setDie(dice[0], die(1)) },
  { id: 'cheap', n: 1, name: 'Cheap Shot', cost: 3, type: 'roll', roll: 'offense', text: 'Your attack this turn cannot be defended (not Ultimates).',
    play: ({ room }) => { room.turnFlags.cheapShot = true; } },
  { id: 'shake', n: 1, name: 'Shake It Off', cost: 1, type: 'instant', text: 'Remove Burn, Knockdown, Frozen or Hammer Lock from yourself.',
    check: ({ me }) => (me.status.burn || me.status.knockdown || me.status.frozen || fx.has(me, 'hammerLock') ? null : 'Nothing to shake off.'),
    play: ({ me }) => {
      if (me.status.burn) me.status.burn = 0;
      else if (me.status.knockdown) me.status.knockdown = false;
      else if (me.status.frozen) me.status.frozen = false;
      else fx.drop(me, 'hammerLock');
    } },
  { id: 'patch', n: 1, name: 'Patch Up', cost: 2, type: 'instant', text: 'Heal 4.',
    play: ({ me }) => fx.heal(me, 4) }
];

// Hookshot: take the most valuable token. Fairy and Biggoron's Sword come with it.
// Only Aang's Mastery tokens can't be taken. Air Scooter can, before Aang uses it.
const STEAL_ORDER = ['avatarState', 'fairy', 'biggoron', 'burrowed', 'airScooter', 'might'];
function stealToken(att, t, notes) {
  const tok = STEAL_ORDER.find((k) => fx.has(t, k));
  if (!tok) { notes.push(`${t.name} had no token to take`); return; }
  t.tokens[tok] -= 1;
  if (t.tokens[tok] <= 0) delete t.tokens[tok];
  if (tok === 'fairy' || tok === 'biggoron') fx.gain(att, tok);
  notes.push(`${att.name} hooks ${TOKENS[tok].name} from ${t.name}`);
}

// ------------------------------------------------------------------ card catalog

// Every card by id: generic, upgrades and hero cards.
const CARDS = {};
GENERIC.forEach((c) => { CARDS[c.id] = { ...c, hero: null }; });
Object.values(HEROES).forEach((h) => {
  h.cards.forEach((c) => { CARDS[h.id + ':' + c.id] = { ...c, id: h.id + ':' + c.id, hero: h.id }; });
  h.upgrades.forEach(([ability, name, cost]) => {
    const target = h.abilities.find((a) => a.id === ability) || h.defense;
    CARDS[h.id + ':up:' + ability] = {
      id: h.id + ':up:' + ability, hero: h.id, name, cost, type: 'upgrade', ability,
      text: 'Upgrade ' + target.name + ': ' + (target.text[1] || '')
    };
  });
});

function deckFor(heroId) {
  const ids = [];
  GENERIC.forEach((c) => { for (let i = 0; i < c.n; i++) ids.push(c.id); });
  const h = HEROES[heroId];
  h.upgrades.forEach(([ability]) => ids.push(h.id + ':up:' + ability));
  h.cards.forEach((c) => ids.push(h.id + ':' + c.id));
  return ids; // 18 + 8 + 7 = 33
}

// Dice chips shown on each board card (the dice you need).
const CHIPS = {
  aang: { whip: ['3', '3', '3'], scooter: ['1-2', '1-2', '1-2', '1-2'], flash: ['SM'], fists: ['6', '6', '6', '6'], avalanche: ['4', '4', '4'], dragon: ['5', '5', '5'], combust: ['LG'], energy: ['6', '6', '6', '6', '6'] },
  link: { slash: ['2-3', '2-3', '2-3'], hookshot: ['6', '6', '6', '6'], boomerang: ['SM'], spin: ['1', '1', '6', '6'], hammer: ['4-5', '4-5', '4-5', '4-5'], bombs: ['FH'], bow: ['LG'], triforce: ['6', '6', '6', '6', '6'] },
  onua: { swipe: ['1-2', '1-2', '1-2'], rockslide: ['3-4', '3-4', '3-4'], tunnel: ['SM'], mask: ['6', '6', '6'], night: ['5', '5', '3-4', '3-4'], grip: ['1-2', '1-2', '1-2', '3-4', '3-4'], quake: ['LG'], nova: ['6', '6', '6', '6', '6'] }
};

const TOKEN_SLOTS = {
  aang: ['masteryWater', 'masteryAir', 'masteryEarth', 'masteryFire', 'airScooter', 'avatarState'],
  link: ['biggoron', 'fairy', 'hammerLock'],
  onua: ['might', 'burrowed', 'drained']
};

// What phones and TVs need to draw hero boards. No functions.
function catalog() {
  const out = {};
  for (const h of Object.values(HEROES)) {
    out[h.id] = {
      id: h.id, name: h.name, title: h.title, color: h.color, accent: h.accent, blurb: h.blurb,
      art: '/smash/art/' + h.id + '-center.jpg',
      tokenSlots: TOKEN_SLOTS[h.id] || [],
      faces: h.faces, symbols: h.symbols, wildNote: h.wildNote || null,
      abilities: h.abilities.map((a) => ({ id: a.id, chips: (CHIPS[h.id] || {})[a.id] || [], name: a.name, art: '/smash/art/' + h.id + '-' + a.id + '.jpg', space: a.space, ring: !!a.ring, slot: a.slot || null, need: a.need, text: a.text, options: a.options || null, all: !!a.all })),
      ultimate: { id: h.ultimate.id, chips: (CHIPS[h.id] || {})[h.ultimate.id] || [], name: h.ultimate.name, need: h.ultimate.need, text: h.ultimate.text, all: !!h.ultimate.all },
      defense: { id: h.defense.id, dice: h.defense.dice, name: h.defense.name, text: h.defense.text }
    };
  }
  return out;
}

const TOKEN_INFO = Object.fromEntries(Object.entries(TOKENS).map(([k, v]) => [k, { name: v.name, color: v.color, text: v.text, max: v.max }]));

module.exports = { LT, OT, HEROES, GENERIC, CARDS, TOKENS, TOKEN_INFO, MASTERY, MAX_CP, fx, deckFor, catalog, count, smallStraight, largeStraight, fullHouse };
