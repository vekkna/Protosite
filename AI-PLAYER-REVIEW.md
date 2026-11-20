# Seize the Day AI player review

17 November 2026 · Local browser-game source and headless rules engine · Classic and Reform

## What to improve first

Fix the moves the AI cannot see before spending more time looking ahead. I reproduced a legal draft that stops the AI on all three difficulties, a charge with a **99.22% chance of winning immediately** that Hard overlooks under both rulesets, and a Classic position where the engine allows a 90° turn but the AI generates no turn at all. Each has a small regression case and a local fix.

Keep Hard’s round simulation. Its willingness to save commands is sometimes the right play. In one existing test it appears to waste a second shot after routing its first target. I followed all 20 seeds through the whole round. In the 14 cases where the first target routed, Hard fired at the other target every time, after the opponent had moved. Changing its pass preference to satisfy the current assertion would reward the wrong behavior in those replays.

| Order | Change | Evidence | First acceptance check |
|---|---|---|---|
| 1 | Ensure the AI always completes a legal draft step | All three levels throw on a reachable terrain placement | The AI places the tile and proceeds to deployment |
| 2 | Generate short charges and Classic Extra Pivots | Hard overlooks a near-certain win. Four roster types lack their stand-alone turn in Classic | Engine-legal candidates appear, and Hard takes the winning charge |
| 3 | Repair the measurement tools | A test misses a later shot, draft draws are biased, and a diagnostic misvalues terminal states | Whole-round observations, browser-equivalent setup, and correct diagnostic scores |
| 4 | Improve threat estimates and the choice to pass | A field removes a possible charge while leaving the fast evaluation identical | Shortlisted alternatives reflect terrain and command timing |
| 5 | Improve bidding, deployment, and response time | Bid payoffs are approximate, deployment uses one row, and a measured Hard decision took 8.89 seconds | Held-out paired games and browser timings show benefits at acceptable cost |

## How the opponent makes a decision

The browser sends the AI a player’s observation. The engine removes the real dice seed, the other player’s unrevealed bid, and the terrain cards below the visible top card. The engine also validates hypothetical actions and supplies combat probabilities. This lets the AI value the chance of routing a unit, including the rout that ends the game, without predicting the real dice. Preserve this boundary when adding stronger bidding or draft search. [Engine observation and action application](engine.js) · [Browser turn runner](guided-play.js)

In the draft, the AI scores the unit’s profile and the terrain placement its selection permits. It then scores deployment locations against terrain, nearby friends, and visible opponents. In bidding, it constructs a payoff table for the possible bid pairs and samples a strategy. In the command phase, it proposes **whole activations** for each eligible unit, scores the resulting boards, and compares the best options with passing. The important distinction is between a legal move, a move the generator proposes, and a proposed move that survives to detailed scoring. A better evaluator can only help with the last two. [Decision code](ai.js)

| Level | Default command policy | Consequence for play |
|---|---|---|
| Easy | Scores single activations and samples among leading candidates | Can find an immediate attack, but often misses which of two units should act first |
| Normal | Looks for a follow-up on the five leading candidates, checks enemy replies for the shortlist, and considers attacks on shared targets | Recognizes combinations but can spend a command too early |
| Hard | Also plays the rest of the round for leading options and passing. It branches on opening dice outcomes above a small cutoff, then uses typical later outcomes with an expected-value correction | Can exploit the Master Tactician’s final turn. Its prediction depends on the simulated opponent’s choices |

The separate whole-turn beam planner is switched off. Its two-second setting does not cap the default Hard policy. Hard’s command choices have zero sampling temperature, but its bids and draft can still vary. [Difficulty settings and command selection](ai.js)

## What the current tests and games show

**All 19 tests in the AI and Reform test files passed.** The separate position suite produced the following results on the current working tree. These are Classic fixtures. A combination counts as passed only when it passes every configured seed. [AI tests](tests/ai.test.js) · [Reform tests](tests/reform-rules.test.js) · [Position suite](tools/positions.js)

| Level | Positional fixtures | Combination fixtures | Behavior that distinguishes the level |
|---|---:|---:|---|
| Easy | 7/8 | 3/6 | Missed both flanker-first sequences on all four seeds each |
| Normal | 8/8 | 5/6 | Completed the second-shooter case on 20/20 seeds, but spent both commands in the hold-a-command case on all three seeds |
| Hard | 7/8 | 5/6 | Passed both flanker-first cases and the hold-a-command case. The first-turn checks penalized two delayed shots |

