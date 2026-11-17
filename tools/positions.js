#!/usr/bin/env node
/*
 * Positional test suite for the AI: hand-built situations where good play is about where a unit ends up,
 * not about an attack on offer. Each position reports pass/fail, so two AI versions can be compared
 * without the noise of whole games.
 *   node tools/positions.js [hard] [v1]      (any player spec that tools/selfplay.js accepts)
 */
const fs = require('fs');
const path = require('path');
const E = require('../engine');
// The plan generator used by `exposure` comes from the frozen baseline, so this suite does not depend on ai.js (which is being edited).
const AI = require('./baselines/ai-v3.js');

function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
/** A player spec such as v3 or v3:beam=1 is played by its frozen baseline (and that baseline's own carryOut); anything else goes through selfplay. */
function makePlayer(spec, seed) {
    const [name, ...mods] = spec.split(':'), file = path.join(__dirname, 'baselines', `ai-${name}.js`);
    if (!fs.existsSync(file)) return require('./selfplay').makePlayer(spec, seed);
    const brain = require(file), random = rng(seed), weights = {};
    for (const m of mods.join(':').split(',').filter(Boolean)) { const [k, v] = m.split('='); weights[k] = Number(v); }
    return (s, me) => {
        const choice = brain.choose(s, me, { level: 'hard', random, weights });
        const next = brain.carryOut(s, choice.actions);
        if (next === s) throw new Error(`${spec} made no progress in ${s.phase}: ${choice.note} ${JSON.stringify(choice.actions)}`);
        return next;
    };
}

const W = 88 / 25.4 * 20, H = 63 / 25.4 * 20;
const unit = (id, owner, x, y, angle, extra = {}) => ({ id, name: id, owner, x, y, w: W, h: H, angle,
    pace: 6, mobility: 2, melee: 3, shoot: 0, range: 0, defence: 4, ...extra });
function battle(units, bids = { p1: 1, p2: 3 }, seed = 9) {
    // Spare units tucked in the corners keep army sizes realistic without affecting the fight.
    const spare = [unit('s1', 'p1', 10, 665, 0), unit('s2', 'p1', 90, 665, 0), unit('t1', 'p2', 10, 5, 180), unit('t2', 'p2', 90, 5, 180)];
    let s = E.createGame({ units: [...units, ...spare], seed });
    s = E.apply(s, { type: 'bid', player: 'p1', value: bids.p1 });
    return E.apply(s, { type: 'bid', player: 'p2', value: bids.p2 });
}
/** Expected strain the enemy's best single attack would put on `id` if it acted now. */
function exposure(s, id, by = 'p2') {
    const q = E.clone(s); q.hypothetical = true; q.activation = null; q.turnStep = by === q.master ? 0 : 1; q.commands = { ...q.commands, [by]: 3 };
    for (const u of q.units) u.activated = false;
    let worst = { expected: 0, flank: false };
    for (const u of q.units.filter(x => x.owner === by)) for (const plan of AI.plansFor(q, u, by, true)) {
        if (plan.pending.targetId !== id) continue;
        const pre = E.attackPreview(plan.state, u.id, id, plan.pending.type === 'shoot' ? 'shoot' : 'strike');
        if (pre.expected > worst.expected) worst = { expected: pre.expected, flank: pre.mods.some(m => m.label === 'Target outflanked') };
    }
    return worst;
}
const find = (s, id) => s.units.find(u => u.id === id);

