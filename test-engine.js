// ============================================================
// Rules check for engine.js — run with:  node test-engine.js [games]
// Hand-made situations for each card (normal and flex side) and each Power Card rule, then
// thousands of full bot games that check the game always ends, no card is lost or copied,
// and every state can be saved to Firestore.
// ============================================================
const E = require('./engine.js');
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ ' + msg); } };
const P = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));

// Build a round, then set hands / table by hand. A card is written as
//   ['red','5'] classic · ['red','5','flip'] with the flip icon · ['red','5','blue'] flex (flex colour blue)
//   ['wild','wild4'] wild (flex wilds get flex:true automatically)
function setup(n, hands, top, opts = {}) {
  const st = E.newRound(P(n));
  let id = 1000;
  const mk = a => {
    const c = { id: id++, c: a[0], v: a[1] };
    if (a[2] === 'flip') c.flip = true;
    else if (a[2]) { c.c2 = a[2]; c.flex = true; }
    if (a[0] === 'wild' && a[1] !== 'wildFlip') c.flex = true;
    return c;
  };
  const filler = () => [['blue', '8'], ['blue', '7']];
  st.hands = {};
  st.players.forEach((p, i) => { st.hands[p.id] = (hands[i] || filler()).map(mk); });
  st.players = st.players.map(p => ({ ...p, cardCount: st.hands[p.id].length }));
  st.discard = [mk(top)];
  st.topColor = st.discard[0].c; st.topValue = st.discard[0].v;
  st.drawPile = Array.from({ length: 40 }, (_, i) => mk(['green', String(1 + i % 8)]));
  if (opts.power) st.power = { ...st.power, ...opts.power };
  return st;
}
const R = ['red', '5'];

