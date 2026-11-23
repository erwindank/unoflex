// ============================================================
// I18N — Spanish / English text
//
// t('key', { name: 'Ana' }) returns the text in the chosen language, with {name}
// replaced. Missing English keys fall back to Spanish, missing keys show the key.
// Loaded before every other script so all of them can use t().
//
// The game log is saved as { k: 'log.play', p: {...} } (see engine.js), so every
// player reads it in their own language — no translating of saved sentences needed.
// ============================================================

const I18N = { es: {}, en: {} };

// The chosen language: saved per device, Spanish by default
let LANG = (() => {
  try { return localStorage.getItem('camaleonLang') === 'en' ? 'en' : 'es'; } catch (_) { return 'es'; }
})();
try { document.documentElement.lang = LANG; } catch (_) {}

function t(key, params) {
  let s = I18N[LANG]?.[key] ?? I18N.es[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
  return s;
}

// Adds a block of strings: addStrings({ key: ['español', 'English'], ... })
function addStrings(map) {
  for (const [k, [es, en]] of Object.entries(map)) {
    I18N.es[k] = es;
    I18N.en[k] = en ?? es;
  }
}

// English only: for fixed text in index.html, whose Spanish is written in the page
function addEnglish(map) { Object.assign(I18N.en, map); }

// Switches language, saves it, and tells the page to redraw ('langchange' event)
function setLanguage(lang) {
  LANG = lang === 'en' ? 'en' : 'es';
  try { localStorage.setItem('camaleonLang', LANG); } catch (_) {}
  document.documentElement.lang = LANG;
  applyStaticI18n();
  document.dispatchEvent(new Event('langchange'));
}

// Fixed text in index.html: elements with data-i18n="key" (text) or
// data-i18n-ph="key" (placeholder) / data-i18n-title="key" (tooltip).
// The Spanish text written in the HTML is kept as the fallback.
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    if (el.dataset.i18nEs === undefined) el.dataset.i18nEs = el.innerHTML;
    const k = el.dataset.i18n;
    el.innerHTML = (LANG === 'es' || !I18N.en[k]) ? (I18N.es[k] ?? el.dataset.i18nEs) : I18N.en[k];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    if (el.dataset.i18nPhEs === undefined) el.dataset.i18nPhEs = el.placeholder;
    el.placeholder = I18N[LANG][el.dataset.i18nPh] ?? el.dataset.i18nPhEs;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    if (el.dataset.i18nTitleEs === undefined) el.dataset.i18nTitleEs = el.title;
    el.title = I18N[LANG][el.dataset.i18nTitle] ?? el.dataset.i18nTitleEs;
  });
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('selected', b.dataset.lang === LANG));
}

const colorLabel = c => t('color.' + c);

