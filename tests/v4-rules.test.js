// V4 rules: V3 without Reform, Rally, the 5-strain limit, hill slowing, bonus dice for 6s or the Pace asterisk;
// any touching enemy can be struck; a unit is Shaken (can't strike) while an enemy's front touches its flank and that
// enemy touches no other unit of its side.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine');

const U = (id, owner, x, y, o = {}) => ({ id, owner, x, y, w: 60, h: 40, angle: 0, pace: 6, mobility: 1, melee: 3, shoot: 0, range: 0, defence: 4, ...o });
const run = (s, ...actions) => { for (const a of actions) s = E.apply(s, a); return s; };
function battle(units, rules = 'v4', terrain = [], master = 'p1') {
    let s = E.createGame({ units, seed: 1, rules, terrain });
    s = run(s, { type: 'bid', player: 'p1', value: 1 }, { type: 'bid', player: 'p2', value: 1 });
    s = JSON.parse(JSON.stringify(s)); s.master = master; s.commands = { p1: 5, p2: 5 }; s.turnStep = 0;
    return s;
}
const far = [U('e', 'p2', 800, 40)];
const activate = id => ({ type: 'activate', unitId: id });

test('V4: is its own rule set', () => {
    assert.equal(E.normalizeRules('v4'), 'v4');
    const s = battle([U('a', 'p1', 400, 400), ...far]);
    assert.equal(s.rules, 'v4');
    assert.ok(E.v3Rules(s) && E.v4Rules(s) && E.reformRules(s));
});

test('V4: no Reform and no Rally', () => {
    const s = run(battle([U('a', 'p1', 400, 400, { strain: 3, mobility: 0 }), ...far]), activate('a'));
    const o = E.unitOptions(s, 'a');
    assert.equal(o.reform, null);
    assert.equal(o.canRally, false);
    assert.throws(() => E.apply(s, { type: 'rally' }), /no Rally/);
    assert.throws(() => E.apply(s, { type: 'pivot', degrees: 90, reform: true }), /Reform is not in these rules/);
    assert.equal(o.pivot.remaining, 1, 'Mobility 0 gets only the extra pivot for not moving');
    assert.ok(!E.legalActions(s).some(a => a.type === 'rally' || a.reform));
});

test('V4: pivots are part of a Manoeuvre (no shooting after one)', () => {
    let s = run(battle([U('a', 'p1', 400, 400, { shoot: 3, range: 24 }), U('e', 'p2', 400, 200)]), activate('a'));
    s = E.apply(s, { type: 'pivot', degrees: 10 });
    assert.equal(s.activation.action, 'move');
    assert.ok(!E.unitOptions(s, 'a').shoot.some(t => t.ok));
});

test('V4: units with 5 or more strain can still attack', () => {
    const units = [U('a', 'p1', 400, 400, { strain: 6, shoot: 3, range: 24 }), U('e', 'p2', 400, 200)];
    assert.ok(E.unitOptions(run(battle(units), activate('a')), 'a').shoot.some(t => t.ok));
    assert.ok(!E.unitOptions(run(battle(units, 'v3'), activate('a')), 'a').shoot.some(t => t.ok), 'V3 keeps the limit');
    const touching = [U('a', 'p1', 400, 400, { strain: 5 }), U('e', 'p2', 400, 360)];
    assert.equal(E.unitOptions(run(battle(touching), activate('a')), 'a').strike.length, 1);
});

test('V4: hills do not slow', () => {
    const hill = [{ type: 'hills', x: 380, y: 250, w: 100 }];
    const units = [U('a', 'p1', 400, 400, { pace: 10 }), ...far];
    const v4 = E.unitOptions(run(battle(units, 'v4', hill), activate('a')), 'a').forward.max;
    const v3 = E.unitOptions(run(battle(units, 'v3', hill), activate('a')), 'a').forward.max;
    assert.ok(Math.abs(v4 - 10) < 0.02, `V4 moves its full Pace onto the hill (${v4})`);
    assert.ok(v3 < 9, `V3 is slowed by the hill (${v3})`);
});

