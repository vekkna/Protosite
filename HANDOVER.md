Handover notes
==============

Read this first if you are picking the project up. `GUIDED-PLAY.md` has the
architecture and the rules interpretations; this file has the current state,
how to measure things, what has been tried, and what to do next.

Last updated: 2026-11-26 (V5 rules added; see "Rules variant: V5"). Branch `codex/rules-guided-play`. The rules-engine /
AI / guided-play work is committed; the card-maker and PDF work is not.

What exists
-----------

- A rules-enforced browser game (open `index.html` through a static server:
  `Start Seize the Day.bat` runs `tools/serve.py 8173 --open`, and `.claude/launch.json`
  runs it on 8174). `tools/serve.py` sends `Cache-Control: no-cache`: with plain
  `python -m http.server` a browser kept a stale `unit-artwork.js` next to a new
  `app.js` and AI games hung on "Preparing battlefield" (2026-11-20).
- `engine.js`: headless rules engine. Source of truth for all game state.
- `guided-play.js`: the game client (board gestures to engine actions, panel,
  overlays, AI turn runner). Exposes `GuidedPlay`.
- `ai.js`: the AI opponent (`SeizeAI`). `ai-worker.js` runs it in a Web Worker.
- `app.js`: older tabletop renderer, lobby, save/resume, PeerJS networking.
  Large and DOM-centred; the client talks to it through a few hooks.
- Rules source: the Google Doc linked in `rules url.txt`. `game-rules.html` is a
  copy made on 2026-11-16. The doc changes; re-check it before trusting the
  engine.
- Unit stats source: the Google Sheet linked in `stats sheet url.txt` (tab
  gid 663136589) is authoritative. The browser game (`SHEET_URL` in `app.js`)
  and the card maker (`SOURCE` in `card-maker/server.py`) read it live.
  `unit-cards-source.csv` is a snapshot used by the headless tools and tests
  and as the offline fallback for the card maker and the game. Refresh it with
  `node tools/sync-stats.js` after the sheet changes. If the sheet can't be
  reached, the game uses its browser cache, then this snapshot, then
  `FALLBACK_DEFAULT_UNITS` in `app.js`. `tests/roles-stats.test.js` fails
  when that built-in list drifts from the snapshot, so copy the new values
  into it after a sync. Every new game or board reset reloads the sheet.
  Designer decision (2026-11-18): a resumed or rejoined game keeps the stats
  it started with (they are stored in the save), so a battle never changes
  mid-game and both online players share the same numbers.

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
    tools/baselines/ai-v6.js   v5 + the exact speed-ups; the AI before the Reform rules variant
    tools/baselines/ai-v7.js   v6 + Reform / Reform Variant / V3 support; the AI before V3 tuning
    tools/baselines/ai-v8.js   the V3-tuned AI as committed (ad3886b); the AI before V4 support
    tools/baselines/ai-v9.js   v8 + reading V4 correctly (c66fefb/c953539); the AI before V4 tuning
    tools/baselines/ai-v10.js  v9 + closeCharge + midCharge (V4 tuning, 2026-11-21)
    tools/baselines/ai-v11.js  v10 + V4 extra-pivot turns in plansFor (2026-11-25); the AI before pivotMove/fixedShots
    tools/baselines/ai-v12.js  v11 + pivotMove + fixedShots (2026-11-25 work, frozen 2026-11-26); the AI before V5 support

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
     strike also gets the outflank dice.
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
     deployed opposite; staying near friends, but not so close to a friend
     or the side edge that it can't pivot (`deployRoom`, added 2026-11-19;
     `deployRoom=0` packs units flush as before). Over 20 seeds the share of
     units deployed unable to pivot 45° both ways fell from 130/240 to 6/240.
   - Auto-draft (engine `automaticDeployment`, not the AI) also picks the
     nearest spot that leaves pivot room (`deploymentCramp`): 221/240 stuck
     before, 0/240 after. Covered by a test in tests/engine.test.js.
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

