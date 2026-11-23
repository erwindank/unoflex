// ============================================================
// Rules check for engine.js — run with:  node test-engine.js [games]
// Hand-made situations for each card and power, then thousands of full bot games that
// check the game always ends, no card is lost or copied, and every state can be saved
// to Firestore.
// ============================================================
const E = require('./engine.js');
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ ' + msg); } };
const P = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));

// Build a round, then set hands / table by hand.
// A card is written as ['red','5'] (plain), ['red','5','blue','rain'] (chameleon) or ['wild','wild4'].
function setup(n, hands, top, opts = {}) {
  const st = E.newRound(P(n));
  let id = 1000;
  const mk = a => (a[2] ? { id: id++, c: a[0], v: a[1], c2: a[2], pw: a[3] } : { id: id++, c: a[0], v: a[1] });
  const filler = () => [['blue', '9'], ['blue', '8']];
  st.hands = {};
  st.players.forEach((p, i) => { st.hands[p.id] = (hands[i] || filler()).map(mk); });
  st.players = st.players.map(p => ({ ...p, cardCount: st.hands[p.id].length }));
  st.discard = [mk(top)];
  st.topColor = st.discard[0].c; st.topValue = st.discard[0].v;
  st.drawPile = Array.from({ length: 40 }, (_, i) => mk(['green', String(1 + i % 9)]));
  if (opts.power) st.power = { ...st.power, ...opts.power };
  return st;
}
const R = ['red', '5'];
const idOf = (st, pid, k) => st.hands[pid][k].id;