const POSITIONS = [
    {
        name: 'stays out of a heavy charger’s reach when nothing is gained by advancing',
        // Our weak unit is 12.5 inches from enemy cavalry that charges 10. Any real advance walks into it.
        state: seed => battle([unit('a', 'p1', 500, 520, 0, { melee: 1, defence: 3 }), unit('c', 'p2', 500, 220, 180, { pace: 10, melee: 6, mobility: 1 })], undefined, seed),
        check: (before, after) => exposure(after, 'a').expected < 0.01 || 'ended inside the cavalry’s charge reach'
    },
    {
        name: 'does not leave a flank to an enemy that can charge it',
        // Enemy infantry stands off our right side, 4 inches away, and has not acted. Our unit faces up the table.
        state: seed => battle([unit('a', 'p1', 450, 400, 0, { melee: 2 }), unit('f', 'p2', 630, 405, 270, { melee: 5 })], undefined, seed),
        check: (before, after) => !find(after, 'a') || !exposure(after, 'a').flank || 'still offers its flank'
    },
    {
        name: 'pulls a nearly-routed unit away from an enemy that can finish it',
        state: seed => battle([unit('a', 'p1', 500, 470, 0, { strain: 5, melee: 2 }), unit('e', 'p2', 500, 300, 180, { melee: 5 })], undefined, seed),
        check: (before, after) => exposure(after, 'a').expected < exposure(before, 'a').expected - 0.3 || find(after, 'a').strain < 5 || 'left the fragile unit where it was'
    },
    {
        name: 'archers hold their distance from infantry and keep shooting',
        // Archers 9 inches from infantry (pace 6): they can shoot now and stay safe; advancing would be a mistake.
        state: seed => battle([unit('a', 'p1', 500, 520, 0, { melee: 1, shoot: 4, range: 24, defence: 3 }), unit('e', 'p2', 500, 290, 180, { melee: 5 })], undefined, seed),
        check: (before, after, actions) => (actions.some(x => x.type === 'shoot') && find(after, 'a').y >= 520 - 1) || 'did not simply shoot from where it stood'
    },
    {
        name: 'takes the flank charge that is available instead of the frontal one',
        // Two enemies are in reach: one facing us, one side-on. Same stats; the side-on one gives an extra die.
        // P2 is Master Tactician and passes its first turn, so P1 acts in the middle turn and has no second turn:
        // holding the command to rally later (a fair choice when P1 is Master Tactician) is not available.
        state: seed => battle([unit('a', 'p1', 500, 480, 0, { melee: 4 }), unit('front', 'p2', 400, 360, 180), unit('side', 'p2', 600, 360, 90)], { p1: 3, p2: 1 }, seed),
        prepare: s => E.apply(s, { type: 'pass' }),
        check: (before, after, actions) => actions.some(x => x.type === 'strike' && x.targetId === 'side') || 'did not strike the side-on unit'
    },
    {
        name: 'does not march a lone unit into the reach of two enemies',
        // Two fresh enemy units 11 inches away; a full advance ends 5 inches from both with no support.
        state: seed => battle([unit('a', 'p1', 500, 540, 0), unit('e1', 'p2', 430, 270, 180, { melee: 5 }), unit('e2', 'p2', 570, 270, 180, { melee: 5 })], undefined, seed),
        check: (before, after) => exposure(after, 'a').expected <= exposure(before, 'a').expected + 0.01 || 'advanced into charge reach'
    },
    {
        name: 'turns a slow unit to face a threat on its flank even when it cannot attack',
        // Mobility 1, enemy off to the left side out of our charge reach but within theirs.
        state: seed => battle([unit('a', 'p1', 520, 420, 0, { mobility: 1, pace: 4, melee: 3 }), unit('f', 'p2', 280, 425, 90, { melee: 5, pace: 8 })], undefined, seed),
        check: (before, after) => !exposure(after, 'a').flank || 'still offers its flank'
    },
    {
        name: 'shields a fragile friend by not moving the unit that screens it',
        // A solid unit stands between enemy infantry and our 6-strain archers. With one command, it should not walk away.
        state: seed => battle([unit('screen', 'p1', 500, 420, 0, { melee: 3, defence: 5 }), unit('a', 'p1', 500, 500, 0, { strain: 6, melee: 1, defence: 3 }),
            unit('e', 'p2', 500, 250, 180, { melee: 5 })], undefined, seed),
        check: (before, after) => exposure(after, 'a').expected <= exposure(before, 'a').expected + 0.01 || 'opened a path to the fragile unit'
    }
];

const COMBINATIONS = [];