**Whole-round follow-up.** I replayed the disputed positions with Hard on both sides and recorded engine events. In the stationary-archer fixture, Hard passed, the enemy moved, and the archer shot the intended infantry from its original position on its second turn. In the two-shooter fixture, Hard fired both shots at the damaged target on the six seeds where it survived the opener. On the other 14, Hard used its reserved command to shoot the fresh target. This accounts for all 20 seeds. It demonstrates that the shots were used against this opponent. An opponent who can deny the later shot gives a separate, stronger test.

**Whole-game check.** I ran Hard against Normal on seeds 6101 and 6102, swapping seats per seed in each ruleset. I applied each returned action directly through the engine, honoring game end and automatic activation closure. The eight games produced zero unexpected action rejections. The seed pairs are a smoke test. They are too few to rank the difficulties.

| Rules | Hard wins | Normal wins | Unfinished at the 30-round cap | Final round, in seed order with Hard as P1 then P2 |
|---|---:|---:|---:|---|
| Classic | 2 | 1 | 1 | Cap, 5, 11, 22 |
| Reform | 2 | 2 | 0 | 6, 10, 10, 7 |

The project’s larger historical comparison is a reason to retain Hard’s round search. The handover records **65 wins, 34 losses, and 5 unfinished** against v4 for the configuration with the early-resolution bonus. Conversely, the terrain-aware draft recorded **47 wins, 47 losses, and 6 unfinished** against the simpler draft. The former supports keeping the round model as the baseline. The latter leaves the competitive value of the draft weights open. These are historical runs with earlier inputs. [Handover run log](HANDOVER.md)

## Confirmed defects

### 1. A legal terrain placement can stop the draft

When the engine processes a pick, it looks for a legal placement on an 8-pixel grid. If that fails, it tries a finer 1.5-pixel grid before discarding the tile. The AI’s `bestTerrainSpot` only uses the coarse grid. In a narrow opening, the engine correctly requires placement, the AI finds no candidate, and `chooseDraft` reads `best.spot` from null.

I reproduced this from a new two-unit draft through legal engine actions. With an earlier hill centred at **(75, 161)**, the coarse search returned zero placements for the forest. The fine search found **(142.8911, 175.0486)**. The engine accepted it and advanced to deployment. Easy, Normal, and Hard all threw on the same state. The browser retries a failed worker calculation locally with the same input, so that fallback cannot resolve this particular error. The frequency in ordinary twelve-card games is unknown. [Draft legality](engine.js) · [Terrain selection](ai.js) · [Worker fallback](guided-play.js)

**Fix and verify.** Share a placement helper that returns coarse candidates when available and at least one fine candidate when necessary. Use the same helper for pick evaluation and actual placement. Keep the fine scan off the common path. Test the narrow opening, an ordinary placement, and a genuinely impossible placement that the engine discards. A similar guard belongs in deployment, where an empty sample would also be dereferenced. The terrain failure is the one reproduced here.

### 2. A short charge can disappear even when it wins the game

The move generator discards every forward move whose maximum distance is at most 0.3 inches. This also discards the move that makes contact and grants a strike. In a one-unit-per-side test, the engine offered a **0.1995-inch charge** against an unmarked unit already on six strain. Seven dice needing 4+ give a **127/128** chance of inflicting the one strain required for victory. The generator produced **zero strike plans**. Hard spent the command holding in Classic and passed in Reform. The probability comes from the engine preview before rolling. [Candidate generation](ai.js) · [Move and combat resolution](engine.js)

**Fix and verify.** Always generate a positive-distance charge offered by the engine, including in attack-only searches used to predict replies. Keep ordinary movement pruning separate. Test immediately below, at, and above the pruning boundary, plus a unit already touching its target. Assert both that the charge appears among the candidates and that Hard selects it in the winning position. Include a nearby blocking card so the fix continues to respect the engine.

### 3. Classic units with Mobility 0 have no stand-alone turning plan

Classic lets these units spend their action on an Extra Pivot. On an open board I placed a Mobility 0 shooter facing up the table with an enemy directly to its right. The engine allowed 90° in either direction and executed the clockwise turn. The AI generated only hold, advance, and withdraw. Under Reform it generated four turning plans on the same board. The Classic omission affects **Heavy Infantry, Heavy Cavalry, Halberds, and Crossbows**, eight of the 26 copies in the local roster. For Crossbows this matters twice. The generator also deploys them facing straight forward, so an opponent that leaves their firing lane can be difficult to reacquire. [Pivot rules](engine.js) · [Facing generation](ai.js) · [Roster snapshot](unit-cards-source.csv)

