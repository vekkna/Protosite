// V5.1 rules (2026-11-27; the rule set is still 'v5' internally): V4's shooting, Shaken, dice and terrain, with hills
// slowing units that enter them, and new movement: March (Mobility pivots at any point, one more if it doesn't move, no
// contact), Charge (edge from the start line, hinge flush, slide to the edge's centre, free strike at the target; it
// may touch no other unit), no Reform, Withdraw (Master Tactician's unit touching one enemy: face its edge, then march
// back as far as it can, out of contact), and a strike on a flank rerolls its misses once.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine');

const U = (id, owner, x, y, o = {}) => ({ id, owner, x, y, w: 60, h: 40, angle: 0, pace: 6, mobility: 1, melee: 3, shoot: 0, range: 0, defence: 4, ...o });
const run = (s, ...actions) => { for (const a of actions) s = E.apply(s, a); return s; };
function battle(units, rules = 'v5', terrain = [], master = 'p1') {
    let s = E.createGame({ units, seed: 1, rules, terrain });
    s = run(s, { type: 'bid', player: 'p1', value: 1 }, { type: 'bid', player: 'p2', value: 1 });
    s = JSON.parse(JSON.stringify(s)); s.master = master; s.commands = { p1: 5, p2: 5 }; s.turnStep = 0;
    return s;
}
const far = [U('e', 'p2', 800, 40)];
const activate = id => ({ type: 'activate', unitId: id });
const unit = (s, id) => s.units.find(u => u.id === id);
const gap = (s, a, b) => E.geometry.polyDist(E.geometry.rect(unit(s, a)), E.geometry.rect(unit(s, b)));
const norm = a => ((a % 360) + 360) % 360;

test('V5.1: is its own rule set, called V5.1 (internally v5), built on V4', () => {
    assert.equal(E.normalizeRules('v5'), 'v5');
    assert.equal(E.rulesName('v5'), 'V5.1');
    const s = battle([U('a', 'p1', 400, 400), ...far]);
    assert.equal(s.rules, 'v5');
    assert.ok(E.v5Rules(s) && E.v4Rules(s) && !E.v4Only(s) && !E.reformAction(s) && !E.rallyAllowed(s) && E.hillsSlow(s));
    assert.ok(!E.v5Rules(battle([U('a', 'p1', 400, 400), ...far], 'v4')));
});

test('V5.1: a March may pivot at any point, carrying on relative to its new facing', () => {
    let s = run(battle([U('a', 'p1', 400, 400, { mobility: 2 }), ...far]), activate('a'), { type: 'move', inches: 2 }, { type: 'pivot', degrees: 90 });
    const o = E.unitOptions(s, 'a');
    assert.ok(Math.abs(o.forward.max - 4) < 1e-6, `4 inches of Pace left after the pivot (${o.forward.max})`);
    s = E.apply(s, { type: 'move', inches: 4 });
    assert.equal(unit(s, 'a').x, 480, 'carried on to the right, its new forwards');
    assert.equal(unit(s, 'a').y, 360);
});

test('V5.1: no Reform; a unit that doesn’t move gets one more pivot (so Mobility 0 can turn)', () => {
    const s = run(battle([U('a', 'p1', 400, 400, { mobility: 0 }), ...far]), activate('a'));
    const o = E.unitOptions(s, 'a');
    assert.equal(o.reform, null);
    assert.equal(o.pivot.remaining, 1);
    assert.throws(() => E.apply(s, { type: 'pivot', degrees: 90, reform: true }), /Reform is not in these rules/);
    const turned = E.apply(s, { type: 'pivot', degrees: 90 });
    assert.equal(unit(turned, 'a').angle, 90);
    assert.equal(turned.activation, null, 'it used the extra pivot, so it can’t move: the activation ends');
    // Mobility 1: two pivots if it stays put, but only one once it has moved.
    const m1 = run(battle([U('a', 'p1', 400, 400, { mobility: 1 }), ...far]), activate('a'));
    assert.equal(E.unitOptions(m1, 'a').pivot.remaining, 2);
    assert.equal(E.unitOptions(E.apply(m1, { type: 'move', inches: 1 }), 'a').pivot.remaining, 1);
});

