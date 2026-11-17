Handover notes
==============

Read this first if you are picking the project up. `GUIDED-PLAY.md` has the
architecture and the rules interpretations; this file has the current state,
how to measure things, what has been tried, and what to do next.

Last updated: 2026-11-17. Branch `codex/rules-guided-play`. The rules-engine /
AI / guided-play work is committed; the card-maker and PDF work is not.

What exists
-----------

- A rules-enforced browser game (open `index.html` through any static server;
  `.claude/launch.json` starts `python -m http.server 8173`).
- `engine.js`: headless rules engine. Source of truth for all game state.
- `guided-play.js`: the game client (board gestures to engine actions, panel,
  overlays, AI turn runner). Exposes `GuidedPlay`.
- `ai.js`: the AI opponent (`SeizeAI`). `ai-worker.js` runs it in a Web Worker.
- `app.js`: older tabletop renderer, lobby, save/resume, PeerJS networking.
  Large and DOM-centred; the client talks to it through a few hooks.
- Rules source: the Google Doc linked in `rules url.txt`. `game-rules.html` is a
  copy made on 2026-11-16. The doc changes; re-check it before trusting the
  engine.

Modes: shared screen (two humans), online (PeerJS room code), and Play the AI
(landing page; human is Player 1 at the bottom, AI is Player 2).

