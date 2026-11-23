# ¡CAMALEÓN! build plan (2026-11-22)

A "flex" style colour-matching card game built to the same standard as ¡VOLTEA!, UNO Fiesta,
UNO Mentiroso and VIRUS!, with its own name and look (not the Mattel product's name or art).
The GitHub repo is still called `unoflex`.

- 🦎 **Chameleon cards** (24 of 100) are split corner to corner between **two colours**. They go
  on either colour (or their number), and you **choose which of the two colours** they become.
- ⚡ **Power token**: everyone starts each round charged. Playing a chameleon card while charged
  lets you use that card's power, which spends the token:
  - ☔ **Rain**: everybody else draws 1
  - 🔁 **Again**: you play again straight away
  - 🎁 **Gift**: give one of your cards to a player you choose (you must keep at least one)
  - ✌️ **Double**: also drop another card of the colour you picked (it can win the round)
- The token **recharges** when a +2 or Wild +4 makes you draw. A 🦎 **Wild Chameleon**
  recharges yours and switches everybody else's off. Everyone's token is shown on their seat.
- Other cards: +2, Skip, Reverse, Wild and Wild +4. The Wild +4 can be challenged, and a
  chameleon card that has the colour counts as "having the colour".
- **¡ÚLTIMA!**: shout it when you're down to one card, or get caught (+2). Rounds score
  points (chameleon cards are worth 20), with an optional match to 500.

## How it's built (same setup as ¡VOLTEA!)
- `engine.js`: **all the rules in one place**, with no screen or Firebase code. Every move (players, bots,
  guided game, timer) goes through `Engine.apply(state, move, actor)`. A play move is
  `{t:'play', id, color, power?, gift?:{id,to}, extra?}`.
- app.js saves each move in **one Firestore transaction**.
- Effects and stats read the **events** the engine writes (`state.ev`: play, power, charge, draw…).
- Log entries are `{k, p}` and turned into words when shown (ES/EN).
- `node test-engine.js [games]` checks each card and power by hand, then plays thousands of
  bot games.
- Rooms are tagged `game: 'camaleon'` (all the games share the Firestore 'rooms' collection).

## Steps
1. [x] Rules engine + tests
2. [x] App shell and game screen: two-colour cards, ⚡ tokens on every seat and next to my hand,
       the colour indicator, a play window (pick the colour, switch the power on, choose the gift card +
       player or the Double card), the challenge panel, ¡ÚLTIMA!, the log; rainforest theme
       (camaleon.css); chat/voice/music/Spotify/Last.fm kept from ¡VOLTEA!
3. [x] Bots: 5 personalities (Petardo, Pintas the chameleon/power lover, Ahorrador keeps its
       token for the end, Farolero bluffs, Robo) and 3 levels; they choose colours and powers
4. [x] fx.js: the card shimmers into its new colour, ☔ rain over the table, 🎁 a card flying
       between seats, ✌️ the second card following, ⚡ recharge / switch-off, a 🦎 banner.
       extras.js: card zoom with the power's rule, awards (Tamer, Chameleon, Blackout…),
       badges (Chameleon master, Live wire, Double finish, Storm…), stats
5. [x] Guided first game (7 steps: colour, +2 with a recharge, chameleon card + 🔁 Again, Wild
       Chameleon, ✌️ Double, ¡ÚLTIMA!, win), ES/EN, rules window
6. [x] Icons, manifest, service worker, browser tests

## Testing notes
- `node test-engine.js [games]` covers the rules by hand plus thousands of bot games (2–10 players,
  joins/leaves/disconnects, shouts/catches). It checks that no card is lost or copied, cardCount and
  tokens stay in sync, every game ends, every state can be saved to Firestore, and all four powers get used.
- Browser checks (2026-11-22) ran with Playwright against an in-memory stand-in for Firebase,
  so no test rooms were written to the live database:
  - the guided game to the end
  - a full game against 3 bots (powers switched on through the real play window, winner screen)
  - English
  - the Wild +4 challenge panel and stamp, with the chameleon card shown as the reason
  - a match to 500 into round 2 with points kept
  - the gift window
  No page errors.
- Not yet tried: two real devices in the same online room.

## Before going live
- GitHub Pages: Settings → Pages → deploy from `master`, root. The game will then be at
  erwindank.github.io/unoflex/.
- Spotify sharing sends people back to this page after logging in, so add
  `https://erwindank.github.io/unoflex/` to the Spotify app's Redirect URIs.
- The old Mentiroso copy that was in this folder is kept on the local branch `old-mentiroso-copy`.