Unit balance study (2026-11-17)
-------------------------------

720 normal-v-normal games (seeds 5000-5359, sides swapped), per-unit stats from
attack/rout events plus a logistic regression of the winner on unit-count
difference (coefficient SE about 0.1). Strongest: Spears (+0.28, Def 6 is
very hard to strain), Fanatics (+0.25, ~5 strain per strike, most kills),
Archers (+0.24, range 24). Weakest: Mounted Archers (-0.26; they almost never
shoot, because moving and shooting are both the activation's one action).
Drill 0 melee units fight rarely (attacks per unit: Heavy Infantry 0.5,
Halberds 0.9, Heavy Cavalry 1.1, against 2+ for Drill 1+ melee units), since
they cannot pivot and still move, and a pivot mid-move forbids a charge.
Crossbows are not hurt by Drill 0 (180-degree arc, they stand still). Light
Infantry never used its 1*/4 shot. Caveats: normal AI, not hard; the pool
shuffle in `tools/selfplay.js` (`sort(() => rnd() - 0.5)`) is biased, so
Heavy Infantry appeared 832 times and Cavalry 555. Run before the 2026-11-17
sheet update (Light Infantry range 8, Archers 20, Crossbows 20, Mounted
Archers Def 3*), so it describes the old stats. That study also missed the
events of all but the last engine step of each AI decision, so its damage
totals are undercounts (the win regression is unaffected).

Second study (2026-11-18), on the sheet with Fanatics Melee 6 and one copy
each of Halberds, Lancers and Crossbows (23 cards; the sheet's total row says
21 and the rules say 24). 720 normal and 300 v4 games, with a fair pool
shuffle and every engine event captured. The spread is much tighter. Spears
stay strongest (+0.26 normal, +0.53 v4), Mounted Archers weakest (-0.17,
-0.35); Light Cavalry is strong under v4 (+0.22) because it hunts shooters.
Cavalry and Light Cavalry rout first (about twice their share of first
routs, round 5-6). Heavy Infantry still makes only 0.7 attacks a game.
Armies with 3 shooters win about 40%. Tweak test (normal AI): Drill 1 on
Heavy Cavalry overshoots (+0.33), Spears Def 5 overshoots the other way
(-0.17), Mounted Archers range 16 helps (-0.17 to -0.10).
Second tweak (Spears Def 5 Melee 3, Heavy Infantry Drill 1, Heavy Cavalry
Drill 1 Melee 3, Mounted Archers 3/16, Fanatics Melee 7), 720 normal and
300 v4 games: the flattest set so far under the normal AI (every unit
within +/-0.19, Spears 0.00), but under v4 Spears fall to -0.29 and
Fanatics rise to +0.20; Mounted Archers still -0.14/-0.15.

Rules variant: Reform (2026-11-17)
----------------------------------

The designer's new rules doc (`rules url.txt`, doc id 1Nj4...) removes Rally,
replaces Extra Pivot with Reform (the action: face any direction) and allows
pivots only during a Move; a charge is allowed if every pivot came before the
unit started moving. It is a switchable variant: `createGame({ rules: 'reform' })`
(default `'classic'`, unchanged). Code: `reformRules`, `pivotLimit(s,u,act,reform)`
and the `pivot` branch of `commandAction` in `engine.js` (a Reform is a pivot
action with `reform: true`, up to 180 either way, same clearance as a pivot);
`plansFor` (Reform plans for turns beyond 90 x Mobility; continuing a Move a
pivot started) and `pairGeometry` (no turn-and-shoot) in `ai.js`. Tests:
`tests/reform-rules.test.js`.

In the browser: a Rules toggle (Classic / Reform) on the landing page sets the
rules for new games and is remembered in localStorage (`seize-the-day-rules`);
a game keeps the rules it was created with (they are in its state, so saves
and online games carry them). When Reform is available, choose it and drag a
unit's ↻ handle to Reform (corners until 2026-11-21). A direct handle drag pivots within the ordinary limit,
or Reforms beyond it when legal. The drag label indicates when a turn starts
a Move or uses the action to Reform.

Interpretations (confirm with the designer): a pivot with no action yet starts
a Move, so the unit can no longer shoot or strike; a 0-inch Move with pivots is
legal; Reform needs clearance, so not while touching an enemy; pivots after
moving are allowed but forbid a charge.

Rules variant: V3 (2026-11-18, called Skirmishers until 2026-11-19)
--------------------------------------------------------------------

`rules: 'v3'` (`v3Rules` in engine.js; `normalizeRules` maps the old
'skirmishers' to it) is Reform plus the changes below. Charging follows the
Reform Variant: any pivot in the activation, even before moving, rules out a
charge (designer's correction, 2026-11-19). (1) A unit may pivot any number of times in a row;
only its position after the last pivot of the run matters (within the
battlefield, not overlapping a unit or impassable terrain). A pivot may end
overlapping only if a later pivot can still reach a clear facing
(`pivotEndError`); the activation then has `overlap: true`, which blocks moving
and `endActivation` until a pivot ends clear, and lets the unit keep pivoting
while touching an enemy. Reform is one turn, so it must end clear. `pivotScan`
keeps scanning past obstacles and returns `blocked: {left,right}` spans and
`chain` (another pivot follows); `pivotAllowed`, `pivotOverlap`, `nearestPivot`,
`overlapAt` in `engine.js`. Guided play shows the card turning through the
obstacle; on the last pivot it settles on the nearest clear facing, otherwise
it may stop overlapping and End activation is disabled. The AI drops plans
that stop overlapping.
(2) Unlike the Reform Variant, no unit may pass through friendly units
(`friendlyPassage` is Reform Variant only; a Pace asterisk still ignores slowing terrain). Rules page:
`game-rules.html?rules=v3` (Reform Variant text plus `v3-only` /
`not-v3` overrides). Tests at the end of `tests/reform-rules.test.js`.

(3) Line of sight (designer, 2026-11-20): one unobstructed straight line from the
centre of the shooter's front edge to the centre of one of the target's edges that the
shooter can see, not passing through blocking terrain or a unit. The target blocks too, so
only edges facing the shooter count (the firing point lies outside that edge's line; an
edge seen exactly side-on doesn't count). There is no cover modifier
(`COVER_DICE` was removed). `shotCheck` collects the blockers inside the sight fan
(the old all-of-it test; none means a clear shot) and then tests the four lines to
the facing edges' centres. Other blockers are the same as in the other rule sets (units
unless the shooter is elevated, concealing terrain, elevated terrain neither unit is on). The AI's `clearShot` now only says shot or no shot.
Firing arc and range are unchanged (target still wholly in front).

Interpretation: a move segment of a Pace-asterisk unit must still end clear of
friends (no pivoting while overlapping a friend mid-crossing).

Also fixed in both rule sets (found by Astra): turning during a Move into
slowing terrain now counts as entering it (sets the 4-inch cap, or the turn
stops short of the terrain once the unit has moved more than 4").

Measured with `tools/rules-compare.js` / `tools/rules-merge.js`, same seeds
both ways (normal 5001-5200, hard 7001-7024):

                          classic normal  reform normal  classic hard  reform hard
    mean rounds (p10/50/90)  9.8 (6/9/14)  8.1 (6/8/11)  10.8 (6/9/16)  7.8 (5/7/11)
    unfinished by round 30         5/200          0/200          1/24          0/24
    attacks per rout                5.90           4.39          6.20          4.54
    shots per game                   5.8            4.3           5.8           4.5
    Reform share of activations        -           3.3%             -          2.2%

Per unit (normal, ~180 fielded each, win% SE about 4): Heavy Cavalry 40 -> 46%
(Reforms in 19% of its activations), Lancers 42 -> 48%, Mounted Archers 48 -> 40%
(rout rate 52 -> 69%), Spears' strain dealt 4.0 -> 2.3 per unit. Rally was 13%
of classic activations (21% for Mounted Archers). Caveat: the AI's weights were
tuned under classic rules.

Rules variant: V4 (2026-11-21)
------------------------------

`rules: 'v4'`, from the new Google Doc (first line of `rules url.txt`; the V3 doc is the
second line). Rules page: `game-rules-v4.html` (its own file, not overrides in
`game-rules.html`; boxed notes give the app's readings). Landing-page button "V4".
V4 is V3 with these differences. `v3Rules(s)` is true for V4 too. Each difference has
its own helper in engine.js, all exported: `v4Rules`, `reformAction`, `rallyAllowed`,
`hillsSlow`, `explodingSixes`, `ignoresSlowing`, `spent`, `shaken`.

- No Reform, no Rally, no 5-strain attack limit, hills don't slow.
- No bonus dice for 6s: `strainDist(pool, tn, explode)`; `attackPreview` and
  `resolveAttack` pass `explodingSixes(s)`.
- A Pace asterisk does nothing (designer, 2026-11-21). The sheet dropped Light Infantry's
  asterisk the same day.
- Pivots never rule out a charge. Charge facing (rules doc, 2026-11-25, replacing the front-line test): at the very
  start of the Manoeuvre, a line from the charger's front-edge centre to the target's centre; if it crosses the
  target's front edge (corners included) only the front may be contacted. `lineThroughFront`, `chargeFrontOnly`;
  the start pose is `act.startPose`, set by the first pivot or move (BattleUX `facing` sets it for previews).
  Guided play draws that line to each enemy in reach and a gold front edge where only the front is open.
- Pivots may not touch another unit or blocking terrain (rules doc, 2026-11-25; V3 still sweeps through).
  `pivotThrough(s)` is true for V3 only. Read as: impassable terrain and the edge stop a turn too. Something
  already touching may be turned away from but not into (designer, 2026-11-25): in V4 such obstacles are tested for
  overlap (`limitOf` in `pivotScan`) instead of the 0.5 px clearance, so flush units can't turn either way but a
  corner touch blocks one way only.
- Moving in contact (rules doc, 2026-11-25): a unit touching an enemy's front (corners included) can't Manoeuvre
  unless it belongs to the Master Tactician and moves backwards (`frontHeld`). Touching only flanks or rears holds
  nothing. The MT unit may pivot first where it has room (designer); `act.heldBack`, set when the Manoeuvre starts,
  keeps the whole Manoeuvre backwards even if the pivot took it out of contact.
- No firing arc in V4 (designer, 2026-11-25): only the sight line counts, and the shooter's own card blocks it, so
  no line goes backwards. `shotArcError(s, u, v)` is the cheap pre-check (range only in V4). `pivotScan` now has soft
  obstacles (passed through, can't stop on: all of them in V3) and hard ones (stop the turn).
- Range (rules doc, 2026-11-25): measured along the sight line, from the shooter's front-edge centre to the centre
  of a target edge it can see; that edge centre must be within Range (`shotCheck`).
- Strike, and a charge's contact, may be against any touching enemy (designer,
  2026-11-21). `canStrikeAt` keeps the front-only test for `'v3'` only.
- Shaken: a unit can't strike (not even a charge's free strike) while an enemy's front edge
  touches its flank and that enemy isn't touching another unit of the Shaken unit's side (any
  contact; designer, 2026-11-21, replacing "unless that enemy is Shaken itself"). The flank
  test is `touchesFront(enemy, unit) && touchesFlank(unit, enemy)`. `unitOptions` returns
  `shaken`, and the orders panel shows a note. The AI measured as v10 used the old rule.
- "Turn to face" has been removed from the doc (2026-11-25); not modelled. A paragraph saying it counted as a
  charge was briefly in the doc that day.
- A unit that doesn't move forwards or backwards may pivot one additional time (rules doc,
  2026-11-25), so a Drill 0 unit can turn in place, including an MT unit turning to face a
  flanker. `pivotsAllowed` (Mobility + 1 until the unit has moved) and `extraPivotUsed` (no move
  after that extra pivot) in engine.js; the AI's `plansFor` considers turns of 90 x (Mobility + 1).
- In the doc but with no effect: Obscuring terrain (no sample terrain has it) and "higher" units (the doc points to a
  Height section it doesn't have; no dice).

AI: v8 frozen first, then small changes so the AI reads V4 correctly. `pairGeometry` counts
no contact strike by a Shaken unit. Shooter facing estimates use `reformAction`, not
`reformRules`. Attack values use `explodingSixes`. Terrain and deployment treat hills as
slowing only in V3, and Pace asterisks only outside V4. Tests: `tests/v4-rules.test.js`.

V4 tuning (2026-11-21, frozen as v10). Under V4, v9 against itself left 32 of 80 games
unfinished at round 30: armies ended up a fraction of an inch apart and both passed for
ever (V4 has no round limit and no bonus dice). Two causes, both fixed in `ai.js`:

- `closeCharge` (all rule sets): `plansFor` only made forward moves when `forward.max > 0.3`,
  so a charge of under 0.3" was never planned and units left that close never charged.
  It now also plans a charge of any length. The classic positions suite is unchanged
  (7/8, 5/6, the same two known failures as v9).
- `midCharge` (V4 only): pivots no longer cost the charge, so `midMoveCharges` adds plans
  that advance, pivot towards an enemy's centre, flanks or rear, then charge. This is
  what produces flank charges that leave the target Shaken.
- Tried and switched off (no measurable gain once the two above were in): `urgency` (a
  side level or behind on routs discounts its own losses late in a battle) and
  `stuckDraft` (draft penalty for Drill-0 units, which can never turn in V4).

`tools/v4-probe.js` plays V4 games and counts charges, flank charges, mid-Move pivot charges,
strikes, shots and Shaken units per side (it steps through each decision's actions because
the engine keeps only the last action's events).

Rules variant: V5 (2026-11-26)
------------------------------

`rules: 'v5'`, from the V5 Google Doc (first line of `rules url.txt`; a text copy is in
`docs/rules-v5-2026-11-26.txt`). Rules page `game-rules-v5.html`; landing-page button "V5". The designer's working
title for the doc was "Seize 11 Set Moves"; the rule set is called V5 (designer, 2026-11-26). Details of the engine
readings are in GUIDED-PLAY.md. In short: V4's shooting, Shaken, dice and terrain (`v4Rules` is true for V5;
V4-only movement now tests `v4Only`), hills slow units entering them again, and new movement (`v5Rules`): March
(pivots only at the start or end, no contact with anything), Charge (edge picked by the start line, at most one
pivot before moving, hinge flush, slide along the edge until touching its centre (designer's addition, same day),
free strike at the target), Reform (any facing, only the end checked), Withdraw
(Master Tactician's engaged units: `faceAbout`, then a March without pivots), engaged units otherwise only Strike,
and a strike on a flank needs 3s. Tests: `tests/v5-rules.test.js`.

Open questions for the designer (sent with the V5 review, 2026-11-26): see the run log entry of that day.

AI for V5 (2026-11-26): v12 frozen first. New weights, both on: `v5Aim` (plansFor aims charges at points along each
enemy's one chargeable edge, offers a Reform where a pivot would touch something, and plans Withdraws: face about,
then March away, or just face about) and `v5Threat` (pairGeometry: a charge allows one pivot whatever the Mobility,
and a charge or strike on a flank uses a target number of 3). `midCharge` and the extra-pivot turns are V4-only now.
`tools/v4-probe.js` takes `--rules=v5` and also counts Reforms and face-abouts.

Run log
-------

- 2026-11-26: V5 rules added (see "Rules variant: V5"). Stats sheet synced: Heavy Infantry Melee 8, Light Infantry
  Drill 4, Light Cavalry 3/3/3/12 (now shoots), Crossbows 2*/18, Mounted Archers Quantity 0 (out of the pool);
  `FALLBACK_DEFAULT_UNITS` copied. `tools/selfplay.js` and `tools/balance/study.js` read Quantity 0 as 0 (it was 1).
  AI: v12 frozen, then `v5Aim` and `v5Threat`. NOT measured: the designer stopped the measurement (rules likely to
  change soon; playtesting by hand). Only checked: tests, the classic positions suite (same 2 known failures), and
  single hard games (new v new, v12 v v12, new v v12 on 6 seeds both ways; all finish in 7-17 rounds, about 1-3 min).
  Do not freeze v13 until it is measured. Warning: `tools/v4-probe.js 10 hard ...` ran for 6+ hours without finishing
  under V5 (workers at ~2 GB each, so probably cache growth in a long process); one game per process was fine
  (scratch script game1.js, not kept). Use fewer games per process.
  Astra could not be consulted: Codex refused the model in `%USERPROFILE%\.codex\config.toml` (`gpt-6.2-sol`, "not
  supported when using Codex with a ChatGPT account").
  Open questions sent to the designer with the V5 review: see the reply of 2026-11-26 (problems list in that chat;
  the main ones are also boxed notes in game-rules-v5.html).

- 2026-11-25 (later): V4 rules updated to the doc (see "Rules variant: V4"). AI: froze v11 (v10 + extra-pivot
  turns), then `pivotMove` (V4 plans move or charge after an opening pivot; before, `moveStarted` only allowed that
  where Reform existed, so the V4 AI never pivoted and then moved) and `fixedShots` (V4 threat counts only shots
  from a shooter's current facing). Hard v v11, seeds 50001-50040 (both sides each seed), on the rules before the
  no-arc, pivot-away and contact changes: 58-22, 0 unfinished, mean 11.1 rounds; with pivotMove=0: 41-34, 5
  unfinished. Not yet confirmed on the final rules, positions suite not run, not frozen as v12: the designer paused
  AI work. Re-run `tools/v4-probe.js` hard v v11 on fresh seeds (52000+ were started and abandoned) before freezing.
- 2026-11-25: V4 unit balance study on the live sheet (not yet synced into `unit-cards-source.csv`:
  the sheet now has Heavy Infantry Melee 8, Light Infantry Drill 4, Light Cavalry Drill 3).
  Scripts in `tools/balance/` (`study.js` plays AI v AI V4 games with a fair pool shuffle and
  per-unit event counts, stat overrides as `"Unit.Stat=value;..."`; `analyse.js` merges runs and
  fits win ~ unit-count difference; `duel.js` is exact V4 duel maths incl. Shaken and MT
  turn-to-face; `run.sh` runs workers in parallel). Baseline, 720 normal + 216 hard games (seeds
  30000+, 40000+): weakest Crossbows (win 41/43%), Mounted Archers (47/44%), Light Cavalry
  (46/44%); nothing clearly too strong; Heavy Infantry at Melee 8 is average (50%). Flank
  charges are rare in AI play (~0.2-0.4 per unit per game). Tweak set Light Cavalry Melee 3,
  Crossbows Drill 1 and 2*/16, Mounted Archers 3/16, 450 normal + 220 hard games: normal win%
  range 41-56 -> 46-52; hard Crossbows 53%, Light Cavalry 50%, Mounted Archers still 46%.
  Rules doc v app (unchanged since): the doc's charge-facing test is now a line from the
  charger's front-edge centre to the target's centre at the very start of the Manoeuvre
  (engine still uses `behindFrontLine` after pivots, which allows fewer flank charges); the
  doc drops "only by moving forwards" for charges; Range is now measured along the sight line
  to an edge centre, not to the nearest point; the doc mentions a Height section that it lacks.
  Later the same day: the doc gained "a unit that doesn't move may pivot one additional time"
  (see "Rules variant: V4"). The study above was run before this, so its Drill 0 units (Heavy
  Infantry, Heavy Cavalry, Crossbows) could never turn, and no unit had the extra pivot. In the duel
  maths a flanked Heavy Infantry now wins 73% (0% before), Heavy Cavalry 56%. Not re-run in whole games.

- 2026-11-21 (later): V4 Shaken changed by the designer: the flanker only has to be touched
  by another of your units (not itself Shaken) to stop shaking. `shakenSet` removed. The AI
  reads Shaken through `E.shaken`, so it follows the new rule; not re-measured.

- 2026-11-21 (V4 AI): `tools/v4-probe.js`, hard, V4, 80 games each (10x8 or 5x16 in parallel).
  v9 v v9, seeds 20001-20040: 24-24, 32 unfinished, mean 20.4 rounds; 10 of 157 charges
  on a flank. New AI v v9, same seeds (closeCharge+midCharge+urgency 0.5): 48-22, 10
  unfinished (69% +/-11); 98 flank charges v 30; its units Shaken 114 v 411 activation-ends.
  Fresh seeds 20101-20140 v v9: all on 55-19 (6 unf.); closeCharge=0 40-25 (15);
  midCharge=0 35-22 (23); urgency=0 56-20 (4); stuckDraft=0 56-16 (8). Kept closeCharge
  and midCharge, switched urgency and stuckDraft off, froze v10. ~257 v 208 ms/decision.

- 2026-11-21 (later): play UI. Pivot with a ↻ handle behind the selected unit (corner grips
  removed; the whole card drags to move). Undo moved to the battlefield's bottom-left
  (`#board-undo`, `renderBoardUndo`, `positionBoardUndo`). The player's own moves no longer
  animate; the AI's animate faster with shorter pauses (`pieceMotionDuration`, `runAI`).
  V4 charge rule changed (see "Rules variant: V4"). AI not changed or measured for it:
  its plans are engine-checked, but `pairGeometry`'s rough charge estimate ignores the
  front-only limit.

- 2026-11-21: V4 rules added (above). Stats sheet synced: Light Infantry Speed 7 (asterisk
  gone), Drill 6; Light Cavalry Drill 4. `FALLBACK_DEFAULT_UNITS` copied.

- 2026-11-20 (latest+1): V3 charges now follow Reform: a pivot before travelling keeps
  the charge, a pivot after starting to move loses it (`reformVariant` in `moveLimit` is
  Reform Variant only; the AI's charge threat uses the Reform geometry check for V3). V3
  Rally is allowed while touching an enemy.
- 2026-11-20 (latest): designer changed V3 again. (a) No combat modifiers at all:
  `attackPreview` adds no mods in V3 (outflanking and height gone; AP and Loose
  Formation are target-number rules and stay). (b) A unit can only strike enemies touching
  its front (`touchesFront` / `canStrikeAt`): the enemy must touch the front edge (corners
  included) and part of it must lie ahead of the front line, so a unit flush alongside
  doesn't count. A charge also needs a target at the front (else it stops short). (c) Hills
  slow units entering them in V3, but not a unit that started its Move on that hill
  (`slows(s, t, hills)`; `act.startHills` records the hills at the Move's first move or
  pivot, and before that the current hills are used). Leaving the start hill and re-entering
  it in the same Move doesn't count as entering. Their line-of-sight effects are unchanged. (d) 5+ strain can't attack was already in. AI: `pairGeometry` uses no height
  or flank dice in V3 and counts contact strikes only at the front; terrain choice and
  deployment value hills less and treat them as slowing in V3. Untuned. Sanity run: hard v
  normal, V3, 12 games, seeds 9100+: 7-4, 1 unfinished, mean 17.7 rounds.
- 2026-11-20 (later): designer replaced V3's 'Attacker has 4 or more strain' −1 die
  with: a unit with 5 or more strain can't attack (`SPENT_STRAIN`; no Shoot, Strike or
  charge — the charge is our reading, since it exists for the free Strike). The AI's
  `weary` weight is gone; `pairThreat` counts no attacks from such a unit and the
  geometry cache key marks it (it changes whether it can shoot or charge). Frozen v7
  doesn't have that key, so under V3 it may reuse a stale shot or charge answer.
- 2026-11-20: stats sheet synced (`tools/sync-stats.js`): Fanatics 5/5 (was 6*/6),
  Heavy Cavalry Speed 10, Halberds Melee 2*, Cavalry Melee 3, Light Cavalry Melee 2,
  Archers 3/18 (x3), Crossbows Speed 5 and 2*/14, Infantry x3; `FALLBACK_DEFAULT_UNITS`
  copied. V3 AI test: `weary=1` (pairThreat counts the weary die) v v7 (the AI frozen
  before it), `--rules=v3`, 100 hard games, seeds 9001-9050, new stats: 38-48 with 14
  unfinished (44% +/-10). No gain, so `weary` defaults to 0 and no v8 was frozen. V3
  Rally (no roll) is now scored as one outcome (exact, speed only). With the reduced
  stats V3 hard games are long: mean 17 rounds, 14% unfinished by round 30.
- 2026-11-20: designer changed V3: Pace-asterisk units no longer pass through
  friends (Reform Variant keeps it); line of sight is now a clear line to the centre
  of a target edge facing the shooter, and the cover modifier is gone (`COVER_DICE` removed).
- 2026-11-19 (later): designer reverted outflanking and cover to ±1 (`FLANK_DICE`,
  `COVER_DICE` = 1, all rule sets), renamed Skirmishers to V3, and added to V3:
  Rally (the action; not while touching an enemy; removes 1 strain, no roll) and
  'Attacker has 4 or more strain' −1 die (`WEARY_STRAIN`). The AI's flank-threat
  literal 1 now matches the engine again. Rules source: the Google Doc.
- 2026-11-19: designer changed outflanking to +2/−2 and cover to −2 (`FLANK_DICE`,
  `COVER_DICE` in engine.js; ai.js reads them). Positions suite (hard): 2 regressions,
  'pin then flank' and 'strikes the unmarked enemy now': the AI passes, because
  `pairGeometry`'s flank-threat bonus (now `E.FLANK_DICE`) makes waiting look better.
  Holding that bonus at 1 (engine still 2) fixes both, and it is now applied in ai.js
  (literal `1`, commented). flank1 v hard, 80 games, seeds 2001-2040: 39-33, 8 unfinished
  (54%, within noise, no worse). After the fix the positions suite has the same 2 failures
  as before the rule change (archers hold distance; second attacker after a rout). Normal-v-normal 30 games before/after: classic 10.4 -> 9.8
  rounds, shots 5.7 -> 3.5 per game; skirmishers ~unchanged. Note unit-cards-source.csv
  was stale v the sheet when this was measured. Later the same day: CSV synced
  (`node tools/sync-stats.js`) and FALLBACK_DEFAULT_UNITS in app.js updated to match:
  Heavy Infantry Pace 6, Heavy Cavalry Pace 12, Halberds Mobility 1, Spears Melee 1,
  Light Infantry no Ranged (empty cell) and Quantity 3. Selfplay figures above predate this.
- 2026-11-17: Reform rules variant v classic, normal v normal 200 games each and hard v hard 24 each, same seeds (see "Rules variant: Reform").

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
- 2026-11-19: hard (deployRoom 0.3) v hard:deployRoom=0, 40 games, seeds
  1-20: 22-14, 4 unfinished (61% ±16, so likely better, not yet proven).
- 2026-11-19: after adding the side edges to `deployRoom`, the same match:
  16-18, 6 unfinished (47% ±17). Taken together: no measurable effect on
  strength either way; the change is kept because it plays more sensibly.

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
  should arrive first, because its arrival gives the outflank dice to every
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

## Battle log toggle (2026-11-22)

The field tools bar has a log button (`#log-toggle`, key L) that hides
`#battle-log-panel`; `battleLogSpace()` then reads 0, so `fitTableToScreen`
gives the freed width to the board (at 1024x768 it grows from 484 to 590 px
tall). The choice is kept in localStorage (`seizeTheDay.battleLogHidden`).