// ---------------------------------------------------------------------------------------------------------
// Combinations: positions where good play is a sequence of activations in one turn, not the best single one.
// Player 1 is the AI under test and (unless `prepare` says otherwise) Master Tactician. The lower bid is
// Master Tactician and the bid is also the number of commands, so bids {p1: 2, p2: 3} give P1 two commands.
// Every sequence below was executed with E.apply before the check was written, and the numbers in the comments
// come from E.attackPreview and E.strainDist (exact). Checks look only at the attacks and their order, never at dice.
// ---------------------------------------------------------------------------------------------------------
const MT2 = { p1: 2, p2: 3 };
const flanked = a => /target outflanked/.test(a.line);
const unmarked = a => /no command marker/.test(a.line);
const describe = a => `${a.attackerId} ${a.type === 'shoot' ? 'shot' : 'struck'} ${a.targetId}${flanked(a) ? ' (outflanked)' : ''}`;
/** Did the k-th attack of the turn rout its target? (The rout line directly follows the attack line in the log.) */
function routedBy(rec, k) { const i = rec.lines.indexOf(rec.actions[k].line); return /routs!$/.test(rec.lines[i + 1] || ''); }

/*
 * Flank strike first, then the heavy hitter. Rules note: "outflanked" only needs an enemy touching the victim's side or
 * rear that touches none of the victim's friends, so the flanker `b` has the extra die as soon as it arrives, and it
 * also gives that die to anyone who strikes the victim afterwards. Pinning the victim first adds nothing; arrival order
 * does: if `a` strikes first it gets no outflank die. (The plan's wording "sends b in first" as a failure is the wrong
 * way round under these rules.)
 * v is unactivated, strain 2, defence 4. a: melee 5. b: melee 2, pace 10, starts off v's right side and needs a
 * 90 degree pivot, then a 7.03 inch charge into the side. Verified legal in both variants.
 *   b first: b 4 dice (+outflank, +unmarked) exp 2.33; a 7 dice exp 4.08  -> total 6.42, P(rout) 0.815
 *   a first: a 6 dice (+unmarked)       exp 3.50; b 4 dice exp 2.33  -> total 5.83, P(rout) 0.738
 * (a's charge is 4.02 inches in 'pin then flank'; in 'order matters' a already touches v.)
 */
function flankFirst(rec) {
    const [x, y] = rec.actions;
    if (!x) return 'made no attack at all';
    if (!(x.attackerId === 'b' && x.targetId === 'v' && flanked(x))) return `first attack was ${describe(x)}; the flanker should arrive first so that both strikes get the outflank die`;
    if (routedBy(rec, 0)) return true;
    if (!y) return 'the heavy hitter never struck the flanked unit';
    return (y.attackerId === 'a' && y.targetId === 'v' && flanked(y)) || `second attack was ${describe(y)}; expected a to strike v with the outflank die`;
}
COMBINATIONS.push({
    name: 'pin then flank: the fast unit arrives first so that the frontal charge also gets the outflank die',
    seeds: 4,
    state: seed => battle([unit('a', 'p1', 500, 430, 0, { melee: 5 }), unit('b', 'p1', 700, 300, 0, { pace: 10, melee: 2 }),
        unit('v', 'p2', 500, 300, 180, { melee: 3, strain: 2 })], MT2, seed),
    check: (before, after, actions, rec) => flankFirst(rec)
}, {
    name: 'order matters: the flanker charges first, then the unit already in contact strikes with the outflank die',
    seeds: 4,
    state: seed => battle([unit('a', 'p1', 500, 300 + H, 0, { melee: 5 }), unit('b', 'p1', 700, 300, 0, { pace: 10, melee: 2 }),
        unit('v', 'p2', 500, 300, 180, { melee: 3, strain: 2 })], MT2, seed),
    check: (before, after, actions, rec) => flankFirst(rec)
});