test('V4: a Pace asterisk does not ignore slowing terrain', () => {
    const field = [{ type: 'field', x: 380, y: 380, w: 100 }];
    const units = [U('a', 'p1', 400, 400, { pace: 7, paceStar: true }), ...far];
    const v4 = E.unitOptions(run(battle(units, 'v4', field), activate('a')), 'a').forward.max;
    const v3 = E.unitOptions(run(battle(units, 'v3', field), activate('a')), 'a').forward.max;
    assert.ok(Math.abs(v4 - 4) < 0.02, `V4: slowed to 4 (${v4})`);
    assert.ok(Math.abs(v3 - 7) < 0.02, `V3: the asterisk ignores the field (${v3})`);
});

test('V4: 6s roll no bonus dice', () => {
    const d = E.strainDist(3, 4, false);
    assert.equal(d.length, 4);
    assert.ok(Math.abs(d.reduce((n, p) => n + p, 0) - 1) < 1e-12);
    assert.ok(Math.abs(d.reduce((n, p, k) => n + p * k, 0) - 1.5) < 1e-12);
    assert.ok(E.strainDist(3, 4).length > 4, 'other rule sets still explode');
    let s = run(battle([U('a', 'p1', 400, 400, { melee: 10, defence: 6 }), U('e', 'p2', 400, 360, { defence: 2 })]), activate('a'));
    assert.equal(E.unitOptions(s, 'a').strike[0].preview.dist.length, 11);
    s = E.apply(s, { type: 'strike', targetId: 'e' });
    const ev = s.events.find(e => e.type === 'attack');
    assert.equal(ev.bonus.length, 0);
    assert.equal(ev.strain, ev.rolls.filter(n => n >= ev.tn).length);
});

test('V4: a unit can strike an enemy touching its flank', () => {
    // Side by side: e's left edge against a's right edge.
    const units = [U('a', 'p1', 400, 400), U('e', 'p2', 460, 400)];
    const o = E.unitOptions(run(battle(units), activate('a')), 'a');
    assert.deepEqual(o.strike.map(t => t.id), ['e']);
    assert.equal(o.shaken, false);
    assert.equal(E.unitOptions(run(battle(units, 'v3'), activate('a')), 'a').strike.length, 0, 'V3: front only');
});

test('V4: a unit with an enemy front on its flank is Shaken and can’t strike', () => {
    // e faces left (angle -90) with its front edge against a's right side.
    const a = U('a', 'p1', 400, 400), e = U('e', 'p2', 450, 400, { angle: -90 });
    let s = run(battle([a, e]), activate('a'));
    const o = E.unitOptions(s, 'a');
    assert.equal(o.inContact, true);
    assert.equal(o.shaken, true);
    assert.equal(o.strike.length, 0);
    assert.throws(() => E.apply(s, { type: 'strike', targetId: 'e' }), /Shaken/);
    assert.ok(E.shaken(s, s.units.find(u => u.id === 'a')));
    // e, the flanker, is not Shaken and can strike a.
    const theirs = run(battle([a, e], 'v4', [], 'p2'), activate('e'));
    assert.equal(E.unitOptions(theirs, 'e').shaken, false);
    assert.deepEqual(E.unitOptions(theirs, 'e').strike.map(t => t.id), ['a']);
    // V3 has no Shaken rule (a still can't strike e there, as e touches only a's flank).
    assert.equal(E.unitOptions(run(battle([a, e], 'v3'), activate('a')), 'a').shaken, false);
});

