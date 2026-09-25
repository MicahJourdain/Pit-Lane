// Run with: node test-game.js
const G = require('./game');
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label +
    (ok ? '' : `\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
}
// Dice that always roll the given numbers, in order.
const dice = (...faces) => { let i = 0; return () => (faces[i++ % faces.length] - 1) / 6 + 0.01; };

console.log('\nLobby');
const { room } = G.create('t-micah', 'Micah', 's1');
const code = room.code;
G.join(code, 't-dawn', 'Dawn', 's2');
G.join(code, 't-jack', 'Jack', 's3');
let s = G.publicState(room);
check('three on the grid in join order', s.players.map((p) => p.name), ['Micah', 'Dawn', 'Jack']);
check('each gets a different color', new Set(s.players.map((p) => p.color)).size, 3);
check('no secrets in the shared view', JSON.stringify(s).includes('t-micah'), false);
check('wrong code is refused clearly', G.join('ZZZZ', 'x', 'X', 's').error, 'No game with that code. Check the code on the TV.');
check('only the host can start', G.start(code, 't-dawn').error, 'Only the host can start the race.');

console.log('\nRace');
G.start(code, 't-micah', () => 0.1);
s = G.publicState(room);
check('race is running', s.phase, 'race');
check('Micah rolls first', s.turnId, s.players[0].id);
check('everyone holds 3 cards', s.players.map((p) => p.cards), [3, 3, 3]);
check('a phone sees its own hand', G.privateState(room, 't-dawn').hand.length, 3);
check('out of turn is refused', G.takeTurn(code, 't-dawn', null).error, 'It is not your turn yet.');

G.takeTurn(code, 't-micah', null, dice(3));
check('plain roll moves 3', G.publicState(room).players[0].pos, 3);
check('turn passes to Dawn', G.publicState(room).turnId, G.publicState(room).players[1].id);

room.players.get('t-dawn').hand = ['nitro', 'draft', 'bump'];
G.takeTurn(code, 't-dawn', 0, dice(1));
check('Nitro adds 3 to a roll of 1, lands on the 4', G.publicState(room).players[1].pos, 4);
check('the played card is gone', G.privateState(room, 't-dawn').hand.map((c) => c.id), ['draft', 'bump']);

G.takeTurn(code, 't-jack', null, dice(5));
check('landing on the boost pad at 5 jumps to 8', G.publicState(room).players[2].pos, 8);

room.players.get('t-micah').hand = ['bump'];
G.takeTurn(code, 't-micah', 0, dice(2));
check('Bump drops the leader (Jack) back 2', G.publicState(room).players[2].pos, 6);
check('Micah still moves his roll', G.publicState(room).players[0].pos, 5 + 3);

console.log('\nFinish');
room.players.get('t-dawn').pos = 28;
G.takeTurn(code, 't-dawn', null, dice(6));
s = G.publicState(room);
check('passing 30 wins', [s.phase, s.winnerId], ['finished', s.players[1].id]);
check('host can race again', G.start(code, 't-micah', () => 0.1).room.phase, 'race');
check('positions reset', G.publicState(room).players.map((p) => p.pos), [0, 0, 0]);

console.log('\nPhones that go quiet');
G.markAway(code, 't-micah');
check('away phone keeps its seat', G.publicState(room).players.length, 3);
check('no skip before 15 seconds', G.skipIfAway(room, room.turnStartedAt + 5000), false);
check('skip after 15 seconds', G.skipIfAway(room, room.turnStartedAt + 16000), true);
check('Dawn is up after the skip', G.publicState(room).turnId, G.publicState(room).players[1].id);
G.join(code, 't-micah', 'Micah', 's9');
check('Micah comes back to the same seat', G.publicState(room).players.map((p) => p.name), ['Micah', 'Dawn', 'Jack']);

console.log('\nLeaving mid-race');
G.leave(code, 't-dawn');
s = G.publicState(room);
check('Dawn is gone', s.players.map((p) => p.name), ['Micah', 'Jack']);
check('turn moves to Jack', s.turnId, s.players[1].id);
G.leave(code, 't-micah');
check('host passes to Jack', G.publicState(room).players[0].isHost, true);

console.log('\nLate joiner');
G.join(code, 't-late', 'Late', 's10');
s = G.publicState(room);
check('joins the room but sits out this race', s.players.find((p) => p.name === 'Late').inRace, false);

console.log('\nFull room');
const big = G.create('h', 'Host', 'x').room;
for (let i = 0; i < 7; i++) G.join(big.code, 'b' + i, 'D' + i, 'x');
check('ninth driver is refused', G.join(big.code, 'b9', 'X', 'x').error, 'That game is full. Eight drivers is the limit.');
check('a returning driver still gets in', !!G.join(big.code, 'b3', 'D3', 'y').player, true);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