**Fix and verify.** Generate stand-alone turns from the engine’s pivot allowance and `usesAction` flag. Score the resulting firing or movement lane on the next activation. Compare a Classic crossbow that should turn, a unit whose turn would collide, and a Reform crossbow that needs a full about-face. Require the *candidate* wherever legal, and require its *selection* only in positions where turning has an established advantage.

A related omission affects mobile Classic shooters. I executed a shot followed by a legal 45° pivot with one free pivot left. The AI represents shooting as the last substantive action in its plan. Add a small set of post-shot facings when a changed angle affects the next shot or incoming contact. Re-query legality after a rout. Reform already closes the shooting activation and should retain that behavior.

### 4. Resuming an AI activation can forfeit its remaining action

The browser saves after applying each step of an AI order. When the AI receives a command state with an activation already open, its default policy immediately returns `endActivation`. I supplied the state immediately after activating the first archer in the focus-fire fixture. Two targets were legal and Hard ended the activation. This reproduces the decision used on resumption. I did not exercise the browser reload interaction. [Save, restore, and execution](guided-play.js) · [Open-activation handling](ai.js)

**Fix and verify.** Reconstruct the remaining options from `unitOptions`, especially a pending free strike, an unused shot, and remaining movement. If the UI instead persists the unexecuted part of an order, tie it to the exact saved state and validate every step. Test resuming immediately after activation, after charge contact, and after dice have already resolved. Count one command spent and one attack resolved across the save boundary.

## Improve decision quality after restoring move coverage

### Let terrain and positioning influence which moves reach detailed search

On an open board, the engine gave an attacker a **5.4995-inch charge**. Adding a slowing field beneath it capped movement at **4 inches** and removed the charge. The fast position evaluation was **−1.80034 in both positions**. The enemy-reply checker, which generates actual attacks, correctly changed its threat value from **5.13102 to zero**. These are internal evaluation units. This example isolates disagreement between two layers of the AI. It does not measure how often Hard subsequently chooses the wrong move. [Fast geometry and checked replies](ai.js) · [Terrain movement limits](engine.js)

The disagreement matters because Normal and Hard give detailed scrutiny to only a shortlist. Several similar advances can fill it before the safe alternative is examined. First, retain the best candidate from distinct units, targets, and purposes alongside the numerical leaders. Compare the fast estimate with the engine for borderline charges, slowing terrain, and crowded firing lanes. Record the rank of a known-good action before and after pruning. This will distinguish a missing move from a poor score.

For quiet moves, the current generator samples fixed fractions of forward distance and considers only straight-back withdrawals before any turn. It can finish a move with a turn toward the nearest enemy, but it does not generate a move–pivot–move detour around an obstacle. Add a few purposeful endpoints such as the first legal firing lane, a point just outside enemy contact reach, or a clear route around a blocking tile. Generate them when relevant and run each segment through the engine. Test both a worthwhile detour and a case where advancing would give away the winning rout.

### Compare passing with alternatives over the period that matters

The pass check returns before the shared-target combination challenger runs. A combination outside the ordinary shortlist therefore cannot overturn an early pass. The control flow is certain. The frequency with which it costs a game is unmeasured. Record cases where passing narrowly wins, then compare the strongest distinct combination with the pass on the same scoring basis. [Pass and combination selection](ai.js)

Hard’s simulation near a rout deserves selective attention. It treats the opening outcomes separately, then generally follows one typical result for later attacks. The expected-value correction adjusts the score but cannot choose a different subsequent move in an unexplored outcome. Start by branching a later attack where survival versus rout changes the target of the next action, unlocks a lane, or ends the game. The existing second-shooter fixture is a control. Add one where waiting lets the opponent escape or engage the shooter. Score the entire round and examine which target was actually available.

The unfinished Classic game illustrates a different problem. On seed 6101, with Hard as P1, the last rout occurred in round 11. Rounds 12–30 contained **43 attacks and 29 rallies with zero further routs**. The game reached the cap with two P1 units and one P2 unit routed. Both sides were already fighting. Increasing the evaluator’s existing pull toward the nearest enemy would address the wrong symptom here. Save the round-12 position and compare alternative target choices, attack order, and command reserves against the same response policies. Record the chance of converting attacks into a rout before the defender can rally. This replay establishes the pattern, while the best way out still needs a counterfactual test.

### Put a better value on initiative bids