// ---- Cards, powers and the ⚡ token ----
addStrings({
  'color.red': ['Rojo', 'Red'], 'color.yellow': ['Amarillo', 'Yellow'], 'color.green': ['Verde', 'Green'], 'color.blue': ['Azul', 'Blue'],
  'color.wild': ['Comodín', 'Wild'],
  'card.draw2': ['+2', '+2'], 'card.reverse': ['Reversa', 'Reverse'], 'card.skip': ['Salto', 'Skip'],
  'card.wild': ['Comodín', 'Wild'], 'card.wild4': ['Comodín +4', 'Wild +4'], 'card.wildCham': ['Comodín Camaleón', 'Wild Chameleon'],
  'card.cham': ['Camaleón {a}/{b} {v}', 'Chameleon {a}/{b} {v}'],
  // the four powers
  'pw.rain': ['☔ Lluvia', '☔ Rain'], 'pw.again': ['🔁 Otra vez', '🔁 Again'], 'pw.gift': ['🎁 Regalo', '🎁 Gift'], 'pw.double': ['✌️ Doble', '✌️ Double'],
  'pw.rainWhy': ['Todos los demás roban 1 carta.', 'Everybody else draws 1 card.'],
  'pw.againWhy': ['Vuelves a jugar enseguida.', 'You play again straight away.'],
  'pw.giftWhy': ['Le das una de tus cartas a quien quieras.', 'Give one of your cards to anyone you like.'],
  'pw.doubleWhy': ['Sueltas también otra carta del color que elijas.', 'Drop another card of the colour you pick, too.'],
  'pw.use': ['Usar el poder: {power}', 'Use the power: {power}'],
  'pw.spent': ['{power} — tu ⚡ está gastado', '{power} — your ⚡ is spent'],
  'pw.giftWhat': ['¿Qué carta regalas?', 'Which card do you give?'],
  'pw.giftWho': ['¿A quién?', 'To whom?'],
  'pw.giftLast': ['Necesitas quedarte con al menos una carta para regalar otra.', 'You need to keep at least one card to give another away.'],
  'pw.doubleWhat': ['¿Qué carta de {color} sueltas también?', 'Which {color} card do you drop too?'],
  'pw.doubleNone': ['No tienes otra carta de {color}. Elige el otro color o juega sin el poder.', 'You have no other {color} card. Pick the other colour or play without the power.'],
  // the token
  'tok.on': ['⚡ Poder cargado', '⚡ Power charged'], 'tok.off': ['⚡ Poder gastado', '⚡ Power spent'],
  'tok.mineOn': ['Poder listo', 'Power ready'], 'tok.mineOff': ['Poder gastado', 'Power spent'],
  'tok.helpOn': ['Juega una carta camaleón para usar su poder (o guárdalo).', 'Play a chameleon card to use its power (or save it).'],
  'tok.helpOff': ['Se recarga cuando te hacen robar con un +2 o un Comodín +4, o con un Comodín Camaleón.', 'It recharges when a +2 or Wild +4 makes you draw, or with a Wild Chameleon.']
});

// ---- The game log (engine.js writes {k, p}) ----
// {name}/{target} are players, {card} the card played, {color} a colour
addStrings({
  'log.start':        ['¡Partida iniciada! Empieza {name}.', 'Game on! {name} starts.'],
  'log.play':         ['{name} jugó {card}.', '{name} played {card}.'],
  'log.playCham':     ['🦎 {name} jugó {card} y lo dejó en {color}.', '🦎 {name} played {card} and turned it {color}.'],
  'log.playWild':     ['{name} jugó {card} y eligió {color}.', '{name} played {card} and chose {color}.'],
  'log.drawSkip':     ['{name} roba {n} y pierde su turno.', '{name} draws {n} and loses their turn.'],
  'log.skip':         ['{name} pierde su turno.', '{name} loses their turn.'],
  'log.reverse':      ['¡Cambio de sentido!', 'Direction reversed!'],
  'log.pwRain':       ['☔ ¡{name} usó Lluvia: todos los demás roban 1!', '☔ {name} used Rain: everybody else draws 1!'],
  'log.pwAgain':      ['🔁 {name} usó Otra vez y vuelve a jugar.', '🔁 {name} used Again and plays again.'],
  'log.pwGift':       ['🎁 {name} le regaló una carta a {target}.', '🎁 {name} gave {target} a card.'],
  'log.pwDouble':     ['✌️ {name} usó Doble y soltó otra carta.', '✌️ {name} used Double and dropped another card.'],
  'log.wildCham':     ['🦎 {name} jugó un Comodín Camaleón ({color}): su ⚡ se recarga y apaga {n} fichas.', '🦎 {name} played a Wild Chameleon ({color}): their ⚡ recharges and {n} tokens go out.'],
  'log.recharge':     ['⚡ La ficha de {name} se recargó.', "⚡ {name}'s token recharged."],
  'log.wildDraw':     ['{name} jugó un Comodín +4 ({color}). {target}: ¿aceptar o desafiar?', '{name} played a Wild +4 ({color}). {target}: accept or challenge?'],
  'log.accept':       ['{name} aceptó y robó {n}.', '{name} accepted and drew {n}.'],
  'log.challengeWon': ['⚖️ ¡{name} ganó el desafío! {by} tenía el color y roba {n}.', '⚖️ {name} won the challenge! {by} had the colour and draws {n}.'],
  'log.challengeLost':['⚖️ El juego de {by} era limpio: {name} roba {n} y pierde su turno.', "⚖️ {by}'s play was fair: {name} draws {n} and loses their turn."],
  'log.drewPass':     ['{name} robó una carta y pasó.', '{name} drew a card and passed.'],
  'log.pass':         ['{name} pasó (no quedan cartas para robar).', '{name} passed (no cards left to draw).'],
  'log.shout':        ['📣 ¡{name} grita ¡ÚLTIMA!', '📣 {name} shouts LAST CARD!'],
  'log.caught':       ['🚨 {name} pilló a {target} sin gritar: {target} roba 2.', "🚨 {name} caught {target} not shouting: {target} draws 2."],
  'log.reshuffle':    ['Se acabó el mazo: se barajó el descarte.', 'The deck ran out: the discard pile was shuffled.'],
  'log.win':          ['🏆 ¡{name} se quedó sin cartas! +{pts} puntos.', '🏆 {name} is out of cards! +{pts} points.'],
  'log.timeout':      ['⏰ {name} se quedó sin tiempo.', '⏰ {name} ran out of time.'],
  'log.skipGone':     ['Se saltó el turno de {name} (desconectado).', "{name}'s turn was skipped (disconnected)."],
  'log.gone':         ['{name} se desconectó.', '{name} disconnected.'],
  'log.back':         ['{name} se reconectó.', '{name} reconnected.'],
  'log.joined':       ['{name} se unió a la partida.', '{name} joined the game.'],
  'log.left':         ['{name} salió de la partida.', '{name} left the game.'],
  'log.vote':         ['{name} propone terminar ({n}/{t}).', '{name} wants to end the game ({n}/{t}).'],
  'log.unvote':       ['{name} retiró su voto para terminar.', '{name} withdrew their vote to end.']
});