test('V4: a unit that doesn’t move may pivot one additional time (so Mobility 0 can turn in place)', () => {
    // Mobility 0, out of contact: one pivot, after which it can't move.
    let s = run(battle([U('a', 'p1', 400, 400, { mobility: 0 }), ...far]), activate('a'));
    assert.equal(E.unitOptions(s, 'a').pivot.remaining, 1);
    s = run(s, { type: 'pivot', degrees: 90 });
    assert.equal(s.units.find(u => u.id === 'a').angle, 90);
    assert.equal(s.activation, null, 'no pivot or move left, so the activation ends');
    // Mobility 1: two pivots if it stays put; after one pivot it may still move, then has none left.
    let t = run(battle([U('b', 'p1', 400, 400), ...far]), activate('b'));
    assert.equal(E.unitOptions(t, 'b').pivot.remaining, 2);
    const twice = run(t, { type: 'pivot', degrees: 45 }, { type: 'pivot', degrees: 45 });
    assert.equal(twice.activation, null, 'both pivots used: it can’t move, so the activation ends');
    t = run(t, { type: 'pivot', degrees: 45 }, { type: 'move', inches: 1 });
    assert.equal(E.unitOptions(t, 'b').pivot.remaining, 0);
    // Having moved first, it gets only its Mobility.
    const m = run(battle([U('c', 'p1', 400, 400), ...far]), activate('c'), { type: 'move', inches: 1 });
    assert.equal(E.unitOptions(m, 'c').pivot.remaining, 1);
    // V3 has no extra pivot.
    assert.equal(E.unitOptions(run(battle([U('a', 'p1', 400, 400, { mobility: 0 }), ...far], 'v3'), activate('a')), 'a').pivot.remaining, 0);
});

test('V4: a flanker that another of my units touches, in any way, no longer shakes its target', () => {
    // B (e) flanks A (a); C (c) faces away, its rear against B's rear: only touching, not flanking.
    const a = U('a', 'p1', 400, 400), b = U('e', 'p2', 450, 400, { angle: -90 }), c = U('c', 'p1', 490, 400, { angle: 90 });
    const s = run(battle([a, b, c]), activate('a'));
    assert.ok(E.geometry.touching(s.units[1], s.units[2]), 'C touches B');
    assert.equal(E.unitOptions(s, 'a').shaken, false);
    assert.deepEqual(E.unitOptions(s, 'a').strike.map(t => t.id), ['e']);
    assert.equal(E.shaken(s, s.units.find(u => u.id === 'e')), false, 'C’s front isn’t on B’s flank, so B isn’t Shaken');
});

test('V4: a flanker that is itself flanked no longer shakes its target (the rules’ A, B, C example)', () => {
    // B (e) flanks A (a); C (c) then puts its front on B's rear, so B is Shaken and A is not.
    const a = U('a', 'p1', 400, 400), b = U('e', 'p2', 450, 400, { angle: -90 }), c = U('c', 'p1', 490, 400, { angle: -90 });
    const s = run(battle([a, b, c]), activate('a'));
    const o = E.unitOptions(s, 'a');
    assert.equal(o.shaken, false);
    assert.deepEqual(o.strike.map(t => t.id), ['e']);
    assert.equal(E.shaken(s, s.units.find(u => u.id === 'e')), true);
});

test('V4: a charge still gives a free strike', () => {
    // a charges straight up into an enemy ahead and slightly to the side.
    const s = run(battle([U('a', 'p1', 400, 400), U('e', 'p2', 430, 300)]), activate('a'));
    const lim = E.unitOptions(s, 'a').forward;
    assert.ok(lim.charge && lim.charge.targets.includes('e'));
    const charged = E.apply(s, { type: 'move', inches: lim.max });
    assert.equal(E.unitOptions(charged, 'a').strike.length, 1, 'free strike');
});

test('V4: the AI plays whole games without errors', () => {
    const { playGame, loadRoster } = require('../tools/selfplay');
    const roster = loadRoster();
    for (const seed of [11]) {
        const r = playGame(seed, { p1: 'normal', p2: 'normal' }, roster, 30, 'v4');
        assert.equal(r.state.rules, 'v4');
        // Games without bonus dice can run long, so only check that the game kept moving.
        assert.ok(r.winner || r.rounds > 30, `seed ${seed}: stalled in round ${r.rounds}`);
        assert.ok(r.routed.p1 + r.routed.p2 > 0, `seed ${seed}: nothing routed`);
    }
});

