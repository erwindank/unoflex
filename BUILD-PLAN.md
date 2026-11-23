# ¡CAMALEÓN! build plan

A card game that plays by the **UNO Flex rules**, built to the same standard as ¡VOLTEA!,
UNO Fiesta, UNO Mentiroso and VIRUS!. It has its own name and look (¡CAMALEÓN!, rainforest
table, its own card art), not the Mattel product's name or art. The GitHub repo is `unoflex`.

- First built (2026-11-22) with its own "chameleon card + powers" rules.
- 2026-11-22 (on request): switched to match every UNO Flex rule from the official Mattel rule
  sheet (HMY99).

## The rules (as in the official UNO Flex sheet)
- Deck of 104 playing cards plus 8 Power Cards, so 2–8 players. 7 cards each. Numbers run 1–8.
  If the first table card is an action or wild card, it is passed over and the next number card is used.
- On your turn play ONE card matching colour, number or symbol. Otherwise draw one card, which
  you may play straight away if it fits. You may draw instead of playing even with a playable card.
- **Flex cards** have a normal side and a flex side. Playing the flex side needs your **Power Card
  on green** and turns it **red**:
  - Flex number cards match by their flex colour, but the **normal colour carries on**.
  - Flex Draw Two: every other player draws 1, and the next player still plays.
  - Flex Skip: SKIP ALL, so the turn comes back to you.
  - Flex Reverse: reverse, then the first player in the new direction is skipped.
  - Flex Wild Target Draw 2: a player you choose draws 2.
  - Flex Wild All Draw: every other player draws 2.
  - Flex Wild Draw Four: a player you choose draws 4.
  - On their normal side, Target Draw 2 and All Draw are plain wilds.
- A Power Card stays red until one of these happens:
  - every player is red at the same time (all turn green)
  - you play a number card with the **🔄 flip icon** (yours MUST flip, either way)
  - anyone plays a **Wild All Flip** (everybody's flips, and the player calls the colour)
- Classic actions: Draw Two (the next player draws 2 and loses their turn), Skip, Reverse (with 2 players it works like a skip).
- **Wild Draw Four** (normal side): only allowed with no card of the colour in hand, and any wild
  counts as a match. The next player either draws 4 and loses their turn, or challenges:
  - guilty: the player who played it draws 4, the challenger draws none and plays
  - fair: the challenger draws 6 and loses their turn
  The colour called stands either way.
- Shout ¡ÚLTIMA! at one card; if caught before the next player's turn, draw 2.
- Scoring: numbers count their face value, actions 20, wilds 50. Optional match to 500.

### Where the official sheet is silent (choices made here)
- Card counts per type (from a fan wiki deck list, which adds up to 112):
  - per colour: 1–8 classic and 1–8 flex number cards, plus one classic and one flex Draw Two, Skip and Reverse
  - wilds: 6 Wild All Flip, 2 Flex Wild Draw Four, and 8 other flex wilds, split here as 4 Target Draw 2 + 4 All Draw
- The 🔄 flip icon is on 2 classic number cards per colour.
- Flex colours go round the other three colours.
- After a targeted draw (even on the next player), play simply goes on with the next player, as the sheet says.

## How it's built (same setup as ¡VOLTEA!)
- `engine.js`: all the rules in one place. Every move goes through `Engine.apply(state, move, actor)`.
  A play move is `{t:'play', id, flex?, color? (wilds), target? (targeted flex wilds)}`.
- app.js saves each move in one Firestore transaction. Effects read the engine's events
  (`play {flex}`, `powerFlip`, `powerReset`, `skipAll`, `target`, `flexEffect`…).
- Log entries are `{k, p}` and are put into words in ES or EN when shown. Rooms are tagged `game: 'camaleon'`.
- `node test-engine.js [games]` checks every card side and Power Card rule by hand, then plays
  thousands of bot games (no lost cards, every game ends, nobody is left all-red, every state can be saved).

## Screen
- The play window opens for wilds (to pick a colour) and for flex cards while your Power Card is green.
  It shows the normal side and the flex side next to each other with what each one does. When only
  the flex side fits, it is picked for you. Targeted wilds also ask who draws.
- Every seat shows its ⚡ Power Card (green or red). Your own is shown next to your hand.
- Flex cards show a band of their flex colour across the foot and a 🦎 corner with what the flex
  side does. Flip-icon cards show 🔄.
- Guided first game: 8 steps (colour, Draw Two, flex side, 🔄 card, flex Skip, Wild All Flip, ¡ÚLTIMA!, win).

## Testing notes (2026-11-22)
- The rules tests pass, and 3,000 bot games ran with flex plays, all-red resets and targeted draws.
- Browser tests ran with Playwright against an in-memory stand-in for Firebase:
  - the guided game to the end
  - a full game against 3 bots
  - English
  - the Wild Draw Four challenge
  - a match to 500 into round 2
  - the target-picker window
  No page errors.
- Not yet tried: two real devices in the same online room.

## Before going live
- GitHub Pages: Settings → Pages → deploy from `master`, root (erwindank.github.io/unoflex/).
- Add `https://erwindank.github.io/unoflex/` to the Spotify app's Redirect URIs.