console.log('Hand-made situations');
{ // +2: next draws 2, is skipped, and their power recharges
  const st = setup(3, [[['red', 'draw2'], R]], R, { power: { p1: false } });
  const r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state && r.state.hands.p1.length === 4 && r.state.currentPlayerIndex === 2, '+2 draws two and skips');
  ok(r.state.power.p1 === true, '+2 recharges the victim\'s token');
}
{ // Skip and Reverse
  let st = setup(3, [[['red', 'skip'], R]], R);
  let r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.currentPlayerIndex === 2, 'skip');
  st = setup(2, [[['red', 'reverse'], R]], R);
  r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.currentPlayerIndex === 0 && r.state.direction === -1, 'reverse with 2 = skip');
  st = setup(4, [[['red', 'reverse'], R]], R);
  r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.currentPlayerIndex === 3, 'reverse with 4 goes the other way');
}
{ // Chameleon card: plays on either colour, and you choose the colour it becomes
  const st = setup(3, [[['blue', '7', 'red', 'rain'], R]], ['red', '2']);
  ok(E.isPlayable(st.hands.p0[0], st), 'chameleon plays on its second colour');
  let r = E.apply(st, { t: 'play', i: 0, color: 'blue' }, 'p0');
  ok(r.state.topColor === 'blue' && r.state.topValue === '7', 'chameleon turned blue');
  r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.topColor === 'red', 'no colour given → the matching one');
  ok(E.apply(st, { t: 'play', i: 0, color: 'green' }, 'p0').error === 'badColor', 'only its own two colours');
  const st2 = setup(3, [[['blue', '2', 'yellow', 'rain'], R]], ['red', '2']);
  ok(E.isPlayable(st2.hands.p0[0], st2), 'chameleon also matches by number');
  ok(r.state.power.p0 === true, 'no power used unless asked');
}
{ // ☔ Rain: everyone else takes one; the token is spent
  const st = setup(4, [[['red', '7', 'blue', 'rain'], R, R]], R);
  const r = E.apply(st, { t: 'play', i: 0, color: 'red', power: true }, 'p0');
  ok(r.state.hands.p1.length === 3 && r.state.hands.p2.length === 3 && r.state.hands.p3.length === 3, 'rain: +1 each');
  ok(r.state.power.p0 === false && r.state.currentPlayerIndex === 1, 'token spent, turn moves on');
  ok(E.apply(r.state, { t: 'play', i: 0, power: true }, 'p1').error, 'p1 cannot use a power with a plain card');
}
{ // A spent token can't be used
  const st = setup(3, [[['red', '7', 'blue', 'rain'], R]], R, { power: { p0: false } });
  ok(E.apply(st, { t: 'play', i: 0, power: true }, 'p0').error === 'noPower', 'spent token refused');
}
{ // 🔁 Again: same player goes again
  const st = setup(3, [[['red', '7', 'blue', 'again'], R, R]], R);
  const r = E.apply(st, { t: 'play', i: 0, power: true }, 'p0');
  ok(r.state.currentPlayerIndex === 0 && r.state.power.p0 === false, 'again keeps the turn');
}
{ // 🎁 Gift: a card moves to the chosen player; you must keep at least one
  const st = setup(3, [[['red', '7', 'blue', 'gift'], ['yellow', 'skip'], R]], R);
  const g = idOf(st, 'p0', 1);
  const r = E.apply(st, { t: 'play', i: 0, power: true, gift: { id: g, to: 'p2' } }, 'p0');
  ok(r.state.hands.p0.length === 1 && r.state.hands.p2.length === 3 && r.state.hands.p2.some(c => c.id === g), 'gift moved');
  ok(r.state.players.find(p => p.id === 'p2').cardCount === 3, 'cardCount follows the gift');
  ok(E.apply(st, { t: 'play', i: 0, power: true, gift: { id: g, to: 'p0' } }, 'p0').error === 'badGift', 'no gift to yourself');
  const st2 = setup(3, [[['red', '7', 'blue', 'gift'], R]], R);
  ok(E.apply(st2, { t: 'play', i: 0, power: true, gift: { id: idOf(st2, 'p0', 1), to: 'p1' } }, 'p0').error === 'badGift', 'cannot gift your last card');
}
{ // ✌️ Double: a second card of the chosen colour goes down; it can even win the round
  const st = setup(3, [[['red', '7', 'blue', 'double'], ['blue', '3'], ['green', '1']]], R);
  const x = idOf(st, 'p0', 1);
  let r = E.apply(st, { t: 'play', i: 0, color: 'blue', power: true, extra: x }, 'p0');
  ok(r.state.hands.p0.length === 1 && r.state.topColor === 'blue' && r.state.topValue === '7', 'double dropped the blue 3');
  ok(r.state.discard[r.state.discard.length - 2].id === x, 'extra card sits under the top card');
  ok(E.apply(st, { t: 'play', i: 0, color: 'red', power: true, extra: x }, 'p0').error === 'badDouble', 'extra must match the chosen colour');
  const st2 = setup(3, [[['red', '7', 'blue', 'double'], ['blue', '3']]], R);
  r = E.apply(st2, { t: 'play', i: 0, color: 'blue', power: true, extra: idOf(st2, 'p0', 1) }, 'p0');
  ok(r.state.status === 'ended' && r.state.winner === 'p0', 'double can finish the round');
}
{ // 🦎 Wild Chameleon: your token recharges, everybody else's switches off
  const st = setup(3, [[['wild', 'wildCham'], R]], R, { power: { p0: false } });
  ok(E.apply(st, { t: 'play', i: 0 }, 'p0').error === 'needColor', 'wild needs a colour');
  const r = E.apply(st, { t: 'play', i: 0, color: 'green' }, 'p0');
  ok(r.state.power.p0 === true && r.state.power.p1 === false && r.state.power.p2 === false && r.state.topColor === 'green', 'wild chameleon');
}
{ // Wild +4 played fairly; challenge fails → target takes 6 and loses the turn
  const st = setup(3, [[['wild', 'wild4'], ['blue', '1']], [['blue', '3']], [['green', '1']]], R);
  let r = E.apply(st, { t: 'play', i: 0, color: 'blue' }, 'p0');
  ok(r.state.phase?.k === 'challenge' && r.state.phase.guilty === false, 'wild +4 opens a fair challenge');
  ok(E.apply(r.state, { t: 'draw' }, 'p1').error, 'nobody plays while the challenge is open');
  r = E.apply(r.state, { t: 'challenge' }, 'p1');
  ok(r.state.hands.p1.length === 7 && r.state.currentPlayerIndex === 2, 'lost challenge: +6, skipped');
}
{ // Wild +4 bluff caught (a chameleon card with the colour counts) → bluffer takes 4
  const st = setup(3, [[['wild', 'wild4'], ['blue', '1', 'red', 'rain']], [['red', '3']], [['red', '1']]], R);
  let r = E.apply(st, { t: 'play', i: 0, color: 'blue' }, 'p0');
  ok(r.state.phase.guilty === true, 'bluff detected through the chameleon card');
  r = E.apply(r.state, { t: 'challenge' }, 'p1');
  ok(r.state.hands.p0.length === 5 && r.state.currentPlayerIndex === 1, 'won challenge: bluffer +4, target plays');
}
{ // Wild +4 accepted → +4, skipped, token recharged
  const st = setup(3, [[['wild', 'wild4'], ['blue', '1']]], R, { power: { p1: false } });
  let r = E.apply(st, { t: 'play', i: 0, color: 'blue' }, 'p0');
  r = E.apply(r.state, { t: 'accept' }, 'p1');
  ok(r.state.hands.p1.length === 6 && r.state.currentPlayerIndex === 2 && r.state.power.p1 === true, 'accepted +4');
}
{ // Last card: shout or be caught
  const st = setup(3, [[R, ['red', '7']]], R);
  const r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.uno?.pid === 'p0', 'one card → must shout');
  const caught = E.apply(r.state, { t: 'catch' }, 'p2');
  ok(caught.state.hands.p0.length === 3, 'caught → +2');
  ok(caught.state.power.p0 === true, '(caught is not a recharge — token was already charged)');
  const safe = E.apply(r.state, { t: 'shout' }, 'p0');
  ok(!safe.state.uno && E.apply(safe.state, { t: 'catch' }, 'p2').error, 'shouted → safe');
}
{ // Drawing: unplayable card passes by itself; playable one can be played or passed
  const st = setup(3, [[['blue', '1']]], R);
  st.drawPile[0] = { id: 1, c: 'green', v: '2' };
  let r = E.apply(st, { t: 'draw' }, 'p0');
  ok(r.state.currentPlayerIndex === 1 && !r.state.drawn, 'unplayable draw passes');
  const st2 = setup(3, [[['blue', '1']]], R);
  st2.drawPile[0] = { id: 1, c: 'red', v: '2' };
  r = E.apply(st2, { t: 'draw' }, 'p0');
  ok(r.state.drawn && r.state.currentPlayerIndex === 0, 'playable draw waits');
  ok(E.apply(r.state, { t: 'play', i: 0 }, 'p0').error === 'onlyDrawn', 'only the drawn card');
  ok(E.apply(r.state, { t: 'play', i: 1 }, 'p0').state, 'drawn card playable');
}
{ // Winning scores the other hands
  const st = setup(2, [[R], [['red', 'skip'], ['wild', 'wild'], ['red', '3', 'blue', 'gift'], ['blue', '4']]], R);
  const r = E.apply(st, { t: 'play', i: 0 }, 'p0');
  ok(r.state.status === 'ended' && r.state.winner === 'p0' && r.state.roundPoints === 84, 'score 20+40+20+4');
}
{ // Timeout only counts once
  const st = setup(3, [], R);
  const r = E.apply(st, { t: 'timeout', seq: st.seq }, 'sys');
  ok(r.state && r.state.currentPlayerIndex !== 0, 'timeout moves on');
  ok(E.apply(r.state, { t: 'timeout', seq: st.seq }, 'sys').error === 'stale', 'stale timeout ignored');
}
{ // The deck
  const d = E.createDeck();
  ok(d.length === E.CARD_TOTAL && new Set(d.map(c => c.id)).size === d.length, '100 unique cards');
  ok(d.filter(c => c.c2).length === 24 && d.filter(c => c.c === 'wild').length === 12, '24 chameleon, 12 wild');
}
{ // Joining and leaving mid-round keeps every card
  let st = E.newRound(P(4));
  st = E.addPlayer(st, { id: 'late', name: 'Late' });
  ok(st.hands.late.length === 7 && st.players.length === 5 && st.power.late === true, 'late joiner gets 7 and a charged token');
  st.currentPlayerIndex = 2;
  st = E.removePlayer(st, 'p2');
  ok(st.players[st.currentPlayerIndex].id === 'p3', 'turn passes on when the current player leaves');
  const all = [...st.drawPile, ...st.discard, ...Object.values(st.hands).flat()];
  ok(all.length === E.CARD_TOTAL, 'no cards lost when leaving');
  st = E.removePlayer(E.removePlayer(E.removePlayer(st, 'p0'), 'p1'), 'p3');
  ok(st.status === 'ended' && st.winner === 'late', 'last one left wins');
}

