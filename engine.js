// ============================================================
// ¡CAMALEÓN! — rules engine
//
// A colour-matching card game with two twists:
//  🦎 Chameleon cards are split between TWO colours. When you play one, you choose which
//     of its two colours it becomes — that is the colour the next player must follow.
//  ⚡ Every player has one Power token. Play a chameleon card while your token is charged
//     and you may use that card's power (☔ Rain, 🔁 Again, 🎁 Gift or ✌️ Double); the token
//     is then spent. It recharges when somebody makes you take 2+ cards (+2 / Wild +4),
//     and a Wild Chameleon recharges yours while switching everybody else's off.
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
  // plain:     { id, c: 'red', v: '7' }            (also 'skip' / 'reverse' / 'draw2')
  // chameleon: { id, c: 'red', c2: 'blue', v: '7', pw: 'rain' }
  // wild:      { id, c: 'wild', v: 'wild' | 'wild4' | 'wildCham' }
  const COLORS = ['red', 'yellow', 'green', 'blue'];
  const NUMBERS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const ACTIONS = ['skip', 'reverse', 'draw2'];
  const WILDS = ['wild', 'wild4', 'wildCham'];
  const POWERS = ['rain', 'again', 'gift', 'double'];
  const WILD_COLOR = 'wild';            // colour name stored on wild cards
  const isWildValue = v => WILDS.includes(v);
  const isCham = card => !!(card && card.c2);
  const colorsOf = card => (card.c2 ? [card.c, card.c2] : [card.c]);

  // Points left in a loser's hand go to the round winner
  const POINTS = { skip: 20, reverse: 20, draw2: 20, wild: 40, wild4: 50, wildCham: 50 };
  const CHAM_POINTS = 20;
  const cardPoints = card => (isCham(card) ? CHAM_POINTS : NUMBERS.includes(card.v) ? Number(card.v) : (POINTS[card.v] || 0));

  const HAND_SIZE = 7;
  const MATCH_TARGET = 500;
  const LOG_MAX = 24;

  // Every room field this engine writes (app.js copies exactly these into Firestore)
  const GAME_KEYS = ['status', 'players', 'hands', 'drawPile', 'discard', 'topColor', 'topValue', 'power',
    'currentPlayerIndex', 'direction', 'phase', 'drawn', 'uno', 'ev', 'log', 'stats', 'seq',
    'winner', 'winnerName', 'winnerReason', 'roundPoints', 'points', 'matchWinner', 'matchTarget', 'roundNo'];

  // ---------- Deck: 100 cards ----------
  //  40 plain numbers (0–9 once per colour) · 24 chameleon cards (6 colour pairs × the
  //  4 powers) · 24 actions (Skip, Reverse, +2 twice per colour) · 12 wilds
  const PAIRS = [];
  for (let a = 0; a < COLORS.length; a++) for (let b = a + 1; b < COLORS.length; b++) PAIRS.push([COLORS[a], COLORS[b]]);
  const CARD_TOTAL = 100;
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
    for (const c of COLORS) {
      for (const n of NUMBERS) out.push({ c, v: n });
      for (const a of ACTIONS) { out.push({ c, v: a }); out.push({ c, v: a }); }
    }
    // chameleon numbers run 1–9 round the pairs so every number shows up 2–3 times
    PAIRS.forEach(([c, c2], p) => POWERS.forEach((pw, k) => out.push({ c, c2, v: String(((p * 4 + k) % 9) + 1), pw })));
    for (const w of WILDS) for (let i = 0; i < 4; i++) out.push({ c: WILD_COLOR, v: w });
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

  // Can this card go on the table right now?
  function isPlayable(card, state) {
    if (!card) return false;
    if (card.c === WILD_COLOR) return true;
    return colorsOf(card).includes(state.topColor) || card.v === state.topValue;
  }
  // Which cards in this player's hand may be played (indexes)
  function legalPlays(state, pid) {
    if (state.status !== 'playing' || state.phase || currentId(state) !== pid) return [];
    const hand = state.hands[pid] || [];
    if (state.drawn) {
      if (state.drawn.pid !== pid) return [];
      const i = hand.findIndex(c => c.id === state.drawn.id);
      return i >= 0 && isPlayable(hand[i], state) ? [i] : [];
    }
    return hand.map((c, i) => (isPlayable(c, state) ? i : -1)).filter(i => i >= 0);
  }
  // A Wild +4 is only fair when you hold nothing of the colour in play
  // (a chameleon card counts if either of its colours is that colour)
  function hadColor(hand, color) {
    return hand.some(c => c.c !== WILD_COLOR && colorsOf(c).includes(color));
  }
  // Which cards may ride along with a ✌️ Double power: any non-wild card showing the
  // colour the chameleon card was turned into
  function doubleOptions(hand, color) {
    return hand.filter(c => c.c !== WILD_COLOR && colorsOf(c).includes(color));
  }
  // The colour a chameleon card becomes if the player didn't say: the one that matches
  // the table, else its first colour
  function defaultChamColor(card, topColor) {
    return card.c2 === topColor ? card.c2 : card.c;
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
  // Someone is forced to take cards: hand + event + stats in one place.
  // Being hit by a +2 / Wild +4 (2+ cards) recharges your Power token — a small comfort.
  function forceDraw(st, pid, n, by, why) {
    const got = take(st, pid, n);
    emit(st, { t: 'draw', pid, n: got.length, why });
    stat(st, pid, 'taken', got.length);
    if (by && by !== pid) stat(st, by, 'dealt', got.length);
    if ((why === 'draw2' || why === 'wild4') && got.length >= 2 && !hasPower(st, pid)) {
      st.power = { ...(st.power || {}), [pid]: true };
      emit(st, { t: 'charge', pid, why });
      stat(st, pid, 'recharges');
      addLog(st, 'log.recharge', { name: nameOf(st, pid) });
    }
    return got.length;
  }

  // ---------- New round ----------
  // players: [{id, name, …}] (seat order). opts: { matchTarget, points, roundNo, rnd, first }
  function newRound(players, opts = {}) {
    const rnd = opts.rnd || Math.random;
    let deck = createDeck(rnd);
    const hands = {};
    for (const p of players) hands[p.id] = deck.splice(0, HAND_SIZE);
    // The first table card is a plain number card (others stay in the deck)
    const at = deck.findIndex(c => !c.c2 && NUMBERS.includes(c.v));
    const start = deck.splice(at, 1)[0];
    const st = {
      status: 'playing',
      players: players.map(p => ({ ...p, cardCount: HAND_SIZE, disconnected: !!p.disconnected })),
      hands,
      drawPile: deck,
      discard: [start],
      topColor: start.c,
      topValue: start.v,
      power: Object.fromEntries(players.map(p => [p.id, true])),   // everybody starts charged
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
  // move.t: play {id|i, color?, power?, gift?:{id,to}, extra?} · draw · pass · accept ·
  //         challenge · shout · catch · timeout {seq} · endVote · lastPlayer (system)
  function apply(state, move, actor) {
    if (!state || state.status !== 'playing') return { error: 'notPlaying' };
    const st = clone(state);
    st.ev = { n: (state.ev?.n || 0) + 1, list: [] };
    st.seq = (state.seq || 0) + 1;
    st.power = st.power || {};
    const err = run(st, move, actor);
    if (err) return { error: err };
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
        if (!isPlayable(card, st)) return 'cantPlay';
        const wild = card.c === WILD_COLOR;
        const cham = isCham(card);
        if (wild && !COLORS.includes(move.color)) return 'needColor';
        // the colour the card becomes: wild → named colour, chameleon → one of its two
        let color = card.c;
        if (wild) color = move.color;
        else if (cham) {
          color = move.color == null ? defaultChamColor(card, st.topColor) : move.color;
          if (!colorsOf(card).includes(color)) return 'badColor';
        }
        let handBefore = hand.filter((_, i) => i !== move.i);

        // ---- check the power before changing anything ----
        const usePower = !!move.power;
        if (usePower) {
          if (!cham) return 'noPowerCard';
          if (!hasPower(st, me)) return 'noPower';
          if (card.pw === 'gift') {
            const g = move.gift || {};
            const tIdx = indexOf(st, g.to);
            if (g.to === me || tIdx < 0 || st.players[tIdx].disconnected) return 'badGift';
            if (!handBefore.some(c => c.id === g.id)) return 'badGift';
            if (handBefore.length < 2) return 'badGift';        // you must keep at least one card
          }
          if (card.pw === 'double') {
            const x = handBefore.find(c => c.id === move.extra);
            if (!x || !doubleOptions([x], color).length) return 'badDouble';
          }
        }

        closeUno();
        const prevColor = st.topColor;
        st.hands[me] = handBefore;
        st.discard = [...st.discard, card];
        st.drawn = null;
        st.topColor = color;
        st.topValue = card.v;
        emit(st, { t: 'play', pid: me, card: ci(card), color });
        stat(st, me, 'plays');
        if (wild) stat(st, me, 'wilds');
        if (cham) stat(st, me, 'chams');
        addLog(st, wild ? 'log.playWild' : cham ? 'log.playCham' : 'log.play',
          { name: nameOf(st, me), c: card.c, c2: card.c2 || null, v: card.v, color });

        const nxt = nextActive(st, myIdx);
        const nxtId = st.players[nxt].id;
        let goTo = nxt;

        // ---- the chameleon card's power ----
        if (usePower) {
          st.power = { ...st.power, [me]: false };
          stat(st, me, 'powers');
          stat(st, me, 'pw_' + card.pw);
          switch (card.pw) {
            case 'rain': {        // ☔ everybody else takes one card
              let n = 0;
              for (const p of st.players) if (p.id !== me && !p.disconnected) n += forceDraw(st, p.id, 1, me, 'rain');
              emit(st, { t: 'power', pw: 'rain', pid: me, n });
              addLog(st, 'log.pwRain', { name: nameOf(st, me) });
              break;
            }
            case 'again':         // 🔁 you take another turn straight away
              emit(st, { t: 'power', pw: 'again', pid: me });
              addLog(st, 'log.pwAgain', { name: nameOf(st, me) });
              goTo = myIdx;
              break;
            case 'gift': {        // 🎁 one of your cards goes to a player you choose
              const gi = handBefore.findIndex(c => c.id === move.gift.id);
              const gc = handBefore[gi];
              handBefore = handBefore.filter((_, i) => i !== gi);
              st.hands[me] = handBefore;
              st.hands[move.gift.to] = [...(st.hands[move.gift.to] || []), gc];
              emit(st, { t: 'power', pw: 'gift', pid: me, to: move.gift.to, card: ci(gc) });
              stat(st, me, 'dealt');
              stat(st, move.gift.to, 'taken');
              addLog(st, 'log.pwGift', { name: nameOf(st, me), target: nameOf(st, move.gift.to) });
              // a gift can leave the receiver with more than one card — their window closes
              if (st.uno?.pid === move.gift.to) st.uno = null;
              break;
            }
            case 'double': {      // ✌️ a second card of the same colour goes down too
              const xi = handBefore.findIndex(c => c.id === move.extra);
              const xc = handBefore[xi];
              handBefore = handBefore.filter((_, i) => i !== xi);
              st.hands[me] = handBefore;
              // it slides in under the chameleon card, which stays on top
              st.discard = [...st.discard.slice(0, -1), xc, card];
              emit(st, { t: 'power', pw: 'double', pid: me, card: ci(xc) });
              addLog(st, 'log.pwDouble', { name: nameOf(st, me) });
              break;
            }
          }
        }

        const left = handBefore.length;
        const won = left === 0;

        // ---- what the card does ----
        switch (card.v) {
          case 'draw2':
            forceDraw(st, nxtId, 2, me, 'draw2');
            emit(st, { t: 'skip', pid: nxtId });
            addLog(st, 'log.drawSkip', { name: nameOf(st, nxtId), n: 2 });
            goTo = nextActive(st, nxt);
            break;
          case 'skip':
            emit(st, { t: 'skip', pid: nxtId });
            stat(st, me, 'skips');
            addLog(st, 'log.skip', { name: nameOf(st, nxtId) });
            goTo = nextActive(st, nxt);
            break;
          case 'reverse':
            st.direction = -st.direction;
            emit(st, { t: 'reverse', dir: st.direction });
            if (activeCount(st) === 2) {
              emit(st, { t: 'skip', pid: nxtId });
              addLog(st, 'log.skip', { name: nameOf(st, nxtId) });
              goTo = myIdx;
            } else {
              addLog(st, 'log.reverse', {});
              goTo = nextActive(st, myIdx);
            }
            break;
          case 'wildCham': {
            // 🦎 your token recharges, everybody else's switches off
            const drained = st.players.filter(p => p.id !== me && hasPower(st, p.id)).map(p => p.id);
            const pw = {};
            for (const p of st.players) pw[p.id] = p.id === me;
            st.power = pw;
            emit(st, { t: 'charge', pid: me, why: 'wildCham', drained });
            stat(st, me, 'drains', drained.length);
            addLog(st, 'log.wildCham', { name: nameOf(st, me), n: drained.length });
            break;
          }
          case 'wild4': {
            if (won) {
              // last card: no challenge, the next player simply takes the cards
              forceDraw(st, nxtId, 4, me, 'wild4');
              break;
            }
            st.phase = {
              k: 'challenge', kind: 'wild4', by: me, target: nxtId,
              // was it fair? (any card of the colour that was in play)
              guilty: hadColor(handBefore, prevColor),
              prevColor, handAtPlay: handBefore.map(c => ci(c))
            };
            st.currentPlayerIndex = nxt;
            emit(st, { t: 'challengeOpen', by: me, target: nxtId, kind: 'wild4' });
            addLog(st, 'log.wildDraw', { name: nameOf(st, me), target: nameOf(st, nxtId), color: st.topColor });
            setUno(st, me, left);
            return null;
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
        if (isPlayable(got[0], st)) {
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
          // Caught: the player who bluffed takes the 4 cards, the target keeps their turn
          const n = forceDraw(st, ph.by, 4, me, 'penalty');
          emit(st, { t: 'challengeResult', ok: true, by: ph.by, target: me, hand: ph.handAtPlay, prevColor: ph.prevColor });
          stat(st, me, 'challengesWon');
          stat(st, ph.by, 'bluffsCaught');
          addLog(st, 'log.challengeWon', { name: tName, by: byName, n });
          if (st.uno?.pid === ph.by) st.uno = null;
          st.currentPlayerIndex = tIdx;
        } else {
          // Fair play: the challenger takes the 4 cards plus 2 more and loses the turn
          let n = forceDraw(st, me, 4, ph.by, 'wild4');
          n += forceDraw(st, me, 2, ph.by, 'penalty');
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
  // A late joiner gets 7 cards, a charged token, and sits last in the order
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

  // The colour you hold most of — bots and timeouts use it. A chameleon card counts half
  // for each of its colours; action cards count a little more (you want to play them).
  function colorWeights(hand) {
    const n = Object.fromEntries(COLORS.map(c => [c, 0]));
    for (const c of hand) {
      if (c.c === WILD_COLOR) continue;
      const w = NUMBERS.includes(c.v) ? 1 : 1.3;
      for (const col of colorsOf(c)) n[col] += c.c2 ? w * 0.6 : w;
    }
    return n;
  }
  function bestColor(hand, among = COLORS) {
    const n = colorWeights(hand);
    return among.reduce((a, b) => (n[b] > n[a] ? b : a), among[Math.floor(Math.random() * among.length)]);
  }

  // ============================================================
  // BOTS — choose a move for a bot (no peeking: a bot only uses its own hand, card counts,
  // the table and everybody's tokens, which are on show)
  // ============================================================
  // persona: attacker · trickster · saver · bluffer · balanced
  // level:   { challenge: how well it reads a bluff, fair: plays Wild +4 only when fair,
  //            random: chance of a careless play, rnd }
  function botMove(state, pid, persona = 'balanced', level = {}) {
    const st = state;
    const ph = st.phase;
    const hand = st.hands[pid] || [];
    const rnd = level.rnd || Math.random;

    if (ph?.k === 'challenge') {
      if (ph.target !== pid) return null;
      // Guess: the more cards the player had, the likelier they held the colour
      const byHand = (st.hands[ph.by] || []).length;
      let p = Math.min(0.85, 0.12 + byHand * 0.07);
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
    const threat = Math.min(...rivals.map(p => p.cardCount));
    const nxt = st.players[nextActive(st, indexOf(st, pid))];
    const nextIsClose = nxt && nxt.cardCount <= 2;
    const weights = colorWeights(hand);

    // easy bots sometimes just play any card they can (and never bother with powers)
    if (level.random && rnd() < level.random) {
      const i = legal[Math.floor(rnd() * legal.length)];
      return finish({ t: 'play', i }, false);
    }

    const score = i => {
      const c = hand[i];
      let s = 0;
      const wild = c.c === WILD_COLOR;
      if (!wild && !c.c2 && NUMBERS.includes(c.v)) s += 10 + Number(c.v) * 0.3;   // shed high numbers first
      if (!wild) s += Math.max(...colorsOf(c).map(col => weights[col])) * 1.5;    // stay in a colour you are long in
      if (c.c2) {
        s += 9;                                                                     // flexible and worth 20 points
        if (charged) s += persona === 'trickster' ? 12 : 6;                         // …and it carries a power
      }
      if (['draw2', 'skip', 'wild4'].includes(c.v)) s += nextIsClose ? 14 : 6;
      if (c.v === 'reverse') s += 7;
      if (wild) {
        s -= 8;                                                                     // keep wilds for later
        if (hand.length <= 2) s += 20;                                              // …unless it wins soon
      }
      if (c.v === 'wildCham') {
        // worth more when you are out of power, or rivals are charged up
        const charged2 = rivals.filter(p => hasPower(st, p.id)).length;
        s += (charged ? 0 : 8) + charged2 * 2;
      }
      // Wild +4 is only fair with nothing of the colour in play
      if (c.v === 'wild4' && hadColor(hand.filter((_, k) => k !== i), st.topColor)) {
        if (level.fair) s -= 100;
        else s -= persona === 'bluffer' ? -2 : 6;
      }
      if (persona === 'attacker' && !NUMBERS.includes(c.v)) s += 6;
      if (persona === 'saver' && wild) s -= 12;
      if (persona === 'bluffer' && c.v === 'wild4') s += 6;
      return s + rnd() * 3;
    };
    const pick = legal.reduce((a, b) => (score(b) > score(a) ? b : a), legal[0]);
    return finish({ t: 'play', i: pick }, true);

    // colour + power choices for the chosen card
    function finish(move, smart) {
      const card = hand[move.i];
      const rest = hand.filter((_, k) => k !== move.i);
      if (card.c === WILD_COLOR) { move.color = bestColor(rest); return move; }
      if (!card.c2) return move;
      move.color = bestColor(rest, [card.c, card.c2]);
      if (!smart || !charged) return move;
      // Should the bot spend its token on this card's power?
      let use = false;
      switch (card.pw) {
        case 'rain':
          use = threat <= 3 || persona === 'attacker' || rnd() < 0.4;
          break;
        case 'again':
          // only worth it with another card that fits after this one
          use = rest.some(c => c.c === WILD_COLOR || colorsOf(c).includes(move.color) || c.v === card.v);
          break;
        case 'gift': {
          if (rest.length < 2) break;
          // hand the most awkward plain card (not a wild, not a flexible chameleon card) to the
          // rival closest to winning
          const plain = rest.filter(c => c.c !== WILD_COLOR && !c.c2);
          const g = (plain.length ? plain : rest.filter(c => c.c !== WILD_COLOR)).sort((a, b) => cardPoints(b) - cardPoints(a))[0];
          const to = rivals.slice().sort((a, b) => a.cardCount - b.cardCount)[0];
          if (g && to) { use = true; move.gift = { id: g.id, to: to.id }; }
          break;
        }
        case 'double': {
          const opts = doubleOptions(rest, move.color).sort((a, b) => cardPoints(b) - cardPoints(a));
          // careful: a dropped Skip/+2 doesn't do anything, so prefer numbers
          const x = opts.find(c => NUMBERS.includes(c.v)) || opts[0];
          if (x) { use = true; move.extra = x.id; }
          break;
        }
      }
      // a saver keeps its token until the end is near
      if (persona === 'saver' && hand.length > 4 && threat > 3) use = false;
      if (use) move.power = true;
      return move;
    }
  }

  const Engine = {
    COLORS, NUMBERS, ACTIONS, WILDS, POWERS, POINTS, CHAM_POINTS, WILD_COLOR, HAND_SIZE, MATCH_TARGET,
    GAME_KEYS, CARD_TOTAL, PAIRS,
    createDeck, shuffle, newRound, apply, legalPlays, addPlayer, removePlayer, isPlayable, isWildValue,
    isCham, colorsOf, doubleOptions, defaultChamColor, hasPower,
    nextActive, cardPoints, bestColor, botMove, leader, hadColor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