console.log('Hand-made situations');
{ // Draw Two: next draws 2 and loses the turn · flex side: everyone else draws 1, next still plays
  let st = setup(4, [[['red', 'draw2', 'blue'], R]], R);
  let r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.hands.p1.length === 4 && r.state.currentPlayerIndex === 2, 'draw two');
  r = E.apply(st, { t: 'play', i: 0, flex: true }, 'p0');
  ok(r.state.hands.p1.length === 3 && r.state.hands.p3.length === 3 && r.state.currentPlayerIndex === 1, 'flex draw two: all +1, next plays');
  ok(r.state.power.p0 === false, 'flex side turns the Power Card red');
}
{ // Skip · flex: skip all
  let st = setup(4, [[['red', 'skip', 'green'], R]], R);
  ok(E.apply(st, { t: 'play', i: 0 }, 'p0').state.currentPlayerIndex === 2, 'skip');
  ok(E.apply(st, { t: 'play', i: 0, flex: true }, 'p0').state.currentPlayerIndex === 0, 'flex skip = skip all');
}
{ // Reverse · flex: reverse then skip · two players
  let st = setup(4, [[['red', 'reverse', 'green'], R]], R);
  let r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.currentPlayerIndex === 3 && r.state.direction === -1, 'reverse');
  r = E.apply(st, { t: 'play', i: 0, flex: true }, 'p0');
  ok(r.state.currentPlayerIndex === 2 && r.state.direction === -1, 'flex reverse: reverse then skip');
  st = setup(2, [[['red', 'reverse'], R]], R);
  ok(E.apply(st, { t: 'play', i: 0 }, 'p0').state.currentPlayerIndex === 0, 'reverse with 2 = skip');
}
{ // Flex number card: flex colour matches only with a green Power Card; the NORMAL colour carries on
  const st = setup(3, [[['yellow', '4', 'red'], R]], ['red', '2']);
  ok(E.apply(st, { t: 'play', i: 0 }, 'p0').error === 'cantPlay', 'normal side does not match');
  const r = E.apply(st, { t: 'play', i: 0, flex: true }, 'p0');
  ok(r.state.topColor === 'yellow' && r.state.power.p0 === false, 'flex side played, yellow carries on, power red');
  const st2 = setup(3, [[['yellow', '4', 'red'], R]], ['red', '2'], { power: { p0: false } });
  ok(E.apply(st2, { t: 'play', i: 0, flex: true }, 'p0').error === 'noPower', 'red Power Card: no flex');
  ok(E.legalPlays(st2, 'p0').length === 1, 'and it is not a legal card then');
}
{ // Flip icon: your own Power Card switches over (red → green and green → red)
  let st = setup(3, [[['red', '6', 'flip'], R]], R, { power: { p0: false } });
  ok(E.apply(st, { t: 'play', i: 0 }, 'p0').state.power.p0 === true, 'flip card: red → green');
  st = setup(3, [[['red', '6', 'flip'], R]], R);
  ok(E.apply(st, { t: 'play', i: 0 }, 'p0').state.power.p0 === false, 'flip card: green → red');
}
{ // Wild All Flip: everybody's card switches over
  const st = setup(3, [[['wild', 'wildFlip'], R]], R, { power: { p1: false } });
  ok(E.apply(st, { t: 'play', i: 0 }, 'p0').error === 'needColor', 'wild needs a colour');
  const r = E.apply(st, { t: 'play', i: 0, color: 'blue' }, 'p0');
  ok(r.state.power.p0 === false && r.state.power.p1 === true && r.state.power.p2 === false && r.state.topColor === 'blue', 'all flip');
}
{ // Everyone red at once → everyone green
  const st = setup(3, [[['yellow', '4', 'red'], R]], ['red', '2'], { power: { p1: false, p2: false } });
  const r = E.apply(st, { t: 'play', i: 0, flex: true }, 'p0');
  ok(r.state.power.p0 && r.state.power.p1 && r.state.power.p2, 'all red → all green');
}
{ // Flex wilds: normal side is a plain wild; flex sides draw
  let st = setup(4, [[['wild', 'wildAllDraw'], R]], R);
  let r = E.apply(st, { t: 'play', i: 0, color: 'green' }, 'p0');
  ok(r.state.hands.p1.length === 2 && r.state.currentPlayerIndex === 1, 'all draw, normal side = wild');
  r = E.apply(st, { t: 'play', i: 0, color: 'green', flex: true }, 'p0');
  ok(r.state.hands.p1.length === 4 && r.state.hands.p3.length === 4 && r.state.currentPlayerIndex === 1, 'all draw flex: others +2, next plays');
  st = setup(4, [[['wild', 'wildTarget2'], R]], R);
  ok(E.apply(st, { t: 'play', i: 0, color: 'green', flex: true }, 'p0').error === 'badTarget', 'target needed');
  r = E.apply(st, { t: 'play', i: 0, color: 'green', flex: true, target: 'p2' }, 'p0');
  ok(r.state.hands.p2.length === 4 && r.state.currentPlayerIndex === 1, 'target draw 2');
  st = setup(4, [[['wild', 'wild4'], R]], R);
  r = E.apply(st, { t: 'play', i: 0, color: 'green', flex: true, target: 'p1' }, 'p0');
  ok(r.state.hands.p1.length === 6 && r.state.currentPlayerIndex === 1 && !r.state.phase, 'flex wild draw four: target +4, no challenge, next still plays');
}
{ // Wild Draw Four normal side: fair, challenged → challenger draws 6 and loses the turn
  const st = setup(3, [[['wild', 'wild4'], ['blue', '1']], [['blue', '3']], [['green', '1']]], R);
  let r = E.apply(st, { t: 'play', i: 0, color: 'blue' }, 'p0');
  ok(r.state.phase?.k === 'challenge' && r.state.phase.guilty === false, 'fair wild draw four');
  ok(E.apply(r.state, { t: 'draw' }, 'p1').error, 'nobody plays while the challenge is open');
  r = E.apply(r.state, { t: 'challenge' }, 'p1');
  ok(r.state.hands.p1.length === 7 && r.state.currentPlayerIndex === 2, 'lost challenge: +6, skipped');
}
{ // …bluff: holding a wild counts as having the colour → bluffer draws 4, challenger draws none and plays
  const st = setup(3, [[['wild', 'wild4'], ['wild', 'wildFlip']], [['red', '3']], [['red', '1']]], R);
  let r = E.apply(st, { t: 'play', i: 0, color: 'blue' }, 'p0');
  ok(r.state.phase.guilty === true, 'a wild in hand makes it unfair');
  r = E.apply(r.state, { t: 'challenge' }, 'p1');
  ok(r.state.hands.p0.length === 5 && r.state.hands.p1.length === 1 && r.state.currentPlayerIndex === 1, 'caught: bluffer +4');
  ok(r.state.topColor === 'blue', 'the colour named stays');
}
{ // …accepted → +4 and lose the turn
  const st = setup(3, [[['wild', 'wild4'], ['blue', '1']]], R);
  let r = E.apply(st, { t: 'play', i: 0, color: 'blue' }, 'p0');
  r = E.apply(r.state, { t: 'accept' }, 'p1');
  ok(r.state.hands.p1.length === 6 && r.state.currentPlayerIndex === 2, 'accepted');
}
{ // Last card: shout or be caught
  const st = setup(3, [[R, ['red', '7']]], R);
  const r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.uno?.pid === 'p0', 'one card → must shout');
  ok(E.apply(r.state, { t: 'catch' }, 'p2').state.hands.p0.length === 3, 'caught → +2');
  const safe = E.apply(r.state, { t: 'shout' }, 'p0');
  ok(!safe.state.uno && E.apply(safe.state, { t: 'catch' }, 'p2').error, 'shouted → safe');
}
{ // Drawing: you may draw even with a playable card; a drawn card that fits may be played
  const st = setup(3, [[['red', '1']]], R);
  st.drawPile[0] = { id: 1, c: 'green', v: '2' };
  let r = E.apply(st, { t: 'draw' }, 'p0');
  ok(r.state.currentPlayerIndex === 1 && !r.state.drawn, 'unplayable draw passes (even with a playable card in hand)');
  const st2 = setup(3, [[['blue', '1']]], R);
  st2.drawPile[0] = { id: 1, c: 'red', v: '2' };
  r = E.apply(st2, { t: 'draw' }, 'p0');
  ok(r.state.drawn && E.apply(r.state, { t: 'play', i: 0 }, 'p0').error === 'onlyDrawn' && E.apply(r.state, { t: 'play', i: 1 }, 'p0').state, 'drawn card playable');
}
{ // Scoring: numbers face value, actions 20, wilds 50
  const st = setup(2, [[R], [['red', 'skip'], ['wild', 'wildFlip'], ['red', '3', 'blue'], ['blue', 'draw2', 'red']]], R);
  const r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.status === 'ended' && r.state.roundPoints === 93, 'score 20+50+3+20');
}
{ // Timeout only counts once
  const st = setup(3, [], R);
  const r = E.apply(st, { t: 'timeout', seq: st.seq }, 'sys');
  ok(r.state && r.state.currentPlayerIndex !== 0, 'timeout moves on');
  ok(E.apply(r.state, { t: 'timeout', seq: st.seq }, 'sys').error === 'stale', 'stale timeout ignored');
}
{ // The deck
  const d = E.createDeck();
  ok(d.length === 104 && new Set(d.map(c => c.id)).size === 104, '104 unique cards');
  ok(d.filter(c => c.flex && c.c !== 'wild').length === 44 && d.filter(c => c.c === 'wild').length === 16 && d.filter(c => c.flip).length === 8, 'deck makeup');
  ok(!d.some(c => c.v === '0' || c.v === '9'), 'numbers are 1–8');
}
{ // Joining and leaving mid-round keeps every card
  let st = E.newRound(P(4));
  ok(['1','2','3','4','5','6','7','8'].includes(st.topValue), 'first table card is a number');
  st = E.addPlayer(st, { id: 'late', name: 'Late' });
  ok(st.hands.late.length === 7 && st.power.late === true, 'late joiner gets 7 and a green Power Card');
  st.currentPlayerIndex = 2;
  st = E.removePlayer(st, 'p2');
  ok(st.players[st.currentPlayerIndex].id === 'p3', 'turn passes on when the current player leaves');
  ok([...st.drawPile, ...st.discard, ...Object.values(st.hands).flat()].length === 104, 'no cards lost when leaving');
  st = E.removePlayer(E.removePlayer(E.removePlayer(st, 'p0'), 'p1'), 'p3');
  ok(st.status === 'ended' && st.winner === 'late', 'last one left wins');
}