// ---------- Many full bot games ----------
const PERSONAS = ['attacker', 'trickster', 'saver', 'bluffer', 'balanced'];
function nested(v) {   // Firestore forbids arrays directly inside arrays, and undefined
  if (Array.isArray(v)) return v.some(x => Array.isArray(x) || nested(x));
  if (v && typeof v === 'object') return Object.values(v).some(x => nested(x));
  return v === undefined;
}
let games = 0, moves = 0, powers = 0, longest = 0, matchDone = 0;
const used = {};
const N = Number(process.argv[2] || 3000);
for (let g = 0; g < N; g++) {
  const n = 2 + (g % 9);
  let st = E.newRound(P(n), { matchTarget: g % 3 ? 0 : 500 });
  let steps = 0;
  while (st.status === 'playing' && steps < 4000) {
    steps++;
    // sometimes a player drops out, joins, or people shout / catch
    if (Math.random() < 0.002 && n > 2) {
      const p = st.players[Math.floor(Math.random() * st.players.length)];
      if (!p.disconnected && st.players.filter(x => !x.disconnected).length > 2) {
        st = { ...st, players: st.players.map(x => x.id === p.id ? { ...x, disconnected: true } : x) };
      }
    }
    if (Math.random() < 0.003 && st.players.length > 2) st = E.removePlayer(st, st.players[Math.floor(Math.random() * st.players.length)].id);
    else if (Math.random() < 0.002 && st.players.length < 10) st = E.addPlayer(st, { id: 'j' + steps, name: 'J' + steps });
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
    for (const e of st.ev.list) if (e.t === 'power') { powers++; used[e.pw] = (used[e.pw] || 0) + 1; }
    // every card is somewhere, exactly once
    const all = [...st.drawPile, ...st.discard, ...Object.values(st.hands).flat()];
    if (all.length !== E.CARD_TOTAL || new Set(all.map(c => c.id)).size !== E.CARD_TOTAL) { ok(false, `card count ${all.length}`); break; }
    if (st.players.some(p => p.cardCount !== st.hands[p.id].length)) { ok(false, 'cardCount out of sync'); break; }
    if (st.players.some(p => typeof st.power[p.id] !== 'boolean')) { ok(false, 'a player has no token'); break; }
    if (st.phase === undefined || nested(st)) { ok(false, 'not saveable to Firestore'); break; }
  }
  if (st.status !== 'ended') ok(false, `game ${g} did not end (${steps} steps, ${n} players)`);
  if (st.matchWinner) matchDone++;
  longest = Math.max(longest, steps);
  games++;
}
console.log(`${games} bot games, ${moves} moves, ${powers} powers used ${JSON.stringify(used)}, longest ${longest} moves`);
console.log(fails ? `${fails} FAILED` : 'All good ✓');
process.exit(fails ? 1 : 0);
