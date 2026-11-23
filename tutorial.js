// ============================================================
// Guided first game (¡CAMALEÓN!)
//
// A short game on this device only, against "Profe Camaleón", with a fixed deck so every
// lesson works:
//   1 match the colour                       5 chameleon card + ✌️ Double (drop a 2nd card)
//   2 play a +2 (the Profe's ⚡ recharges)   6 shout ¡ÚLTIMA!
//   3 chameleon card: pick its colour and    7 play your last card and win
//     use 🔁 Again (you play again)
//   4 🦎 Wild Chameleon: your ⚡ back on, the Profe's off
//
// While LOCAL_GAME is on, mutateRoom() (app.js) sends every change to localMutate()
// below instead of Firestore: the same rules engine runs on an in-memory room and the
// game is redrawn through onRoomUpdate(). Nothing is saved and it doesn't count in
// your stats.
// ============================================================

let LOCAL_GAME = false;
const TUT_BOT = 'bot_profe', TUT_ME_FALLBACK = 'tut-me';

addStrings({
  'tut.open':  ['🎓 ¿Primera vez? Aprende jugando (2 min)', '🎓 First time? Learn by playing (2 min)'],
  'tut.bot':   ['Profe Camaleón', 'Prof. Chameleon'],
  'tut.step':  ['Paso {n} de 7', 'Step {n} of 7'],
  'tut.skip':  ['Salir del tutorial', 'Leave tutorial'],
  'tut.s1': ['Juega una carta que coincida en <b>color o número</b> con la de la mesa. Toca el <b>Rojo 5</b>.', 'Play a card that matches the table card\'s <b>colour or number</b>. Tap the <b>Red 5</b>.'],
  'tut.s2': ['¡Ataca! El <b>Rojo +2</b> hace que el Profe robe 2 y pierda su turno. Mira su <b>⚡</b>: cuando te hacen robar 2 o más, tu ficha de poder se recarga.', 'Attack! The <b>Red +2</b> makes the Prof draw 2 and lose his turn. Watch his <b>⚡</b>: when you\'re made to draw 2 or more, your power token recharges.'],
  'tut.s3': ['Esta es una <b>carta camaleón</b>: roja y azul. Entra sobre el rojo, pero tú eliges en qué color se queda. Tócala, elige <b>Azul</b> y enciende su poder <b>🔁 Otra vez</b> para volver a jugar.', 'This is a <b>chameleon card</b>: red and blue. It goes on the red, but you choose which colour it becomes. Tap it, pick <b>Blue</b> and switch on its <b>🔁 Again</b> power to play again.'],
  'tut.s4': ['Tu <b>⚡</b> se gastó. El <b>🦎 Comodín Camaleón</b> lo recarga… y apaga el del Profe. Tócalo y elige <b>Verde</b>.', 'Your <b>⚡</b> is spent. The <b>🦎 Wild Chameleon</b> recharges it… and switches the Prof\'s off. Tap it and pick <b>Green</b>.'],
  'tut.s5': ['Otra carta camaleón, esta con <b>✌️ Doble</b>. Tócala, elige <b>Amarillo</b>, enciende el poder y suelta también el <b>Amarillo 9</b>.', 'Another chameleon card, this one with <b>✌️ Double</b>. Tap it, pick <b>Yellow</b>, switch the power on and drop the <b>Yellow 9</b> too.'],
  'tut.s6': ['¡Te queda una carta! Grita <b>¡ÚLTIMA!</b> antes de que te pillen (si te pillan, robas 2).', 'One card left! Shout <b>LAST CARD!</b> before someone catches you (if they do, you draw 2).'],
  'tut.s7': ['Juega tu última carta, el <b>Amarillo 2</b>, y gana.', 'Play your last card, the <b>Yellow 2</b>, and win.'],
  'tut.wait':  ['Turno del Profe… mira lo que hace.', "The Prof's turn… watch what he does."],
  'tut.doneT': ['¡Ganaste tu primera ronda!', 'You won your first round!'],
  'tut.done':  ['Ya sabes lo básico. Aún te quedan sorpresas: los poderes <b>☔ Lluvia</b> y <b>🎁 Regalo</b>, el <b>Comodín +4</b> y los <b>⚖️ desafíos</b>. Míralos en las reglas o mantén pulsada una carta.',
                'You know the basics. More surprises are waiting: the <b>☔ Rain</b> and <b>🎁 Gift</b> powers, the <b>Wild +4</b> and <b>⚖️ challenges</b>. See the rules or hold a card.'],
  'tut.again': ['Jugar contra bots', 'Play against bots'],
  'tut.home':  ['Volver al inicio', 'Back to start']
});
// This file loads after extras.js already filled in the page text, so fill it in again
// for the keys added just above (e.g. the winner screen's "Back to start")
applyStaticI18n();