The lower bid buys initiative and two opportunities to act, but also buys fewer commands. Ties keep the existing holder, with a special initial holder. The AI already models those rules. The weak link is the payoff assigned to each bid pair. It sums each attacker’s best estimated attack, discounts later attacks by 0.85, pays a fixed maneuver allowance, then uses 1.15 and 0.9 multipliers for turn order. The table can miss the value of escaping contact, rallying late in Classic, or claiming a decisive first activation. More iterations of its mixed-strategy solver would leave those payoffs unchanged. [Bid evaluation](ai.js) · [Bid and turn rules](engine.js)

Keep the inexpensive table to identify plausible bids. For Hard, replay selected close bid pairs from the same public pre-bid state through the round. Include the bid on either side of an initiative tie and the bid that buys one more valuable activation. Use common simulated dice streams or exact opening outcomes across alternatives. Check against fixed-low, fixed-high, and varying legal bidders. Measure the cost of the chosen bid against alternatives on held-out states, along with actual wins. Keep Classic and Reform results separate because the value of acting last differs when Rally is available.

### Give drafting and deployment a shared purpose

The draft already accounts for the visible tile. Its main unit score is still mostly the unit’s own stats. The deployment scorer considers matchups, but it receives candidates along a single depth at a single facing. A player can legally deploy at other depths and angles. A slow unit can therefore be committed to an unsuitable lane before the command AI takes over. [Draft scoring](ai.js) · [Deployment enumeration and validation](engine.js)

For the top few picks, evaluate a small set of legal pick–terrain–deployment combinations. Estimate a first useful activation, such as a clear projected shot, a reachable lane, or mutual support with an already deployed unit. Sample staggered depths and a few facings for low-mobility units. Use only the public top tile and visible units. Compare this policy with the current one while holding the battle policy fixed. Inspect first useful activation by unit type, obstructed deployments, and final results. The historical 47–47 draft comparison makes broad weight tuning a lower priority.

## Make strength and speed measurements trustworthy

**Use the same setup distribution as the browser.** Self-play shuffles with a random sort comparator. The browser draws unit copies without replacement and uses Fisher–Yates for the terrain deck. I generated the first 10,000 headless setups. With two copies of each of 13 types and 12 cards drawn, each type has an expected **9,231 copies** across that many browser-style uniform draws. Headless produced **11,321 Heavy Infantry** and **8,619 Cavalry**. It averaged **6.2487 named terrain cards** per 12-card deck against a uniform expectation of **6**. Initial card coordinates also differ, which matters because terrain must overlap the drafted card. Extract a shared seeded setup function and retain the old generator for reproducing historical runs. Record roster, engine, policy, generator, and seed with each result. [Headless setup](tools/selfplay.js) · [Browser setup](app.js)

**Make the test name match what it proves.** The full-game legality test checks that round two was reached. Its executor silently stops at the first rejected sub-action, so a successful activation followed by an illegal move can still count as progress. Keep tolerant behavior where appropriate in the UI, and use a strict executor for tests and tournaments. Treat a game ending mid-plan and an already-closed activation as expected. Fail on other rejections with the seed, rule, action, and preceding state. For position checks, use engine events and distinguish the first turn from the full round. Add performance and tactics fixtures for both rulesets. [AI smoke tests](tests/ai.test.js) · [Plan execution](ai.js) · [Position checks](tools/positions.js)

**Check the diagnostic before using it to tune.** On a terminal state I measured `evaluate` at **+1000** for the winner and **−1000** for the loser. Calling the exported `_roundValue` helper directly gave **0 for both**. Its leaf-cache lookup treats a null cache as a cached value. The normal Hard decision initializes a map before it evaluates rounds. Fix the uncached path and assert equal cached and uncached values before using the helper in bid experiments. The speed benchmark also reuses its on-disk position set by count alone. Give the corpus a version and input hashes so different local rosters or rules do not silently share it. [Round evaluation](ai.js) · [Benchmark cache](tools/bench.js)

**Test the player’s waiting time.** The following figures time `choose` for command decisions in the eight smoke games. Median and 95th percentile use observed decisions and nearest-rank percentiles. The two ruleset runs and replay work shared the machine. These figures expose long decisions and are unsuitable for predicting browser or phone speed.

| Rules | Difficulty | Command decisions | Median | 95th percentile | Slowest |
|---|---|---:|---:|---:|---:|
| Classic | Normal | 228 | 31 ms | 151 ms | 1,092 ms |
| Classic | Hard | 196 | 146 ms | 1,147 ms | 8,890 ms |
| Reform | Normal | 98 | 47 ms | 289 ms | 647 ms |
| Reform | Hard | 125 | 140 ms | 1,959 ms | 4,257 ms |

