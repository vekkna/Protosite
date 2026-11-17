Plan: round-level planning for the AI
=====================================

Written 2026-11-16 for whoever implements this next (human or model). It is
self-contained, but read `HANDOVER.md` first for the project state and
`GUIDED-PLAY.md` for the architecture.

Goal
----

Today the AI chooses one activation at a time (`chooseCommand` in `ai.js`): it
scores every plan for every unit, looks one activation further for the top
five, and plays the best. It never reasons about a *set* of activations, so it
finds combinations only by luck. The rules reward combinations heavily:

- a second attacker on a pinned unit gets the outflanking die (and the target
  loses one if it strikes back while outflanked);
- striking a unit that has not activated this round gets +1 die, so *who acts
  before whom* matters;
- the Master Tactician (MT) acts first and last, so holding commands for the
  second turn is a real option;
- a unit touching an enemy cannot pivot and, unless it is the MT's, cannot
  move, so pinning is a tool.

Deliverable: the AI plans its whole turn as a sequence of activations, plays
the first activation of the best sequence, and re-plans after each one. A
second phase uses the same machinery to bid.

Definition of done (phase 1):

1. New combination positions in `tools/positions.js` (see "Test positions"):
   the new AI passes at least 5 of 6; the current AI must fail at least 3 of
   them when they are first written (otherwise they are not testing this).
2. All existing positions still pass (8/8) and `node --test tests/*.test.js`
   is green.
3. Whole games: new AI v frozen baseline `v3` (freeze it before starting, see
   below) wins at least 58% of decided games over at least 200 games on two
   different seed ranges. If it does not, report the number honestly; do not
   tune until it does on the same seeds.
4. Median decision time under 1 s and 95th percentile under 3 s in Node on
   the `hard` level (measure with the selfplay tool's ms/decision plus your
   own p95).
5. `HANDOVER.md` updated: how it works, what was measured, what did not work.

Ground rules
------------

- The AI must only read `SeizeEngine.observe(state, player)`. Never read
  `state.rng`, the opponent's unrevealed bid, or terrain below the top tile.
- All legality comes from the engine. Do not re-implement rules in `ai.js`;
  build candidate actions and let `E.apply` reject the illegal ones.
- No unit names and no hard-coded stats. The designer changes units and
  numbers often. Derive everything from live unit fields and engine queries.
- Do not change rules behaviour in `engine.js`. Adding pure query helpers or
  performance work is fine; keep `tests/engine.test.js` green.
- Whole-game results are noisy: 40 games is about +/-16 points on a win rate,
  100 is about +/-10, 200 about +/-7. Use the positional suite for quick
  feedback and never claim a strength gain from fewer than 100 games.
- Report results that show no effect. Earlier in this project an entire
  evaluation term turned out to do nothing; that was only found by ablation.

What you are building on
------------------------

Engine (`engine.js`, global `SeizeEngine`, `E` below):

- `E.apply(state, action)` returns a new state or throws an `Error` whose
  message is player-readable. About 0.05 ms. States are plain objects; `apply`
  never mutates its input. Terrain objects are shared between states.
- Command-phase actions: `{type:'activate',unitId}`, `{type:'move',inches,
  backwards}`, `{type:'pivot',degrees}`, `{type:'shoot',targetId}`,
  `{type:'strike',targetId}`, `{type:'rally'}`, `{type:'endActivation'}`,
  `{type:'pass'}`.
- In a hypothetical state (from `E.observe`, or any state with
  `hypothetical: true`) attacks accept `forcedStrain: n` and rally accepts
  `forcedDie: n`. This is how the AI branches on dice.
- `E.unitOptions(state, unitId)`: for the unit being commanded: `forward` and
  `backward` (`max` inches, `charge: {distance, targets}`), `pivot` (`left`,
  `right`, `remaining`, `usesAction`), `shoot` and `strike` target lists with
  `preview` (`pool`, `tn`, `mods`, `dist`, `expected`, `routChance`).
- `E.attackPreview(state, attackerId, targetId, 'strike'|'shoot')`.
- `E.activePlayer(state)`; `state.turnStep` is 0 (MT first turn), 1 (other
  player), 2 (MT second turn); `state.commands[player]` is commands left;
  `unit.activated` is the command marker.
