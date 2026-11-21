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
- `battle-ux.js` — pure movement/charge preview geometry, rotated-card ruler
  snapping and live AI order descriptions. Target route checks sample facings
  every 5 degrees plus target bearings. Highlighted charge targets use the
  engine's exact pivot and move checks. Extra Pivots that spend the action are
  excluded.

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
- `tools/rules-compare.js` — AI-v-AI games under `--rules=classic|reform` with a
  breakdown of activation kinds and per-unit results; `tools/rules-merge.js` merges runs.
- `tools/selfplay.js` — tournaments (`--rules=reform` for the variant) between AI versions and baseline bots:
  `node tools/selfplay.js 20 hard brawler`, or with weight overrides such as
  `hard:approach=0.03`. Add `--verbose` to print each decision.

Online games still send whole board snapshots after each action; the engine
state travels inside the snapshot. Bids stay on each player's own machine until
both are in.

Choose **Auto-draft both sides** from the deployment panel to finish drafting
and go straight to initiative bidding.

Movement planning and feedback
------------------------------

Select a unit on the field or in the roster. **N** cycles through fresh units.
The available order buttons highlight what you can do on the battlefield.
Drag the unit to move. To turn, select it and drag the ↻ handle behind it (it
moves in front when the unit's rear is at the board edge). Choose **Reform** before turning to
spend the action on a Reform. Select an outlined enemy twice to preview and
confirm an attack. **Undo** or **Z** reverses moves and pivots before a roll,
phase change or an online turn handoff.

**Undo** sits at the battlefield's bottom-left corner (just under it when there
is room). Movement outlines show how far the unit can advance or withdraw. Dragging
previews the destination, and the unit lands there at once on release; only the
computer's moves are animated. Drag the ↻ handle
to pivot and see the movement corridor update with the facing. The ruler snaps to
rotated card edges and reads to 0.01 inch. Unit profiles are in the sidebar. Hover
over terrain to read its rules.
The left sidebar shows the next action. The battle log on the right shows enemy
orders and previous results.
Shooting tracers, impact rings and strain text show attack resolution on the board.
Select an enemy unit to inspect its firing range, movement corridors and charge
targets during either player's turn. Unit names use smaller labels with
the shared card maker icons centred above them. `TEXT-EDITING.md` maps page text
to its source files.

Rules interpretations worth checking
------------------------------------

- Rules variant `rules: 'reform'` (chosen on the landing page, see HANDOVER.md): no Rally;
  Reform action turns up to 180 degrees with pivot clearance; pivots only in a Move
  (a pivot with no action yet starts one); a charge needs every pivot before moving.
- Rules variant `rules: 'v3'`: Reform, plus a run of consecutive pivots may pass through
  units, impassable terrain and the edge (only the facing after the last pivot must be clear;
  Reform is one turn, so it must end clear). Unlike the Reform Variant, Pace-asterisk
  units can't pass through friends.
  Shooting needs one clear line from the shooter's front-edge centre to the centre of a target edge that faces the shooter (the target blocks too); no cover modifier.
  Rally removes 1 strain (allowed while touching an enemy); a pivot before moving keeps the charge, one after starting to move loses it; a unit with 5+ strain can't attack (no Shoot, Strike or charge).
  No combat modifiers (no outflanking or height dice); a unit can only strike (or charge) enemies touching its front; hills slow units entering them, but not a unit that starts its Move on one.
- Rules variant `rules: 'v4'` (added 2026-11-21; text in `game-rules-v4.html`, from the
  Google Doc in `rules url.txt`). Built on V3, so `v3Rules(s)` is true for it too: same
  pivoting through obstacles, sight line and lack of dice modifiers; MT units may
  begin a Manoeuvre in contact with a pivot. Differences, each behind an engine helper:
  - no Reform (`reformAction`) and no Rally (`rallyAllowed`), so a Mobility 0 unit can never turn;
  - no 5-strain limit on attacking (`spent` is V3-only);
  - hills don't slow (`hillsSlow` is V3-only);
  - 6s roll no bonus dice (`explodingSixes`; `strainDist(pool, tn, explode)`);
  - a Pace asterisk does nothing (`ignoresSlowing`; designer ruling 2026-11-21, and the
    sheet has since dropped Light Infantry's asterisk);
  - Pivots never rule out a charge (designer, 2026-11-21, later): `canCharge` in `moveLimit`
    ignores `pivotedInMove` for V4. But a charger with no part behind the line extending
    the target's front edge can only charge that front (`behindFrontLine`, `chargeFrontOnly`;
    judged where the charging move starts, after any pivots; a corner on the line isn't
    behind it — my reading). A charge that would meet only flanks it may not charge stops
    short, with a reason. Guided play draws each nearby enemy's extended front line
    (dashed) and a gold front edge where only the front can be charged (`drawChargeFaces`).
  - Strike (and charge contact) may be against any touching enemy, front or flank
    (designer ruling 2026-11-21; `canStrikeAt` keeps V3's front-only test for `'v3'` only);
  - Shaken (`shaken`, `shakenSet`): a unit can't strike while an enemy's front edge
    (corners included) touches its flank and that enemy isn't Shaken. Settled from the
    outside in; units left in a loop of mutual flanking all count as Shaken (my reading,
    not yet confirmed by the designer). `unitOptions(...).shaken` drives a panel note.
  - "Turn to face" (an MT unit pivoting out of and back into contact) is not modelled:
    designer ruling 2026-11-21. Only a charge brings a unit into contact.
  - The shooting "whole target in front of the shooter" check is kept from earlier
    versions though the V4 text doesn't mention it.
- Turning during a Move into slowing terrain counts as entering it (all rule sets).

- Concealing terrain blocks any sight line passing through it, so a unit
  standing in a forest can neither shoot nor be shot (the rules' "shooting out
  of forest" example is still a TODO).
- "Loose formation" (Defence asterisk) is used for the shooting target number
  of 6; the older "Mobility 3 or more" wording in the stat list is ignored.
- Slowing terrain is ignored by units with a Pace asterisk (not in V4).
- A unit may slide past a touching friend, but cannot pivot while within half a
  pixel of another unit, impassable terrain or the edge.
- A non-charging move stops 1 px (0.05 inch) short of an enemy.
- The top terrain tile must be placed if any legal position exists; it is
  discarded automatically only when none does or when it is open ground.
- A player with no commands left, or no unit left to command, passes
  automatically. When a player's final move or pivot would end the round, the
  board lets them choose Undo or End round.
- The outlined circular tile is the terrain feature.

Tests
-----

`node --test tests/*.test.js` — includes `tests/engine.test.js` (rules),
`tests/engine-fuzz.test.js` (random full games checked for illegal positions)
and `tests/ai.test.js` (tactical positions with one right answer, plus whole
games against a baseline bot).