// ---------- In-memory room (used by mutateRoom in app.js) ----------
const LocalRoom = { data: null };
const tutClone = o => JSON.parse(JSON.stringify(o));
let _localTimer = null;
function localMutate(fn) {
  if (!LocalRoom.data) return 'noRoom';
  const patch = fn(tutClone(LocalRoom.data));
  if (!patch || typeof patch === 'string') return patch || 'noChange';
  Object.assign(LocalRoom.data, tutClone(patch));
  // redraw on the next tick, like a database update arriving
  clearTimeout(_localTimer);
  _localTimer = setTimeout(() => {
    if (!LOCAL_GAME || !LocalRoom.data) return;
    roomState = tutClone(LocalRoom.data);
    onRoomUpdate(roomState);
  }, 0);
  return null;
}

// ---------- The lesson's cards ----------
let _tid = 500;
const tc = (c, v) => ({ id: _tid++, c, v });                            // plain / wild
const tcc = (c, c2, v, pw) => ({ id: _tid++, c, c2, v, pw });            // chameleon
// my hand, in the order the lesson plays it
const TUT_MINE = () => [
  tc('red', '5'),                         // 1
  tc('red', 'draw2'),                     // 2
  tcc('red', 'blue', '4', 'again'),       // 3  → Blue, 🔁 Again
  tc('wild', 'wildCham'),                 // 4  → Green
  tcc('green', 'yellow', '6', 'double'),  // 5  → Yellow, ✌️ Double…
  tc('yellow', '9'),                      //    …drops this one too
  tc('yellow', '2')                       // 7  (6 = shout)
];
const TUT_STEPS = [1, 2, 3, 4, 5, 5, 7];   // step shown while each of my cards is next
// The Profe's hand is built so exactly one card fits each time it's his turn
const TUT_BOT_HAND = () => [
  tc('red', '8'),       // answers my Red 5
  tc('green', '7'),     // answers my Wild Chameleon (Green)
  tc('yellow', '1'),    // answers my chameleon card (Yellow 6)
  tc('blue', '3'), tc('blue', '9'), tc('blue', '2'), tc('blue', '4')
];
let _tutMine = [];

function startTutorial() {
  closeRules();
  LOCAL_GAME = true;
  if (!localUid) localUid = TUT_ME_FALLBACK;
  const me = localUid;
  const raw = document.getElementById('player-name').value.trim() || t('land.defaultName');
  localName = selectedEmoji ? `${selectedEmoji} ${raw}` : raw;
  currentRoomId = 'TUTORIAL';
  _tid = 500;
  _tutMine = TUT_MINE();
  const st = Engine.newRound([
    { id: me, name: localName },
    { id: TUT_BOT, name: `🦎 ${t('tut.bot')}`, isBot: true, persona: 'balanced' }
  ], { matchTarget: 0 });
  st.hands = { [me]: tutClone(_tutMine), [TUT_BOT]: TUT_BOT_HAND() };
  st.discard = [tc('red', '3')];
  st.topColor = 'red'; st.topValue = '3';
  // the Profe starts with his ⚡ spent, so the +2 can show a recharge
  st.power = { [me]: true, [TUT_BOT]: false };
  // the 2 cards from my +2 come first (they never fit when the Profe has to play)
  st.drawPile = [tc('blue', '1'), tc('blue', '8'), ...Array.from({ length: 30 }, (_, i) =>
    tc(['green', 'yellow', 'blue', 'red'][i % 4], String(1 + i % 9)))];
  st.players = st.players.map(p => ({ ...p, cardCount: st.hands[p.id].length }));
  st.currentPlayerIndex = 0;
  st.log = [];
  LocalRoom.data = { ...st, game: GAME_TAG, hostId: me, endVotes: [], botLevel: 'easy' };
  document.body.classList.add('tutorial');
  fxPrevState = null;
  roomState = tutClone(LocalRoom.data);
  onRoomUpdate(roomState);
}

// Which lesson we're on, read from the game itself
function tutorialStep(state) {
  const me = localUid;
  if (state.uno?.pid === me) return 6;
  if (!isMyTurn(state)) return 0;
  const hand = state.hands?.[me] || [];
  const k = _tutMine.findIndex(c => hand.some(h => h.id === c.id));
  return k >= 0 ? TUT_STEPS[k] : 0;
}
function tutorialWantId(step) {
  const k = TUT_STEPS.indexOf(step);
  return k >= 0 ? _tutMine[k].id : null;
}
function tutorialAllowsCard(card) { return card.id === tutorialWantId(tutorialStep(roomState)); }
function tutorialAllowsDraw() { return false; }
function tutorialAllowsShout(kind) { return kind === 'shout'; }