/*
 * Focus fire. Shooters a1, a2 (shoot 4, range 24) at y=500; enemies d (strain 3) and f (fresh) at y=250, both defence 4,
 * both in the open and in front of both shooters. One shot is 4 dice needing 4+: expected 2.33 strain.
 *   d needs 4 more strain: one shot routs it 0.178, two shots 0.732.
 *   split fire (one each): P(rout d) 0.178 and 2.33 strain on f.   both at d: P(rout d) 0.732.
 * The follow-up shot goes to d unless the first already routed it, in which case it goes to f.
 */
function focusFire(rec) {
    const [x, y] = rec.actions;
    if (!x) return 'made no attack at all';
    if (x.targetId !== 'd') return `first shot went at ${x.targetId}, not the damaged unit`;
    const gone = routedBy(rec, 0);
    if (!y) return gone ? 'first shot routed d and the second shooter did nothing' : 'second shooter did nothing';
    if (gone) return y.targetId === 'f' || `first shot routed d but the second went at ${y.targetId}`;
    return y.targetId === 'd' || `d survived the first shot but the second went at ${y.targetId}`;
}
const shooters = () => [unit('a1', 'p1', 380, 500, 0, { melee: 1, shoot: 4, range: 24, defence: 3 }), unit('a2', 'p1', 560, 500, 0, { melee: 1, shoot: 4, range: 24, defence: 3 })];
COMBINATIONS.push({
    name: 'focus fire: both shots at the damaged unit rather than one each',
    seeds: 10,
    state: seed => battle([...shooters(), unit('d', 'p2', 380, 250, 180, { strain: 3 }), unit('f', 'p2', 560, 250, 180)], MT2, seed),
    check: (before, after, actions, rec) => focusFire(rec)
}, {
    // d has strain 5 (needs 2): the first shot routs it 0.729 of the time. Then the second shooter must use its shot on f
    // (exp 2.33 strain); if d survives (0.271) the second shot goes at d (P(rout) 0.729 again). Run over 20 dice seeds.
    name: 'does not waste the second attacker after a rout (checked over 20 seeds)',
    seeds: 20,
    state: seed => battle([...shooters(), unit('d', 'p2', 380, 250, 180, { strain: 5 }), unit('f', 'p2', 560, 250, 180)], MT2, seed),
    check: (before, after, actions, rec) => focusFire(rec)
});

/*
 * Strike before they are marked. a charges v (4.02 inches, pace 6): 5 dice now (melee 4 +1 for an unmarked target) exp 2.92
 * strain; in the second turn v will have been activated by the enemy and the same strike is 4 dice, exp 2.33, after v has
 * already had its own go at us. b (second command) has nothing to attack. Right play: a charges v in the first turn.
 */
COMBINATIONS.push({
    name: 'strikes the unmarked enemy now instead of waiting for the second turn',
    seeds: 3,
    state: seed => battle([unit('a', 'p1', 500, 430, 0, { melee: 4 }), unit('b', 'p1', 300, 430, 0, { melee: 3 }), unit('v', 'p2', 500, 300, 180, { melee: 3 })], MT2, seed),
    check: (before, after, actions) => actions.some(x => x.attackerId === 'a' && x.targetId === 'v' && unmarked(x)) || 'did not strike the unactivated unit in the first turn'
});

/*
 * Hold a command. Archers a, b (range 8) face two infantry c, d (pace 6, melee 4) 10 inches away: nothing can attack
 * anyone now (10 > 8 range, charge 6 inches gets nowhere). Moving up puts the archers inside the infantry's charge, and
 * every activation spent now is a command missing from the second turn, which comes after the enemy has moved.
 * Measured with the frozen v3 playing both sides (12 seeds, whole round): passing the first turn gave the enemy
 * 2.67 strain on average (the enemy walks into range and both archers get a shot in the second turn); using both
 * commands first gave 0. Holding never did worse. Caveat: this relies on the opponent being willing to advance; if it
 * does not, holding costs nothing either. Pass: at most one command used and nobody left in charge reach.
 */