test('V5: a March stops short of friends, impassable terrain and enemies it can’t charge', () => {
    const friend = run(battle([U('a', 'p1', 400, 400), U('f', 'p1', 400, 320), ...far]), activate('a'));
    const lim = E.unitOptions(friend, 'a').forward;
    assert.ok(lim.max < 2 && lim.max > 1.9, `stops just short (${lim.max})`);
    assert.ok(gap(E.apply(friend, { type: 'move', inches: lim.max }), 'a', 'f') > 0.5, 'not touching the friend');
    const back = run(battle([U('a', 'p1', 400, 400), U('e', 'p2', 400, 460)]), activate('a'));
    const b = E.unitOptions(back, 'a').backward;
    assert.equal(b.charge, null);
    assert.ok(gap(E.apply(back, { type: 'move', inches: b.max, backwards: true }), 'a', 'e') > 0.5, 'a backward March doesn’t touch the enemy');
});

test('V5.1: a straight charge meets the front, ends flush and strikes only the target', () => {
    const units = [U('a', 'p1', 400, 400), U('e', 'p2', 400, 300, { angle: 180 }), U('g', 'p2', 600, 300, { angle: 180 })];
    let s = run(battle(units), activate('a'));
    const lim = E.unitOptions(s, 'a').forward;
    assert.ok(lim.charge?.targets.includes('e'), lim.reason);
    assert.equal(lim.charge.edge, 0);
    s = E.apply(s, { type: 'move', inches: lim.max });
    assert.equal(unit(s, 'a').y, 340); assert.equal(norm(unit(s, 'a').angle), 0);
    assert.ok(s.activation.charged);
    assert.deepEqual(E.unitOptions(s, 'a').strike.map(t => t.id), ['e'], 'free strike only at the target');
});

test('V5.1: a charge may not end touching any unit but its target', () => {
    // g stands just right of where a would end up, flush against e's front: a would touch it.
    const units = [U('a', 'p1', 400, 400), U('e', 'p2', 400, 300, { angle: 180 }), U('g', 'p2', 460, 345, { angle: 180 })];
    const lim = E.unitOptions(run(battle(units), activate('a')), 'a').forward;
    assert.equal(lim.charge, null);
    assert.match(lim.reason, /No room to line up flush against e’s front: it would touch g/);
});

test('V5: an angled charge hinges about the contact point until flush with the edge', () => {
    let s = run(battle([U('a', 'p1', 420, 400, { angle: 10 }), U('e', 'p2', 400, 300, { angle: 180 })]), activate('a'));
    const lim = E.unitOptions(s, 'a').forward;
    assert.ok(lim.charge, lim.reason);
    s = E.apply(s, { type: 'move', inches: lim.max });
    const a = unit(s, 'a'), r = E.geometry.rect(a);
    assert.ok(Math.abs(norm(a.angle + 180) - 180) < 1e-6, `faces the front squarely (${a.angle})`);
    assert.ok(Math.abs(r[0].y - 340) < 1e-6 && Math.abs(r[1].y - 340) < 1e-6, 'front edge flush on e’s front edge');
    assert.ok(Math.abs(r[0].x - 430) < 0.05, `then slides along the edge until it touches its centre (x 430): ${r[0].x}`);
    assert.ok(E.geometry.touching(a, unit(s, 'e')));
});

test('V5: a charger that meets only the end of the edge slides along it to touch the centre', () => {
    // a overlaps e's front edge by 2 px at the far left; e's front edge runs x 400..460, centre 430.
    let s = run(battle([U('a', 'p1', 342, 400), U('e', 'p2', 400, 300, { angle: 180 })]), activate('a'));
    s = E.apply(s, { type: 'move', inches: E.unitOptions(s, 'a').forward.max });
    const r = E.geometry.rect(unit(s, 'a'));
    assert.ok(Math.abs(r[1].x - 430) < 0.05 && Math.abs(r[1].y - 340) < 1e-6, `front-right corner on the centre: ${r[1].x}, ${r[1].y}`);
    assert.ok(E.geometry.touching(unit(s, 'a'), unit(s, 'e')));
    // Already touching the centre: no slide.
    let t = run(battle([U('a', 'p1', 380, 400), U('e', 'p2', 400, 300, { angle: 180 })]), activate('a'));
    t = E.apply(t, { type: 'move', inches: E.unitOptions(t, 'a').forward.max });
    assert.equal(unit(t, 'a').x, 380);
});