// What each lesson wants from the play window: the colour (shown already picked) and
// the power. Whatever is tapped, the move is steered to this so the lesson can go on.
const TUT_PLAY = { 3: { color: 'blue', power: true }, 4: { color: 'green' }, 5: { color: 'yellow', power: true, extra: 5 } };
function tutorialPresetPlay(pick) {
  const want = TUT_PLAY[tutorialStep(roomState)];
  if (want) pick.color = want.color;
}
function tutorialFixMove(move) {
  const want = TUT_PLAY[tutorialStep(roomState)];
  if (!want) return move;
  const out = { ...move, color: want.color };
  if (want.power) out.power = true;
  if (want.extra != null) out.extra = _tutMine[want.extra].id;   // the Yellow 9
  return out;
}

function tutorialRender(state) {
  let coach = document.getElementById('coach');
  if (!coach) {
    coach = document.createElement('div');
    coach.id = 'coach';
    coach.className = 'coach';
    document.querySelector('.hand-area')?.before(coach);
  }
  const step = tutorialStep(state);
  coach.innerHTML = `
    <div class="coach-head"><span class="coach-step">${step ? t('tut.step', { n: step }) : ''}</span>
      <button type="button" class="link-btn coach-skip" onclick="endTutorial()">${t('tut.skip')}</button></div>
    <div class="coach-text">${step ? t('tut.s' + step) : t('tut.wait')}</div>`;
  coach.classList.toggle('waiting', !step);
  const want = tutorialWantId(step);
  document.querySelectorAll('#player-hand .card[data-id]').forEach(el => {
    el.classList.toggle('coach-pulse', +el.dataset.id === want);
  });
  // the ✌️ Double lesson also lights up the card that rides along
  if (step === 5) document.querySelector(`#player-hand .card[data-id="${_tutMine[5].id}"]`)?.classList.add('coach-pulse-soft');
}

// The Profe plays whatever fits (his hand is built so the fitting card is the scripted
// one); called from doBotTick instead of the normal bot brain
async function tutorialBotTick(state) {
  if (state.status !== 'playing' || whoActs(state) !== TUT_BOT) return;
  if (state.uno?.pid === localUid) return;   // waiting for me to shout first
  const move = Engine.botMove(state, TUT_BOT, 'balanced', { fair: true, challenge: 0 });
  if (move) await sendMove(move, TUT_BOT);
}

function tutorialOutro() {
  document.getElementById('coach')?.remove();
  let m = document.getElementById('tut-outro');
  if (!m) {
    m = document.createElement('div');
    m.id = 'tut-outro';
    m.className = 'spotify-modal';
    document.body.appendChild(m);
  }
  m.innerHTML = `<div class="spotify-modal-card tut-card">
    <div class="tut-trophy">🏆</div>
    <h3 class="spotify-modal-title">${t('tut.doneT')}</h3>
    <p class="spotify-modal-desc">${t('tut.done')}</p>
    <div class="spotify-modal-btns">
      <button class="btn btn-primary" onclick="endTutorial(); handleQuickBots();">🤖 ${t('tut.again')}</button>
      <button class="btn btn-ghost" onclick="endTutorial()">${t('tut.home')}</button>
    </div>
  </div>`;
  m.classList.remove('hidden');
  try { localStorage.setItem('camaleonTutorialDone', '1'); } catch (_) {}
  updateTutorialLink();
}

function endTutorial() {
  LOCAL_GAME = false;
  LocalRoom.data = null;
  if (localUid === TUT_ME_FALLBACK) localUid = auth.currentUser?.uid || null;
  _celebrated = null;
  roomState = null;
  currentRoomId = null;
  fxPrevState = null;
  document.body.classList.remove('tutorial');
  document.getElementById('coach')?.remove();
  document.getElementById('tut-outro')?.remove();
  ['uno-call-overlay', 'claim-dialog', 'challenge-area'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  FX.layer().innerHTML = '';
  showScreen('landing');
}

function updateTutorialLink() {
  const el = document.getElementById('tutorial-link');
  if (!el) return;
  el.innerHTML = t('tut.open');
  let seen = false;
  try { seen = !!localStorage.getItem('camaleonTutorialDone') || loadMyStats().games > 0; } catch (_) {}
  el.classList.toggle('first-time', !seen);
}
document.addEventListener('langchange', updateTutorialLink);
updateTutorialLink();