COMBINATIONS.push({
    name: 'holds a command for the second turn when nothing can be attacked yet',
    seeds: 3,
    state: seed => battle([unit('a', 'p1', 400, 500, 0, { melee: 3, shoot: 3, range: 8, defence: 3 }), unit('b', 'p1', 560, 500, 0, { melee: 3, shoot: 3, range: 8, defence: 3 }),
        unit('c', 'p2', 400, 500 - 10 * 20 - H, 180, { melee: 4 }), unit('d', 'p2', 560, 500 - 10 * 20 - H, 180, { melee: 4 })], MT2, seed),
    check: (before, after, actions, rec) => {
        if (rec.activated.length > 1) return `used ${rec.activated.length} commands (${rec.activated.join(', ')}) in the first turn; none was needed`;
        const exposed = ['a', 'b'].filter(id => find(after, id) && exposure(after, id).expected > 0.01 && exposure(before, id).expected <= 0.01);
        return !exposed.length || `moved ${exposed.join(' and ')} into charge reach`;
    }
});

/** Plays Player 1's whole current turn from `start` and records what happened. `spec` may also be a function (state, 'p1') -> state, for scripted test moves. Unit names equal ids in these positions. */
function play(spec, start, playerSeed) {
    const player = typeof spec === 'function' ? spec : makePlayer(spec, playerSeed), rec = { actions: [], activated: [], routed: [], lines: [] };
    const step = start.turnStep;
    let s = start;
    for (let i = 0; i < 12 && s.phase === 'command' && E.activePlayer(s) === 'p1' && s.turnStep === step; i++) {
        const prev = s; s = player(s, 'p1');
        if (s === prev) break;
        for (const u of s.units) if (u.owner === 'p1' && u.activated && !(prev.units.find(v => v.id === u.id) || {}).activated) rec.activated.push(u.id);
        // The log is newest-first; a routed unit is gone from s.units, so activations are also read from the log below.
        for (const line of s.log.slice(0, s.log.length - prev.log.length).reverse()) {
            rec.lines.push(line);
            const m = /^(\S+) (shoots|strikes) (\S+):/.exec(line), r = /^(\S+) routs!/.exec(line);
            if (m) rec.actions.push({ type: m[2] === 'shoots' ? 'shoot' : 'strike', attackerId: m[1], targetId: m[3], line });
            if (r) rec.routed.push(r[1]);
        }
    }
    return { start, end: s, rec };
}
const SEED0 = 9;
function run(spec, only = '') {
    const results = [];
    for (const [group, list] of [['positional', POSITIONS], ['combinations', COMBINATIONS]]) {
        for (const pos of list) {
            if (only && !pos.name.includes(only)) continue;
            const seeds = pos.seeds || 1, fails = [];
            for (let i = 0; i < seeds; i++) {
                const before = pos.state(SEED0 + i * 101), start = pos.prepare ? pos.prepare(before) : before;
                const { end, rec } = play(spec, start, 77 + i);
                const verdict = pos.check(start, end, rec.actions, rec);
                if (verdict !== true) fails.push(seeds > 1 ? `seed ${SEED0 + i * 101}: ${verdict}` : verdict);
            }
            results.push({ group, name: pos.name, ok: !fails.length, seeds, passedSeeds: seeds - fails.length, why: fails[0] || '' });
        }
    }
    return results;
}
if (require.main === module) {
    const args = process.argv.slice(2), only = (args.find(a => a.startsWith('--only=')) || '').slice(7), specs = args.filter(a => !a.startsWith('--'));
    for (const spec of specs.length ? specs : ['v3']) {
        const results = run(spec, only), count = g => { const r = results.filter(x => x.group === g); return `${r.filter(x => x.ok).length}/${r.length}`; };
        console.log(`\n${spec}: ${count('positional')} positional, ${count('combinations')} combinations`);
        let group = '';
        for (const r of results) {
            if (r.group !== group) { group = r.group; if (group === 'combinations') console.log('combinations'); }
            console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.seeds > 1 ? ` [${r.passedSeeds}/${r.seeds} seeds]` : ''}${r.ok ? '' : ` — ${r.why}`}`);
        }
    }
}
module.exports = { run, play, POSITIONS, COMBINATIONS, exposure, battle, unit, find, W, H };
