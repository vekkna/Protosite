// V4 rules: V3 without Reform, Rally, the 5-strain limit, hill slowing, bonus dice for 6s or the Pace asterisk;
// any touching enemy can be struck; a unit is Shaken (can't strike) while an unshaken enemy's front touches its flank.
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
    assert.equal(o.pivot.remaining, 0, 'Mobility 0 can never turn');
    assert.ok(!E.legalActions(s).some(a => a.type === 'rally' || a.reform));
});

test('V4: pivots are part of a Manoeuvre and may sweep through units (as V3)', () => {
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

test('V4: with no part behind the target’s front line, a unit can only charge its front', () => {
    // e faces right (front edge at x = 520). a starts wholly ahead of that line and would hit e's top flank.
    const target = U('e', 'p2', 470, 280, { angle: 90 });
    const ahead = U('a', 'p1', 530, 90, { angle: 205, pace: 8 });
    let s = run(battle([ahead, target]), activate('a'));
    assert.equal(E.chargeFrontOnly(s, s.units[0], s.units[1]), true);
    const lim = E.unitOptions(s, 'a').forward;
    assert.equal(lim.charge, null);
    assert.match(lim.reason, /can only charge its front/);
    assert.ok(E.unitOptions(run(battle([ahead, target], 'v3'), activate('a')), 'a').forward.charge, 'V3 has no such limit');
    // Starting with a corner behind the line, the flank charge is allowed.
    const behind = U('a', 'p1', 455, 190, { angle: 180, pace: 8 });
    s = run(battle([behind, target]), activate('a'));
    assert.equal(E.behindFrontLine(s.units[0], s.units[1]), true);
    assert.ok(E.unitOptions(s, 'a').forward.charge?.targets.includes('e'));
});