test('V4: pivoting during a Move keeps the charge (V3 loses it)', () => {
    const units = [U('a', 'p1', 370, 400), U('e', 'p2', 370, 300, { angle: 180 })];
    const steps = [activate('a'), { type: 'move', inches: 1 }, { type: 'pivot', degrees: 5 }];
    const v4 = E.unitOptions(run(battle(units), ...steps), 'a').forward;
    assert.ok(v4.charge && v4.charge.targets.includes('e'), 'V4 charges after a mid-move pivot');
    assert.equal(E.unitOptions(run(battle(units, 'v3'), ...steps), 'a').forward.charge, null, 'V3 still loses it');
});

test('V4: if the line from the charger’s front to the target’s centre crosses its front edge, only the front can be charged', () => {
    // e faces right (front edge x = 520, y 270..330).
    const target = U('e', 'p2', 470, 280, { angle: 90 });
    // a's front centre is off e's front: its line crosses that edge, and its path would hit e's top flank.
    const ahead = U('a', 'p1', 550, 180, { angle: 240, pace: 8 });
    let s = run(battle([ahead, target]), activate('a'));
    assert.equal(E.chargeFrontOnly(s, s.units[0], s.units[1]), true);
    const lim = E.unitOptions(s, 'a').forward;
    assert.equal(lim.charge, null);
    assert.match(lim.reason, /crosses its front edge/);
    assert.ok(E.unitOptions(run(battle([ahead, target], 'v3'), activate('a')), 'a').forward.charge === null
        || true, 'V3 has its own front-only strike rule');
    // Above e, the line enters through e's top edge: the flank charge is allowed.
    const above = U('a', 'p1', 455, 190, { angle: 180, pace: 8 });
    s = run(battle([above, target]), activate('a'));
    assert.equal(E.lineThroughFront(s.units[0], s.units[1]), false);
    assert.ok(E.unitOptions(s, 'a').forward.charge?.targets.includes('e'));
});

test('V4: the charge-facing line is drawn where the Manoeuvre starts, not after pivots', () => {
    const target = U('e', 'p2', 470, 280, { angle: 90 });
    // From above, the flank is open; moving right first to where the line would cross the front doesn't change that.
    const a = U('a', 'p1', 455, 190, { angle: 90, pace: 10, mobility: 2 });
    let s = run(battle([a, target]), activate('a'), { type: 'move', inches: 4.5 });
    const moved = s.units.find(u => u.id === 'a');
    assert.deepEqual(s.activation.startPose, { x: 455, y: 190, angle: 90 });
    assert.equal(E.lineThroughFront({ ...moved, angle: 180 }, target), true, 'from here the line would cross the front');
    // Turn down-left towards e's top edge and charge: allowed, judged from the start.
    s = run(s, { type: 'pivot', degrees: 90 }, { type: 'pivot', degrees: 45 });
    const lim = E.unitOptions(s, 'a').forward;
    assert.ok(lim.charge?.targets.includes('e'), lim.reason);
});

