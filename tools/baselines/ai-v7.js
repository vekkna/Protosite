/*
 * Seize the Day — AI opponent.
 *
 * Works only through the rules engine: it proposes whole activations ("plans") for each unit, lets the
 * engine validate them, and scores the resulting positions. Nothing here names a unit or hard-codes a
 * stat, so it keeps working when the unit list or the numbers change.
 *
 *   SeizeAI.choose(state, player, options) -> { actions: [...engine actions], note }
 *   SeizeAI.play(state, player, options)   -> new state after carrying those actions out (Node, tests)
 *
 * options: { level: 'easy' | 'normal' | 'hard', random: () => number, weights: {...} }
 */
const SeizeAI = (() => {
    const E = typeof SeizeEngine !== 'undefined' ? SeizeEngine : require('../../engine');
    const PX = E.PX, G = E.geometry, ROUT = E.ROUT_STRAIN, other = E.other;

    const DEFAULTS = {
        strain: 2.0,        // value of a unit's worth of strain (curved: later strain is worth more)
        routed: 3.0,        // value of removing a unit, on top of its strain
        victory: 6.0,       // value spread over progress to the rout threshold
        threatNow: 0.9,     // enemy attacks that can still happen this round
        chanceNow: 0.6,     // my attacks that can still happen this round
        nextRound: 0.35,    // either side's attacks next round
        approach: 0.012,    // per inch closer to the nearest enemy, per unit
        maneuver: 0.08,     // bidding: value of an activation that makes no attack
        lookahead: 0.8,     // weight of the best follow-up activation
        reply: 1.0,         // weight of the enemy's engine-checked replies (replaces the rough threat guess)
        probe: 8,           // how many of the best options get that check
        playout: 1,         // 1 = value leading options and passing by playing the round out (roundValue), at levels that allow it (hard); 0 = as v4
        rollouts: 0,        // play-outs per option; 0 = one play-out with typical dice from each exact result of the opening
        resolveFirst: 0.1,  // play-out: bonus for an option that rolls its dice now rather than later
        winBonus: 50,       // extra value of the rout that wins the battle
        leafWin: 50,        // the same, in play-out leaves (a smaller value makes them less noisy)
        combos: 1,          // 1 = let combined attacks on a shared target challenge the chosen activation (comboChallenger); 0 = as v3
        planner: 0,         // 1 = plan the whole turn (planTurn, experimental, unproven); 0 = one activation at a time (chooseCommand)
        timeBudget: 2000,   // ms the turn planner may spend deepening
        split: 3,           // opening attacks that get every dice outcome searched separately
        draftSmart: 1,      // 0 = original stats-only draft, random terrain, fixed deployment
        draftTerrain: 1.0,  // weight of the top terrain tile when choosing a unit
        deployRoom: 0.3,    // deployment: cost of standing too close to a friend to pivot freely (0 = pack units flush)
        passMargin: 0.02
    };
    const LEVELS = { easy: { temperature: 0.35, depth: 1, probe: false, beam: 1, turnDepth: 1 }, normal: { temperature: 0.08, depth: 2, probe: true, beam: 3, turnDepth: 2 },
        hard: { temperature: 0, depth: 2, probe: true, playout: true, beam: 6, turnDepth: 4 } };

    // ---------- small geometry ----------
    const centre = u => ({ x: u.x + u.w / 2, y: u.y + u.h / 2 });
    const norm180 = a => { a %= 360; if (a > 180) a -= 360; if (a <= -180) a += 360; return a; };
    const bearing = (from, to) => Math.atan2(to.x - from.x, -(to.y - from.y)) * 180 / Math.PI;   // engine angle: 0 = up
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const army = (s, p) => s.units.filter(u => u.owner === p);
    function segmentHitsCircle(a, b, c, r) {
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / l2)) : 0;
        return Math.hypot(a.x + t * dx - c.x, a.y + t * dy - c.y) < r;
    }
    /** Is the straight path between two units obstructed by another unit or impassable terrain? */
    function pathBlocked(s, a, b) {
        const ca = centre(a), cb = centre(b);
        for (const o of s.units) if (o.owner && o.id !== a.id && o.id !== b.id && segmentHitsCircle(ca, cb, centre(o), Math.min(o.w, o.h) * 0.45)) return true;
        for (const t of s.terrain) if (E.TERRAIN[t.type].impassable && segmentHitsCircle(ca, cb, centre(t), t.w / 2)) return true;
        return false;
    }

    // ---------- valuation ----------
    const strainScore = (st, W) => W.strain * Math.pow(Math.min(st, ROUT) / ROUT, 1.5);
    const routProgress = (k, need, W) => W.victory * Math.pow(Math.min(k, need) / need, 1.5);
    /** What the side that owns `u` loses if `u` takes `extra` strain now. */
    function lossFrom(s, u, extra, W) {
        if (u.strain + extra < ROUT) return strainScore(u.strain + extra, W) - strainScore(u.strain, W);
        const need = Math.ceil(s.starting[u.owner] / 2), k = s.routed[u.owner];
        return W.strain + W.routed - strainScore(u.strain, W) + routProgress(k + 1, need, W) - routProgress(k, need, W) + (k + 1 >= need ? W.winBonus : 0);
    }
    function attackValue(s, target, pool, tn, W) {
        const d = E.strainDist(Math.max(1, pool), tn);
        let v = 0;
        for (let j = 1; j < d.length; j++) if (d[j] > 1e-4) v += d[j] * lossFrom(s, target, j, W);
        return v;
    }
    const targetNumber = (att, def, shooting) => (shooting && def.defenceStar ? 6 : Math.max(2, Math.min(6, (shooting ? att.shootAP : att.meleeAP) ? Math.min(def.defence, 3) : def.defence)));

    /**
     * Rough value of the best attack `att` could make on `def` with one activation, or 0 if it can't reach.
     * `fresh` = assume a new round (no command markers anywhere).
     */
    function pairThreat(s, att, def, W, fresh, cache) {
        const key = att.id + '>' + def.id + (fresh ? 'f' : '');
        if (cache.has(key)) return cache.get(key);
        const g = pairGeometry(s, att, def, cache), unmarked = E.unmarkedStrikeDice(s, !fresh && def.activated);
        let best = 0;
        if (g.melee !== null) best = attackValue(s, def, att.melee + unmarked + g.melee, targetNumber(att, def, false), W);
        if (g.shoot !== null) best = Math.max(best, attackValue(s, def, att.shoot + g.shoot, targetNumber(att, def, true), W));
        cache.set(key, best);
        return best;
    }
    /** Which attacks `att` could make on `def`, as extra dice (null = none). Depends only on geometry, so kept by geoKey. */
    function pairGeometry(s, att, def, cache) {
        const lk = att.id + '>' + def.id, hit = cache.pairs.get(lk);
        if (hit) return hit;
        const ca = centre(att), cd = centre(def), d = dist(ca, cd), contact = cache.contacts.get(att.id);
        const high = cache.high.get(att.id) - cache.high.get(def.id), g = { melee: null, shoot: null };
        if (contact.length) {
            // Already fighting: it can strike what it touches (and nothing else worth modelling).
            if (contact.includes(def.id)) g.melee = high;
        } else {
            const gap = d - att.h / 2 - Math.min(def.w, def.h) / 2;
            const turn = Math.abs(norm180(bearing(ca, cd) - att.angle));
            const lane = Math.atan2(att.w / 2 + Math.max(def.w, def.h) / 2, Math.max(1, d)) * 180 / Math.PI;
            let canCharge = false;
            if (att.melee > 0) {
                if (s.rules === 'reform-variant' || s.rules === 'v3') {
                    if (!cache.charges.has(att.id)) {
                        const limit = E.moveLimit(s, att, { moved: 0 }, false);
                        cache.charges.set(att.id, limit.charge?.targets || []);
                    }
                    canCharge = cache.charges.get(att.id).includes(def.id);
                } else {
                    canCharge = gap <= att.pace * PX && turn <= 90 * att.mobility + lane && !pathBlocked(s, att, def);
                }
            }
            if (canCharge) {
                const f = G.forwardOf(def), front = { x: cd.x + f.x * def.h / 2, y: cd.y + f.y * def.h / 2 };
                g.melee = ((ca.x - front.x) * f.x + (ca.y - front.y) * f.y < -def.h * 0.25 ? 1 : 0) + high;   // flank-threat weight held at 1 although the rule is now +2: at 2 the AI over-fears flanks and passes up good charges (tested 2026-11-19)
            }
            const reform = E.reformRules(s);
            if (att.shoot > 0 && d - att.h / 2 - Math.max(def.w, def.h) / 2 <= att.range * PX && !cache.contacts.get(def.id).length && (reform || turn <= 90 * att.mobility + 25)) {
                const facing = att.mobility > 0 && !reform ? { ...att, angle: bearing(ca, cd) } : att;
                const probe = facing === att ? s : { ...s, units: s.units.map(u => (u.id === att.id ? facing : u)) };
                const cover = clearShot(s, probe, att, facing, def, cache);
                if (cover !== false) g.shoot = high - cover;
            }
        }
        cache.pairs.set(lk, g);
        return g;
    }
    /**
     * Line of sight from `att` (turned to `facing`) to `def`. It depends on the two units, terrain, and only those
     * units near the line between them: the sight lines and both units' contacts lie within the larger unit's radius
     * of the segment joining their centres. So the answer is kept by those units' exact geometry, and a move elsewhere
     * on the field doesn't make it be worked out again.
     */
    function clearShot(s, probe, att, facing, def, cache) {
        const ca = centre(att), cd = centre(def), rad = Math.max(G.reach(att), G.reach(def)) + 1;
        let key = `${facing.angle}|${cache.unitKey.get(att.id)}|${cache.unitKey.get(def.id)}`;
        for (const o of s.units) if (o.owner && o.id !== att.id && o.id !== def.id && pointSegDist(centre(o), ca, cd) < G.reach(o) + rad) key += '|' + cache.unitKey.get(o.id);
        let clear = cache.shots.get(key);
        // false when there's no shot; otherwise the dice lost to the sight line (always 0 now: V3 dropped cover).
        if (clear === undefined) { const check = E.shotCheck(probe, facing, def); clear = check.reason ? false : 0; cache.shots.set(key, clear); }
        return clear;
    }
    function pointSegDist(p, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
        return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
    }
    /** Best total of `k` attacks from `attackers` on `defenders`, each attacker used once. */
    function threatTotal(s, attackers, defenders, k, W, fresh, cache) {
        if (k <= 0 || !attackers.length || !defenders.length) return 0;
        const best = attackers.map(a => { let m = 0; for (const d of defenders) m = Math.max(m, pairThreat(s, a, d, W, fresh, cache)); return m; }).sort((x, y) => y - x);
        let total = 0;
        // Later attacks are discounted: they pile onto the same victims and the position will have changed.
        for (let i = 0; i < Math.min(k, best.length); i++) total += best[i] * Math.pow(0.85, i);
        return total;
    }
    /**
     * Geometry is costly (line of sight, contact, high ground) and most positions met in one search differ from each
     * other only in strain and command markers, while every new state has new unit objects the engine's own caches
     * miss. So those answers are kept by an exact key of everything they depend on: terrain and every unit's place,
     * facing, size, side and movement and shooting stats (line of sight more finely, see clearShot). Exact, so it
     * changes no decision; cleared when it grows large.
     */
    const geoCache = new Map(), shotCache = new Map();
    const unitKeyOf = u => `${u.id}${u.owner}${u.x},${u.y},${u.angle},${u.w},${u.h},${u.melee},${u.shoot},${u.range},${u.pace},${Boolean(u.paceStar)},${u.mobility}`;
    function makeCache(s) {
        if (geoCache.size > 20000) geoCache.clear();
        if (shotCache.size > 50) shotCache.clear();
        let terrain = (s.rules || 'classic') + ';';
        for (const t of s.terrain) terrain += `${t.type}${t.x},${t.y},${t.w};`;
        const unitKey = new Map();
        let geo = terrain;
        for (const u of s.units) if (u.owner) { const k = unitKeyOf(u); unitKey.set(u.id, k); geo += k + ';'; }
        const cache = new Map();
        let g = geoCache.get(geo);
        if (!g) {
            if (!shotCache.has(terrain)) shotCache.set(terrain, new Map());
            const shots = shotCache.get(terrain);
            if (shots.size > 200000) shots.clear();
            g = { contacts: new Map(), high: new Map(), pairs: new Map(), charges: new Map(), unitKey, shots };
            // Contact is symmetric: test each pair of opposing units once (the lists are only searched, so order doesn't matter).
            const live = s.units.filter(u => u.owner);
            for (const u of live) { g.contacts.set(u.id, []); g.high.set(u.id, E.inTrait(s, u, 'elevated') ? 1 : 0); }
            for (const u of live) for (const v of live) if (u.owner === 'p1' && v.owner === 'p2' && G.touching(u, v)) { g.contacts.get(u.id).push(v.id); g.contacts.get(v.id).push(u.id); }
            geoCache.set(geo, g);
        }
        cache.contacts = g.contacts; cache.high = g.high; cache.pairs = g.pairs; cache.charges = g.charges; cache.unitKey = g.unitKey; cache.shots = g.shots;
        return cache;
    }

    /** Value of a position to `me`. Higher is better. Call with no activation in progress. */
    function evaluate(s, me, W) { return assess(s, me, W).total; }
    function assess(s, me, W) {
        if (s.phase === 'finished') return { total: s.winner === me ? 1000 : -1000, theirs: 0 };
        const en = other(me), mine = army(s, me), theirs = army(s, en), cache = makeCache(s);
        const side = p => army(s, p).reduce((n, u) => n + strainScore(u.strain, W), 0) + s.routed[p] * (W.strain + W.routed) + routProgress(s.routed[p], Math.ceil(s.starting[p] / 2), W);
        let v = side(en) - side(me), theirNow = 0, myNow = 0;
        // Attacks that can still be made this round.
        if (s.phase === 'command') {
            const acting = E.activePlayer(s), left = { p1: 0, p2: 0 };
            for (const p of ['p1', 'p2']) {
                const stillToAct = p === acting || (p === s.master ? s.turnStep < 2 : s.turnStep < 1);
                left[p] = stillToAct ? s.commands[p] : 0;
            }
            theirNow = W.threatNow * threatTotal(s, theirs.filter(u => !u.activated), mine, left[en], W, false, cache);
            myNow = W.chanceNow * threatTotal(s, mine.filter(u => !u.activated), theirs, left[me], W, false, cache);
        }
        // An attack that could happen this round or next is counted once, and always for less than
        // actually making it, so the AI prefers a blow struck to a blow threatened.
        const guess = p => Math.min(3, army(s, p).length);
        v += Math.max(myNow, W.nextRound * threatTotal(s, mine, theirs, guess(me), W, true, cache));
        const theirThreat = Math.max(theirNow, W.nextRound * threatTotal(s, theirs, mine, guess(en), W, true, cache));
        v -= theirThreat;
        // Mild pull towards the enemy so that armies close instead of waiting for each other.
        if (theirs.length) {
            const pull = W.approach * (1 + Math.max(0, s.round - 1) / 5);
            for (const u of mine) { let near = Infinity; const c = centre(u); for (const o of theirs) near = Math.min(near, dist(c, centre(o))); v -= pull * near / PX; }
        }
        return { total: v, theirs: theirThreat };
    }

    // ---------- plans ----------
    function pivotChunks(delta) {
        const out = []; let rest = delta;
        while (Math.abs(rest) > 0.5) { const step = Math.max(-90, Math.min(90, rest)); out.push(step); rest -= step; }
        return out;
    }
    function tryApply(s, a) { try { return E.apply(s, a); } catch (e) { return null; } }
    function finish(s) { return s.phase === 'command' && s.activation ? tryApply(s, { type: 'endActivation' }) || s : s; }

    /** Every worthwhile whole activation for one unit. Each plan: { actions, state, pending }. */
    function plansFor(s, u, me, attacksOnly = false) {
        const plans = [], start = tryApply(s, { type: 'activate', unitId: u.id });
        if (!start) return plans;
        const first = [{ type: 'activate', unitId: u.id }];
        // A plan can't stop partway through a run of pivots that overlaps something (V3).
        const add = (name, actions, state, pending = null) => { if (state.activation?.overlap) return; if (pending || !attacksOnly) plans.push({ name, unitId: u.id, actions, state, pending }); };
        const enemies = army(s, other(me)), cu = centre(u);
        add('hold', first, start);

        const here = E.unitOptions(start, u.id);
        if (here.canRally && !attacksOnly) add('rally', first, start, { type: 'rally' });
        const flankOf = t => t.preview.mods.some(m => m.label === 'Target outflanked');
        for (const t of here.strike) add('strike', first, start, { type: 'strike', targetId: t.id, dist: t.preview.dist, flank: flankOf(t) });

        // Facings worth considering: as it stands, at each enemy (centre and both sides), and directly away.
        const turns = [0];
        const pivotOK = u.mobility > 0 && here.pivot.remaining > 0;
        const reformOK = Boolean(here.reform && here.reform.remaining > 0), maxTurn = reformOK ? 180 : 90 * u.mobility;
        const consider = angle => { const d = norm180(angle - u.angle); if (Math.abs(d) > 2 && Math.abs(d) <= maxTurn && !turns.some(t => Math.abs(t - d) < 6)) turns.push(d); };
        if (pivotOK || reformOK) {
            const byRange = enemies.slice().sort((a, b) => dist(cu, centre(a)) - dist(cu, centre(b)));
            for (const e of byRange.slice(0, 5)) {
                const ce = centre(e), right = { x: Math.cos(e.angle * Math.PI / 180), y: Math.sin(e.angle * Math.PI / 180) }, f = G.forwardOf(e);
                consider(bearing(cu, ce));
                for (const sign of [-1, 1]) consider(bearing(cu, { x: ce.x + right.x * sign * e.w * 0.45, y: ce.y + right.y * sign * e.w * 0.45 }));
                consider(bearing(cu, { x: ce.x - f.x * e.h * 0.45, y: ce.y - f.y * e.h * 0.45 }));
            }
            if (byRange.length) consider(bearing(centre(byRange[0]), cu));
            for (const d of [-90, -45, 45, 90]) consider(u.angle + d);
        }
        const nearestBearing = st => {
            const me2 = st.units.find(x => x.id === u.id); if (!me2 || !enemies.length) return null;
            const c = centre(me2); let best = null, bd = Infinity;
            for (const e of st.units) if (e.owner && e.owner !== me) { const d = dist(c, centre(e)); if (d < bd) { bd = d; best = e; } }
            return best ? norm180(bearing(c, centre(best)) - me2.angle) : null;
        };

        for (const turn of turns) {
            if (reformOK && Math.abs(turn) > 90 * u.mobility) {
                // Too far for this unit's pivots: Reform, which is its whole action.
                const step = { type: 'pivot', degrees: turn, reform: true }, next = tryApply(start, step);
                if (next) add('reform', [...first, step], next);
                continue;
            }
            let st = start, acts = first.slice(), ok = true;
            for (const step of pivotChunks(turn)) { const next = tryApply(st, { type: 'pivot', degrees: step }); if (!next) { ok = false; break; } st = next; acts.push({ type: 'pivot', degrees: step }); }
            if (!ok || !st.activation) continue;
            const o = E.unitOptions(st, u.id);
            if (!o.canAct) continue;
            if (turn !== 0) add('face', acts, st);
            for (const t of o.shoot) if (t.ok) add('shoot', acts, st, { type: 'shoot', targetId: t.id, dist: t.preview.dist, flank: flankOf(t) });
            // In Reform games a pivot starts a Move that can still be continued.
            const moveStarted = o.reform && o.activation.action === 'move' && o.activation.moved === 0;
            if (!o.actionFree && !moveStarted) continue;
            const moves = [];
            if (o.forward.max > 0.3) for (const f of attacksOnly ? (o.forward.charge ? [1] : []) : o.forward.charge ? [1, 0.6, 0.3] : [1, 0.75, 0.5, 0.25]) moves.push({ inches: f === 1 ? o.forward.max : o.forward.max * f, backwards: false, charge: f === 1 && Boolean(o.forward.charge) });
            if (!attacksOnly && turn === 0 && o.backward.max > 0.3) for (const f of [1, 0.5]) moves.push({ inches: f === 1 ? o.backward.max : o.backward.max * f, backwards: true });
            for (const m of moves) {
                const action = { type: 'move', inches: m.inches, backwards: m.backwards }, moved = tryApply(st, action);
                if (!moved) continue;
                const acts2 = [...acts, action];
                if (m.charge && moved.activation && moved.activation.freeStrike) {
                    for (const t of E.unitOptions(moved, u.id).strike) add('charge', acts2, moved, { type: 'strike', targetId: t.id, dist: t.preview.dist, flank: flankOf(t) });
                    continue;
                }
                add(m.backwards ? 'withdraw' : 'advance', acts2, moved);
                // Optionally finish by turning to face the nearest enemy.
                if (moved.activation) {
                    const d = nearestBearing(moved);
                    if (d !== null && Math.abs(d) > 12) {
                        const step = Math.max(-90, Math.min(90, d)), turned = tryApply(moved, { type: 'pivot', degrees: step });
                        if (turned && (!turned.activation || turned.activation.action === 'move')) add('advance+face', [...acts2, { type: 'pivot', degrees: step }], turned);
                    }
                }
            }
        }
        return plans;
    }

    /** Expected value of a plan, averaging over its dice. Also returns the most typical resulting state. */
    function scorePlan(plan, me, W) {
        const p = plan.pending;
        if (!p) { const end = finish(plan.state); return { value: evaluate(end, me, W), typical: end }; }
        if (p.type === 'rally') {
            let value = 0, typical = null;
            for (const die of [1, 3, 5]) {   // d6 halved, rounded up: 1, 2 or 3 strain, equally likely
                const end = finish(E.apply(plan.state, { type: 'rally', forcedDie: die }));
                value += evaluate(end, me, W) / 3; if (die === 3) typical = end;
            }
            return { value, typical };
        }
        const target = plan.state.units.find(u => u.id === p.targetId), need = ROUT - target.strain;
        let value = 0, typical = null, mean = 0, routP = 0;
        p.dist.forEach((q, j) => { mean += q * j; if (j >= need) routP += q; });
        const typicalStrain = Math.min(need - (routP > 0.5 ? 0 : 1), Math.round(mean));
        for (let j = 0; j < Math.min(need, p.dist.length); j++) {
            const q = p.dist[j]; if (q < 1e-4 && j !== typicalStrain) continue;
            const end = finish(E.apply(plan.state, { type: p.type, targetId: p.targetId, forcedStrain: j }));
            value += q * evaluate(end, me, W); if (j === typicalStrain) typical = end;
        }
        if (routP > 0) {
            const end = finish(E.apply(plan.state, { type: p.type, targetId: p.targetId, forcedStrain: need }));
            value += routP * evaluate(end, me, W); if (typicalStrain >= need) typical = end;
        }
        return { value, typical: typical || finish(plan.state) };
    }

    /**
     * What the enemy could really do to `me` from this position: for each enemy unit, the engine works out
     * its attacks (including pivot-and-charge and flank contact) and the best ones are added up. Uses the
     * attacks still possible this round if the enemy has a turn to come, otherwise next round's.
     */
    function replyThreat(s, me, W) {
        if (s.phase === 'finished') return 0;
        const en = other(me), q = E.clone(s);
        q.hypothetical = true; q.activation = null;
        let k = 0, weight = 1;
        if (s.phase === 'command') {
            const acting = E.activePlayer(s), toCome = en === acting || (en === s.master ? s.turnStep < 2 : s.turnStep < 1);
            if (toCome) k = Math.min(s.commands[en], army(s, en).filter(u => !u.activated).length);
        }
        if (k > 0) q.turnStep = en === q.master ? (q.turnStep === 0 ? 0 : 2) : 1;
        else {
            // Next round: everyone is fresh and unmarked; assume a typical bid.
            for (const u of q.units) u.activated = false;
            k = Math.min(3, army(q, en).length); weight = W.nextRound / W.threatNow;
            q.phase = 'command'; q.master = q.master || en; q.turnStep = en === q.master ? 0 : 1; q.commands = { ...q.commands, [en]: k };
        }
        const best = [];
        for (const u of army(q, en)) {
            if (u.activated) continue;
            let top = 0;
            for (const plan of plansFor(q, u, en, true)) {
                const target = plan.state.units.find(x => x.id === plan.pending.targetId); if (!target) continue;
                let v = 0; plan.pending.dist.forEach((p, j) => { if (j > 0 && p > 1e-4) v += p * lossFrom(plan.state, target, j, W); });
                if (v > top) top = v;
            }
            best.push(top);
        }
        best.sort((a, b) => b - a);
        let total = 0;
        for (let i = 0; i < Math.min(k, best.length); i++) total += best[i] * Math.pow(0.85, i);
        return weight * W.threatNow * total;
    }

    function allPlans(s, me) {
        const out = [];
        if (s.phase !== 'command' || E.activePlayer(s) !== me || s.activation || s.commands[me] < 1) return out;
        for (const u of army(s, me)) if (!u.activated) out.push(...plansFor(s, u, me));
        return out;
    }
    /**
     * Combined attacks. chooseCommand values a follow-up only on the typical dice result, so an attack that only pays
     * because of what a second unit can then do to the same target (a flank charge that gives a later strike the
     * outflank die, a second shot at a unit the first may have broken) can lose to a plainer one. This challenges the
     * chosen activation with such attacks. The challenger and the current choice are valued the same way: the average,
     * over every dice result of the first attack, of the best attack still to come this turn (or stopping), plus the
     * same correction from the enemy's engine-checked replies after the first activation. It replaces the current
     * choice only if it is better by passMargin. Returns { pick, note } or null.
     */
    function comboChallenger(s, me, W, scored, pick) {
        if (s.commands[me] < 2) return null;
        const attackersOf = new Map();
        for (const c of scored) { const t = c.plan.pending && c.plan.pending.targetId; if (t) { if (!attackersOf.has(t)) attackersOf.set(t, new Set()); attackersOf.get(t).add(c.plan.unitId); } }
        // The best attack by each unit on each target that another unit can also attack, frontal and flank contact apart.
        const challengers = [], seen = new Set();
        for (const c of scored) {
            const pd = c.plan.pending, t = pd && pd.targetId;
            if (!t || attackersOf.get(t).size < 2 || c === pick) continue;
            const key = `${c.plan.unitId}>${t}${pd.flank ? 'f' : ''}`;
            if (!seen.has(key)) { seen.add(key); challengers.push(c); }
        }
        if (!challengers.length) return null;
        const sameTurn = st => st.phase === 'command' && st.round === s.round && st.turnStep === s.turnStep && E.activePlayer(st) === me && st.commands[me] >= 1;
        const memo = new Map();
        const afterwards = st => {
            const key = exactKey(st);
            if (memo.has(key)) return memo.get(key);
            let best = evaluate(st, me, W);
            if (sameTurn(st)) for (const u of army(st, me)) if (!u.activated) for (const plan of plansFor(st, u, me, true)) best = Math.max(best, scorePlan(plan, me, W).value);
            memo.set(key, best);
            return best;
        };
        const value = c => {
            if (W.playout) return c === pick ? pick.value : c.round !== undefined ? c.round : roundValue(c, me, W);
            const t = c.typical || finish(c.plan.state);
            return outcomesOf(c.plan, 1e-4).reduce((v, o) => v + o.p * afterwards(o.state), 0) + assess(t, me, W).theirs - W.reply * replyThreat(t, me, W);
        };
        const baseValue = value(pick);
        let best = null;
        for (const c of challengers) { const v = value(c); if (!best || v > best.v) best = { c, v }; }
        if (!best || best.v <= baseValue + W.passMargin) return null;
        return { pick: { ...best.c, value: best.v }, note: `${best.c.plan.name} ${best.c.plan.unitId}>${best.c.plan.pending.targetId} ${best.v.toFixed(2)} over ${baseValue.toFixed(2)}` };
    }
    function exactKey(s) {
        let k = `${s.phase}|${s.round}|${s.turnStep}|${s.master}|${s.commands.p1},${s.commands.p2}|${s.routed.p1},${s.routed.p2}|${s.winner || ''}`;
        for (const u of s.units) if (u.owner) k += `|${u.id}:${u.x},${u.y},${u.angle},${u.strain},${u.activated ? 1 : 0}`;
        return k;
    }
    const seeded = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    /** One result of a plan's dice, chosen by `u` in [0, 1) from the exact distribution. */
    function sampleOutcome(plan, u) {
        const outs = outcomesOf(plan, 1e-4);
        for (const o of outs) { u -= o.p; if (u < 0) return o.state; }
        return outs[outs.length - 1].state;
    }
    /**
     * The rest of the round from `s`, cheaply: whoever is to act takes their best single activation (scorePlan, no
     * lookahead), or passes if nothing beats passing; its dice are drawn from `random`. Stops at the end of the round.
     */
    let playMemo = null;   // within one decision: state -> { end, adj } of its typical-dice play-out (see chooseCommand)
    function playOut(s, W, random, me = null) {
        let st = s, adj = 0;
        const memo = playMemo && !random && me ? playMemo : null, path = [];
        for (let i = 0; i < 16 && st.phase === 'command' && st.round === s.round; i++) {
            if (st.activation) { st = finish(st); continue; }
            if (memo) {
                // Lines from different options often meet (the same activations in another order, the same result):
                // the rest of the play-out from here is then already known.
                const key = exactKey(st) + me, hit = memo.get(key);
                if (hit) { adj += hit.adj; st = hit.end; break; }
                path.push({ key, adj });
            }
            const actor = E.activePlayer(st), passed = tryApply(st, { type: 'pass' });
            let best = null, bestValue = passed ? evaluate(passed, actor, W) : -Infinity;
            for (const plan of allPlans(st, actor)) { const sp = scorePlan(plan, actor, W); if (sp.value > bestValue) { bestValue = sp.value; best = { plan, typical: sp.typical }; } }
            const next = !best ? passed : random ? sampleOutcome(best.plan, random()) : best.typical;
            if (!next || next === st) break;
            // With typical dice the line follows one result, but the attack is worth (to `me`) its average over all of them.
            if (me && !random && best && best.plan.pending) adj += scorePlan(best.plan, me, W).value - evaluate(next, me, W);
            st = next;
        }
        if (memo) for (const p of path) memo.set(p.key, { end: st, adj: adj - p.adj });
        if (me) st = Object.assign(Object.create(Object.getPrototypeOf(st)), st, { playoutAdj: adj });
        return st;
    }
    /**
     * Value to `me` of an option once the round is played out: the average over W.rollouts play-outs, each with its
     * own dice stream, shared by every option compared in one decision so that they meet the same luck. The opening
     * attack's own dice are sampled evenly over their distribution, and its exact expected value is kept: only the
     * difference the rest of the round makes is estimated. Where the round ends, next round's enemy replies are
     * checked with the engine. `option` is a scored plan ({ plan, single }) or a state to play on from (a pass).
     */
    function roundValue(option, me, W) {
        const L = W.leafWin === W.winBonus ? W : { ...W, winBonus: W.leafWin };
        const leaf = st => {
            const key = playMemo && exactKey(st) + me + '#leaf', hit = key && playMemo.get(key);
            if (hit !== undefined && hit !== false) return hit;
            const a = assess(st, me, L), v = a.total + a.theirs - W.reply * replyThreat(st, me, L);
            if (key) playMemo.set(key, v);
            return v;
        };
        if (!W.rollouts) {
            // Every exact result of the opening (routs as one), each played on with typical dice.
            // Dice rolled now are known before the later activations are chosen; play-outs with typical dice cannot
            // see that, so an option that rolls dice gets a small bonus (this also settles near-ties in its favour).
            const opens = option.plan ? outcomesOf(option.plan, 1e-4) : [{ p: 1, state: option }], early = option.plan && option.plan.pending ? W.resolveFirst : 0;
            return early + opens.reduce((v, o) => { const end = playOut(o.state, L, null, me); return v + o.p * (leaf(end) + end.playoutAdj); }, 0);
        }
        const n = W.rollouts;
        let sum = 0;
        for (let i = 0; i < n; i++) {
            const random = seeded(7919 * (i + 1));
            const open = option.plan ? sampleOutcome(option.plan, (i + random()) / n) : option;
            sum += leaf(playOut(open, W, random)) - (option.plan ? evaluate(open, me, L) : 0);
        }
        return (option.plan ? (L === W ? option.single : scorePlan(option.plan, me, L).value) : 0) + sum / n;
    }
    function chooseCommand(s, me, W, level, random) {
        try { return chooseActivation(s, me, W, level, random); } finally { playMemo = null; }
    }
    function chooseActivation(s, me, W, level, random) {
        if (s.activation) return { actions: [{ type: 'endActivation' }], note: 'finish activation' };
        const passed = tryApply(s, { type: 'pass' }), passValue = passed ? evaluate(passed, me, W) : -Infinity;
        const scored = allPlans(s, me).map(plan => { const sp = scorePlan(plan, me, W); return { plan, ...sp, single: sp.value }; }).sort((a, b) => b.value - a.value);
        if (!scored.length) return { actions: [{ type: 'pass' }], note: 'nothing to do' };
        if (level.depth > 1) for (const c of scored.slice(0, 5)) {
            const t = c.typical;
            if (!t || t.phase !== 'command' || E.activePlayer(t) !== me || t.commands[me] < 1) continue;
            const base = evaluate(t, me, W);
            let best = base;
            for (const plan of allPlans(t, me)) best = Math.max(best, scorePlan(plan, me, W).value);
            c.value += W.lookahead * (best - base);
        }
        scored.sort((a, b) => b.value - a.value);
        let passScore = passValue, options = scored;
        const usePlayout = Boolean(level.probe && level.playout && W.playout);
        if (usePlayout) {
            // For the leading options (chosen with the lookahead) and for passing, play the rest of the round out.
            // The play-out includes the follow-ups, so the lookahead bonus is dropped rather than counted twice.
            playMemo = new Map();
            options = scored.slice(0, W.probe);
            for (const c of options) c.value = c.round = roundValue(c, me, W);
            options.sort((a, b) => b.value - a.value);
            if (passed) passScore = roundValue(passed, me, W);
        } else if (level.probe) {
            // For the leading options, swap the rough threat estimate for what the enemy can really do in reply.
            const refine = (state, value) => value + assess(state, me, W).theirs - W.reply * replyThreat(state, me, W);
            options = scored.slice(0, W.probe);
            for (const c of options) if (c.typical) c.value = refine(c.typical, c.value);
            options.sort((a, b) => b.value - a.value);
            if (passed) passScore = refine(passed, passValue);
        }
        let pick = options[0];
        if (level.temperature > 0) {
            const pool = options.slice(0, 8), weights = pool.map(c => Math.exp((c.value - pool[0].value) / level.temperature));
            let r = random() * weights.reduce((a, b) => a + b, 0);
            for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { pick = pool[i]; break; } }
        }
        if (pick.value <= passScore + W.passMargin) return { actions: [{ type: 'pass' }], note: `pass (${passScore.toFixed(2)} vs ${pick.value.toFixed(2)})` };
        let combo = '';
        if (level.depth > 1 && level.probe && W.combos) { const c = comboChallenger(s, me, usePlayout ? W : { ...W, playout: 0 }, scored, pick); if (c) { pick = c.pick; combo = ` combo ${c.note}`; } }
        const actions = pick.plan.actions.slice();
        if (pick.plan.pending) actions.push(pick.plan.pending.type === 'rally' ? { type: 'rally' } : { type: pick.plan.pending.type, targetId: pick.plan.pending.targetId });
        actions.push({ type: 'endActivation' });
        return { actions, note: `${pick.plan.name} (${pick.value.toFixed(2)}, pass ${passScore.toFixed(2)})${combo}` };
    }

    // ---------- planning a whole turn ----------
    const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    function stateKey(s) {
        let k = `${s.phase}|${s.turnStep}|${s.commands.p1},${s.commands.p2}`;
        k += `|${s.round}|${s.master}|${s.routed.p1},${s.routed.p2}`;
        for (const u of s.units) if (u.owner) k += `|${u.id}:${u.x.toFixed(1)},${u.y.toFixed(1)},${u.angle.toFixed(1)},${u.strain},${u.activated ? 1 : 0}`;
        return k;
    }
    /** Every distinct result of a plan's dice: [{ p, state }], states with the activation closed. Routs are one outcome. */
    function outcomesOf(plan, minP = 0.004) {
        const pd = plan.pending;
        if (!pd) return [{ p: 1, state: finish(plan.state) }];
        if (pd.type === 'rally') return [1, 3, 5].map(die => ({ p: 1 / 3, state: finish(E.apply(plan.state, { type: 'rally', forcedDie: die })) }));
        const target = plan.state.units.find(u => u.id === pd.targetId), need = ROUT - target.strain, out = [];
        let routP = 0, dropped = 0;
        pd.dist.forEach((q, j) => {
            if (j >= need) routP += q;
            else if (q < minP) dropped += q;
            else out.push({ p: q, state: finish(E.apply(plan.state, { type: pd.type, targetId: pd.targetId, forcedStrain: j })) });
        });
        if (routP >= minP) out.push({ p: routP, state: finish(E.apply(plan.state, { type: pd.type, targetId: pd.targetId, forcedStrain: need })) });
        else dropped += routP;
        if (dropped > 0 && out.length) { const scale = 1 / (1 - dropped); out.forEach(o => { o.p *= scale; }); }   // negligible outcomes are folded in, not ignored
        return out;
    }
    const planKey = plan => plan.actions.map(a => `${a.type}${a.unitId || ''}${Math.round((a.inches || a.degrees || 0) * 10)}${a.backwards ? 'b' : ''}`).join(',')
        + (plan.pending ? plan.pending.type + (plan.pending.targetId || '') : '');

    /**
     * Plans the rest of this turn as a sequence of whole activations and returns the first one.
     *
     * - Decisions take the best option; dice take the average. The most promising opening attacks are branched
     *   on every real outcome (each strain value, with all routs as one), a follow-up is searched separately
     *   under each, and the opening is worth the probability-weighted sum. No outcome is ever pruned.
     * - Deeper attacks follow their typical result while carrying the gap between their true expected value
     *   and that result's value, so their own worth is still an expectation.
     * - "Stop here" is a result at every depth. A sequence cut off by the depth limit is valued as it stands,
     *   with the turn still open, not as a voluntary pass.
     * - So that combinations survive pruning, each step keeps the best attack on every target and any second
     *   attack on a target already hit, as well as the overall leaders.
     * - Leading results are finally re-scored with the enemy's engine-checked replies.
     * The rest of the sequence is re-planned next time, once the real dice are known.
     */
    function planTurn(s, me, W, level, random) {
        if (s.activation) return { actions: [{ type: 'endActivation' }], note: 'finish activation' };
        const started = clock(), beam = W.beam || level.beam, maxDepth = Math.min(W.turnDepth || level.turnDepth, s.commands[me]);
        const overBudget = () => clock() - started > W.timeBudget;
        const myTurn = st => st.phase === 'command' && st.round === s.round && st.turnStep === s.turnStep && E.activePlayer(st) === me && st.commands[me] > 0;
        const results = [];
        const record = (node, state) => results.push({ root: node.root, branch: node.branch, p: node.p, first: node.first, names: node.names, state, quick: evaluate(state, me, W) + node.adj });
        const stopHere = node => record(node, myTurn(node.state) ? tryApply(node.state, { type: 'pass' }) || node.state : node.state);
        const cutOff = node => record(node, node.state);

        const expand = node => {
            const options = [];
            for (const plan of allPlans(node.state, me)) {
                const sp = scorePlan(plan, me, W);
                options.push({ plan, sp, quick: sp.value + node.adj, target: plan.pending && plan.pending.type !== 'rally' ? plan.pending.targetId : null });
            }
            options.sort((a, b) => b.quick - a.quick);
            const keep = new Set(options.slice(0, W.branch || 8)), seen = new Set();
            for (const o of options) {
                if (!o.target) continue;
                const pair = o.plan.unitId + '>' + o.target;
                if (!seen.has(o.target)) { seen.add(o.target); keep.add(o); }                                   // best attack on each target
                else if (node.hit.includes(o.target) && !seen.has(pair)) { seen.add(pair); keep.add(o); }       // each further attacker on a target already hit
            }
            return [...keep].sort((a, b) => b.quick - a.quick);
        };
        const childOf = (node, o, state, extra) => ({ state, adj: node.adj, first: node.first || o.plan, root: node.root || planKey(o.plan), branch: node.branch, p: node.p,
            names: [...node.names, `${o.plan.name} ${o.plan.unitId}${o.target ? '>' + o.target : ''}`], hit: o.target ? [...node.hit, o.target] : node.hit, target: o.target, ...extra });

        const root = { state: s, adj: 0, first: null, root: null, branch: 'line', p: 1, names: [], hit: [] };
        stopHere(root);
        let frontier = [];
        if (maxDepth >= 1) {
            const options = expand(root), split = new Set();
            // Opening attacks worth exact treatment: the leaders among distinct attacker/target pairs.
            if (maxDepth >= 2) for (const o of options) { if (o.target && split.size < (W.split || 3)) split.add(o); }
            for (const o of options) {
                if (split.has(o)) {
                    outcomesOf(o.plan).forEach((out, j) => frontier.push(childOf(root, o, out.state, { branch: 'o' + j, p: out.p, quick: evaluate(out.state, me, W), group: planKey(o.plan) + '#' + j })));
                } else {
                    const adj = o.plan.pending ? o.sp.value - evaluate(o.sp.typical, me, W) : 0;
                    frontier.push(childOf(root, o, o.sp.typical, { adj, quick: o.quick, group: 'line' }));
                }
            }
        }
        for (let depth = 2; frontier.length; depth++) {
            // Choose which positions to continue from: a beam for ordinary lines, a narrow one inside each dice outcome.
            const groups = new Map();
            for (const n of frontier) { if (!groups.has(n.group)) groups.set(n.group, []); groups.get(n.group).push(n); }
            const chosen = [];
            for (const [group, list] of groups) {
                list.sort((a, b) => b.quick - a.quick);
                const width = group === 'line' ? beam : 2, picked = list.slice(0, width), targets = new Set();
                if (group === 'line') for (const n of list.slice(width)) if (n.target && !targets.has(n.target) && targets.size < 4) { targets.add(n.target); picked.push(n); }
                // Anything not continued still counts as a place the turn could stop.
                for (const n of list) { if (picked.includes(n) && myTurn(n.state) && depth <= maxDepth && !overBudget()) chosen.push(n); else if (myTurn(n.state) && depth > maxDepth) cutOff(n); else stopHere(n); }
            }
            const next = new Map();
            for (const node of chosen) {
                stopHere(node);
                for (const o of expand(node)) {
                    const adj = o.plan.pending ? o.sp.value - evaluate(o.sp.typical, me, W) : 0;
                    const child = childOf(node, o, o.sp.typical, { adj: node.adj + adj, quick: o.quick, group: node.group });
                    const key = node.group + '|' + (o.target ? node.names.join(';') + '>' : '') + stateKey(child.state);   // only quiet moves are merged: attack order matters
                    const had = next.get(key);
                    if (!had || child.quick > had.quick) next.set(key, child);
                }
            }
            frontier = [...next.values()];
        }

        // Value of each opening: best continuation under each dice outcome, weighted by its probability.
        const refine = r => { if (r.value === undefined) r.value = level.probe ? r.quick + assess(r.state, me, W).theirs - W.reply * replyThreat(r.state, me, W) : r.quick; return r.value; };
        const openings = new Map();
        for (const r of results) {
            const k = r.root || 'pass';
            if (!openings.has(k)) openings.set(k, { key: k, first: r.first, branches: new Map() });
            const b = openings.get(k).branches;
            if (!b.has(r.branch)) b.set(r.branch, { p: r.p, list: [] });
            b.get(r.branch).list.push(r);
        }
        const score = (o, full) => {
            let total = 0, names = null;
            for (const br of o.branches.values()) {
                br.list.sort((a, b) => b.quick - a.quick);
                // Fully score the best few continuations of this outcome and keep the best of them.
                let best = br.list[0];
                if (full) { for (const r of br.list.slice(0, 2)) refine(r); best = br.list.slice(0, 2).reduce((m, r) => (r.value > m.value ? r : m)); }
                total += br.p * (full ? best.value : best.quick);
                if (!names || br.p > names.p) names = { p: br.p, text: best.names.join(' → ') };
            }
            return { total, text: names ? names.text : '' };
        };
        const list = [...openings.values()];
        for (const o of list) o.quick = score(o, false).total;
        list.sort((a, b) => b.quick - a.quick);
        const finalists = list.slice(0, W.probe), passOpening = list.find(o => !o.first);
        if (passOpening && !finalists.includes(passOpening)) finalists.push(passOpening);
        for (const o of finalists) { const sc = score(o, true); o.value = sc.total; o.text = sc.text; }
        finalists.sort((a, b) => b.value - a.value);
        let pick = finalists[0];
        if (level.temperature > 0 && finalists.length > 1) {
            const weights = finalists.map(o => Math.exp((o.value - finalists[0].value) / level.temperature));
            let x = random() * weights.reduce((a, b) => a + b, 0);
            for (let i = 0; i < finalists.length; i++) { x -= weights[i]; if (x <= 0) { pick = finalists[i]; break; } }
        }
        const passValue = passOpening ? passOpening.value : -Infinity, ms = Math.round(clock() - started);
        if (!pick.first || pick.value <= passValue + W.passMargin) return { actions: [{ type: 'pass' }], note: `pass (${passValue.toFixed(2)}, ${ms} ms)` };
        const actions = pick.first.actions.slice(), pending = pick.first.pending;
        if (pending) actions.push(pending.type === 'rally' ? { type: 'rally' } : { type: pending.type, targetId: pending.targetId });
        actions.push({ type: 'endActivation' });
        return { actions, note: `${pick.text} (${pick.value.toFixed(2)}, pass ${passValue.toFixed(2)}, ${ms} ms)` };
    }

    // ---------- bidding ----------
    /** Mixed strategy for the row player of a zero-sum matrix, by fictitious play. */
    function solveMatrix(payoff) {
        const n = payoff.length, m = payoff[0].length, rowCount = Array(n).fill(0), colCount = Array(m).fill(0);
        const rowSum = Array(n).fill(0), colSum = Array(m).fill(0);
        let r = 0, c = 0;
        for (let it = 0; it < 4000; it++) {
            rowCount[r] += 1; colCount[c] += 1;
            for (let i = 0; i < n; i++) rowSum[i] += payoff[i][c];
            for (let j = 0; j < m; j++) colSum[j] += payoff[r][j];
            r = rowSum.indexOf(Math.max(...rowSum)); c = colSum.indexOf(Math.min(...colSum));
        }
        return rowCount.map(x => x / 4000);
    }
    function chooseBid(s, me, W, level, random) {
        const en = other(me), mine = army(s, me), theirs = army(s, en), cache = makeCache(s);
        const gains = (from, to) => from.map(a => Math.max(0, ...to.map(d => pairThreat(s, a, d, W, true, cache)))).sort((x, y) => y - x);
        const mineG = gains(mine, theirs), theirG = gains(theirs, mine);
        const take = (list, k) => { let t = 0; for (let i = 0; i < k; i++) t += (list[i] || 0) * Math.pow(0.85, i) + W.maneuver; return t; };
        const holder = s.master || other(s.firstPick);
        const payoff = [];
        for (let a = 1; a <= mine.length; a++) {
            const row = [];
            for (let b = 1; b <= theirs.length; b++) {
                const mt = a === b ? holder : (a < b ? me : en);
                // The Master Tactician can strike first and keeps the last move to escape or exploit.
                const mineV = take(mineG, a) * (mt === me ? 1.15 : 0.9), theirV = take(theirG, b) * (mt === en ? 1.15 : 0.9);
                row.push(mineV - theirV);
            }
            payoff.push(row);
        }
        let mix = solveMatrix(payoff);
        if (level.temperature > 0.2) mix = mix.map(p => p + 0.5 / mix.length);   // easy: less disciplined
        const cut = mix.map(p => (p < 0.05 ? 0 : p)), total = cut.reduce((x, y) => x + y, 0) || 1;
        let r = random() * total, value = 1;
        for (let i = 0; i < cut.length; i++) { r -= cut[i]; if (r <= 0) { value = i + 1; break; } }
        return { actions: [{ type: 'bid', player: me, value }], note: `bid ${value} from mix ${mix.map(p => p.toFixed(2)).join(' ')}` };
    }

    // ---------- draft ----------
    function unitAppeal(u) {
        return u.melee * (u.meleeAP ? 1.35 : 1) / 3 + (u.shoot || 0) * (u.shootAP ? 1.3 : 1) * Math.min(24, u.range || 0) / 24 + u.pace / 8 + u.mobility * 0.25
            + (7 - u.defence <= 2 ? 0.6 : 0) + (u.defenceStar ? 0.3 : 0) + (u.paceStar ? 0.2 : 0);
    }
    const ZONE = 6 * PX, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const isShooter = u => u.shoot > 0 && u.range >= 8, isFast = u => u.pace >= 10;
    /** Expected strain from a's better attack on b, straight from the dice maths. */
    function exchange(a, b) {
        const mean = (pool, tn) => E.strainDist(Math.max(1, pool), tn).reduce((n, p, k) => n + p * k, 0);
        return Math.max(a.melee > 0 ? mean(a.melee, targetNumber(a, b, false)) : 0, isShooter(a) ? mean(a.shoot, targetNumber(a, b, true)) : 0);
    }
    /**
     * How much a terrain tile centred at `c` favours `me`. Positive = good for me.
     * Hills are worth having on my side; impassable and slowing ground belongs in the enemy's way, not mine;
     * cover matters to whoever is being out-shot; a blocked wing suits the side with fewer fast units.
     */
    function terrainWorth(s, me, type, c) {
        const T = E.TERRAIN[type]; if (!T) return 0;
        const en = other(me), depth = s.height - 2 * ZONE;
        const yRel = clamp((me === 'p1' ? s.height - ZONE - c.y : c.y - ZONE) / depth, 0, 1), near = 1 - 2 * yRel;   // +1 by my zone, -1 by theirs
        const xRel = Math.abs(c.x - s.width / 2) / (s.width / 2);
        const sum = (p, f) => army(s, p).reduce((n, u) => n + f(u), 0);
        const shootEdge = clamp((sum(en, u => (isShooter(u) ? u.shoot : 0)) - sum(me, u => (isShooter(u) ? u.shoot : 0))) / 6, -1, 1);
        const fastEdge = clamp((sum(en, u => (isFast(u) ? 1 : 0)) - sum(me, u => (isFast(u) ? 1 : 0))) / 2, -1, 1);
        let v = 0;
        if (T.elevated) v += 0.6 * near + (sum(me, u => (isShooter(u) ? 1 : 0)) ? 0.15 * Math.max(0, near) : 0);
        if (T.impassable) v += -0.3 * near * (1 - 0.5 * xRel) + 0.25 * fastEdge * xRel;
        if (T.concealing) v += 0.35 * shootEdge * (1 - 0.5 * Math.abs(near));
        if (T.slowing) v += -0.2 * near;
        return v;
    }
    function bestTerrainSpot(s, me) {
        const type = s.terrainDeck[0], enemies = army(s, other(me));
        let best = null;
        for (const spot of E.terrainSpots(s)) {
            let v = terrainWorth(s, me, type, spot);
            // Obstacles are worth a little more squarely in front of units the enemy has already deployed.
            if (E.TERRAIN[type].impassable || E.TERRAIN[type].slowing) for (const e of enemies) if (Math.abs(centre(e).x - spot.x) < e.w) v += 0.08;
            if (!best || v > best.v) best = { spot, v };
        }
        return best;
    }
    /** Distance from a point to the nearest part of a unit's rectangle (0 inside it). */
    function rectDist(p, u) {
        const o = centre(u), a = (u.angle || 0) * Math.PI / 180, dx = p.x - o.x, dy = p.y - o.y;
        const lx = Math.abs(dx * Math.cos(a) + dy * Math.sin(a)) - u.w / 2, ly = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a)) - u.h / 2;
        return Math.hypot(Math.max(0, lx), Math.max(0, ly));
    }
    function deployScore(s, me, u, a, random, W) {
        const en = other(me), probe = { ...u, x: a.x, y: a.y, angle: a.angle }, c = centre(probe);
        const xRel = Math.abs(c.x - s.width / 2) / (s.width / 2), shooter = isShooter(u);
        let v = isFast(u) ? 0.5 * xRel : 0.25 * (1 - xRel);
        // The lane ahead: what stands between this spot and the enemy.
        for (const t of s.terrain) {
            const ct = centre(t), T = E.TERRAIN[t.type];
            if (Math.abs(ct.x - c.x) > t.w / 2 + u.w / 2) continue;
            const ahead = clamp(Math.abs(ct.y - c.y) / PX / 24, 0, 1), close = 1 - ahead;
            if (T.elevated) v += (ahead < 0.45 ? 0.4 : 0) * close + (shooter && ahead < 0.45 ? 0.3 : 0);
            if (T.impassable && !shooter) v -= 0.5 * close;
            if (T.slowing && !u.paceStar && !shooter) v -= 0.25 * close;
            if (T.concealing && shooter) v -= 0.5 * close;
        }
        // Match-ups against enemy units already on the table, weighted by how nearly opposite they are.
        for (const e of army(s, en)) {
            const opposite = Math.max(0, 1 - Math.abs(centre(e).x - c.x) / (12 * PX));
            if (opposite > 0) v += 0.25 * opposite * (exchange(u, e) - exchange(e, u));
        }
        // Stay in touch with the rest of the army.
        const friends = army(s, me);
        if (friends.length) v -= 0.03 * Math.max(0, Math.min(...friends.map(f => dist(c, centre(f)))) / PX - 8);
        // ...but leave room to turn: a unit wedged against a friend or the side edge can't pivot until it moves away.
        if (W.deployRoom) for (const f of [null, ...friends]) {
            const short = f ? Math.max(G.reach(probe) - rectDist(c, f), G.reach(f) - rectDist(centre(f), probe)) + 0.5
                : G.reach(probe) + 0.5 - Math.min(c.x, s.width - c.x);   // the side edges
            if (short > 0) v -= W.deployRoom * (0.3 + Math.min(short / PX, 1.5));
        }
        return v + random() * 0.05;
    }
    function chooseDraft(s, me, random, W) {
        const d = s.draft;
        if (!W.draftSmart) return chooseDraftSimple(s, me, random);
        if (d.step === 'pick') {
            const scored = s.units.filter(u => !u.owner).map(u => {
                // Drafting a unit also decides roughly where the top terrain tile goes: on that unit.
                const picked = tryApply(s, { type: 'pick', player: me, unitId: u.id });
                const placed = picked && picked.draft.step === 'terrain' ? bestTerrainSpot(picked, me) : null;
                const terrain = placed ? placed.v : 0;
                return { u, terrain, v: unitAppeal(u) + W.draftTerrain * terrain + random() * 0.3 };
            }).sort((a, b) => b.v - a.v);
            return { actions: [{ type: 'pick', player: me, unitId: scored[0].u.id }], note: `pick ${scored[0].u.name} (terrain ${scored[0].terrain.toFixed(2)})` };
        }
        if (d.step === 'terrain') {
            const best = bestTerrainSpot(s, me);
            return { actions: [{ type: 'placeTerrain', player: me, x: best.spot.x, y: best.spot.y }], note: `place ${s.terrainDeck[0]} (${best.v.toFixed(2)})` };
        }
        const u = s.units.find(x => x.id === d.picked), options = E.legalActions(s).filter(a => a.type === 'deploy');
        let best = null;
        for (const a of options) { const v = deployScore(s, me, u, a, random, W); if (!best || v > best.v) best = { a, v }; }
        return { actions: [best.a], note: `deploy ${u.name} (${best.v.toFixed(2)})` };
    }
    /** The first draft logic: stats only, random terrain, fast units on the wings. Kept for comparison (draftSmart: 0). */
    function chooseDraftSimple(s, me, random) {
        const d = s.draft;
        if (d.step === 'pick') {
            const pool = s.units.filter(u => !u.owner).map(u => ({ u, v: unitAppeal(u) + random() * 0.4 })).sort((a, b) => b.v - a.v);
            return { actions: [{ type: 'pick', player: me, unitId: pool[0].u.id }], note: `pick ${pool[0].u.name}` };
        }
        if (d.step === 'terrain') {
            const spots = E.terrainSpots(s), spot = spots[Math.floor(random() * Math.min(spots.length, 12))];
            return { actions: [{ type: 'placeTerrain', player: me, x: spot.x, y: spot.y }], note: 'place terrain' };
        }
        const u = s.units.find(x => x.id === d.picked), options = E.legalActions(s).filter(a => a.type === 'deploy');
        // Fast units on the wings, shooters and slow infantry towards the centre.
        const wing = u.pace >= 10 ? (army(s, me).filter(x => x.pace >= 10).length % 2 ? 0.14 : 0.86) : 0.5 + (random() - 0.5) * 0.45;
        const want = s.width * wing - u.w / 2;
        const best = options.reduce((m, a) => (Math.abs(a.x - want) < Math.abs(m.x - want) ? a : m), options[0]);
        return { actions: [best], note: 'deploy' };
    }

    // ---------- entry points ----------
    function choose(state, player, options = {}) {
        // The engine rejects illegal actions by throwing, and the search tries many: skip building their stack traces.
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = 0;
        try { return chooseFor(state, player, options); } finally { Error.stackTraceLimit = limit; }
    }
    function chooseFor(state, player, options) {
        const s = state.hypothetical ? state : E.observe(state, player);
        const W = { ...DEFAULTS, ...(options.weights || {}) }, level = LEVELS[options.level] || LEVELS.normal, random = options.random || Math.random;
        if (s.phase === 'draft') return s.draft.picker === player ? chooseDraft(s, player, random, W) : { actions: [], note: 'not my pick' };
        if (s.phase === 'bidding') return s.bids[player] === null ? chooseBid(s, player, W, level, random) : { actions: [], note: 'already bid' };
        if (s.phase === 'command') return E.activePlayer(s) === player ? (W.planner ? planTurn : chooseCommand)(s, player, W, level, random) : { actions: [], note: 'not my turn' };
        return { actions: [], note: 'game over' };
    }
    /** Carry out a chosen list of actions on the real state. Stops quietly if the plan no longer applies. */
    function carryOut(state, actions) {
        let s = state;
        for (const a of actions) {
            if (s.phase === 'finished') break;
            if (a.type === 'endActivation' && !s.activation) continue;
            try { s = E.apply(s, a); } catch (e) { break; }
        }
        return s;
    }
    const play = (state, player, options) => carryOut(state, choose(state, player, options).actions);

    return { choose, play, carryOut, terrainWorth, replyThreat: (s, me, w) => replyThreat(s, me, { ...DEFAULTS, ...(w || {}) }), evaluate: (s, me, w) => evaluate(s, me, { ...DEFAULTS, ...(w || {}) }), plansFor, _playOut: (s, w, seed = 1) => playOut(s, { ...DEFAULTS, ...(w || {}) }, seed === null ? null : seeded(seed)), _outcomes: (plan) => outcomesOf(plan, 1e-4), _roundValue: (o, me, w) => roundValue(o, me, { ...DEFAULTS, ...(w || {}) }), DEFAULTS, LEVELS };
})();
if (typeof module !== 'undefined') module.exports = SeizeAI;
