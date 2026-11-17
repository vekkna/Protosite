I would implement the two-activation experiment first. Step 2 has correctness gaps that could make deeper search worse. No files changed.

1. **Chance outcomes must belong to decisions, not compete in the beam.**

Today, `scorePlan.value` preserves expected immediate value; selecting final typical states would discard that protection. Rout/no-rout splitting still misses focus-fire combinations: different surviving strain values produce different probabilities of routing on the next attack.

Use exact strain outcomes for attacks participating in combinations; collapse all routing outcomes into one state. Back up **expectation at chance nodes, maximum at decision nodes**, retaining root-action identity. Never prune an unlucky outcome independently or renormalize only surviving outcomes. That selects lucky scenarios rather than good decisions. Rally needs equivalent expectation handling.

Also:

- Preserve children that automatically end the turn as finished leaves immediately. Otherwise `allPlans` returns nothing and they can disappear.
- Identify the current turn by `(round, phase, turnStep, activePlayer)`, not active player alone.
- Cache continuation values for identical states while retaining each parent’s probability and first action. The proposed merge key needs phase, round, turn step, master, both command counts, routed counts and terminal status. Rounded coordinates can merge positions with different contact legality.
- A depth cutoff is **not a voluntary pass**. Complete it with a cheap rollout or evaluate its continuation separately.

2. **Use a common horizon, with each opportunity counted once.**

`chanceNow` rewards retained attacks; its 0.6 weight generally favours realizing damage, but can encourage holding when its geometric estimate is optimistic. `approach` rewards spending otherwise unnecessary commands to move closer. Neither creates an inevitable length bias, but both can distort stopping decisions.

Crucially, MT passing preserves `chanceNow` on the **unchanged board**. `replyThreat` subtracts enemy attack losses without actually moving enemies, marking them, or removing casualties. It cannot value “wait until they advance” reliably.

My preferred leaf value is expected value **after a cheap enemy turn and MT second-turn continuation, through round cleanup**: terminal utility, otherwise strain/rout/progress value plus discounted next-round opportunities and a small approach tie-breaker. No current-round opportunity term remains.

If retaining turn-boundary leaves initially, use the existing replacement formula:

`assess.total + assess.theirs - W.reply * replyThreat`

Subtracting reply threat directly from `evaluate` double-counts enemy threats. Do not also sum intermediate `scorePlan.value` values.

3. **Protect combinations before scalar pruning.**

Reserve candidates by `(attacker, target, contact geometry)`, including frontal and flank contact. For every target reachable by two unactivated attackers, extend representative first attacks with the other attacker **before applying the global beam**.

Prioritize continuations using expected `lossFrom`, increase in combined rout probability, and engine-confirmed outflank modifiers. Guarantee a same-target continuation where legal; keeping every facing variant wastes slots. Preserve the existing chooser’s candidate as a fallback.

The handover’s 14–13 threat ablation is weak evidence, not proof that evaluation has no signal. The stronger evidence is `replyThreat` improving positional results and winning 74–42; pruning before that correction deserves caution.

4. **Several proposed tests need tightening.**

- **1–2:** Outflanking requires flank contact, not an initial frontal pin. With no intervening enemy action, flanker-first may improve *both* strikes. Prove the intended order beats the reverse; accept early routs.
- **3:** At strain 4, rout requires 3 more. Dice can produce two hits each, so “one shot cannot rout” requires checking distribution support. Greedy already favours damaged targets; add a stronger competing immediate attack.
- **4:** This mostly tests existing replanning. Require actual routed cases and exclude battle-ending routs.
- **5:** Require a strike; shooting receives no unmarked bonus. Playing the enemy continuation is necessary to test waiting.
- **6:** “Must advance” is not enforced. Script or search a defensible enemy response; verify the saved command produces value.
- Don’t manufacture three baseline failures. Record baseline performance honestly.

5. **Yes: add targeted two-activation combinations first.**

Enumerate both orders, score exact chance outcomes with outcome-dependent follow-ups, compare on the same horizon, execute the first activation, and re-plan. This directly tests whether missing combinations—not search depth—are the bottleneck before adding full-turn beam machinery.