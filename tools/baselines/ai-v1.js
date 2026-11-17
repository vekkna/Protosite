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
        passMargin: 0.02
    };
    const LEVELS = { easy: { temperature: 0.35, depth: 1 }, normal: { temperature: 0.08, depth: 2 }, hard: { temperature: 0, depth: 2 } };

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
        return W.strain + W.routed - strainScore(u.strain, W) + routProgress(k + 1, need, W) - routProgress(k, need, W) + (k + 1 >= need ? 50 : 0);
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
        let best = 0;
        const ca = centre(att), cd = centre(def), d = dist(ca, cd), contact = cache.contacts.get(att.id);
        const unmarked = fresh || !def.activated ? 1 : 0;
        const high = cache.high.get(att.id) - cache.high.get(def.id);
        if (contact.length) {
            // Already fighting: it can strike what it touches (and nothing else worth modelling).
            if (contact.includes(def.id)) best = attackValue(s, def, att.melee + unmarked + high, targetNumber(att, def, false), W);
        } else {
            const gap = d - att.h / 2 - Math.min(def.w, def.h) / 2;
            const turn = Math.abs(norm180(bearing(ca, cd) - att.angle));
            const lane = Math.atan2(att.w / 2 + Math.max(def.w, def.h) / 2, Math.max(1, d)) * 180 / Math.PI;
            if (att.melee > 0 && gap <= att.pace * PX && turn <= 90 * att.mobility + lane && !pathBlocked(s, att, def)) {
                const f = G.forwardOf(def), front = { x: cd.x + f.x * def.h / 2, y: cd.y + f.y * def.h / 2 };
                const flank = (ca.x - front.x) * f.x + (ca.y - front.y) * f.y < -def.h * 0.25 ? 1 : 0;
                best = attackValue(s, def, att.melee + unmarked + flank + high, targetNumber(att, def, false), W);
            }
            if (att.shoot > 0 && d - att.h / 2 - Math.max(def.w, def.h) / 2 <= att.range * PX && !cache.contacts.get(def.id).length) {
                const canFace = turn <= 90 * att.mobility + 25;
                if (canFace) {
                    const facing = att.mobility > 0 ? { ...att, angle: bearing(ca, cd) } : att;
                    const probe = facing === att ? s : { ...s, units: s.units.map(u => (u.id === att.id ? facing : u)) };
                    if (!E.shotError(probe, facing, def)) best = Math.max(best, attackValue(s, def, att.shoot + high, targetNumber(att, def, true), W));
                }
            }
        }
        cache.set(key, best);
        return best;
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
    function makeCache(s) {
        const cache = new Map();
        cache.contacts = new Map(); cache.high = new Map();
        for (const u of s.units) if (u.owner) {
            cache.contacts.set(u.id, E.enemiesTouching(s, u).map(v => v.id));
            cache.high.set(u.id, E.inTrait(s, u, 'elevated') ? 1 : 0);
        }
        return cache;
    }

    /** Value of a position to `me`. Higher is better. Call with no activation in progress. */
    function evaluate(s, me, W) {
        if (s.phase === 'finished') return s.winner === me ? 1000 : -1000;
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
        v -= Math.max(theirNow, W.nextRound * threatTotal(s, theirs, mine, guess(en), W, true, cache));
        // Mild pull towards the enemy so that armies close instead of waiting for each other.
        if (theirs.length) {
            const pull = W.approach * (1 + Math.max(0, s.round - 1) / 5);
            for (const u of mine) { let near = Infinity; const c = centre(u); for (const o of theirs) near = Math.min(near, dist(c, centre(o))); v -= pull * near / PX; }
        }
        return v;
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
    function plansFor(s, u, me) {
        const plans = [], start = tryApply(s, { type: 'activate', unitId: u.id });
        if (!start) return plans;
        const first = [{ type: 'activate', unitId: u.id }];
        const add = (name, actions, state, pending = null) => plans.push({ name, unitId: u.id, actions, state, pending });
        const enemies = army(s, other(me)), cu = centre(u);
        add('hold', first, start);

        const here = E.unitOptions(start, u.id);
        if (here.canRally) add('rally', first, start, { type: 'rally' });
        for (const t of here.strike) add('strike', first, start, { type: 'strike', targetId: t.id, dist: t.preview.dist });

        // Facings worth considering: as it stands, at each enemy (centre and both sides), and directly away.
        const turns = [0];
        const consider = angle => { const d = norm180(angle - u.angle); if (Math.abs(d) > 2 && Math.abs(d) <= 90 * u.mobility && !turns.some(t => Math.abs(t - d) < 6)) turns.push(d); };
        if (!here.inContact && u.mobility > 0) {
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
            let st = start, acts = first.slice(), ok = true;
            for (const step of pivotChunks(turn)) { const next = tryApply(st, { type: 'pivot', degrees: step }); if (!next) { ok = false; break; } st = next; acts.push({ type: 'pivot', degrees: step }); }
            if (!ok || !st.activation) continue;
            const o = E.unitOptions(st, u.id);
            if (!o.canAct) continue;
            if (turn !== 0) add('face', acts, st);
            for (const t of o.shoot) if (t.ok) add('shoot', acts, st, { type: 'shoot', targetId: t.id, dist: t.preview.dist });
            if (!o.actionFree) continue;
            const moves = [];
            if (o.forward.max > 0.3) for (const f of o.forward.charge ? [1, 0.6, 0.3] : [1, 0.75, 0.5, 0.25]) moves.push({ inches: f === 1 ? o.forward.max : o.forward.max * f, backwards: false, charge: f === 1 && Boolean(o.forward.charge) });
            if (turn === 0 && o.backward.max > 0.3) for (const f of [1, 0.5]) moves.push({ inches: f === 1 ? o.backward.max : o.backward.max * f, backwards: true });
            for (const m of moves) {
                const action = { type: 'move', inches: m.inches, backwards: m.backwards }, moved = tryApply(st, action);
                if (!moved) continue;
                const acts2 = [...acts, action];
                if (m.charge && moved.activation && moved.activation.freeStrike) {
                    for (const t of E.unitOptions(moved, u.id).strike) add('charge', acts2, moved, { type: 'strike', targetId: t.id, dist: t.preview.dist });
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

    function allPlans(s, me) {
        const out = [];
        if (s.phase !== 'command' || E.activePlayer(s) !== me || s.activation || s.commands[me] < 1) return out;
        for (const u of army(s, me)) if (!u.activated) out.push(...plansFor(s, u, me));
        return out;
    }
    function chooseCommand(s, me, W, level, random) {
        if (s.activation) return { actions: [{ type: 'endActivation' }], note: 'finish activation' };
        const passed = tryApply(s, { type: 'pass' }), passValue = passed ? evaluate(passed, me, W) : -Infinity;
        const scored = allPlans(s, me).map(plan => ({ plan, ...scorePlan(plan, me, W) })).sort((a, b) => b.value - a.value);
        if (!scored.length) return { actions: [{ type: 'pass' }], note: 'nothing to do' };
        // Look one activation further for the most promising options.
        if (level.depth > 1) for (const c of scored.slice(0, 5)) {
            const t = c.typical;
            if (!t || t.phase !== 'command' || E.activePlayer(t) !== me || t.commands[me] < 1) continue;
            const base = evaluate(t, me, W);
            let best = base;
            for (const plan of allPlans(t, me)) best = Math.max(best, scorePlan(plan, me, W).value);
            c.value += W.lookahead * (best - base);
        }
        scored.sort((a, b) => b.value - a.value);
        let pick = scored[0];
        if (level.temperature > 0) {
            const pool = scored.slice(0, 8), weights = pool.map(c => Math.exp((c.value - pool[0].value) / level.temperature));
            let r = random() * weights.reduce((a, b) => a + b, 0);
            for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { pick = pool[i]; break; } }
        }
        if (pick.value <= passValue + W.passMargin) return { actions: [{ type: 'pass' }], note: `pass (${passValue.toFixed(2)} vs ${pick.value.toFixed(2)})` };
        const actions = pick.plan.actions.slice();
        if (pick.plan.pending) actions.push(pick.plan.pending.type === 'rally' ? { type: 'rally' } : { type: pick.plan.pending.type, targetId: pick.plan.pending.targetId });
        actions.push({ type: 'endActivation' });
        return { actions, note: `${pick.plan.name} (${pick.value.toFixed(2)}, pass ${passValue.toFixed(2)})` };
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
                // The Master Tactician strikes first, against unmarked units, and keeps the last move to escape or exploit.
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
    function chooseDraft(s, me, random) {
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
        const s = state.hypothetical ? state : E.observe(state, player);
        const W = { ...DEFAULTS, ...(options.weights || {}) }, level = LEVELS[options.level] || LEVELS.normal, random = options.random || Math.random;
        if (s.phase === 'draft') return s.draft.picker === player ? chooseDraft(s, player, random) : { actions: [], note: 'not my pick' };
        if (s.phase === 'bidding') return s.bids[player] === null ? chooseBid(s, player, W, level, random) : { actions: [], note: 'already bid' };
        if (s.phase === 'command') return E.activePlayer(s) === player ? chooseCommand(s, player, W, level, random) : { actions: [], note: 'not my turn' };
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

    return { choose, play, carryOut, evaluate: (s, me, w) => evaluate(s, me, { ...DEFAULTS, ...(w || {}) }), plansFor, DEFAULTS, LEVELS };
})();
if (typeof module !== 'undefined') module.exports = SeizeAI;