- Things that surprise people:
  - `apply` ends an activation by itself when nothing more is possible, and
    passes the turn by itself when a player has no commands or no unit left
    to activate (`skipEmptyTurns`). After any `apply`, re-read
    `E.activePlayer` and `state.phase` instead of assuming whose turn it is.
  - After a charge, the free Strike is optional; the activation stays open
    until `endActivation` or the strike.
  - A rout removes the unit from `state.units`. Look units up by id each
    time; never hold a unit object across an `apply`.
  - A charge is only a charge when the move equals `forward.max` and
    `forward.charge` is set. Pass `forward.max` itself as `inches`.

AI (`ai.js`, global `SeizeAI`):

- `plansFor(state, unit, me, attacksOnly)` returns whole activations as
  `{ name, unitId, actions, state, pending }`. `state` is the hypothetical
  state after the deterministic part; `pending` is the final dice action if
  any (`{type:'strike'|'shoot', targetId, dist}` or `{type:'rally'}`).
  About 40-80 plans per unit.
- `scorePlan(plan, me, W)` returns `{ value, typical }`: the expectation of
  `evaluate` over the dice outcomes, and the most typical outcome state with
  the activation closed.
- `evaluate(state, me, W)` / `assess` return a position value (and the rough
  threat part, `theirs`). Call only with no activation in progress.
- `replyThreat(state, me, W)`: value of what the enemy can really do in
  reply, from engine-generated enemy attack plans. Costs roughly one
  `plansFor(..., true)` per enemy unit.
- `chooseCommand(state, me, W, level, random)` is the function to replace.
  It returns `{ actions, note }`; `actions` is one whole activation (or
  `[{type:'pass'}]`). `carryOut` executes it and tolerates a plan that has
  stopped applying.
- Weights are in `DEFAULTS`; levels in `LEVELS`.

Tools:

- `node tools/positions.js hard v2` runs the positional suite for one or more
  players. A position is `{ name, state(), check(before, after, actions) }`;
  `check` returns `true` or a failure string. `exposure(state, unitId)` gives
  the enemy's best expected strain on a unit and whether it would be a flank
  attack. The harness currently lets the AI play only Player 1's first turn
  as MT with **one** command; you will need to let a position set the bids
  (see below).
- `node tools/selfplay.js N A B [--offset=K] [--verbose]` plays A v B with
  sides swapped per seed. Specs: `easy|normal|hard`, `random`, `brawler`,
  `passive`, frozen baselines `v1`, `v2`, and weight overrides such as
  `hard:beam=1`.

Step 0: freeze a baseline
-------------------------

    sed "s#require('./engine')#require('../../engine')#" ai.js > tools/baselines/ai-v3.js
    node tools/positions.js hard v3        # must be identical
    node tools/selfplay.js 20 hard v3      # must be close to 50%

Record both outputs in the run log at the end of `HANDOVER.md`.

Step 1: write the test positions first
--------------------------------------

Extend `tools/positions.js`:

- Let a position supply `bids` (already a parameter of `battle`) and a
  `turns` count, and let the runner keep calling the player until Player 1's
  turn ends or the round ends. Record every attack from the log (the existing
  regular expression does this) and the order of activations (add
  `activated: [unitIds]` by watching for `unit.activated` flipping).
- Add the positions below. For each, first confirm by hand, with
  `E.attackPreview` and the engine, that the intended sequence is legal and
  really is better; put the expected-strain numbers in a comment. Then run the
  current AI and note which it fails.

1. **Pin then flank.** Enemy unit `v` faces us. Our unit `a` is in front of
   it within charge reach; our fast unit `b` can reach `v`'s side. Two
   commands. Pass: both strike `v`, and the second strike has the
   "Target outflanked" modifier (check with `E.attackPreview` at the moment of
   the second strike, or parse "target outflanked" in the log line).
   Fail today if it attacks two different targets or sends `b` in first.
2. **Order matters: flanker's arrival makes the frontal unit's strike
   better.** Same shape, but `a` is already touching `v` (so `a` can strike
   without moving). Pass: `b` charges the flank *first*, then `a` strikes with
   the outflank die. This tests ordering specifically.
3. **Focus fire to rout.** Two shooters, two enemy targets: one at 4 strain,
   one fresh. One shot cannot rout the damaged one; two probably can. Pass:
   both shots go at the damaged unit (or the second goes there unless the
   first already routed it).
4. **Do not waste the second attacker after a rout.** As 3, but the first
   shot is very likely to rout. Because the AI re-plans after each
   activation, the check is on behaviour over many seeds: when the first shot
   routs, the second attacker must do something else useful (attack the other
   target), never "shoot" a missing unit or pass with a good shot available.
   Run 20 seeds; pass if it is right in all of them.
