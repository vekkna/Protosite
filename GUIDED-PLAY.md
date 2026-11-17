Rules-enforced play
===================

The site is a computer game, not a sandbox: every draft pick, bid, move, pivot,
attack and rally goes through the rules engine, and illegal orders are refused
with the reason.

Architecture
------------

- `engine.js` — headless rules engine (`SeizeEngine`). Pure functions over a
  plain JSON state; no DOM. Dice come from a seeded generator kept in the state,
  so the same state and action always give the same result.
  - `createGame(options)`, `apply(state, action)` (returns a new state, throws
    with a readable message if illegal), `legalActions(state)` (sampled list for
    an AI or for fuzzing), `unitOptions(state, unitId)` (move limits, charge
    targets, pivot limits, shoot/strike targets with odds), `attackPreview`.
- `guided-play.js` — the game client. Holds the engine state, redraws the board
  from it after each action, and turns board gestures into engine actions.
- `app.js` — tabletop renderer, lobby, saving and PeerJS networking. It calls
  the client through a handful of hooks (`canDrag`, `constrainDrag`,
  `dropPiece`, `constrainRotation`, `dropRotation`, `tap`).

- `ai.js` — the AI opponent (`SeizeAI`). For each unit it proposes whole
  activations (charge, shoot, advance, withdraw, face, rally, hold), has the
  engine validate them, and scores the outcomes using the exact dice odds. It
  looks one further activation ahead, bids from a small payoff matrix, and
  drafts and deploys by simple heuristics. It names no units and hard-codes no
  stats. It only sees `SeizeEngine.observe(state, player)`: no dice seed, no
  opponent bid, no terrain below the top tile. `ai-worker.js` runs it off the
  main thread. At hard level it also plays the rest of the round out before
  choosing; geometry answers are cached by exact unit positions to keep that
  fast (see HANDOVER.md, "Speed-ups"). Engine geometry caches must stay exact:
  they may never change a rules answer.
- `tools/bench.js` — times the hard AI on 60 fixed positions and counts how
  many choices match a frozen version.
- `tools/selfplay.js` — tournaments between AI versions and baseline bots:
  `node tools/selfplay.js 20 hard brawler`, or with weight overrides such as
  `hard:approach=0.03`. Add `--verbose` to print each decision.

Online games still send whole board snapshots after each action; the engine
state travels inside the snapshot. Bids stay on each player's own machine until
both are in.

Rules interpretations worth checking
------------------------------------

- Concealing terrain blocks any sight line passing through it, so a unit
  standing in a forest can neither shoot nor be shot (the rules' "shooting out
  of forest" example is still a TODO).
- "Loose formation" (Defence asterisk) is used for the shooting target number
  of 6; the older "Mobility 3 or more" wording in the stat list is ignored.
- Slowing terrain is ignored by units with a Pace asterisk.
- A unit may slide past a touching friend, but cannot pivot while within half a
  pixel of another unit, impassable terrain or the edge.
- A non-charging move stops 1 px (0.05 inch) short of an enemy.
- The top terrain tile must be placed if any legal position exists; it is
  discarded automatically only when none does or when it is open ground.
- A player with no commands left, or no unit left to command, passes
  automatically. An activation closes by itself when nothing more can be done.
- The outlined circular tile is the terrain feature.

Tests
-----

`node --test tests/*.test.js` — includes `tests/engine.test.js` (rules),
`tests/engine-fuzz.test.js` (random full games checked for illegal positions)
and `tests/ai.test.js` (tactical positions with one right answer, plus whole
games against a baseline bot).
