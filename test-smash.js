// Run with: node test-smash.js
const S = require('./smash-rules');
const H = require('./smash-heroes');
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label +
    (ok ? '' : `\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
}
// Dice that always roll the given faces, in order, then repeat.
const dice = (...faces) => { let i = 0; return () => (faces[i++ % faces.length] - 1) / 6 + 0.01; };
const { active, fighterById } = S._internal;

console.log('\nDecks');
for (const h of Object.keys(H.HEROES)) check(`${h} deck has 33 cards`, H.deckFor(h).length, 33);
check('every card in every deck exists', Object.keys(H.HEROES).every((h) => H.deckFor(h).every((c) => H.CARDS[c])), true);

console.log('\nLobby');
const { room } = S.create('t-micah', 'Micah', 's1');
const code = room.code;
S.join(code, 't-dawn', 'Dawn', 's2');
check('only host adds bots', S.addBot(code, 't-dawn').error, 'Only the host can add a bot.');
check('bad hero refused', S.pickHero(code, 't-micah', 'mario').error, 'Pick one of the heroes shown.');
S.pickHero(code, 't-micah', 'aang');
S.pickHero(code, 't-dawn', 'link');
check('no secrets in the shared view', JSON.stringify(S.publicState(room)).includes('t-micah'), false);

console.log('\nStart');
S.setRng(() => 0.01); // Micah goes first
S.start(code, 't-micah', 1000);
let s = S.publicState(room);
check('fight is on', s.phase, 'play');
check('two fighters at 50', s.fighters.map((f) => f.hp), [50, 50]);
check('Micah is first', s.activeId, s.players[0].id);
check('first player skips income: 4 cards, 2 CP', [s.fighters[0].cards, s.fighters[0].cp], [4, 2]);
check('Dawn cannot roll on Micah\'s turn', S.toRoll(code, 't-dawn').error, 'It is not your turn.');

console.log('\nAang rolls');
S.toRoll(code, 't-micah', 1000);
S.setRng(dice(4, 6, 6, 3, 1));
S.roll(code, 't-micah', 1000);
check('dice show', room.dice.values, [4, 6, 6, 3, 1]);
check('Avatar is wild: 1 Earth + 2 Avatar = Rock Avalanche (and Water)', S.qualifying(room).map((q) => q.id).sort(), ['avalanche', 'whip']);
check('Air Scooter needs 4 Air', S.qualifying(room).some((q) => q.id === 'scooter'), false);
const dawnF = fighterById(room, s.fighters[1].id);
S.attack(code, 't-micah', { ability: 'avalanche' }, 1000);
check('Link defends', room.step, 'defend');
S.setRng(dice(4, 5, 2, 6)); // 2 shields (4) + triforce (1) = 5 prevented
S.defRoll(code, 't-dawn', 1000);
S.defAccept(code, 't-dawn', 1000);
const micahF = fighterById(room, s.fighters[0].id);
check('Rock Avalanche: 8 dmg - 5 blocked = 3', dawnF.hp, 47);
check('Link is Knocked Down, Aang earns Earth Mastery', [dawnF.status.knockdown, micahF.tokens.masteryEarth], [true, 1]);
check('now main phase 2', room.step, 'main2');

console.log('\nCards');
micahF.hand = ['pocket', 'wind', 'aang:up:avalanche', 'loaded', 'brace', 'patch', 'jinx'];
micahF.cp = 5;
check('Loaded Die only while dice are live', S.play(code, 't-micah', 3, { dice: [0], faces: [6] }).error, 'Only while your dice are showing.');
S.play(code, 't-micah', 0, {});
check('Pocket Change gives 2 CP', micahF.cp, 7);
S.play(code, 't-micah', 1, {}); // upgrade card is now index 1
check('Upgrade sets level 2', micahF.upgrades.avalanche, 2);
while (micahF.hand.length > 6) S.sell(code, 't-micah', 0);
const dawnHand = dawnF.hand.length;
S.endTurn(code, 't-micah', 2000);
check('income: Dawn gains 1 CP and refills to 4 cards', [active(room).name, dawnF.cp, dawnF.hand.length], ['Dawn', 3, Math.max(4, dawnHand)]);

console.log('\nAir Scooter token, Brace and Avatar State');
S.toRoll(code, 't-dawn', 2000);
S.setRng(dice(2, 2, 3, 3, 2));
S.roll(code, 't-dawn', 2000);
micahF.tokens.avatarState = 1;
micahF.tokens.airScooter = 2;
S.attack(code, 't-dawn', { ability: 'slash' }, 2000);
const brace = micahF.hand.indexOf('brace');
if (brace >= 0) S.play(code, 't-micah', brace, {});
S.setRng(dice(3)); // Sidestep: Water only → heal 1 each, no prevent
S.defRoll(code, 't-micah', 2000);
S.defAccept(code, 't-micah', 2000);
const hit = Math.max(0, 6 - 2 - 2 - (brace >= 0 ? 3 : 0));
check('Slash 6 - 2 Air Scooter - 2 Avatar State - Brace, then heal 4', micahF.hp, Math.min(50, 50 - hit + 4));
check('one Air Scooter token used', micahF.tokens.airScooter, 1);

console.log('\nWater Whip');
S.endTurn(code, 't-dawn', 3000);
S.toRoll(code, 't-micah', 3000);
S.setRng(dice(3, 3, 3, 1, 1));
S.roll(code, 't-micah', 3000);
S.setRng(dice(3, 6, 1)); // whip roll: one 3 (3 dmg), one 6 (heal 2)
micahF.hp = 40;
S.attack(code, 't-micah', { ability: 'whip' }, 3000);
check('Water Whip rolled one 3: 3 dmg + 5 Avatar State', room.pending.plan.dmg, 8);
S.setRng(dice(1)); S.defRoll(code, 't-dawn', 3000); S.defAccept(code, 't-dawn', 3000);
check('...and healed Aang 2', micahF.hp, 42);
check('Water Mastery earned', micahF.tokens.masteryWater, 1);

console.log('\nEnergybending');
S.endTurn(code, 't-micah', 4000);
S.endTurn(code, 't-dawn', 4000);
['masteryAir', 'masteryWater', 'masteryEarth', 'masteryFire'].forEach((m) => { micahF.tokens[m] = 1; });
delete micahF.tokens.avatarState;
S.toRoll(code, 't-micah', 4000);
S.setRng(dice(6));
S.roll(code, 't-micah', 4000);
check('5 Avatar + all Mastery unlocks the Ultimate', S.qualifying(room).some((q) => q.id === 'energy'), true);
const before = dawnF.hp;
S.attack(code, 't-micah', { ability: 'energy' }, 4000);
check('Ultimate skips defense: 13 dmg', dawnF.hp, before - 13);
check('Aang gains Avatar State and uses his Mastery', [micahF.tokens.avatarState, micahF.tokens.masteryFire], [1, undefined]);

console.log('\nBots');
const b = S.create('t-solo', 'Solo', 'x').room;
S.pickHero(b.code, 't-solo', 'onua');
check('host adds a bot', S.addBot(b.code, 't-solo', 'link').room.bots.length, 1);
S.setRng(Math.random);
S.start(b.code, 't-solo', 0);
let t = 0, guard = 0;
// Solo player simply ends every turn; the bot plays for real.
while (b.phase === 'play' && guard++ < 5000) {
  t += 2000;
  const f = active(b);
  if (!f.bot && b.step === 'main1') { while (f.hand.length > 6) S.sell(b.code, 't-solo', 0); S.endTurn(b.code, 't-solo', t); }
  else if (b.step === 'defend' && !fighterById(b, b.pending.defenderId).bot) {
    if (!b.dice.rolled) S.defRoll(b.code, 't-solo', t); else S.defAccept(b.code, 't-solo', t);
  } else S.tick(b, t);
}
check('a bot game reaches a winner', b.phase, 'finished');
console.log('          (' + guard + ' steps, turn ' + b.turnNo + ')');
check('the bot won against a player who never attacks', fighterById(b, b.winnerId).bot, true);
check('host can rematch', S.rematch(b.code, 't-solo').room.phase, 'lobby');

console.log('\nAway phone');
const a = S.create('t-a', 'A', 'x').room;
S.addBot(a.code, 't-a', 'aang');
S.setRng(() => 0.01);
S.start(a.code, 't-a', 0);
S.markAway(a.code, 't-a');
check('no skip before 15 s', S.tick(a, 10000), false);
check('turn passes after 15 s', S.tick(a, 16000), true);
check('bot is up', active(a).bot, true);

console.log('\nPick your own code');
check('host picks NAIL', S.create('t-n', 'N', 'x', 'nail').room.code, 'NAIL');
check('NAIL can be joined', !!S.join('NAIL', 't-n2', 'M', 'x').player, true);
check('a taken code is refused', S.create('t-n3', 'O', 'x', 'NAIL').error, 'The code NAIL is already in use. Pick another, or leave it blank.');
check('wrong length is refused', S.create('t-n4', 'O', 'x', 'ab').error, 'Your own code needs exactly 4 letters, or leave it blank for a random one.');
check('blank gives a random code', S.create('t-n5', 'O', 'x', '').room.code.length, 4);

console.log('\nFull room');
const big = S.create('h', 'Host', 'x').room;
for (let i = 0; i < 3; i++) S.join(big.code, 'b' + i, 'P' + i, 'x');
check('fifth fighter refused', S.join(big.code, 'b9', 'X', 'x').error, 'That game is full. Four fighters is the limit.');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