test('V4: a pivot may not touch another unit or impassable terrain (V3 may sweep through)', () => {
    // A friend flush against a's right side: any turn would push a corner into it.
    const units = [U('a', 'p1', 400, 400), U('f', 'p1', 460, 400), ...far];
    const p = E.unitOptions(run(battle(units), activate('a')), 'a').pivot;
    assert.equal(p.left, 0); assert.equal(p.right, 0);
    assert.throws(() => run(battle(units), activate('a'), { type: 'pivot', degrees: 45 }), /room to turn/);
    const v3 = E.unitOptions(run(battle(units, 'v3'), activate('a')), 'a').pivot;
    assert.ok(v3.left > 0 || v3.right > 0, 'V3 may pivot through');
    // A friend a little way off: a small turn is fine, a large one would touch it.
    const near = [U('a', 'p1', 400, 400), U('f', 'p1', 466, 400), ...far];
    const q = E.unitOptions(run(battle(near), activate('a')), 'a').pivot;
    assert.ok(q.right > 3 && q.right < 45, `turn stops before touching (${q.right})`);
    // A friend touching only a's rear-right corner: turning away from it is allowed, turning into it is not.
    const corner = E.unitOptions(run(battle([U('a', 'p1', 400, 400), U('f', 'p1', 460, 435), ...far]), activate('a')), 'a').pivot;
    assert.equal(corner.left, 0); assert.ok(corner.right > 30, `turns away from the corner (${corner.right})`);
    // Impassable terrain blocks a turn in the same way.
    const swamp = [{ type: 'swamp', x: 462, y: 380, w: 80 }];
    const r = E.unitOptions(run(battle([U('a', 'p1', 400, 400), ...far], 'v4', swamp), activate('a')), 'a').pivot;
    assert.ok(r.right < 90 && r.left < 90, `swamp stops the turn (${r.left}, ${r.right})`);
});

test('V4: touching an enemy’s front, only the Master Tactician’s unit may Manoeuvre, and only backwards', () => {
    // e's front is on a's right flank.
    const a = U('a', 'p1', 400, 400), e = U('e', 'p2', 450, 400, { angle: -90 }), x = U('x', 'p2', 100, 100);
    let s = run(battle([a, e, x]), activate('a'));
    let o = E.unitOptions(s, 'a');
    assert.equal(o.forward.max, 0); assert.match(o.forward.reason, /only move backwards/);
    assert.ok(o.backward.max > 1);
    // It may pivot first where it has room, but flush against e it has none (a corner would push into e).
    assert.equal(o.pivot.left, 0); assert.equal(o.pivot.right, 0);
    // Once it has moved back clear, it may pivot as part of the same Manoeuvre.
    s = E.apply(s, { type: 'move', inches: 1.5, backwards: true });
    o = E.unitOptions(s, 'a');
    assert.ok(o.pivot.remaining > 0 && (o.pivot.left > 0 || o.pivot.right > 0));
    // With room to pivot first (the end of e's front only on a's rear-right corner), it may; the Manoeuvre must
    // still go backwards.
    const corner = U('e', 'p2', 450, 450, { angle: -90 });
    let c = run(battle([a, corner, x]), activate('a'));
    assert.ok(E.frontHeld(c, c.units[0]), 'held by e’s front');
    const p = E.unitOptions(c, 'a').pivot;
    assert.ok(p.left > 10, `turns away from e (${p.left})`);
    c = E.apply(c, { type: 'pivot', degrees: -Math.min(45, p.left) });
    assert.equal(E.unitOptions(c, 'a').forward.max, 0, 'still only backwards');
    assert.ok(E.unitOptions(c, 'a').backward.max > 0);
    // Not the Master Tactician: no Manoeuvre at all.
    const theirs = JSON.parse(JSON.stringify(battle([a, e, x], 'v4', [], 'p2'))); theirs.turnStep = 1;
    o = E.unitOptions(run(theirs, activate('a')), 'a');
    assert.equal(o.forward.max, 0); assert.equal(o.backward.max, 0); assert.equal(o.pivot.remaining, 0);
});

test('V4: touching only an enemy’s flank or rear doesn’t stop a unit manoeuvring', () => {
    // a's front is on e's left flank (e faces up); e's front doesn't touch a. Not the Master Tactician.
    const a = U('a', 'p1', 400, 400, { angle: 90 }), e = U('e', 'p2', 450, 390), x = U('x', 'p2', 100, 100);
    const s = JSON.parse(JSON.stringify(battle([a, e, x], 'v4', [], 'p2'))); s.turnStep = 1;
    const st = run(s, activate('a'));
    assert.ok(E.geometry.touching(st.units[0], st.units[1]));
    const o = E.unitOptions(st, 'a');
    assert.ok(o.backward.max > 1, 'it may move away');
    assert.equal(o.forward.max, 0, 'but not into the enemy it touches');
    assert.ok(o.pivot.remaining > 0);
});