// ---------- Many full bot games ----------
const PERSONAS = ['attacker', 'flexer', 'saver', 'bluffer', 'balanced'];
function nested(v) {   // Firestore forbids arrays directly inside arrays, and undefined
  if (Array.isArray(v)) return v.some(x => Array.isArray(x) || nested(x));
  if (v && typeof v === 'object') return Object.values(v).some(x => nested(x));
  return v === undefined;
}
let games = 0, moves = 0, flexes = 0, resets = 0, longest = 0;
const N = Number(process.argv[2] || 3000);
for (let g = 0; g < N; g++) {
  const n = 2 + (g % 7);   // 2–8 players
  let st = E.newRound(P(n), { matchTarget: g % 3 ? 0 : 500 });
  let steps = 0;
  while (st.status === 'playing' && steps < 4000) {
    steps++;
    if (Math.random() < 0.002 && n > 2) {
      const p = st.players[Math.floor(Math.random() * st.players.length)];
      if (!p.disconnected && st.players.filter(x => !x.disconnected).length > 2) {
        st = { ...st, players: st.players.map(x => x.id === p.id ? { ...x, disconnected: true } : x) };
      }
    }
    if (Math.random() < 0.003 && st.players.length > 2) st = E.removePlayer(st, st.players[Math.floor(Math.random() * st.players.length)].id);
    else if (Math.random() < 0.002 && st.players.length < 8) st = E.addPlayer(st, { id: 'j' + steps, name: 'J' + steps });
    if (st.status !== 'playing') break;
    if (st.uno && Math.random() < 0.5) {
      const r = Math.random() < 0.6 ? E.apply(st, { t: 'shout' }, st.uno.pid)
        : E.apply(st, { t: 'catch' }, st.players.find(p => p.id !== st.uno.pid).id);
      if (r.state) st = r.state;
    }
    const actor = st.phase?.k === 'challenge' ? st.phase.target : st.players[st.currentPlayerIndex].id;
    let move;
    if (st.players.find(p => p.id === actor)?.disconnected) move = { t: 'timeout', seq: st.seq };
    else move = E.botMove(st, actor, PERSONAS[g % 5], { fair: g % 2 === 0, challenge: 0.5, random: g % 4 === 0 ? 0.3 : 0 });
    if (!move) { ok(false, 'bot found no move'); break; }
    const r = E.apply(st, move, actor);
    if (r.error) { ok(false, `move error ${r.error} ${JSON.stringify(move)} phase=${JSON.stringify(st.phase)}`); break; }
    st = r.state;
    moves++;
    for (const e of st.ev.list) { if (e.t === 'play' && e.flex) flexes++; if (e.t === 'powerReset') resets++; }
    const all = [...st.drawPile, ...st.discard, ...Object.values(st.hands).flat()];
    if (all.length !== 104 || new Set(all.map(c => c.id)).size !== 104) { ok(false, `card count ${all.length}`); break; }
    if (st.players.some(p => p.cardCount !== st.hands[p.id].length)) { ok(false, 'cardCount out of sync'); break; }
    if (st.players.some(p => typeof st.power[p.id] !== 'boolean')) { ok(false, 'a player has no Power Card'); break; }
    if (st.status === 'playing' && st.players.every(p => !st.power[p.id])) { ok(false, 'everyone red after a move'); break; }
    if (st.phase === undefined || nested(st)) { ok(false, 'not saveable to Firestore'); break; }
  }
  if (st.status !== 'ended') ok(false, `game ${g} did not end (${steps} steps, ${n} players)`);
  longest = Math.max(longest, steps);
  games++;
}
console.log(`${games} bot games, ${moves} moves, ${flexes} flex plays, ${resets} all-red resets, longest ${longest} moves`);
console.log(fails ? `${fails} FAILED` : 'All good ✓');
process.exit(fails ? 1 : 0);