5. **Strike before they are marked.** We are MT with two commands. Enemy unit
   `v` is unactivated and reachable now. Passing and attacking in the second
   turn would lose the +1 unmarked die if the enemy activates `v` in between.
   Pass: attacks `v` in the first turn.
6. **Hold a command for the second turn.** We are MT with two commands and no
   attack available now; the enemy has units that must advance into our
   reach to do anything. Pass: uses at most one command in the first turn
   (so that one remains for the second). Be careful that this position has a
   defensible right answer; if you cannot convince yourself, drop it rather
   than encode a guess.

Also add one unit test per position family to `tests/ai.test.js` once the
behaviour is stable, so regressions are caught by `node --test`.

Step 2: beam search over the turn
---------------------------------

Replace the body of `chooseCommand` with a search over sequences of whole
activations for the current player's current turn.

Definitions:

- A **node** is a hypothetical state with no activation in progress in which
  it is still my turn, plus the list of activations that led to it and the
  probability mass it represents.
- A **move** from a node is one plan from `allPlans(node.state, me)` or
  "stop" (pass now, keeping any remaining commands for a later turn if I am
  MT in turn step 0, otherwise losing them).

Algorithm (start simple, then add the numbered refinements only if the
positions demand them):

    frontier = [root]
    finished = []
    for depth in 1..maxDepth:
        candidates = []
        for node in frontier:
            finished.push(stop(node))                    # stopping is always an option
            plans = allPlans(node.state, me)
            score each plan quickly (see "Cheap ordering")
            for the best `branch` plans:
                child = typical outcome of the plan       # scorePlan(...).typical
                child.expected = expectation bookkeeping (see "Dice")
                candidates.push(child)
        frontier = best `beam` candidates by quick score
        stop early if frontier is empty
    finished += frontier (as stops)
    for each finished sequence: final score = full evaluation with replyThreat
    choose the best finished sequence; return its FIRST activation
    (or pass, if the best sequence is empty)

Starting parameters: `beam = 6`, `branch = 8`, `maxDepth = min(commands left,
4)`. Put them in `DEFAULTS` (`beam`, `branch`, `depth`) so the selfplay tool
can override them, and make `beam: 1, depth: 1` reproduce today's behaviour
closely enough to act as an in-file ablation.

Details that matter:

1. **Cheap ordering.** Do not call `replyThreat` inside the search; it is the
   expensive part. Use `scorePlan(...).value` (which uses `evaluate`) to order
   and prune. Apply `replyThreat` only to finished sequences (at most
   `beam * maxDepth + 1` of them). This is the same "refine the leaders"
   pattern the current code uses with `W.probe`.
2. **Stopping.** For a stop node, build the state after `{type:'pass'}` and
   evaluate that, exactly as the current code does for `passed`. Remember the
   engine may already have passed the turn automatically when commands ran
   out; check `E.activePlayer(state) === me` before trying to pass.
3. **Dice.** The simple version follows only the typical outcome of each
   attack and scores the sequence by the value of the final typical state.
   That over-trusts plans that need a hit. First refinement, which positions
   3 and 4 will probably require: at an attack whose outcome decides the
   follow-up (rout or no rout), split into two children, "target routed"
   (probability `routChance`, state from `forcedStrain: need`) and "target
   survives" (state from the most likely non-routing strain), carry the
   probability on each child, and score a sequence as the
   probability-weighted sum over its leaves. Keep the split to rout / no rout;
   do not branch on every strain value. Cap total leaves per root move.
4. **Duplicates.** Activating A then B often reaches the same position as B
   then A. Before pushing a candidate, key it by the multiset of
   (unitId, rounded x, y, angle, strain, activated) for all units plus
   commands left, and keep only the best-scoring copy. Without this the beam
   fills with permutations of one idea. Do **not** merge when an attack is
   involved in either activation unless the keys really match, because order
   changes the dice (positions 1 and 2).
5. **What to return.** Only the first activation of the winning sequence,
   with `endActivation` appended as now. The caller re-plans next time with
   the real dice. Put the planned sequence in `note` (unit names and plan
   names) so `--verbose` shows the intent.
6. **Difficulty levels.** `easy`: beam 1, depth 1, keep the temperature
   sampling. `normal`: beam 3, depth 2. `hard`: full settings. Apply the
   temperature only to the choice among root moves.