// ---- Game words (app.js) ----
addStrings({
  'ui.copy': ['Copiar', 'Copy'], 'ui.copied': ['¡Copiado!', 'Copied!'], 'ui.cancel': ['Cancelar', 'Cancel'],
  'ui.close': ['Cerrar', 'Close'], 'ui.retry': ['Reintentar', 'Try again'], 'ui.disconnect': ['Desconectar', 'Disconnect'],
  'ui.someone': ['Alguien', 'Someone'], 'chat.me': ['(yo)', '(me)'],
  'err.name': ['Escribe tu nombre primero', 'Type your name first'],
  'err.connecting': ['Aún conectando… intenta de nuevo', 'Still connecting… try again'],
  'err.code': ['Introduce el código de sala de 6 caracteres', 'Enter the 6-character room code'],
  'err.notFound': ['Sala no encontrada', 'Room not found'],
  'err.ended': ['La partida ya terminó', 'That game has already ended'],
  'err.started': ['La partida ya comenzó', 'That game has already started'],
  'err.full': ['Sala llena (máximo {n})', 'Room full (max {n})'],
  'lob.removeBot': ['Quitar bot', 'Remove bot'], 'lob.back': ['vuelve', 'back'], 'lob.readyBadge': ['✓ listo', '✓ ready'],
  'lob.dc': ['desconectado', 'disconnected'], 'lob.ready': ['✓ Estás listo para jugar', "✓ You're ready to play"],
  'lob.again': ['¡Quiero jugar de nuevo!', 'I want to play again!'], 'lob.start': ['Iniciar partida', 'Start game'],
  'lob.waitingPlayers': ['Esperando jugadores…', 'Waiting for players…'], 'lob.addBot': ['+ Añadir bot', '+ Add bot'],
  'vc.title': ['Chat de voz', 'Voice chat'], 'vc.opened': ['{name} abrió el micrófono', '{name} turned their mic on'],
  'vc.left': ['{name} dejó el chat de voz', '{name} left voice chat'], 'vc.muted': ['{name} silenció el micrófono', '{name} muted their mic'],
  'vc.unmuted': ['{name} activó el micrófono', '{name} unmuted their mic'], 'vc.noMic': ['No se pudo acceder al micrófono', 'Could not use the microphone'],
  'vc.join': ['Unirse al chat de voz', 'Join voice chat'], 'vc.mute': ['Silenciar micrófono', 'Mute microphone'], 'vc.leave': ['Salir del chat de voz', 'Leave voice chat'],
  'uno.mine': ['¡Solo te queda 1 carta!', 'You only have 1 card left!'], 'uno.shout': ['¡ÚLTIMA!', 'LAST CARD!'],
  'uno.other': ['¡{name} tiene 1 carta y no ha gritado!', "{name} has 1 card and hasn't shouted!"],
  'uno.callOn': ['¡PILLAR A {name}!', 'CATCH {name}!'],
  'st.yourTurn': ['✨ ¡Tu turno! Elige una carta.', '✨ Your turn! Pick a card.'],
  'st.turnOf': ['Turno de {name}', "{name}'s turn"],
  'st.youDecide': ['⚖️ ¿Aceptas o desafías?', '⚖️ Accept or challenge?'],
  'st.decides': ['⚖️ {name} decide si desafiar…', '⚖️ {name} is deciding whether to challenge…'],
  'st.colorNow': ['Color: {color}', 'Colour: {color}'],
  'hand.drawnOk': ['¡Robaste una carta que sirve! Juégala o pasa.', 'You drew a card you can play! Play it or pass.'],
  'hand.pick': ['Tu turno — toca una carta para jugarla', 'Your turn — tap a card to play it'],
  'hand.count': ['Tu mano ({n})', 'Your hand ({n})'],
  'toi.you': ['tu turno', 'your turn'], 'toi.prev': ['anterior', 'previous'], 'toi.next': ['siguiente', 'next'],
  'nt.on': ['🔔 Notificaciones activadas', '🔔 Notifications on'], 'nt.onBody': ['Recibirás avisos del juego.', "You'll get game alerts."],
  'nt.disable': ['Desactivar notificaciones', 'Turn off notifications'], 'nt.enable': ['Activar notificaciones', 'Turn on notifications'],
  'nt.started': ['¡La partida comenzó!', 'The game has started!'], 'nt.first': ['{name} va primero.', '{name} goes first.'],
  'nt.won': ['🏆 ¡Ganaste!', '🏆 You won!'], 'nt.over': ['🎉 Ronda terminada', '🎉 Round over'],
  'nt.congrats': ['¡Felicidades!', 'Congratulations!'], 'nt.whoWon': ['Ganó {name}', '{name} won'],
  'nt.yourTurn': ['¡Es tu turno!', "It's your turn!"], 'nt.yourTurnBody': ['Elige una carta para jugar.', 'Pick a card to play.'],
  'nt.challenge': ['Te jugaron un Comodín +4: ¿aceptas o desafías?', 'Someone played a Wild +4 on you: accept or challenge?'],
  'nt.uno': ['¡Solo te queda 1 carta! Grita ¡ÚLTIMA! antes de que te pillen.', 'Only 1 card left! Shout LAST CARD before someone catches you.'],
  'mu.mute': ['Silenciar música', 'Mute music'], 'mu.play': ['Activar música', 'Play music'],
  'claim.wildTitle': ['Elige el color del Comodín', 'Pick the Wild colour'],
  'claim.drawTitle': ['{card}: elige el color', '{card}: pick the colour'],
  'claim.chamTitle': ['🦎 ¿En qué color se queda?', '🦎 Which colour does it become?'],
  'claim.unfair': ['⚠️ Ojo: tienes cartas de {color}. Si te desafían, robas tú.', '⚠️ Careful: you hold {color} cards. If you get challenged, you draw.'],
  'draw.ok': ['Sí, robar', 'Yes, draw'],
  'draw.haveTitle': ['Tienes cartas jugables', 'You have playable cards'],
  'draw.haveBody': ['Tienes cartas que puedes jugar. ¿Quieres robar una de todas formas?', 'You have cards you can play. Draw one anyway?'],
  'notice.ok': ['Entendido', 'Got it'],
  'notice.cantTitle': ['No puedes jugar esta carta', "You can't play this card"],
  'notice.cantBody': ['Tiene que coincidir en color ({color}), número o símbolo con la carta de la mesa. Elige otra o roba.', 'It must match the colour ({color}), number or symbol of the table card. Pick another or draw.'],
  'notice.onlyDrawnTitle': ['Solo la carta que robaste', 'Only the card you drew'],
  'notice.onlyDrawnBody': ['Después de robar solo puedes jugar esa carta (la que brilla) o pasar.', 'After drawing you can only play that card (the glowing one) or pass.'],
  'ch.title': ['{c} te jugó un <b>{card}</b> y eligió {color}.', '{c} played a <b>{card}</b> on you and chose {color}.'],
  'ch.rule': ['Solo es limpio si no tenía ninguna carta de {prev}. Le quedan {n} cartas.', 'It is only fair if they held no {prev} card. They have {n} cards left.'],
  'ch.acceptT': ['Aceptar', 'Accept'], 'ch.challengeT': ['Desafiar', 'Challenge'],
  'ch.take4': ['Robas 4 y pierdes el turno (tu ⚡ se recarga).', 'You draw 4 and lose your turn (your ⚡ recharges).'],
  'ch.challengeWhy4': ['Si {c} tenía el color, roba 4 él. Si no, robas 6.', 'If {c} had the colour, they draw 4. If not, you draw 6.'],
  'ch.accept': ['Aceptar', 'Accept'], 'ch.challenge': ['Desafiar', 'Challenge'],
  'ch.waitMine': ['{t} decide si desafiar tu {card}…', '{t} is deciding whether to challenge your {card}…'],
  'ch.waitOther': ['{t} decide si desafiar el {card} de {c}…', "{t} is deciding whether to challenge {c}'s {card}…"],
  'g.leaveQ': ['¿Seguro que quieres salir?', 'Are you sure you want to leave?'],
  'g.leaveBody': ['Si sales ahora tus cartas vuelven al mazo y no saldrás en la puntuación. Si quieres terminar la partida y ver los resultados, vota para finalizar.', "If you leave now your cards go back into the deck and you won't be in the score. To end the game and see the results, vote to end instead."],
  'g.leave': ['Salir', 'Leave'], 'g.stay': ['Quedarme', 'Stay'], 'g.voteEnd': ['Votar terminar', 'Vote to end'],
  'g.votes': ['{n}/{t} quieren terminar', '{n}/{t} want to end'], 'g.withdraw': ['Retirar voto', 'Withdraw vote'], 'g.end': ['Terminar', 'End game'],
  'w.vote': ['🤝 ¡Partida terminada!', '🤝 Game over!'], 'w.last': ['🏆 ¡Último en pie!', '🏆 Last one standing!'],
  'w.winner': ['🎉 ¡Ganador!', '🎉 Winner!'], 'w.roundWin': ['🎉 Ronda {n}', '🎉 Round {n}'],
  'w.champion': ['👑 ¡Campeón de la partida!', '👑 Match champion!'],
  'w.pts': ['+{n} puntos (las cartas de los demás)', '+{n} points (everyone else\'s cards)'],
  'w.ptsMatch': ['+{n} puntos en esta ronda · se juega a {target}', '+{n} points this round · playing to {target}'],
  'w.table': ['Cartas que quedaron', 'Cards left'], 'w.tableMatch': ['Cartas que quedaron · puntos totales', 'Cards left · total points'],
  'w.standing': ['{c} cartas · {p} pts', '{c} cards · {p} pts'],
  'w.again': ['Jugar de nuevo', 'Play again'], 'w.toLobby': ['Volver a la sala', 'Back to the room'],
  'rc.label': ['Reconectando…', 'Reconnecting…'],
  'sp.cancel': ['Cancelaste la conexión con Spotify.', 'You cancelled the Spotify connection.'],
  'sp.session': ['Error de sesión Spotify. Intenta de nuevo.', 'Spotify session error. Try again.'],
  'sp.fetch': ['No se pudo contactar Spotify. Revisa tu conexión.', "Couldn't reach Spotify. Check your connection."],
  'sp.other': ['Error de Spotify: {e}', 'Spotify error: {e}'], 'sp.nothing': ['Sin reproducción activa ahora mismo.', 'Nothing playing right now.'],
  'sp.connected': ['Conectado a Spotify', 'Connected to Spotify'], 'sp.on': ['Spotify conectado', 'Spotify connected'],
  'sp.connectTitle': ['Conectar Spotify', 'Connect Spotify'],
  'sp.desc': ['Comparte lo que estás escuchando con los demás jugadores. Aparecerá en la barra superior.', "Share what you're listening to with the other players. It shows in the top bar."],
  'sp.connectBtn': ['Conectar cuenta', 'Connect account'], 'sp.errTitle': ['Error de Spotify', 'Spotify error'],
  'lf.notFound': ['Usuario no encontrado en Last.fm.', 'User not found on Last.fm.'], 'lf.netError': ['Error de conexión. Intenta de nuevo.', 'Connection error. Try again.'],
  'lf.now': ['Escuchando ahora', 'Listening now'], 'lf.last': ['Última escuchada', 'Last played'], 'lf.none': ['Sin historial de Last.fm.', 'No Last.fm history.'],
  'lf.as': ['Conectado como {name}', 'Connected as {name}'], 'lf.connectTitle': ['Conectar Last.fm', 'Connect Last.fm'],
  'lf.desc': ['Introduce tu usuario de Last.fm para compartir lo que escuchas (funciona con Spotify, Apple Music, Tidal y más).', 'Enter your Last.fm username to share what you listen to (works with Spotify, Apple Music, Tidal and more).'],
  'lf.placeholder': ['Tu usuario de Last.fm', 'Your Last.fm username'], 'lf.connect': ['Conectar', 'Connect']
});