test('V5: the slide to the centre stops where a friend is in the way', () => {
    const units = [U('a', 'p1', 342, 400), U('e', 'p2', 400, 300, { angle: 180 }), U('f', 'p1', 415, 345)];
    let s = run(battle(units), activate('a'));
    const lim = E.unitOptions(s, 'a').forward;
    assert.ok(lim.charge, lim.reason);
    s = E.apply(s, { type: 'move', inches: lim.max });
    const a = unit(s, 'a');
    assert.ok(a.x > 354 && a.x < 355, `slid only up to f (${a.x})`);
    assert.ok(gap(s, 'a', 'f') > 0.02 && gap(s, 'a', 'f') < 0.1, 'stops just short of the friend');
});

test('V5: a flank strike rerolls its misses once (and keeps the target’s Defence)', () => {
    // e faces right; a (3 dice) comes down onto its left flank.
    let s = run(battle([U('a', 'p1', 400, 180, { angle: 180 }), U('e', 'p2', 400, 260, { angle: 90, defence: 5 })]), activate('a'));
    const lim = E.unitOptions(s, 'a').forward;
    assert.equal(lim.charge?.edge, 3, lim.reason);
    s = E.apply(s, { type: 'move', inches: lim.max });
    const t = E.unitOptions(s, 'a').strike[0].preview;
    assert.equal(t.tn, 5); assert.equal(t.reroll, true); assert.match(t.rerollNote, /misses rerolled once/);
    // Each die hits 5+ with 1/3, or 1/3 + 2/3 x 1/3 = 5/9 with the reroll: 3 dice expect 5/3 strain.
    assert.ok(Math.abs(t.expected - 5 / 3) < 1e-9, `expected ${t.expected}`);
    // Rolled for real: every miss is rolled once more, and the log says so.
    const struck = E.apply(s, { type: 'strike', targetId: 'e' }), ev = struck.events.find(x => x.type === 'attack');
    assert.equal(ev.rerolls.length, ev.rolls.filter(n => n < 5).length);
    assert.equal(ev.strain, [...ev.rolls, ...ev.rerolls].filter(n => n >= 5).length);
    assert.match(struck.log.find(l => / strikes /.test(l)), /rerolling misses \(flank attack\)/);
    // The same strike from the front: no reroll.
    const front = run(battle([U('a', 'p1', 400, 400), U('e', 'p2', 400, 300, { angle: 180, defence: 5 })]), activate('a'));
    const charged = E.apply(front, { type: 'move', inches: E.unitOptions(front, 'a').forward.max });
    const f = E.unitOptions(charged, 'a').strike[0].preview;
    assert.equal(f.tn, 5); assert.equal(f.reroll, false); assert.ok(Math.abs(f.expected - 1) < 1e-9);
});

test('V5: only the edge the start line crosses may be charged', () => {
    // The line from a's front to e's centre crosses e's front, but a's path would meet e's side first.
    const s = run(battle([U('a', 'p1', 460, 330, { angle: -90, pace: 10 }), U('e', 'p2', 400, 300, { angle: 180 })]), activate('a'));
    assert.deepEqual(E.chargeEdges(unit(s, 'a'), unit(s, 'e')), [0]);
    const lim = E.unitOptions(s, 'a').forward;
    assert.equal(lim.charge, null);
    assert.match(lim.reason, /crosses its front/);
    assert.ok(gap(E.apply(s, { type: 'move', inches: lim.max }), 'a', 'e') > 0.5, 'stops short without contact');
});