7. **Time guard.** Track elapsed time with `performance.now()` (available in
   Node, browsers and workers) and stop deepening when a budget (say 1.5 s)
   is reached, returning the best finished sequence so far.

Likely cost: `allPlans` is about 300-480 plans per node; each plan costs a
few `apply` calls plus one `evaluate` per dice outcome. Budget roughly 30-60
ms per node today, so beam 6 x depth 4 is about 1-1.5 s. If that is too slow:

- Cache `plansFor` results per (unit, state key) within one search; most
  units' plans do not change when a distant friend acts. A safe invalidation
  rule: reuse a unit's plans only if no unit that moved, routed or changed
  strain is within (that unit's pace + the other's largest dimension + 2
  inches) of it or of any of its plan end points.
- Order plans by a cheaper proxy before full scoring: attack plans by
  expected `lossFrom`, moves by `evaluate` without the threat terms.
- Reduce `branch` before reducing `beam`.

Step 3: make the evaluation sequence-aware where needed
-------------------------------------------------------

Run the positions. Expected problems and fixes:

- *It still attacks two targets instead of one.* Check that the second
  attacker's plan list contains the flank charge at all (`plansFor` tries
  bearings at the target's centre, both sides and rear; a pinned target may
  need a bearing at the exposed side's midpoint from a different approach
  angle). Fix candidate generation before touching weights.
- *It will not pin because the pinning unit gets hurt.* That is the
  evaluation correctly pricing the risk; the sequence value should still win
  once the flank strike is included. If not, check the dice bookkeeping.
- *It stops too early or never holds a command.* Look at how the stop node is
  valued: `assess` counts my remaining commands through `chanceNow` only if I
  still have a turn to come. Verify with position 6 before changing weights.

Only after the positions pass, run whole games against `v3`.

Step 4 (phase 2): bidding from the same search
----------------------------------------------

Today `chooseBid` fills its payoff matrix from a rough per-unit estimate. With
a turn planner, estimate each cell by playing the round out:

1. For a bid pair (a, b), build the hypothetical state after both bids
   (`E.apply` twice on an observed state; you may set the opponent's bid in a
   hypothetical state because it is a hypothesis, not peeking).
2. Play the round with a fast policy for both sides: the turn planner at beam
   2, depth 2, typical dice outcomes, until the phase leaves `command`.
3. Cell value = `evaluate` of the resulting state from my side, plus the
   value of holding the tie for next round (a small constant; measure it).
4. There are at most 36 cells. Fill all of them with the cheapest policy
   (beam 1), then re-run the cells in or next to the support of the first
   solution with the better policy. Solve with the existing `solveMatrix`.
5. Budget about 2-3 s. Cache within a call; the units do not move between
   cells until the round starts, so the first node's `allPlans` can be shared
   by all cells with the same MT.

Test positions for bidding (add to `tools/positions.js` with a `phase:
'bidding'` flag, checking the *distribution* over, say, 200 random draws):

- Nothing can attack anyone this round: low bids should not dominate (there
  is no first-strike value) and the mix should not put most weight on 1.
- I have one decisive attack and the enemy has one decisive attack on the
  same pair of units: being MT is worth a lot; the mix should favour bidding
  low enough to win MT.
- I have four good attacks and the enemy has none: bid high.

Whole-game check: `hard` v `hard:bidRollout=0` over 200 games.

Step 5: tuning
--------------

Only after steps 2-4. The selfplay tool accepts weight overrides, so a simple
coordinate search is enough: for each weight in `DEFAULTS`, try x0.5 and x2
against the current settings over 100 games each on the same seeds, keep
changes that win by more than the noise, and repeat once. Log every run.

What not to do
--------------

- Do not add full Monte Carlo tree search first. With around 400 plans per
  node it needs a strong prior to be useful; the beam with the existing plan
  generator is the cheaper experiment. Benchmark MCTS later on the same plan
  generator and time budget if you want to compare.
- Do not insert an enemy reply after each of my activations. The enemy acts
  after my whole turn, not in between.
- Do not let the search read dice (`state.rng`) or use a non-observed state.
- Do not special-case unit types.

Reporting
---------

When finished, update `HANDOVER.md` ("How the AI works", "What has been
measured", "Known weaknesses", run log) with: positions passed before and
after, whole-game numbers with sample sizes and seed ranges, decision-time
median and p95, and anything tried that did not help.