The browser adds a 500 ms pause before a command decision and separate waits for presenting actions. Instrument worker search, time to the first visible action, and total turn duration separately. Keep a completed legal choice available while refining alternatives, so Hard can return it at a measured time limit. Preserve immediate winning actions and passing as explicit candidates. Replay the slowest decisions on target browsers before choosing a budget. The worker keeps search off the main thread when available. Its current synchronous fallback makes expensive decisions particularly visible. [Browser pacing and worker fallback](guided-play.js) · [Worker entry point](ai-worker.js)

## Implementation and release sequence

1. **Restore correctness.** Freeze the reviewed policy together with its compatible engine and roster. Add the terrain, short-charge, Extra Pivot, and mid-activation fixtures. Repair the diagnostic and use strict action replay in tests. Gate each correction on its specific failing example.
2. **Establish a representative baseline.** Bring setup generation into parity with the browser. Keep a fixed corpus for comparing code changes and a separate set of withheld seeds for strength. Include open boards, blocked lanes, several shooters, near-rout decisions, and saved games. Capture redacted positions from human play when available.
3. **Change one decision at a time.** Compare terrain-aware candidate selection, full-round pass comparisons, and selective later dice branching independently. For each change, report positional regressions, wins/losses/unfinished, and command latency. Retain a more expensive search only when its advantage survives those comparisons.
4. **Validate difficulty and strategy.** Run Easy–Normal and Normal–Hard pairings under each ruleset as well as against the frozen policy. A practical first strength screen is the project’s 100 games per comparison, with sides swapped on 50 fresh seeds. Estimate uncertainty by resampling seed pairs and show capped games separately. Extend inconclusive runs if the decision matters. Keep draft and bid experiments isolated so that improvements can be attributed.

## Reproduction notes

The reviewed root working tree was based on commit `4c99297` and included local edits. Node was `v26.7.0`. The reviewed SHA-256 prefixes were `30E8DDAF00A3` for the AI, `3FE63A490933` for the engine, and `8142A52E0983` for the roster. The packaged site copies contained a different AI. Results here apply to the root source and local roster snapshot. The live deployment, real browser latency, and human playing strength were outside the measurements.

```powershell
node --test tests/ai.test.js tests/reform-rules.test.js
node tools/positions.js hard normal easy
node tools/selfplay.js 4 hard normal --offset=6100 --rules=classic
node tools/selfplay.js 4 hard normal --offset=6100 --rules=reform
```

The last two commands reproduce the matchups and outcomes. The timing table used direct per-command timing and strict engine replay. The ordinary tournament prints a different timing aggregate.

| Probe | Starting state and comparison |
|---|---|
| Short charge | One 60×40 unit each, seed 9, first pick P2, bids 1–1. P1 at (400, 400), facing 0°, Pace 6, Mobility 0, Melee 6. P2 at (400, 356), facing 180°, Defence 4, strain 6. Compare the charge from `unitOptions` after activation with `plansFor` before activation. Repeat in both rulesets. |
| Extra Pivot | Same footprint and bids. P1 at (400, 400), facing 0°, Mobility 0, Shoot 3, range 20. P2 at (600, 400). Compare the result of a legal clockwise 90° pivot with the complete generated plan list. |
| Slowing field | Same footprint and bids, both units fresh, Melee 6, Pace 6, Mobility 0, Defence 4. P1 at (400, 400), P2 at (400, 250), facing one another. Compare an empty board with a 70-pixel field at (394, 386). Inspect `unitOptions`, `evaluate(s, 'p1')`, and `replyThreat(s, 'p2')`. |
| Narrow terrain placement | Standard wide cards of width W = 88 × 20 / 25.4 and height H = 63 × 20 / 25.4. Tile diameter W. First pick P1, deck hills then forest. Put unowned A at (40, 122 + H) and B at (40, 121), both facing 0°. Pick A, place hills at centre (75, 161), deploy A at (280, 620), then pick B. Compare `terrainSpots(s)` with `terrainSpots(s, 1, 1.5)` and ask the AI to place the forest. |
| Deferred shots | Use `POSITIONS[3]` at seed 9 and `COMBINATIONS[3]` at seeds 9 + 101 × i for i = 0…19. Run Hard on both sides with decision randomness fixed at 0.5 until the round ends. Record every attack’s turn step and target ID from the engine events. |
| Draft draw frequencies | Call `newGame(seed, loadRoster())` for seeds 1…10,000. Count every copy in the twelve-card pool, including duplicates, and count named terrain tiles in the twelve-card deck before drafting. |