test('V5.1: a charge may use all its Mobility pivots, at any point', () => {
    // e is off to the right: a moves up, pivots right, moves on, pivots back up, then charges e’s front.
    const units = [U('a', 'p1', 300, 500, { mobility: 2, pace: 16 }), U('e', 'p2', 420, 300, { angle: 180 })];
    let s = run(battle(units), activate('a'), { type: 'move', inches: 2 }, { type: 'pivot', degrees: 90 }, { type: 'move', inches: 6 }, { type: 'pivot', degrees: -90 });
    const lim = E.unitOptions(s, 'a').forward;
    assert.ok(lim.charge?.targets.includes('e'), lim.reason);
    s = E.apply(s, { type: 'move', inches: lim.max });
    assert.ok(s.activation.charged);
});

test('V5: no charge where there is no room to hinge flush', () => {
    // A friend just right of where a would end up flush.
    const units = [U('a', 'p1', 420, 400, { angle: 10 }), U('e', 'p2', 400, 300, { angle: 180 }), U('f', 'p1', 493, 345)];
    const s = run(battle(units), activate('a'));
    const lim = E.unitOptions(s, 'a').forward;
    assert.equal(lim.charge, null);
    assert.match(lim.reason, /No room to line up flush/);
});

test('V5.1: engaged units can only Strike; the Master Tactician’s may Withdraw instead', () => {
    // a and e front to front.
    const units = [U('a', 'p1', 400, 400), U('e', 'p2', 400, 360, { angle: 180 }), U('x', 'p2', 100, 100, { shoot: 3, range: 30 })];
    const other = battle(units, 'v5', [], 'p2'); other.turnStep = 1;
    const theirs = run(other, activate('a'));
    let o = E.unitOptions(theirs, 'a');
    assert.equal(o.forward.max, 0); assert.equal(o.backward.max, 0); assert.equal(o.pivot.remaining, 0);
    assert.deepEqual(o.withdraw, []); assert.equal(o.strike.length, 1); assert.equal(o.engaged, true);
    assert.match(o.withdrawWhy, /Master Tactician/);
    assert.throws(() => E.apply(theirs, { type: 'withdraw', targetId: 'e' }), /Master Tactician/);
    // As the Master Tactician: one Withdraw action turns it to face e (already does) and marches back as far as it can.
    let s = run(battle(units), activate('a'));
    o = E.unitOptions(s, 'a');
    assert.deepEqual(o.withdraw, ['e']); assert.equal(o.backward.max, 0, 'no March while engaged');
    s = E.apply(s, { type: 'withdraw', targetId: 'e' });
    assert.equal(unit(s, 'a').angle, 0);
    assert.equal(unit(s, 'a').y, 460, 'marched back its full half Pace');
    assert.match(s.log[0], /withdraws from e and marches back 3\.00″/);
});

test('V5.1: a Withdraw faces the enemy’s edge it touches, then marches back; it may pivot afterwards', () => {
    // e's front is on a's right flank: a turns 90° clockwise to face it, then backs away to the left.
    const flank = [U('a', 'p1', 400, 400, { mobility: 1 }), U('e', 'p2', 450, 400, { angle: -90 }), U('x', 'p2', 100, 100)];
    let s = run(battle(flank), activate('a'), { type: 'withdraw', targetId: 'e' });
    assert.equal(unit(s, 'a').angle, 90);
    assert.match(s.log[0], /turning 90° to face it/);
    assert.ok(unit(s, 'a').x < 360, 'moved left, away from e');
    assert.equal(E.unitOptions(s, 'a').pivot.remaining, 1, 'a March may still pivot');
    // An enemy on a's rear: a turns right round.
    const rear = run(battle([U('a', 'p1', 400, 400), U('e', 'p2', 400, 440), U('x', 'p2', 100, 100)]), activate('a'), { type: 'withdraw', targetId: 'e' });
    assert.equal(norm(unit(rear, 'a').angle), 180);
});

test('V5.1: only a unit touching just one enemy can Withdraw', () => {
    const two = run(battle([U('a', 'p1', 400, 400), U('e', 'p2', 400, 360, { angle: 180 }), U('g', 'p2', 450, 400, { angle: -90 })]), activate('a'));
    const o = E.unitOptions(two, 'a');
    assert.deepEqual(o.withdraw, []); assert.match(o.withdrawWhy, /more than one enemy/);
});