// ---- Fixed text in index.html (its Spanish is written in the page) ----
addEnglish({
  'land.tagline':  'Two-colour cards, one power in your hand. Change colour before anyone else.',
  'land.howTitle': 'How to play',
  'land.how1':     'Play a card that matches the table card\'s <strong>colour, number or symbol</strong>, or a wild. Can\'t? Draw one. Down to one card? Shout <strong>LAST CARD!</strong>',
  'land.how2':     '<strong>🦎 Chameleon cards</strong> have two colours: they go on either one, and <strong>you choose</strong> which colour they become.',
  'land.how3':     '<li>You hold a <strong>⚡ power</strong> token. While it\'s charged, playing a chameleon card lets you use its power: <strong>☔ Rain</strong> (everyone else draws 1), <strong>🔁 Again</strong> (play again), <strong>🎁 Gift</strong> (give someone a card) or <strong>✌️ Double</strong> (drop another card of the same colour).</li><li>Your token recharges when a <strong>+2</strong> or <strong>Wild +4</strong> makes you draw. The <strong>🦎 Wild Chameleon</strong> recharges yours and switches everyone else\'s off.</li><li>A Wild +4 is only fair when you hold nothing of the colour in play — the next player can <strong>challenge</strong>.</li>',
  'land.how4':     'Empty your hand to win the round and score the cards everyone else holds. Play a single round or a match to 500.',
  'land.allRules': 'See all the rules →',
  'land.emoji': 'Pick an emoji', 'land.name': 'Your name', 'land.create': 'Create room', 'land.joinCode': 'Join with a code',
  'land.codePh': 'Room code (e.g. XK7M2P)', 'land.join': 'Join', 'land.players': 'Up to 10 players · No account needed',
  'lob.title': 'Waiting room', 'lob.code': 'Code:', 'lob.waitHost': 'Waiting for the host…', 'lob.leave': 'Leave room',
  'lob.share': 'Share the code with friends so they can join',
  'g.copyCode': 'Copy code', 'g.rules': 'Rules', 'g.chat': 'Chat', 'g.drawPile': 'Draw', 'g.discardPile': 'Table',
  'g.pass': 'Pass turn', 'g.playCard': 'Play card',
  'w.other': 'Join another room', 'w.next': 'Next round ▶', 'w.nextWait': 'Waiting for the host to deal the next round…',
  'chat.ph': 'Message…',
  'mp.title': 'Background music?', 'mp.desc': 'Adds some atmosphere to the game', 'mp.yes': 'Yes, with music', 'mp.no': 'No music',
  'rules.title': '📖 ¡CAMALEÓN! rules',
  'rules.goalT': 'Goal', 'rules.goal': 'Be the first to run out of cards. Each card must match the table card\'s <strong>colour</strong> or <strong>number/symbol</strong>, or be a wild. If you can\'t play, draw one: if it fits you may play it straight away, otherwise your turn passes.',
  'rules.chamT': '🦎 Chameleon cards', 'rules.cham': 'They have <strong>two colours</strong> (split corner to corner) and a number. They go down if the table asks for <strong>either of their colours</strong> or their number, and when you play one <strong>you choose which of its two colours it becomes</strong>: that is the colour the next player must follow. Each one also carries a power (the picture in the corner).',
  'rules.tokenT': '⚡ Your power token', 'rules.token': 'You start every round with your token <strong>charged</strong>. When you play a chameleon card you may spend it to use that card\'s power — or save it for later. It <strong>recharges</strong> when someone makes you draw with a +2 or a Wild +4. Everybody can see whose tokens are charged.',
  'rules.powersT': 'The four powers', 'rules.powers': '<strong>☔ Rain</strong> everybody else draws 1 · <strong>🔁 Again</strong> you play again straight away · <strong>🎁 Gift</strong> give one of your cards to anyone you like (you must keep at least one) · <strong>✌️ Double</strong> also drop another card of the colour you picked (its action doesn\'t count — and yes, it can empty your hand).',
  'rules.cardsT': 'Other cards', 'rules.cards': '<strong>+2</strong> next player draws 2 and loses their turn · <strong>⊘</strong> skip · <strong>⇄</strong> reverse (with 2 players it works like a skip) · <strong>Wild</strong> pick a colour · <strong>Wild +4</strong> pick a colour, the next player draws 4 and loses their turn · <strong>🦎 Wild Chameleon</strong> pick a colour, your token recharges and everybody else\'s switches off.',
  'rules.chT': '⚖️ Challenge', 'rules.ch': 'A Wild +4 is only fair if you hold no card of the colour in play (a chameleon card with that colour counts). The next player can <strong>accept</strong> or <strong>challenge</strong>. Caught out? You take the 4 and they keep their turn. Fair? They take 6.',
  'rules.unoT': '📣 LAST CARD!', 'rules.uno': 'When you have one card left, shout <strong>LAST CARD!</strong>. If someone catches you first, you draw 2.',
  'rules.ptsT': '🏆 Points', 'rules.pts': 'The round winner scores everyone else\'s cards: numbers = their value, chameleon cards = 20, +2/Reverse/Skip = 20, Wild = 40, Wild +4 and Wild Chameleon = 50. In a match, the first to 500 wins.',
  'rules.hereT': 'How to play here', 'rules.here': 'On your turn each card shows <strong>✓</strong> if you can play it and <strong>✕</strong> if not. Tapping a chameleon card or a wild opens a window to pick the colour and, if you like, the power. Hold a card to see it big with its rule. Tap another player to throw something at them.',
  'rules.ok': 'Got it'
});