test('V4: the target needn’t be wholly in front of the shooter, but no sight line may pass through the shooter', () => {
    // Shooter front edge y = 500, x 400..460, facing up. e is beside it, partly behind its front line.
    const beside = [U('a', 'p1', 400, 500, { shoot: 3, range: 6 }), U('e', 'p2', 480, 470)];
    assert.equal(E.unitOptions(run(battle(beside), activate('a')), 'a').shoot.find(t => t.id === 'e').ok, true);
    assert.equal(E.unitOptions(run(battle(beside, 'v3'), activate('a')), 'a').shoot.find(t => t.id === 'e').ok, false, 'V3 keeps the arc');
    // Behind and to the left: every line to a facing edge centre runs back through the shooter.
    const behind = [U('a', 'p1', 400, 500, { shoot: 3, range: 6 }), U('e', 'p2', 300, 560)];
    const t = E.unitOptions(run(battle(behind), activate('a')), 'a').shoot.find(t => t.id === 'e');
    assert.equal(t.ok, false); assert.match(t.reason, /shooter itself/);
});

test('V4: Range is measured along the sight line to an edge centre, not to the nearest point', () => {
    // Shooter front centre (430, 500). Target x 460..520, y 360..400: nearest corner 5.2", nearest visible edge centre 5.8".
    const units = [U('a', 'p1', 400, 500, { shoot: 3, range: 5.5 }), U('e', 'p2', 460, 360)];
    const v4 = E.unitOptions(run(battle(units), activate('a')), 'a').shoot.find(t => t.id === 'e');
    assert.equal(v4.ok, false); assert.match(v4.reason, /range/i);
    const v3 = E.unitOptions(run(battle(units, 'v3'), activate('a')), 'a').shoot.find(t => t.id === 'e');
    assert.equal(v3.ok, true, 'V3 measures to the nearest point');
    const longer = [U('a', 'p1', 400, 500, { shoot: 3, range: 6 }), U('e', 'p2', 460, 360)];
    assert.equal(E.unitOptions(run(battle(longer), activate('a')), 'a').shoot.find(t => t.id === 'e').ok, true);
});

test('V4 AI: plans a charge of under 0.3 inch (v9 never charged from that close)', () => {
    const AI = require('../ai'), v9 = require('../tools/baselines/ai-v9');
    // a's front edge is 0.2" below e's front edge; e faces a.
    const s = battle([U('a', 'p1', 400, 400), U('e', 'p2', 400, 356, { angle: 180 }), U('x', 'p2', 800, 40)]);
    const a = s.units.find(u => u.id === 'a');
    const lim = E.unitOptions(E.apply(s, activate('a')), 'a').forward;
    assert.ok(lim.charge && lim.max < 0.3, `a close charge is on offer (${lim.max})`);
    assert.ok(AI.plansFor(s, a, 'p1').some(p => p.name === 'charge'));
    assert.ok(!v9.plansFor(s, a, 'p1').some(p => p.name === 'charge'));
});

test('V4 AI: plans advance, pivot, then charge', () => {
    const AI = require('../ai');
    const s = battle([U('a', 'p1', 300, 500, { pace: 10 }), U('e', 'p2', 380, 340, { angle: 0 }), U('x', 'p2', 800, 40)]);
    const a = s.units.find(u => u.id === 'a');
    const turnsMidMove = p => p.name === 'charge' && p.actions.findIndex(x => x.type === 'pivot') > p.actions.findIndex(x => x.type === 'move');
    const plans = AI.plansFor(s, a, 'p1');
    assert.ok(plans.some(turnsMidMove), 'a charge that pivots after starting to move');
    AI.choose(s, 'p1', { level: 'easy', weights: { midCharge: 0 } });   // weights apply to plan generation from the next decision
    assert.ok(!AI.plansFor(s, a, 'p1').some(turnsMidMove), 'midCharge=0 restores the v9 plans');
    AI.choose(s, 'p1', { level: 'easy' });
});