test('V5.1: no Withdraw without room to turn or to march back out of contact', () => {
    // A friend just above a: turned 90° to face e (on a's right), a is taller and would touch it.
    const noTurn = run(battle([U('a', 'p1', 400, 400), U('e', 'p2', 450, 400, { angle: -90 }), U('f', 'p1', 400, 339, { w: 60, h: 60 }), U('x', 'p2', 100, 100)]), activate('a'));
    assert.deepEqual(E.unitOptions(noTurn, 'a').withdraw, []);
    assert.match(E.unitOptions(noTurn, 'a').withdrawWhy, /No room to turn to face the enemy: it would touch f/);
    assert.throws(() => E.apply(noTurn, { type: 'withdraw', targetId: 'e' }), /No room to turn/);
    // Its back against the battlefield's edge: it can turn but can't back away.
    const s = battle([U('a', 'p1', 400, 679.5), U('e', 'p2', 400, 639.5, { angle: 180 }), U('x', 'p2', 100, 100)]);
    assert.throws(() => E.apply(run(s, activate('a')), { type: 'withdraw', targetId: 'e' }), /out of contact/);
});

test('V5: hills slow units entering them, but not one that starts on the hill', () => {
    const hill = [{ type: 'hills', x: 380, y: 250, w: 100 }];
    const v5 = E.unitOptions(run(battle([U('a', 'p1', 400, 400, { pace: 10 }), ...far], 'v5', hill), activate('a')), 'a').forward.max;
    const v4 = E.unitOptions(run(battle([U('a', 'p1', 400, 400, { pace: 10 }), ...far], 'v4', hill), activate('a')), 'a').forward.max;
    assert.ok(v5 < 4.01, `V5 is slowed entering the hill (${v5})`);
    assert.ok(v4 > 9.9, `V4 isn’t (${v4})`);
    const onHill = E.unitOptions(run(battle([U('a', 'p1', 400, 280, { pace: 10 }), ...far], 'v5', hill), activate('a')), 'a').forward.max;
    assert.ok(onHill > 9.9, `starting on the hill isn’t slowed (${onHill})`);
});

test('V5: Shaken and V4 shooting still apply', () => {
    // e's front on a's right flank: a is Shaken.
    const s = run(battle([U('a', 'p1', 400, 400), U('e', 'p2', 450, 400, { angle: -90 }), U('x', 'p2', 100, 100)]), activate('a'));
    const o = E.unitOptions(s, 'a');
    assert.equal(o.shaken, true); assert.equal(o.strike.length, 0);
    const shooter = run(battle([U('a', 'p1', 400, 400, { shoot: 3, range: 24 }), U('e', 'p2', 400, 200)]), activate('a'));
    assert.ok(E.unitOptions(shooter, 'a').shoot.some(t => t.ok));
});

test('V5: the AI plays a whole game without errors', () => {
    const { playGame, loadRoster } = require('../tools/selfplay');
    const r = playGame(11, { p1: 'normal', p2: 'normal' }, loadRoster(), 30, 'v5');
    assert.equal(r.state.rules, 'v5');
    assert.ok(r.winner || r.rounds > 30, `stalled in round ${r.rounds}`);
    assert.ok(r.routed.p1 + r.routed.p2 > 0, 'nothing routed');
});

test('V5 AI: plans a pivot-then-charge onto the one edge it may charge', () => {
    const AI = require('../ai');
    // e faces right; from below-left, the line from a's front to e's centre crosses e's bottom (left flank) edge.
    const s = battle([U('a', 'p1', 330, 420, { pace: 8, melee: 4 }), U('e', 'p2', 400, 260, { angle: 90, defence: 5 }), U('x', 'p2', 860, 40)]);
    const { actions } = AI.choose(E.observe(s, 'p1'), 'p1', { level: 'normal', random: () => 0.5 });
    let st = E.observe(s, 'p1');
    for (const a of actions) { if (a.type === 'endActivation' && !st.activation) continue; st = E.apply(st, a); if (!st.activation && a.type === 'strike') break; }
    assert.ok(actions.some(a => a.type === 'pivot') && actions.some(a => a.type === 'strike'), JSON.stringify(actions));
    assert.ok(st.log.some(l => /charges e’s/.test(l)), st.log.slice(0, 4).join(' / '));
});
