// ============================================================
// ¡CAMALEÓN! — rules engine (plays by the UNO Flex rules, with its own name and look)
//
//  🦎 Flex cards have a normal colour and a second "flex" colour. Normally a flex card plays
//     on its normal side. With your ⚡ Power Card on green you may play its FLEX side instead:
//     it can then match its flex colour, and flex action / flex wild cards do their stronger
//     flex effect. Either way the colour that carries on is the card's NORMAL colour (or the
//     colour named for a wild). Using a flex side turns your Power Card red.
//  ⚡ A Power Card goes back the other way when you play a number card with the 🔄 flip
//     icon (it switches YOUR card over), when anyone plays a Wild All Flip (everybody's card
//     switches over), and when every player's card is red at once (all turn green).
//
// This file has NO screen and NO Firebase code. Every move — mine, the bots', the guided
// game's, a timeout — goes through Engine.apply(state, move, actorId), which returns the
// new game state (or an error). app.js saves that result in one Firestore transaction,
// so two players can never half-overwrite each other. Because it is plain logic it runs
// in Node too: `node test-engine.js` plays thousands of bot games to check the rules.
//
// Room fields this engine owns are listed in GAME_KEYS; anything else in the room
// (chat, music, votes…) is left alone.
// ============================================================

(function (root) {
  'use strict';

  // ---------- Cards ----------
  // classic number:  { id, c: 'red', v: '7', flip?: true }        (🔄 flip icon on some)
  // classic action:  { id, c: 'red', v: 'skip' | 'reverse' | 'draw2' }
  // flex (number/action): { id, c: 'red', c2: 'blue', v: '7' | 'skip' | …, flex: true }
  // wild:            { id, c: 'wild', v: 'wildFlip' }               (classic Wild All Flip)
  // flex wild:       { id, c: 'wild', v: 'wildTarget2' | 'wildAllDraw' | 'wild4', flex: true }
  const COLORS = ['red', 'yellow', 'green', 'blue'];
  const NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const ACTIONS = ['skip', 'reverse', 'draw2'];
  const WILDS = ['wildFlip', 'wildTarget2', 'wildAllDraw', 'wild4'];
  const WILD_COLOR = 'wild';            // colour name stored on wild cards
  const isWildValue = v => WILDS.includes(v);
  const isWild = card => !!card && card.c === WILD_COLOR;
  const isFlex = card => !!(card && card.flex);
  // flex wilds whose flex side makes ONE chosen player draw
  const TARGETED = { wildTarget2: 2, wild4: 4 };

  // Points left in a loser's hand go to the round winner
  const cardPoints = card => NUMBERS.includes(card.v) ? Number(card.v) : isWild(card) ? 50 : 20;

  const HAND_SIZE = 7;
  const MAX_PLAYERS = 8;                // there are 8 Power Cards
  const MATCH_TARGET = 500;
  const LOG_MAX = 24;

  // Every room field this engine writes (app.js copies exactly these into Firestore)
  const GAME_KEYS = ['status', 'players', 'hands', 'drawPile', 'discard', 'topColor', 'topValue', 'power',
    'currentPlayerIndex', 'direction', 'phase', 'drawn', 'uno', 'ev', 'log', 'stats', 'seq',
    'winner', 'winnerName', 'winnerReason', 'roundPoints', 'points', 'matchWinner', 'matchTarget', 'roundNo'];

  // ---------- Deck: 104 playing cards (+ the 8 Power Cards, which are the `power` field) ----------
  //  per colour: classic 1–8 (two of them with the 🔄 flip icon), flex 1–8, classic Skip /
  //  Reverse / Draw Two, flex Skip / Reverse / Draw Two  → 22 × 4 = 88
  //  wilds: 6 Wild All Flip, 4 Flex Wild Target Draw 2, 4 Flex Wild All Draw, 2 Flex Wild Draw Four
  const CARD_TOTAL = 104;
  const FLIP_NUMBERS = [['3', '7'], ['2', '6'], ['4', '8'], ['1', '5']];   // flip icons, per colour
  function shuffle(arr, rnd = Math.random) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function createDeck(rnd = Math.random) {
    const out = [];
    COLORS.forEach((c, ci) => {
      const others = COLORS.filter(x => x !== c);
      for (const n of NUMBERS) {
        const card = { c, v: n };
        if (FLIP_NUMBERS[ci].includes(n)) card.flip = true;
        out.push(card);
      }
      // the flex colours go round the three other colours
      NUMBERS.forEach((n, k) => out.push({ c, c2: others[k % 3], v: n, flex: true }));
      for (const a of ACTIONS) out.push({ c, v: a });
      ACTIONS.forEach((a, k) => out.push({ c, c2: others[k], v: a, flex: true }));
    });
    for (let i = 0; i < 6; i++) out.push({ c: WILD_COLOR, v: 'wildFlip' });
    for (let i = 0; i < 4; i++) out.push({ c: WILD_COLOR, v: 'wildTarget2', flex: true });
    for (let i = 0; i < 4; i++) out.push({ c: WILD_COLOR, v: 'wildAllDraw', flex: true });
    for (let i = 0; i < 2; i++) out.push({ c: WILD_COLOR, v: 'wild4', flex: true });
    return shuffle(out.map((card, id) => ({ id, ...card })), rnd);
  }

  // ---------- Small helpers ----------
  const clone = o => JSON.parse(JSON.stringify(o));
  const ci = card => (card ? { ...card } : null);   // card as stored in events

  function nextActive(state, fromIdx, dir = state.direction, steps = 1) {
    const n = state.players.length;
    let idx = fromIdx;
    for (let s = 0; s < steps; s++) {
      for (let k = 0; k < n; k++) {
        idx = ((idx + dir) % n + n) % n;
        if (!state.players[idx].disconnected) break;
      }
    }
    return idx;
  }
  const activeCount = state => state.players.filter(p => !p.disconnected).length;
  const indexOf = (state, pid) => state.players.findIndex(p => p.id === pid);
  const nameOf = (state, pid) => state.players.find(p => p.id === pid)?.name || '?';
  const currentId = state => state.players[state.currentPlayerIndex]?.id;
  const hasPower = (state, pid) => !!(state.power && state.power[pid]);

  // Can this card go down on its NORMAL side?
  function isPlayable(card, state) {
    if (!card) return false;
    if (isWild(card)) return true;
    return card.c === state.topColor || card.v === state.topValue;
  }
  // Can this card go down on its FLEX side? (needs a green Power Card)
  //  flex wild: always · flex number/action: its flex colour matches, or its normal side would
  //  (you may flex a card that already fits, just to get the flex effect)
  function canFlex(card, state, pid) {
    if (!isFlex(card) || !hasPower(state, pid)) return false;
    if (isWild(card)) return true;
    return card.c2 === state.topColor || isPlayable(card, state);
  }
  // Which cards in this player's hand may be played (indexes), on either side
  function legalPlays(state, pid) {
    if (state.status !== 'playing' || state.phase || currentId(state) !== pid) return [];
    const hand = state.hands[pid] || [];
    const ok = c => isPlayable(c, state) || canFlex(c, state, pid);
    if (state.drawn) {
      if (state.drawn.pid !== pid) return [];
      const i = hand.findIndex(c => c.id === state.drawn.id);
      return i >= 0 && ok(hand[i]) ? [i] : [];
    }
    return hand.map((c, i) => (ok(c) ? i : -1)).filter(i => i >= 0);
  }
  // A Wild Draw Four (normal side) is only fair when you hold no card of the colour in play —
  // and any wild counts as a match too
  function hadColor(hand, color) {
    return hand.some(c => isWild(c) || c.c === color);
  }

  // ---------- Drawing (the discard pile is reshuffled when the deck runs out) ----------
  function refill(st) {
    if (st.drawPile.length || st.discard.length <= 1) return;
    const top = st.discard[st.discard.length - 1];
    st.drawPile = shuffle(st.discard.slice(0, -1));
    st.discard = [top];
    addLog(st, 'log.reshuffle', {});
  }
  function take(st, pid, n) {
    const got = [];
    for (let i = 0; i < n; i++) {
      refill(st);
      if (!st.drawPile.length) break;
      got.push(st.drawPile.shift());
    }
    st.hands[pid] = [...(st.hands[pid] || []), ...got];
    return got;
  }

  // ---------- Log, events, stats ----------
  function addLog(st, k, p) {
    st.log = [...(st.log || []), { k, p }].slice(-LOG_MAX);
  }
  function emit(st, e) { st.ev.list.push(e); }
  function stat(st, pid, key, n = 1) {
    if (!pid) return;
    st.stats = st.stats || {};
    const s = st.stats[pid] || (st.stats[pid] = {});
    s[key] = (s[key] || 0) + n;
  }
  function syncCounts(st) {
    st.players = st.players.map(p => ({ ...p, cardCount: (st.hands[p.id] || []).length }));
  }
  // Someone is forced to take cards: hand + event + stats in one place
  function forceDraw(st, pid, n, by, why) {
    const got = take(st, pid, n);
    emit(st, { t: 'draw', pid, n: got.length, why });
    stat(st, pid, 'taken', got.length);
    if (by && by !== pid) stat(st, by, 'dealt', got.length);
    return got.length;
  }

  // ---------- ⚡ Power Cards ----------
  // switch some players' cards over (green ↔ red)
  function togglePower(st, pids, why, by) {
    const pw = { ...(st.power || {}) };
    for (const id of pids) pw[id] = !pw[id];
    st.power = pw;
    emit(st, { t: 'powerFlip', pids, why, by: by || null, now: pids.map(id => pw[id]) });
  }
  // every player's card red at the same time → everybody back to green
  function checkAllRed(st) {
    const ids = st.players.map(p => p.id);
    if (ids.length && ids.every(id => !hasPower(st, id))) {
      st.power = Object.fromEntries(ids.map(id => [id, true]));
      emit(st, { t: 'powerReset' });
      addLog(st, 'log.allRed', {});
    }
  }

  // ---------- New round ----------
  // players: [{id, name, …}] (seat order). opts: { matchTarget, points, roundNo, rnd, first }
  function newRound(players, opts = {}) {
    const rnd = opts.rnd || Math.random;
    let deck = createDeck(rnd);
    const hands = {};
    for (const p of players) hands[p.id] = deck.splice(0, HAND_SIZE);
    // The first table card can't be an action or wild card: those are passed over until a
    // number card turns up (they stay in the deck)
    const at = deck.findIndex(c => NUMBERS.includes(c.v));
    const start = deck.splice(at, 1)[0];
    const st = {
      status: 'playing',
      players: players.map(p => ({ ...p, cardCount: HAND_SIZE, disconnected: !!p.disconnected })),
      hands,
      drawPile: deck,
      discard: [start],
      topColor: start.c,
      topValue: start.v,
      power: Object.fromEntries(players.map(p => [p.id, true])),   // everybody starts green
      currentPlayerIndex: 0,
      direction: 1,
      phase: null,
      drawn: null,
      uno: null,
      ev: { n: 1, list: [{ t: 'start' }] },
      log: [],
      stats: {},
      seq: 1,
      winner: null, winnerName: null, winnerReason: null, roundPoints: 0,
      points: opts.points || {},
      matchWinner: null,
      matchTarget: opts.matchTarget || 0,
      roundNo: (opts.roundNo || 0) + 1
    };
    // who starts moves round the table from game to game; never a disconnected player
    st.currentPlayerIndex = (opts.first || 0) % st.players.length;
    if (st.players[st.currentPlayerIndex].disconnected) st.currentPlayerIndex = nextActive(st, st.currentPlayerIndex, 1);
    addLog(st, 'log.start', { name: st.players[st.currentPlayerIndex].name });
    return st;
  }

  // ---------- Ending a round ----------
  function endRound(st, winnerId, reason = 'out') {
    let pts = 0;
    for (const p of st.players) {
      if (p.id === winnerId) continue;
      pts += (st.hands[p.id] || []).reduce((s, c) => s + cardPoints(c), 0);
    }
    st.status = 'ended';
    st.winner = winnerId;
    st.winnerName = nameOf(st, winnerId);
    st.winnerReason = reason;
    st.roundPoints = pts;
    st.points = { ...(st.points || {}) };
    st.points[winnerId] = (st.points[winnerId] || 0) + pts;
    st.phase = null; st.drawn = null; st.uno = null;
    if (st.matchTarget && st.points[winnerId] >= st.matchTarget) st.matchWinner = winnerId;
    emit(st, { t: 'win', pid: winnerId, pts });
    addLog(st, 'log.win', { name: st.winnerName, pts });
  }

  // Standings for "end by vote" / last player standing: fewest cards, then fewest points
  function leader(st) {
    return st.players
      .filter(p => !p.disconnected)
      .map(p => {
        const hand = st.hands[p.id] || [];
        return { id: p.id, n: hand.length, pts: hand.reduce((s, c) => s + cardPoints(c), 0) };
      })
      .sort((a, b) => a.n - b.n || a.pts - b.pts)[0]?.id || null;
  }

  // ---------- Applying a move ----------
  // move.t: play {id|i, flex?, color? (wilds), target? (flex Target Draw 2 / Wild Draw Four)} ·
  //         draw · pass · accept · challenge · shout · catch · timeout {seq} · endVote · lastPlayer
  function apply(state, move, actor) {
    if (!state || state.status !== 'playing') return { error: 'notPlaying' };
    const st = clone(state);
    st.ev = { n: (state.ev?.n || 0) + 1, list: [] };
    st.seq = (state.seq || 0) + 1;
    st.power = st.power || {};
    const err = run(st, move, actor);
    if (err) return { error: err };
    if (st.status === 'playing') checkAllRed(st);
    syncCounts(st);
    return { state: st };
  }

  function run(st, move, actor) {
    const me = actor;
    const myIdx = indexOf(st, me);
    const isTurn = currentId(st) === me;

    // The last-card window closes as soon as someone else does something
    const closeUno = () => { if (st.uno && st.uno.pid !== me) st.uno = null; };

    switch (move.t) {
      case 'play': {
        if (!isTurn) return 'notYourTurn';
        if (st.phase) return 'busy';
        const hand = st.hands[me] || [];
        // cards are chosen by id (safe if the hand changed meanwhile); index still works
        if (move.id != null) move = { ...move, i: hand.findIndex(c => c.id === move.id) };
        const card = hand[move.i];
        if (!card) return 'noCard';
        if (st.drawn && card.id !== st.drawn.id) return 'onlyDrawn';
        const flex = !!move.flex;
        if (flex) {
          if (!isFlex(card)) return 'notFlex';
          if (!hasPower(st, me)) return 'noPower';
          if (!canFlex(card, st, me)) return 'cantPlay';
        } else if (!isPlayable(card, st)) return 'cantPlay';
        const wild = isWild(card);
        if (wild && !COLORS.includes(move.color)) return 'needColor';
        // a targeted flex wild needs someone else (still in the game) to aim at
        const targeted = flex && TARGETED[card.v];
        let tIdx = -1;
        if (targeted) {
          tIdx = indexOf(st, move.target);
          if (move.target === me || tIdx < 0 || st.players[tIdx].disconnected) return 'badTarget';
        }

        closeUno();
        const prevColor = st.topColor;
        const handBefore = hand.filter((_, i) => i !== move.i);
        st.hands[me] = handBefore;
        st.discard = [...st.discard, card];
        st.drawn = null;
        // the NORMAL colour carries on, even when the flex side was used (wild: the named colour)
        st.topColor = wild ? move.color : card.c;
        st.topValue = card.v;
        emit(st, { t: 'play', pid: me, card: ci(card), color: st.topColor, flex });
        stat(st, me, 'plays');
        if (wild) stat(st, me, 'wilds');
        if (flex) {
          stat(st, me, 'flexes');
          // using the flex side turns my Power Card red
          togglePower(st, [me], 'flex', me);
        }
        addLog(st, wild ? 'log.playWild' : 'log.play', { name: nameOf(st, me), c: card.c, c2: card.c2 || null, v: card.v, color: st.topColor, flex });

        const left = handBefore.length;
        const won = left === 0;
        const nxt = nextActive(st, myIdx);
        const nxtId = st.players[nxt].id;
        let goTo = nxt;
        const others = () => st.players.filter(p => p.id !== me && !p.disconnected);

        // ---- what the card does (normal side, or flex side) ----
        switch (card.v) {
          case 'draw2':
            if (flex) {        // every other player draws 1; the next player still plays
              for (const p of others()) forceDraw(st, p.id, 1, me, 'flexDraw');
              emit(st, { t: 'flexEffect', v: 'draw2', pid: me });
              addLog(st, 'log.flexDraw2', { name: nameOf(st, me) });
            } else {
              forceDraw(st, nxtId, 2, me, 'draw2');
              emit(st, { t: 'skip', pid: nxtId });
              addLog(st, 'log.drawSkip', { name: nameOf(st, nxtId), n: 2 });
              goTo = nextActive(st, nxt);
            }
            break;
          case 'skip':
            if (flex) {        // SKIP ALL: the turn comes back to me
              emit(st, { t: 'skipAll', pid: me });
              stat(st, me, 'skips', activeCount(st) - 1);
              addLog(st, 'log.skipAll', { name: nameOf(st, me) });
              goTo = myIdx;
            } else {
              emit(st, { t: 'skip', pid: nxtId });
              stat(st, me, 'skips');
              addLog(st, 'log.skip', { name: nameOf(st, nxtId) });
              goTo = nextActive(st, nxt);
            }
            break;
          case 'reverse': {
            st.direction = -st.direction;
            emit(st, { t: 'reverse', dir: st.direction });
            const first = nextActive(st, myIdx);          // first player in the new direction
            const firstId = st.players[first].id;
            if (flex) {        // REVERSE then SKIP
              emit(st, { t: 'skip', pid: firstId });
              stat(st, me, 'skips');
              addLog(st, 'log.reverseSkip', { name: nameOf(st, firstId) });
              goTo = nextActive(st, first);
            } else if (activeCount(st) === 2) {   // with two players a Reverse works as a Skip
              emit(st, { t: 'skip', pid: firstId });
              addLog(st, 'log.skip', { name: nameOf(st, firstId) });
              goTo = myIdx;
            } else {
              addLog(st, 'log.reverse', {});
              goTo = first;
            }
            break;
          }
          case 'wildFlip': {   // everybody's Power Card switches over
            togglePower(st, st.players.map(p => p.id), 'wildFlip', me);
            stat(st, me, 'allFlips');
            addLog(st, 'log.wildFlip', { name: nameOf(st, me), color: st.topColor });
            break;
          }
          case 'wildAllDraw':
            if (flex) {        // every other player draws 2; the next player still plays
              for (const p of others()) forceDraw(st, p.id, 2, me, 'flexDraw');
              emit(st, { t: 'flexEffect', v: 'wildAllDraw', pid: me });
              addLog(st, 'log.flexAllDraw', { name: nameOf(st, me) });
            }
            break;
          case 'wildTarget2':
          case 'wild4': {
            if (flex) {        // the chosen player draws; play goes on with the next player
              const n = TARGETED[card.v];
              const tid = st.players[tIdx].id;
              forceDraw(st, tid, n, me, 'target');
              emit(st, { t: 'target', pid: me, to: tid, n });
              stat(st, me, 'targets');
              addLog(st, 'log.target', { name: nameOf(st, me), target: nameOf(st, tid), n });
              break;
            }
            if (card.v === 'wildTarget2') break;    // normal side: a plain wild
            // Wild Draw Four, normal side
            if (won) {         // last card: no challenge, the next player simply takes the cards
              forceDraw(st, nxtId, 4, me, 'wild4');
              break;
            }
            st.phase = {
              k: 'challenge', kind: 'wild4', by: me, target: nxtId,
              // was it fair? (any card of the colour that was in play — wilds count too)
              guilty: hadColor(handBefore, prevColor),
              prevColor, handAtPlay: handBefore.map(c => ci(c))
            };
            st.currentPlayerIndex = nxt;
            emit(st, { t: 'challengeOpen', by: me, target: nxtId, kind: 'wild4' });
            addLog(st, 'log.wildDraw', { name: nameOf(st, me), target: nameOf(st, nxtId), color: st.topColor });
            setUno(st, me, left);
            return null;
          }
          default:
            // a number card with the 🔄 flip icon: my Power Card MUST switch over
            if (card.flip) {
              togglePower(st, [me], 'flipCard', me);
              addLog(st, 'log.flipCard', { name: nameOf(st, me) });
            }
        }
        if (won) { endRound(st, me); return null; }
        setUno(st, me, left);
        st.currentPlayerIndex = goTo;
        return null;
      }

      case 'draw': {
        if (!isTurn) return 'notYourTurn';
        if (st.phase) return 'busy';
        if (st.drawn) return 'alreadyDrew';
        closeUno();
        const got = take(st, me, 1);
        if (!got.length) {          // no cards anywhere: just pass
          addLog(st, 'log.pass', { name: nameOf(st, me) });
          st.currentPlayerIndex = nextActive(st, myIdx);
          return null;
        }
        emit(st, { t: 'draw', pid: me, n: 1, why: 'self' });
        stat(st, me, 'drew');
        if (isPlayable(got[0], st) || canFlex(got[0], st, me)) {
          st.drawn = { pid: me, id: got[0].id };   // may play it now, or pass
        } else {
          addLog(st, 'log.drewPass', { name: nameOf(st, me) });
          st.currentPlayerIndex = nextActive(st, myIdx);
        }
        return null;
      }

      case 'pass': {
        if (!isTurn) return 'notYourTurn';
        if (!st.drawn) return 'drawFirst';
        st.drawn = null;
        addLog(st, 'log.drewPass', { name: nameOf(st, me) });
        st.currentPlayerIndex = nextActive(st, myIdx);
        return null;
      }

      case 'accept': case 'challenge': {
        const ph = st.phase;
        if (!ph || ph.k !== 'challenge' || ph.target !== me) return 'noChallenge';
        st.phase = null;
        const tIdx = indexOf(st, me);
        const byName = nameOf(st, ph.by), tName = nameOf(st, me);
        if (move.t === 'accept') {
          const n = forceDraw(st, me, 4, ph.by, 'wild4');
          emit(st, { t: 'skip', pid: me });
          addLog(st, 'log.accept', { name: tName, n });
          st.currentPlayerIndex = nextActive(st, tIdx);
        } else if (ph.guilty) {
          // Caught: the player who played it draws 4, the challenger draws none and plays
          const n = forceDraw(st, ph.by, 4, me, 'penalty');
          emit(st, { t: 'challengeResult', ok: true, by: ph.by, target: me, hand: ph.handAtPlay, prevColor: ph.prevColor });
          stat(st, me, 'challengesWon');
          stat(st, ph.by, 'bluffsCaught');
          addLog(st, 'log.challengeWon', { name: tName, by: byName, n });
          if (st.uno?.pid === ph.by) st.uno = null;
          st.currentPlayerIndex = tIdx;
        } else {
          // Fair play: the challenger draws 6 instead of 4 and loses their turn
          const n = forceDraw(st, me, 6, ph.by, 'wild4');
          emit(st, { t: 'challengeResult', ok: false, by: ph.by, target: me, hand: ph.handAtPlay, prevColor: ph.prevColor });
          emit(st, { t: 'skip', pid: me });
          stat(st, ph.by, 'challengesWon');
          addLog(st, 'log.challengeLost', { name: tName, by: byName, n });
          st.currentPlayerIndex = nextActive(st, tIdx);
        }
        return null;
      }

      case 'shout': {
        if (!st.uno || st.uno.pid !== me) return 'noUno';
        st.uno = null;
        emit(st, { t: 'uno', pid: me });
        stat(st, me, 'shouts');
        addLog(st, 'log.shout', { name: nameOf(st, me) });
        return null;
      }

      case 'catch': {
        const u = st.uno;
        if (!u || u.pid === me || myIdx < 0) return 'noUno';
        if ((st.hands[u.pid] || []).length !== 1) { st.uno = null; return null; }
        st.uno = null;
        forceDraw(st, u.pid, 2, me, 'caught');
        emit(st, { t: 'caught', pid: u.pid, by: me });
        stat(st, me, 'catches');
        addLog(st, 'log.caught', { name: nameOf(st, me), target: nameOf(st, u.pid) });
        return null;
      }

      // The default move for whoever is holding the game up (turn timer, a player who
      // left). move.seq must match, so two clients firing at once only count once.
      case 'timeout': {
        if (move.seq !== (st.seq - 1)) return 'stale';
        const ph = st.phase;
        if (ph?.k === 'challenge') return run(st, { t: 'accept' }, ph.target);
        const cur = currentId(st);
        if (st.drawn) return run(st, { t: 'pass' }, cur);
        if (st.players[st.currentPlayerIndex].disconnected) {
          addLog(st, 'log.skipGone', { name: nameOf(st, cur) });
          st.currentPlayerIndex = nextActive(st, st.currentPlayerIndex);
          return null;
        }
        addLog(st, 'log.timeout', { name: nameOf(st, cur) });
        const e = run(st, { t: 'draw' }, cur);
        if (e) return e;
        if (st.drawn) return run(st, { t: 'pass' }, cur);
        return null;
      }

      // Everybody voted to stop: the player with the fewest cards wins the round
      case 'endVote': {
        const w = leader(st);
        if (!w) return 'nobody';
        endRound(st, w, 'vote');
        return null;
      }
      // Only one player still connected
      case 'lastPlayer': {
        const alive = st.players.filter(p => !p.disconnected);
        if (alive.length !== 1) return 'notLast';
        endRound(st, alive[0].id, 'lastPlayer');
        return null;
      }
    }
    return 'unknownMove';
  }

  // ---------- Someone joins / leaves in the middle of a round ----------
  // A late joiner gets 7 cards, a green Power Card, and sits last in the order
  function addPlayer(state, player) {
    const st = clone(state);
    st.ev = { n: (state.ev?.n || 0) + 1, list: [] };
    st.seq = (state.seq || 0) + 1;
    st.players = [...st.players, { ...player, cardCount: 0, disconnected: false }];
    st.power = { ...(st.power || {}), [player.id]: true };
    const got = take(st, player.id, HAND_SIZE);
    emit(st, { t: 'draw', pid: player.id, n: got.length, why: 'join' });
    addLog(st, 'log.joined', { name: player.name });
    syncCounts(st);
    return st;
  }
  // A player who leaves: their cards go back under the deck and the turn moves on
  function removePlayer(state, pid) {
    const idx = indexOf(state, pid);
    if (idx < 0) return state;
    const st = clone(state);
    st.ev = { n: (state.ev?.n || 0) + 1, list: [] };
    st.seq = (state.seq || 0) + 1;
    const name = nameOf(st, pid);
    st.drawPile = [...st.drawPile, ...(st.hands[pid] || [])];
    delete st.hands[pid];
    if (st.stats) delete st.stats[pid];
    if (st.power) delete st.power[pid];
    const wasCur = st.currentPlayerIndex === idx;
    const ph = st.phase;
    st.players = st.players.filter(p => p.id !== pid);
    addLog(st, 'log.left', { name });
    if (st.status !== 'playing') { syncCounts(st); return st; }
    const n = st.players.length;
    if (!n) { st.status = 'ended'; return st; }
    // keep pointing at the same "next" person
    let cur = st.currentPlayerIndex;
    if (idx < cur) cur--;
    else if (wasCur) cur = st.direction === 1 ? idx % n : (idx - 1 + n) % n;
    st.currentPlayerIndex = cur;
    if (st.players[cur]?.disconnected) st.currentPlayerIndex = nextActive(st, cur);
    // anything that was waiting on them is dropped
    if (ph && (ph.target === pid || ph.by === pid)) st.phase = null;
    if (st.drawn?.pid === pid) st.drawn = null;
    if (st.uno?.pid === pid) st.uno = null;
    checkAllRed(st);
    syncCounts(st);
    const alive = st.players.filter(p => !p.disconnected);
    if (alive.length === 1) endRound(st, alive[0].id, 'lastPlayer');
    return st;
  }

  // After a play: one card left means the player must shout (others may catch them)
  function setUno(st, pid, left) {
    if (left === 1) st.uno = { pid, at: st.seq };
    else if (st.uno?.pid === pid) st.uno = null;
  }

  // The colour you hold most of — bots and timeouts use it (action cards count a bit more)
  function bestColor(hand, among = COLORS) {
    const n = Object.fromEntries(COLORS.map(c => [c, 0]));
    for (const c of hand) if (!isWild(c)) n[c.c] += NUMBERS.includes(c.v) ? 1 : 1.3;
    return among.reduce((a, b) => (n[b] > n[a] ? b : a), among[Math.floor(Math.random() * among.length)]);
  }

  // ============================================================
  // BOTS — choose a move for a bot (no peeking: a bot only uses its own hand, card counts,
  // the table and everybody's Power Cards, which are on show)
  // ============================================================
  // persona: attacker · flexer · saver · bluffer · balanced
  // level:   { challenge: how well it reads a bluff, fair: plays Wild Draw Four only when fair,
  //            random: chance of a careless play, rnd }
  function botMove(state, pid, persona = 'balanced', level = {}) {
    const st = state;
    const ph = st.phase;
    const hand = st.hands[pid] || [];
    const rnd = level.rnd || Math.random;

    if (ph?.k === 'challenge') {
      if (ph.target !== pid) return null;
      // Guess: the more cards the player had, the likelier they held the colour (or a wild)
      const byHand = (st.hands[ph.by] || []).length;
      let p = Math.min(0.85, 0.15 + byHand * 0.08);
      if (persona === 'bluffer') p += 0.15;
      if (persona === 'saver') p -= 0.1;
      const sharp = level.challenge ?? 0.5;                   // 0 = coin flip, 1 = very good guesser
      const guess = rnd() < p;
      const read = rnd() < sharp * 0.55 ? ph.guilty : guess;  // good bots "read the table" more often
      return { t: read ? 'challenge' : 'accept' };
    }
    if (currentId(st) !== pid || st.status !== 'playing') return null;

    const legal = legalPlays(st, pid);
    if (!legal.length) return st.drawn ? { t: 'pass' } : { t: 'draw' };
    const charged = hasPower(st, pid);
    const rivals = st.players.filter(p => p.id !== pid && !p.disconnected);
    const leaderRival = rivals.slice().sort((a, b) => a.cardCount - b.cardCount)[0];
    const threat = leaderRival ? leaderRival.cardCount : 99;
    const nxt = st.players[nextActive(st, indexOf(st, pid))];
    const nextIsClose = nxt && nxt.cardCount <= 2;
    const colorCount = c => hand.filter(h => h.c === c).length;

    // Would this card be worth playing on its flex side? (it costs the Power Card)
    const flexWorth = c => {
      if (!canFlex(c, st, pid)) return -1;
      if (!isPlayable(c, st)) return 10;                      // the only way to play it
      let w = 0;
      if (c.v === 'skip') w = 8 + (activeCount(st) - 2) * 2;  // skip everyone, go again
      if (c.v === 'reverse') w = 4;
      if (c.v === 'draw2') w = rivals.length >= 3 ? 5 : 1;
      if (c.v === 'wildAllDraw') w = 4 + rivals.length * 2;
      if (c.v === 'wildTarget2') w = threat <= 3 ? 9 : 4;
      if (c.v === 'wild4') w = threat <= 3 ? 14 : 8;
      if (NUMBERS.includes(c.v)) w = -2;                      // no effect: keep the power
      if (persona === 'flexer') w += 5;
      if (persona === 'saver' && hand.length > 4 && threat > 3) w -= 8;
      return w;
    };

    const plan = i => {
      const c = hand[i];
      const fw = flexWorth(c);
      const flex = fw > 0 && (isPlayable(c, st) ? rnd() < 0.85 : true);
      let s = 0;
      const wild = isWild(c);
      if (!wild && NUMBERS.includes(c.v)) s += 10 + Number(c.v) * 0.3;   // shed high numbers first
      if (!wild) s += colorCount(c.c) * 1.5;                              // keep to a colour you are long in
      if (['draw2', 'skip'].includes(c.v)) s += nextIsClose ? 14 : 6;
      if (c.v === 'reverse') s += 7;
      if (wild) {
        s -= 8;                                                           // keep wilds for later
        if (hand.length <= 2) s += 20;                                    // …unless it wins soon
      }
      if (c.flip) s += charged ? -3 : 6;                                  // a 🔄 card turns a red Power Card green
      if (c.v === 'wildFlip') {
        const reds = rivals.filter(p => !hasPower(st, p.id)).length;
        s += (charged ? -4 : 8) + (rivals.length - reds * 2);             // good when I'm red and they're green
      }
      if (flex) s += fw;
      // Wild Draw Four (normal side) is only fair with nothing of the colour (or a wild) in hand
      if (c.v === 'wild4' && !flex && hadColor(hand.filter((_, k) => k !== i), st.topColor)) {
        if (level.fair) s -= 100;
        else s -= persona === 'bluffer' ? -2 : 6;
      }
      if (persona === 'attacker' && !NUMBERS.includes(c.v)) s += 6;
      if (persona === 'saver' && wild) s -= 12;
      if (persona === 'bluffer' && c.v === 'wild4') s += 6;
      return { s: s + rnd() * 3, flex };
    };

    let pick, plan0;
    if (level.random && rnd() < level.random) {
      // easy bots sometimes just play any card they can
      pick = legal[Math.floor(rnd() * legal.length)];
      plan0 = { flex: !isPlayable(hand[pick], st) };
    } else {
      let best = -Infinity;
      for (const i of legal) { const p = plan(i); if (p.s > best) { best = p.s; pick = i; plan0 = p; } }
    }
    const card = hand[pick];
    const move = { t: 'play', i: pick };
    if (plan0.flex) move.flex = true;
    if (isWild(card)) move.color = bestColor(hand.filter((_, k) => k !== pick));
    if (move.flex && TARGETED[card.v]) move.target = leaderRival?.id;
    if (move.flex && TARGETED[card.v] && !move.target) delete move.flex;
    return move;
  }

  const Engine = {
    COLORS, NUMBERS, ACTIONS, WILDS, WILD_COLOR, HAND_SIZE, MAX_PLAYERS, MATCH_TARGET, GAME_KEYS, CARD_TOTAL, TARGETED,
    createDeck, shuffle, newRound, apply, legalPlays, addPlayer, removePlayer, isPlayable, canFlex, isWildValue,
    isWild, isFlex, hasPower, nextActive, cardPoints, bestColor, botMove, leader, hadColor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