How to check things
-------------------

    node --test tests/*.test.js          all unit tests (142; ~1.5 min, mostly the whole
                                         hard-v-hard smoke games; add
                                         --test-name-pattern=... for quick runs)
    node tools/bench.js current          hard-level speed on 60 fixed positions, and
                                         how many choices match v5 (--ref=vN)
    node tools/positions.js hard v1      positional suite, one or more players
    node tools/selfplay.js 40 hard v1    whole-game match, sides swapped per seed
    node tools/selfplay.js 40 hard v1 --offset=100    same, on fresh seeds
    node tools/selfplay.js 2 hard hard --verbose      print every AI decision

Player specs for the tools: `easy`, `normal`, `hard` (current `ai.js`),
`random`, `brawler` (always attacks or walks forward), `passive` (never acts),
and any frozen AI in `tools/baselines/ai-<name>.js` (see "Freezing AI
versions" below). Weight
overrides: `hard:approach=0.03,reply=0.8`.

Freezing AI versions
--------------------

Every AI version that is kept gets frozen as a numbered file, so that any later
change can be measured against it:

    tools/baselines/ai-v1.js   first AI
    tools/baselines/ai-v2.js   + engine-checked enemy replies (replyThreat)
    tools/baselines/ai-v3.js   + terrain-aware draft; the AI before round planning
    tools/baselines/ai-v4.js   + comboChallenger (combined attacks on one target)
    tools/baselines/ai-v5.js   + round play-out at hard level (playOut / roundValue)

Rules:

1. Before changing the AI's behaviour, check that the newest `ai-vN.js`
   matches the current `ai.js` (apart from the require path). If it does
   not, freeze the current one first.
2. Make the change in `ai.js`, behind a `DEFAULTS` weight where possible
   (`combos`, `playout`, `planner`), so `0` gives the previous behaviour.
3. Measure the new `ai.js` against the newest frozen version with both tools:
   `node tools/positions.js hard vN` and at least 100 games of
   `node tools/selfplay.js 100 hard vN --offset=<fresh seeds>`. Use an offset
   not already in the run log, so that no seeds are reused.
4. If the change is kept, freeze it as the next number and add a line to the
   list above and to the run log. If it is not kept, switch it off by
   default and say so in the run log.

To freeze (N = next number):

    sed "s#require('./engine')#require('../../engine')#" ai.js > tools/baselines/ai-vN.js
    node -e "require('./tools/baselines/ai-vN.js')"

Never edit a frozen file. Any frozen version can be played by name in both
tools (`v3`, `v4:combos=0`, ...). Whole-game results are noisy: 40 games
gives about +/-16 points on the win rate, 100 games about +/-10, so use the
positional suite for quick feedback and at least 100 games for a claim of
strength.

Consulting Astra
----------------

"Astra" is the designer's name for a second AI reviewer: OpenAI's Codex CLI,
running the model and medium reasoning effort set in
`%USERPROFILE%\.codex\config.toml`, with this project folder trusted. It is
used as a second opinion on designs, diffs and puzzling results, not to write
code. Its earlier reviews are in `docs-astra-review-round-planning.md` and
summarised in this file. Consult it before a large design step, and when a
measured result is surprising.

How to run it (Git Bash; the exe is not on PATH):

    CODEX="/c/Users/vekkna/AppData/Local/OpenAI/Codex/bin/5449c1f0f26f1f98/codex.exe"
    "$CODEX" exec -C . -s read-only "$(cat prompt.txt)" < /dev/null > astra-out.txt 2>&1

- `-s read-only` keeps it from editing files; also say "read-only, do not
  edit files" in the prompt.
- **`< /dev/null` is required.** Without it `codex exec` prints "Reading
  additional input from stdin..." and waits forever for input when run from
  a script or a background job. (In PowerShell use `$null | & $codex exec ...`.)
- The output file contains its whole working log; its answer is the last
  block after a line reading `codex`:
  `awk '/^codex$/{buf=""} {buf=buf"\n"$0} END{print buf}' astra-out.txt`
- It reads the repository itself, so the prompt needs only: what changed and
  where (function names), the measured results, and a few numbered questions
  with a word limit. It takes a few minutes; run it in the background.
- The folder name in the exe path is a version hash and changes when Codex
  updates; find the current one with
  `ls /c/Users/vekkna/AppData/Local/OpenAI/Codex/bin/*/codex.exe`.

How the AI works
----------------

`SeizeAI.choose(state, player, options)` returns a list of engine actions.

1. It only looks at `SeizeEngine.observe(state, player)`: dice seed zeroed,
   opponent's unrevealed bid removed, terrain below the top tile hidden. Dice
   results can be fixed (`forcedStrain`, `forcedDie`) only in such states.
2. Command phase, `chooseCommand`:
   - `plansFor(unit)` builds whole activations: hold, rally, strike, and for
     each candidate facing (current, at each nearby enemy's centre, sides and
     rear, directly away, +/-45/90) the pivot, then shoot, or move by several
     fractions of the limit, or charge and strike, optionally ending with a turn
     to face the nearest enemy. Every step is applied through the engine, so
     only legal plans survive.
   - `scorePlan` averages `evaluate` over the dice outcomes of the plan's
     attack (exact distribution from the engine) and keeps a "typical" outcome
     state.
   - The top 5 get a one-activation lookahead (`lookahead` weight).
   - The top `probe` (8) and the pass option are re-scored: the evaluation's
     rough threat term is replaced by `replyThreat`, which generates the
     enemy's real attack plans with the engine from the resulting position.
   - It passes if nothing beats passing by `passMargin`.
   - `comboChallenger` (`combos: 1`): if two or more commands remain, the
     best attack by each unit on each target that another unit can also
     attack (frontal and flank contact kept apart) challenges the choice.
     Challenger and current choice are valued the same way: the average over
     every dice result of the first attack (`outcomesOf(plan, 1e-4)`) of the
     best attack still to come this turn or stopping (memoised by exact state
     key, never crossing into another turn), plus the usual `replyThreat`
     correction after the first activation. It wins only by `passMargin`.
     This is what lets a weak flanker charge first so that the heavy hitter's
     strike also gets the outflank die.
   - Hard level only, `playOut` / `roundValue` (`playout: 1`): the probe step
     instead plays the rest of the round out for each leading option and for
     passing. Each exact dice result of the option is followed by both sides
     greedily taking their best single activation with typical dice, each
     later attack credited with its true average (`playoutAdj`). The end of
     the round is valued with `evaluate` plus next-round `replyThreat`, and
     options that roll dice now get `resolveFirst`. The lookahead bonus is
     not added (the play-out contains the follow-ups), and `comboChallenger`
     uses the same valuation. This is what lets the Master Tactician keep a
     command for its second turn.
3. `evaluate` (in `assess`): strain and routs for both sides (curved so late
   strain counts more, plus progress to the rout threshold), a rough geometric
   estimate of attacks each side could still make (`pairThreat`,
   `threatTotal`), and a small pull towards the enemy that grows with the round
   number so that games do not stall.
4. Bidding, `chooseBid`: a payoff matrix over all bid pairs from a rough
   estimate of each side's best attacks, solved for a mixed strategy by
   fictitious play. Not based on playing rounds out.
5. Draft, `chooseDraft`:
   - Pick: stat-derived `unitAppeal` plus `terrainWorth` of the best legal spot
     for the top tile on that unit (drafting a unit decides where the tile
     goes), plus a little noise.
   - `terrainWorth(state, me, type, point)`: hills are good near my zone and
     bad near theirs; impassable and slowing ground is good in the enemy's
     half; cover favours whichever side is being out-shot; a blocked wing
     favours the side with fewer fast units. Army make-up is read from the
     units drafted so far.
   - Place: the legal spot with the highest `terrainWorth`, nudged towards
     lanes in front of deployed enemy units for obstacles.
   - Deploy, `deployScore`: fast units to the wings; what terrain lies in the
     lane ahead (hills good, impassable or slowing bad for movers, cover bad
     for shooters); expected strain exchanged with enemy units already
     deployed opposite; staying near friends.
   - `draftSmart: 0` restores the first version (`chooseDraftSimple`) for
     comparison.

Nothing names a unit or hard-codes a stat. Weights are in `DEFAULTS`.

What has been measured
----------------------

- v1 (first AI, frozen in `tools/baselines/ai-v1.js`): 6-0 v random, 12-0 v
  brawler, 8-0 v passive in about 6.5 rounds. Switching off all its threat
  terms made no measurable difference (14-13 over 30 games), i.e. its
  positional judgement was not doing anything.
- A tactical test found v1 valued a threatened attack above making it
  (potential attacks were counted for this round and next). Fixed by taking the
  larger of the two and weighting it below 1.
- Current AI (v1 plus `replyThreat`): positional suite 8/8 against v1's 6/8
  (v1 leaves a flank open and walks a lone unit into two enemies). Whole games
  against v1 over two runs on different seeds: 74-42 with 4 unfinished in 120
  games, 64% of decided games (+/-9), so the improvement is real.
- Terrain-aware draft (pick, placement, deployment) v the original draft
  with the same battle AI: 47-47 with 6 unfinished over 100 games (50% +/-10).
  No measurable gain in strength. It does behave as intended in set positions
  (four tests in `tests/ai.test.js`: hill on its own side, swamp in the enemy's
  way, no deploying movers behind impassable ground), so the likely reading is
  that the hand-set terrain values are too small or wrong to matter, or that
  the battle AI does not yet exploit terrain. Kept on because it looks more
  sensible to a human opponent; treat its values as unproven.
- Aggression weights (`approach` 0.012 to 0.06, `chanceNow`, `nextRound`) made
  no difference to how fast it beats the passive bot; about 6-7 rounds looks
  close to the floor given unit speeds.
- Combination challenger (2026-11-17), v v3: 52-44 with 4 unfinished over
  100 games (54% +/-10), 157 v 124 ms per decision. No measurable gain in
  whole games, but it solves pin-then-flank and order-matters (combinations
  3/6 -> 5/6, positional still 8/8) at little cost, so it is on.
  A first, broader version (exact two-step value for the top 6 plus all
  combination candidates, with move follow-ups, replacing the lookahead) went
  43-53 at 3x the cost and was dropped. Astra's reading: v3 already finds
  ordinary follow-ups, order-dependent combinations are rare, and wider
  search amplifies evaluation error, made worse because the follow-up was
  valued but the threat correction was still taken after the first
  activation only.
- Speed: roughly 0.1-0.15 s per decision in Node (0.2-0.3 s with two
  shooters able to fire on shared targets).

Known weaknesses and gaps
-------------------------

- Bidding is a rough estimate, and the AI does not plan to hold commands back
  for the Master Tactician's second turn except through the pass comparison.
- No planning across a whole round: it chooses one activation at a time with
  one step of lookahead. Combined attacks happen by accident.
- `replyThreat` assumes the enemy's attacks are independent and looks only at
  attacks, not at enemy moves that set up next round.
- Draft terrain values are hand-set priors (see `terrainWorth`), not learned;
  the AI does not consider which tile its pick leaves face up for the
  opponent, and it always deploys at the front edge of its zone.
- The positional suite has 8 positions and the current AI passes all of them,
  so it no longer discriminates. Add harder positions before the next change.
- Difficulty levels are not validated as a ladder (hard v easy not measured).
- Not tested: a real two-machine online game, Player 2's flipped board view,
  touch input. Online play sends whole snapshots and does not validate the
  other side's moves.
- The pivot check samples whole degrees with half a pixel of clearance. This
  cannot let a unit pass through anything, but can refuse a legal turn by under
  a degree.

Suggested next steps
--------------------

1. Play it. A few human games will show which weaknesses matter; add each
   mistake you see as a position in `tools/positions.js`.
2. Round-level planning: beam search over the sequence of activations in a
   turn instead of one at a time. A full implementation plan, with test
   positions and acceptance criteria, is in `PLAN-ROUND-PLANNING.md`.
3. Bidding from rollouts (phase 2 of the same plan).
4. Tune `DEFAULTS` automatically with the self-play tool once the above is in.

Open rules questions for the designer
-------------------------------------

Listed in `GUIDED-PLAY.md`. The two that change play most: whether a unit in a
forest can shoot or be shot, and whether "hard to shoot" comes from Mobility 3+
(stat list) or the Defence asterisk (combat section; this is what is coded).

Run log
-------

- 2026-11-16: hard v v1, 40 games, seeds 1-20: 22-15, 3 unfinished.
- 2026-11-16: hard v v1, 80 games, seeds 101-140: 52-27, 1 unfinished.
- 2026-11-16: after the designer's first playtest, the top terrain tile is now
  shown for the whole draft (it is face up in the rules), not only during the
  placement step. Open-ground tiles are labelled "Open".
- 2026-11-17: hard (broad combos) v v3, 100 games, offset 500: 43-53, 4
  unfinished, 307 v 114 ms/decision. Dropped.
- 2026-11-17: hard (comboChallenger) v v3, 100 games, offset 600: 52-44, 4
  unfinished, 157 v 124 ms/decision. Kept.
- 2026-11-17: play-out experiments (suite only, see "Round play-out").
- 2026-11-17: hard:playout=1,rollouts=0 v v4, 104 games (4 parallel runs of
  26, offsets 800/813/826/839): 62-38, 4 unfinished (62% +/-10).
  1.3-2.0 s v 0.16-0.26 s per decision (4 runs sharing the machine).
- 2026-11-17: same, offsets 900/913/926/939: 60-41, 3 unfinished (59%).
- 2026-11-17: with resolveFirst, as switched on (hard v v4), offsets
  1000/1013/1026/1039: 65-34, 5 unfinished (66% +/-10). Frozen as v5.
- 2026-11-17: hard v v4, 4 games alone on the machine, offset 1100: 3-1,
  1053 v 115 ms per decision.
- 2026-11-17: after the exact speed-ups, hard v v4, the same 4 games
  (offset 1100): 3-1 again, 263 v 50 ms per decision. `tools/bench.js`:
  same choice as v5 60/60, 271 v 721 ms on the same machine load.
- 2026-11-17: hard v hard:draftSmart=0, 100 games, seeds 301-350: 47-47, 6
  unfinished. (The ms/decision figures in that run were inflated by the
  machine being busy or asleep; ignore them.)

Round-level planning: paused mid-way (2026-11-17)
-------------------------------------------------

Work on `PLAN-ROUND-PLANNING.md` was stopped by the designer partway through.
State at the pause:

- Baseline frozen: `tools/baselines/ai-v3.js` (the AI before any planner work).
- Step 1 done: `tools/positions.js` now has six "combinations" positions and
  runs a player's whole turn (`bids`, `prepare`, `seeds`, `--only=`). The
  suite loads its helper from the v3 baseline, not `ai.js`. Current AI
  (planner off): `8/8 positional, 3/6 combinations`. It fails pin-then-flank,
  order-matters and hold-a-command. Note from the agent that wrote them: the
  plan's wording for position 1 was backwards. Under these rules the flanker
  should arrive first, because its arrival gives the outflank die to every
  later striker. The positions encode flanker-first. Position 6
  (hold a command) is the least certain of the six.
- Step 2 started: `planTurn` in `ai.js` (beam search over activations,
  branching opening attacks on every dice outcome). It is switched OFF
  (`DEFAULTS.planner: 0`); the game uses `chooseCommand` as before. With it on,
  one AI unit test failed (flank-charge test: it moved a spare unit first) and
  it went 1-3 against v3 in a 4-game smoke test. Not evaluated further; do not
  switch it on without running the positions and at least 100 games.
- Astra's review of the plan is saved as
  `docs-astra-review-round-planning.md`. Its main points, not yet acted on:
  back up expectation at dice nodes and maximum at decisions (partly done);
  value leaves after a cheap play-out of the enemy's turn rather than with
  `replyThreat` on an unchanged board; protect two-attacker combinations
  before pruning; and try a simpler targeted two-activation combination
  generator on top of `chooseCommand` before the full beam. That last
  suggestion has now been done (`comboChallenger`, see above; Astra's second
  review of it is summarised under "What has been measured").

Round play-out: on at hard level (2026-11-17)
---------------------------------------------

`playOut` / `roundValue` in `ai.js`. On for the hard level only
(`LEVELS.hard.playout`, `DEFAULTS.playout: 1`, `rollouts: 0`); normal and
easy play as v4. `hard:playout=0` gives v4.
For the leading options and for passing, the rest of the round is played
out (each side greedily takes its best single activation by `scorePlan`,
or passes) and the end-of-round state is valued with `evaluate` plus
next-round `replyThreat`. The opening keeps its exact expected value; only
the difference the rest of the round makes is estimated. `rollouts: 0` uses
typical dice in one deterministic play-out; `rollouts: N` averages N
play-outs with sampled dice (seeded streams shared across options, opening
dice stratified). With `playout: 1` the lookahead bonus is not added (the
play-out already contains the follow-ups) and `comboChallenger` uses the
same valuation.

Suite results (v4: 8/8 positional, 5/6 combinations):

    first version (typical dice, lookahead counted twice)   7/8, 5/6
    rollouts=0 (typical dice, no double count)              7/8, 2/6
    rollouts=6                                              6/8, 1/6
    rollouts=16                                             6/8, 4/6
    (fixture fix below, leafWin cap, exact opening outcomes:)
    rollouts=0, exact opening outcomes, typical after       8/8, 4/6
      same with leafWin=10 or 3                             8/8, 4/6
    rollouts=16, leafWin=10                                 7/8, 4/6
    rollouts=0, exact opening + carried dice gap           7/8, 5/6

`rollouts: 0` now branches every exact result of the opening and plays
each on with typical dice, while carrying the gap between each later
attack's true average value and its typical result (`playoutAdj`), as
`planTurn` does. Without that gap, a 73% rout later in the line counts as
certain: shooting the fresh unit first then looked better than finishing the
damaged one. `leafWin` (a smaller near-win bonus in play-out leaves) made
no difference on the suite. With the gap carried, the two remaining
failures are both the Master Tactician holding its command for the second
turn (archers wait instead of shooting; after a rout the second shooter
waits). Those may be fair choices; whole games decide. Cost: 50-400 ms
per decision, up to 2.2 s with two shooters (v4: 6-300 ms).

It is the only thing that passes hold-a-command, but it loses the flank
charge, pin-then-flank, order-matters, focus fire and strike-unmarked.
What the traces show:

- Typical dice are too crude: a typical rally removes exactly 2 strain,
  which cancels a typical attack, so positional terms decide.
- Sampled dice are too noisy: values near a win are heavy-tailed (a rout
  that brings the enemy one rout from defeat scores 20+), so 6 play-outs
  let a lucky pass beat a good shot. 16 is better but still loses
  positions and costs much more time.
- The greedy play-out lets the Master Tactician hold its command and rally
  after being hit. Astra agrees this is a legitimate choice, so
  "takes the flank charge" claims more than it should: it should compare
  flank v frontal charge only when the unit charges, or use a position
  with no hold-and-rally alternative. "Strikes the unmarked enemy now"
  needs the same review now that the enemy can spend its turn rallying.

Astra's advice (third review): replace this round's `replyThreat`
correction with the play-out and keep `replyThreat` only at the leaf for
next round (done); don't use fractional expected-strain states (routs and
rally caps make them misleading); sampling will not fix the greedy policy or
a weak leaf evaluation.

Next, in order:

1. Done: "takes the flank charge" now has P2 as Master Tactician passing
   first, so P1 has no second turn to rally in. Still passes for v4.
   "Strikes the unmarked enemy now" left as is: striking first is still
   right there (waiting lets v strike a with the unmarked die first).
2. Done: the leaf noise fixes above. Whole games v v4: three runs of 104
   (see the run log), 187-113 overall, about 62%. Switched on for hard and
   frozen as v5.
   Also added `resolveFirst` (0.1): play-outs with typical dice cannot see
   that dice rolled now are known before later activations are chosen, so
   an option that rolls dice now gets a small bonus. Without it the AI
   advanced a spare unit before taking a 99% rout (the unit test "takes a
   rout when one is on offer" failed by 0.02).
   The unit test "shoots a target in range instead of doing nothing" now
   gives P1 its only turn of the round (P2 is Master Tactician and passes),
   because as Master Tactician the AI now holds the shot for its second turn,
   which is a fair choice.
   Cost: was about 1.05 s per decision at hard; after the exact speed-ups
   below, about 0.26 s (v4 now 0.05 s) measured alone in Node. It runs in
   the Web Worker, so the page stays responsive. Not yet timed in a real
   browser.

Speed-ups (2026-11-17, after consulting Astra). All exact: `tools/bench.js`
shows the same choice as v5 on 60/60 positions, the 4-game timing match
repeats its result exactly, and the line-of-sight key was checked against
the direct engine call 400,839 times with no mismatch. In order of effect:

- `ai.js` `makeCache`/`pairGeometry`: per-position geometry (contacts, high
  ground, which attacks each pair could make) is kept by an exact key of
  terrain and every unit's place, facing, size, side and stats. Positions
  in one search mostly differ only in strain and markers, and each new state
  has new unit objects that the engine's own caches miss.
- `clearShot`: line of sight keyed only by the two units and the units near
  the segment between their centres (within the larger unit's radius plus
  the other's), so a move elsewhere doesn't recompute it.
- `engine.js`: `overlapping` rejects on bounding boxes first; `gapBelow`
  stops the separating-axis test at the first separating axis (also used by
  the pivot scan); `shotError` skips blockers whose enclosing circle clears
  the sight triangle; `pivotLimit` caches its scan by exact geometry.
- Play-out continuations and leaves memoised by exact state within one
  decision (`playMemo`); comboChallenger reuses round values already
  computed; contact tested once per pair; Error stack traces switched off
  while choosing (the engine rejects illegal actions by throwing).

Rejected as not exact: bounding-box pre-checks against the pivot clearance
(SAT gap over edge normals can be smaller than a bounding-box gap).

Still open for the play-out:

- At hard it fails two suite positions, both the Master Tactician holding
  its shot for the second turn (archers; second shooter after a rout).
  Decide whether those fixtures are wrong (as with the flank charge) or
  the AI overvalues holding; a game against a human will show which.
- Cost is now about 0.26 s. If more is needed, Astra's next ideas change
  decisions, so they need matches against v5: adaptive probing (start with
  4 options, widen near ties) and a shortlist of quiet moves per unit in
  the play-out policy (keep every attack and rally). Most time is now the
  play-out scoring every plan of every step (`scorePlan` -> `assess`) and
  `plansFor`.
3. Planner leaves in `planTurn` need the same play-out once it works.
4. The suites are nearly saturated; add positions from real games.
