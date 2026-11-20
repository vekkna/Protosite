const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine');

const { PX } = E;
const geo = E.geometry;

// ---------------------------------------------------------------- helpers
/** A 3" x 2" unit facing up unless overridden. */
const U = (id, owner, x, y, o = {}) => ({
    id, owner, x, y, w: 60, h: 40, angle: 0,
    pace: 6, mobility: 1, melee: 3, shoot: 0, range: 0, defence: 4, ...o
});
const unit = (s, id) => s.units.find(u => u.id === id);
const run = (s, ...actions) => { for (const a of actions) s = E.apply(s, a); return s; };
const opts = (s, id) => E.unitOptions(s, id);
const near = (a, b, tol = 0.06) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const clone = s => JSON.parse(JSON.stringify(s));
const mark = (s, id) => { s = clone(s); unit(s, id).activated = true; return s; };

/**
 * A prepared battle already in the command phase. Both players bid 1; the Master Tactician
 * and command counts are then overridden so tests do not depend on bidding.
 */
function battle(units, { terrain = [], master = 'p1', cmds = 5, seed = 1, firstPick = 'p1' } = {}) {
    units = [...units];
    if (!units.some(u => u.owner === 'p1')) units.push(U('fp1', 'p1', 880, 660));
    if (!units.some(u => u.owner === 'p2')) units.push(U('fp2', 'p2', 880, 20));
    let s = E.createGame({ units, terrain, seed, firstPick });
    s = run(s, { type: 'bid', player: 'p1', value: 1 }, { type: 'bid', player: 'p2', value: 1 });
    s = clone(s);
    s.master = master; s.commands = { p1: cmds, p2: cmds }; s.turnStep = 0;
    return s;
}
/** battle() with `id` already activated. */
const started = (units, id, o) => run(battle(units, o), { type: 'activate', unitId: id });

function checkAttackEvent(ev) {
    assert.equal(ev.bonus.length, ev.rolls.filter(n => n === 6).length, 'one bonus die per 6');
    assert.equal(ev.strain, [...ev.rolls, ...ev.bonus].filter(n => n >= ev.tn).length, 'strain = dice >= target number');
    for (const n of [...ev.rolls, ...ev.bonus]) assert.ok(Number.isInteger(n) && n >= 1 && n <= 6);
}
const fin = s => (s.activation ? E.apply(s, { type: 'endActivation' }) : s);
const lastAttack = s => s.events.find(e => e.type === 'attack');

// ---------------------------------------------------------------- parseStats
test('parseStats reads card-style stat rows', () => {
    const p = E.parseStats({ Speed: '7*', Drill: '4', Melee: '3', Ranged: '1*/4', Def: '4*' });
    assert.deepEqual(p, { pace: 7, paceStar: true, mobility: 4, melee: 3, meleeAP: false, shoot: 1, shootAP: true, range: 4, defence: 4, defenceStar: true });
});

// ---------------------------------------------------------------- 1. bidding
const threeEach = (firstPick = 'p1') => E.createGame({
    firstPick,
    units: [U('a1', 'p1', 100, 640), U('a2', 'p1', 300, 640), U('a3', 'p1', 500, 640),
            U('b1', 'p2', 100, 40), U('b2', 'p2', 300, 40), U('b3', 'p2', 500, 40)]
});
const bid = (s, p, v) => E.apply(s, { type: 'bid', player: p, value: v });

test('a prepared battle (all units owned) skips the draft and starts at bidding', () => {
    const s = threeEach();
    assert.equal(s.phase, 'bidding');
    assert.equal(s.round, 1);
    assert.deepEqual(s.starting, { p1: 3, p2: 3 });
});
test('bidding: the lower bid is Master Tactician and commands equal bids', () => {
    let s = bid(threeEach(), 'p1', 2);
    assert.equal(s.phase, 'bidding', 'waits for the other bid');
    s = bid(s, 'p2', 3);
    assert.equal(s.phase, 'command');
    assert.equal(s.master, 'p1');
    assert.deepEqual(s.commands, { p1: 2, p2: 3 });
    assert.equal(E.activePlayer(s), 'p1');
    const t = bid(bid(threeEach(), 'p1', 3), 'p2', 1);
    assert.equal(t.master, 'p2');
    assert.deepEqual(t.commands, { p1: 3, p2: 1 });
    assert.equal(E.activePlayer(t), 'p2');
});
test('bidding: bids must be whole numbers from 1 to the unit count, and only once', () => {
    const s = threeEach();
    for (const v of [0, -1, 4, 1.5, '2', null, NaN]) assert.throws(() => bid(s, 'p1', v), undefined, `bid ${v}`);
    assert.doesNotThrow(() => bid(s, 'p1', 1));
    assert.doesNotThrow(() => bid(s, 'p1', 3));
    assert.throws(() => bid(bid(s, 'p1', 1), 'p1', 2), /already/);
    assert.throws(() => E.apply(s, { type: 'activate', unitId: 'a1' }));
});
test('bidding: the maximum bid is the number of units still on the battlefield', () => {
    const s = E.createGame({ units: [U('a1', 'p1', 100, 640), U('b1', 'p2', 100, 40), U('b2', 'p2', 300, 40)] });
    assert.throws(() => bid(s, 'p1', 2));
    assert.doesNotThrow(() => bid(s, 'p2', 2));
});
test('round 1 tie goes to the player who picked second', () => {
    let s = bid(bid(threeEach('p1'), 'p1', 2), 'p2', 2);
    assert.equal(s.master, 'p2');
    s = bid(bid(threeEach('p2'), 'p1', 2), 'p2', 2);
    assert.equal(s.master, 'p1');
});
test('later ties keep the previous round Master Tactician', () => {
    // firstPick p2 => a round-1 tie would give p1; here p2 wins round 1 on bids, then ties.
    let s = bid(bid(threeEach('p2'), 'p1', 3), 'p2', 1);
    assert.equal(s.master, 'p2');
    s = run(s, { type: 'pass' }, { type: 'pass' }, { type: 'pass' });
    assert.equal(s.phase, 'bidding');
    assert.equal(s.round, 2);
    s = bid(bid(s, 'p1', 2), 'p2', 2);
    assert.equal(s.master, 'p2', 'tie keeps last round MT rather than other(firstPick)');
    // and the other way round
    s = bid(bid(threeEach('p1'), 'p1', 1), 'p2', 3);
    s = run(s, { type: 'pass' }, { type: 'pass' }, { type: 'pass' });
    s = bid(bid(s, 'p1', 3), 'p2', 3);
    assert.equal(s.master, 'p1');
});

// ---------------------------------------------------------------- 2. turn order
test('turn order: MT, then other player, then MT again, then clean up', () => {
    let s = bid(bid(threeEach(), 'p1', 2), 'p2', 3);
    assert.equal(E.activePlayer(s), 'p1');
    s = run(s, { type: 'activate', unitId: 'a1' }, { type: 'endActivation' });
    assert.equal(E.activePlayer(s), 'p1', 'MT may keep activating');
    s = run(s, { type: 'pass' });
    assert.equal(E.activePlayer(s), 'p2');
    s = run(s, { type: 'activate', unitId: 'b1' }, { type: 'endActivation' }, { type: 'pass' });
    assert.equal(E.activePlayer(s), 'p1');
    assert.equal(s.commands.p1, 1, 'unspent commands remain for the second MT turn');
    s = run(s, { type: 'activate', unitId: 'a2' }, { type: 'endActivation' });
    // p1 is out of commands, so the phase moves on by itself: clean up
    assert.equal(s.phase, 'bidding');
    assert.equal(s.round, 2);
    assert.ok(s.units.every(u => u.activated === false), 'markers removed');
    assert.deepEqual(s.commands, { p1: 0, p2: 0 });
    assert.deepEqual(s.bids, { p1: null, p2: null });
    assert.ok(s.events.some(e => e.type === 'cleanup'));
});
test('a player with no commands left is skipped automatically', () => {
    let s = bid(bid(threeEach(), 'p1', 1), 'p2', 2);          // p1 MT with a single command
    s = run(s, { type: 'activate', unitId: 'a1' }, { type: 'endActivation' });
    assert.equal(E.activePlayer(s), 'p2', 'p1 has no commands so its first turn ends');
    s = run(s, { type: 'pass' });
    assert.equal(s.phase, 'bidding', 'p1 second turn is skipped too; clean up follows');
    assert.equal(s.round, 2);
});
test('a player with no commands at the very start is skipped', () => {
    // can't bid 0, so spend p2's only command, then it must not be given another turn
    let s = bid(bid(threeEach(), 'p1', 2), 'p2', 3);
    s = run(s, { type: 'pass' });
    assert.equal(E.activePlayer(s), 'p2');
    s = clone(s); s.commands.p2 = 0;
    s = run(s, { type: 'pass' });
    assert.equal(E.activePlayer(s), 'p1');
});
test('a unit can only be activated once per round', () => {
    let s = battle([U('A', 'p1', 400, 400), U('A2', 'p1', 100, 400), U('B', 'p2', 400, 100)]);
    s = run(s, { type: 'activate', unitId: 'A' }, { type: 'endActivation' });
    assert.equal(E.activePlayer(s), 'p1');
    assert.throws(() => run(s, { type: 'activate', unitId: 'A' }), /already/);
    assert.equal(opts(s, 'A').canAct, false);
    assert.equal(s.commands.p1, 4);
});
test('cannot pass, or activate another unit, in the middle of an activation', () => {
    const s = started([U('A', 'p1', 400, 400), U('A2', 'p1', 100, 400), U('B', 'p2', 400, 100)], 'A');
    assert.throws(() => run(s, { type: 'pass' }), /activation/);
    assert.throws(() => run(s, { type: 'activate', unitId: 'A2' }));
    assert.doesNotThrow(() => run(s, { type: 'endActivation' }));
});
test('the wrong player cannot act, and cannot activate enemy units', () => {
    const s = battle([U('A', 'p1', 400, 400), U('B', 'p2', 400, 100)]);
    assert.throws(() => E.apply(s, { type: 'activate', player: 'p2', unitId: 'B' }), /turn/);
    assert.throws(() => E.apply(s, { type: 'pass', player: 'p2' }));
    assert.throws(() => E.apply(s, { type: 'activate', player: 'p1', unitId: 'B' }));
    assert.throws(() => E.apply(s, { type: 'move', inches: 1 }), /Activate/);
    assert.equal(opts(s, 'B').canAct, false);
    assert.doesNotThrow(() => E.apply(s, { type: 'activate', player: 'p1', unitId: 'A' }));
});
test('cannot activate with no commands left', () => {
    const s = battle([U('A', 'p1', 400, 400), U('A2', 'p1', 100, 400)], { cmds: 0 });
    // commands are 0 but the engine only skips on the next transition; activation must still be refused
    assert.throws(() => E.apply(s, { type: 'activate', unitId: 'A' }), /commands/);
});

// ---------------------------------------------------------------- 3. move
const open = () => [U('A', 'p1', 400, 400), U('B', 'p2', 400, 100)];

test('move: forward up to Pace, backward up to half Pace', () => {
    const s = started(open(), 'A');
    const o = opts(s, 'A');
    near(o.forward.max, 6);
    near(o.backward.max, 3);
    assert.throws(() => run(s, { type: 'move', inches: 6.5 }), /at most/);
    assert.throws(() => run(s, { type: 'move', inches: 3.5, backwards: true }), /at most/);
    assert.throws(() => run(s, { type: 'move', inches: 0 }));
    assert.throws(() => run(s, { type: 'move', inches: -2 }));
    const f = run(s, { type: 'move', inches: 6 });
    near(unit(f, 'A').y, 280, 0.01);
    near(unit(f, 'A').x, 400, 0.01);
    const b = run(s, { type: 'move', inches: 3, backwards: true });
    near(unit(b, 'A').y, 460, 0.01);
});
test('move follows the facing: a unit facing right moves along +x', () => {
    const s = run(started(open(), 'A'), { type: 'pivot', degrees: 90 }, { type: 'move', inches: 2 });
    assert.equal(unit(s, 'A').angle, 90);
    near(unit(s, 'A').x, 440, 0.01);
    near(unit(s, 'A').y, 400, 0.01);
});
test('move cannot switch between forwards and backwards', () => {
    const s = run(started(open(), 'A'), { type: 'move', inches: 2 });
    assert.equal(opts(s, 'A').backward.max, 0);
    assert.throws(() => run(s, { type: 'move', inches: 1, backwards: true }), /switch/);
    const t = run(started(open(), 'A'), { type: 'move', inches: 1, backwards: true });
    assert.equal(opts(t, 'A').forward.max, 0);
    assert.throws(() => run(t, { type: 'move', inches: 1 }), /switch/);
});
test('move: the total over several segments is limited to Pace (backward: half Pace)', () => {
    let s = started(open(), 'A');
    s = run(s, { type: 'move', inches: 2 }, { type: 'move', inches: 2 });
    near(opts(s, 'A').forward.max, 2);
    assert.throws(() => run(s, { type: 'move', inches: 2.5 }), /at most/);
    s = run(s, { type: 'move', inches: 2 });
    near(unit(s, 'A').y, 280, 0.01);
    assert.equal(opts(s, 'A').forward.max, 0);
    assert.throws(() => run(s, { type: 'move', inches: 0.5 }));
    let b = run(started(open(), 'A'), { type: 'move', inches: 1.5, backwards: true }, { type: 'move', inches: 1, backwards: true });
    near(opts(b, 'A').backward.max, 0.5);
    assert.throws(() => run(b, { type: 'move', inches: 1, backwards: true }));
});
test('move is blocked by a friendly unit', () => {
    const s = started([U('A', 'p1', 400, 400), U('F', 'p1', 400, 330), U('B', 'p2', 400, 100)], 'A');
    near(opts(s, 'A').forward.max, 1.5);           // F's bottom edge is 30px = 1.5" ahead
    assert.equal(opts(s, 'A').forward.charge, null);
    assert.equal(opts(s, 'A').forward.blocker.id, 'F');
    assert.throws(() => run(s, { type: 'move', inches: 2 }), /at most/);
    const t = run(s, { type: 'move', inches: 1.5 });
    assert.ok(geo.touching(unit(t, 'A'), unit(t, 'F')), 'may end touching a friend');
});
test('move is blocked by impassable terrain (swamp and mountain)', () => {
    for (const type of ['swamp', 'mountain']) {
        const s = started(open().concat([]), 'A', { terrain: [{ type, x: 380, y: 240, w: 80 }] });
        const o = opts(s, 'A');
        near(o.forward.max, 4, 0.1);                // circle bottom at y=320, unit top at y=400
        assert.equal(o.forward.stop, 'terrain');
        assert.equal(o.forward.blocker.type, type);
        assert.throws(() => run(s, { type: 'move', inches: 4.6 }), /at most/);
        const t = run(s, { type: 'move', inches: o.forward.max });
        assert.ok(geo.satGap(geo.rect(unit(t, 'A')), geo.disc(t.terrain[0])) >= -0.05, 'not overlapping terrain');
    }
});
test('move is blocked by the battlefield edge', () => {
    const top = started([U('A', 'p1', 400, 50), U('B', 'p2', 100, 300)], 'A');
    near(opts(top, 'A').forward.max, 2.5);
    assert.equal(opts(top, 'A').forward.stop, 'edge');
    const bottom = started([U('A', 'p1', 400, 680), U('B', 'p2', 100, 300)], 'A');
    assert.equal(opts(bottom, 'A').backward.max, 0);
    const side = started([U('A', 'p1', 10, 400, { angle: 270 }), U('B', 'p2', 500, 300)], 'A');
    // facing left, centre at x=40, half-length (along facing) is 20 once rotated: 30px of the box is x-extent... check by geometry
    const o = opts(side, 'A');
    const t = run(side, { type: 'move', inches: o.forward.max });
    assert.ok(Math.min(...geo.rect(unit(t, 'A')).map(p => p.x)) >= -0.01);
});
test('a move may not be started when the shortfall is zero', () => {
    const s = started([U('A', 'p1', 400, 0), U('B', 'p2', 100, 300)], 'A');
    assert.equal(opts(s, 'A').forward.max, 0);
    assert.throws(() => run(s, { type: 'move', inches: 1 }));
});

// ---------------------------------------------------------------- 4. charging
const chargeSetup = (extra = []) => [U('A', 'p1', 400, 400), U('B', 'p2', 400, 300, { angle: 180 }), ...extra];

test('charge: moving the full forward.max into an enemy is a charge with a free Strike', () => {
    const s = started(chargeSetup(), 'A');
    const o = opts(s, 'A');
    near(o.forward.max, 3);
    assert.deepEqual(o.forward.charge.targets, ['B']);
    const t = run(s, { type: 'move', inches: o.forward.max });
    assert.ok(t.events.some(e => e.type === 'charge' && e.targets.includes('B')));
    assert.ok(geo.touching(unit(t, 'A'), unit(t, 'B')), 'ends touching');
    assert.equal(t.activation.charged, true);
    assert.equal(opts(t, 'A').forward.max, 0, 'no more movement');
    assert.equal(opts(t, 'A').backward.max, 0);
    assert.equal(opts(t, 'A').pivot.remaining, 0, 'no pivoting after a charge');
    assert.throws(() => run(t, { type: 'pivot', degrees: 10 }));
    assert.throws(() => run(t, { type: 'move', inches: 1, backwards: true }));
    assert.deepEqual(opts(t, 'A').strike.map(x => x.id), ['B']);
    assert.equal(opts(t, 'A').freeStrike, true);
    const u = run(t, { type: 'strike', targetId: 'B' });
    checkAttackEvent(lastAttack(u));
    assert.equal(lastAttack(u).kind, 'strike');
    assert.throws(() => run(u, { type: 'strike', targetId: 'B' }), undefined, 'only one free Strike');
});
test('charge: a shorter move that stops short is not a charge, but can be continued as one', () => {
    let s = run(started(chargeSetup(), 'A'), { type: 'move', inches: 2 });
    assert.equal(s.activation.charged, false);
    assert.ok(!s.events.some(e => e.type === 'charge'));
    assert.ok(!geo.touching(unit(s, 'A'), unit(s, 'B')));
    const o = opts(s, 'A');
    near(o.forward.max, 1);
    assert.deepEqual(o.forward.charge.targets, ['B']);
    s = run(s, { type: 'move', inches: o.forward.max });
    assert.equal(s.activation.charged, true);
});
test('charge: pivoting before the Move still allows a charge', () => {
    const s = run(started(chargeSetup(), 'A'), { type: 'pivot', degrees: 1 });
    assert.ok(opts(s, 'A').forward.charge, 'pivot before the Move is fine');
});
test('charge: out of reach means no charge and a plain move', () => {
    const s = started([U('A', 'p1', 400, 400), U('B', 'p2', 400, 230, { angle: 180 })], 'A');   // 6.5" away
    const o = opts(s, 'A');
    assert.equal(o.forward.charge, null);
    near(o.forward.max, 6);
});
test('move, pivot, move cannot contact an enemy and stops short', () => {
    let s = run(started(chargeSetup(), 'A'), { type: 'move', inches: 1 }, { type: 'pivot', degrees: 1 });
    const o = opts(s, 'A');
    assert.equal(o.forward.charge, null);
    assert.ok(o.forward.max > 1.5 && o.forward.max < 2, `max ${o.forward.max}`);
    assert.throws(() => run(s, { type: 'move', inches: 2 }), /at most/);
    s = run(s, { type: 'move', inches: o.forward.max });
    assert.ok(!geo.touching(unit(s, 'A'), unit(s, 'B')), 'stopped short of the enemy');
    assert.ok(geo.satGap(geo.rect(unit(s, 'A')), geo.rect(unit(s, 'B'))) > 0);
    assert.ok(!s.events.some(e => e.type === 'charge'));
});
test('moving backwards never charges', () => {
    const s = started([U('A', 'p1', 400, 300), U('B', 'p2', 400, 360)], 'A');   // enemy 1" behind
    const o = opts(s, 'A');
    assert.equal(o.backward.charge, null);
    assert.ok(o.backward.max < 1, `max ${o.backward.max}`);
    const t = run(s, { type: 'move', inches: o.backward.max, backwards: true });
    assert.ok(!t.events.some(e => e.type === 'charge'));
    assert.ok(!geo.touching(unit(t, 'A'), unit(t, 'B')));
});
test('a unit touching an enemy cannot Move unless it is the Master Tactician', () => {
    const units = [U('A', 'p1', 400, 400), U('B', 'p2', 400, 360, { angle: 180 })];
    // p1 is NOT the MT
    let s = battle(units, { master: 'p2' });
    s = run(s, { type: 'pass', player: 'p2' }, { type: 'activate', player: 'p1', unitId: 'A' });
    assert.ok(opts(s, 'A').inContact);
    assert.equal(opts(s, 'A').forward.max, 0);
    assert.equal(opts(s, 'A').backward.max, 0);
    assert.throws(() => run(s, { type: 'move', inches: 1, backwards: true }));
    assert.deepEqual(opts(s, 'A').strike.map(t => t.id), ['B'], 'it can still strike');
    // p1 IS the MT
    const m = started(units, 'A');
    near(opts(m, 'A').backward.max, 3);
    assert.equal(opts(m, 'A').forward.max, 0, 'cannot push forwards through the enemy');
    assert.equal(opts(m, 'A').pivot.remaining, 0, 'still cannot pivot while touching');
    const t = run(m, { type: 'move', inches: 3, backwards: true });
    assert.ok(!geo.touching(unit(t, 'A'), unit(t, 'B')));
});

// ---------------------------------------------------------------- 5. pivot
test('pivot: Mobility pivots are free, a further one uses the action as an Extra Pivot', () => {
    let s = started([U('A', 'p1', 400, 400, { mobility: 2 }), U('B', 'p2', 100, 100)], 'A');
    assert.equal(opts(s, 'A').pivot.usesAction, false);
    s = run(s, { type: 'pivot', degrees: 10 }, { type: 'pivot', degrees: 10 });
    assert.equal(opts(s, 'A').pivot.usesAction, true, 'third pivot costs the action');
    assert.ok(opts(s, 'A').forward.max > 0, 'move still possible before the extra pivot');
    s = run(s, { type: 'pivot', degrees: 10 });
    assert.equal(unit(s, 'A').angle, 30);
    assert.equal(s.activation, null, 'nothing further is possible, so the activation ends');
    assert.throws(() => run(s, { type: 'move', inches: 1 }));
});
test('pivot: Extra Pivot uses the action so Move is no longer possible', () => {
    let s = started([U('A', 'p1', 400, 400, { mobility: 1 }), U('B', 'p2', 100, 100)], 'A');
    s = run(s, { type: 'pivot', degrees: 10 });
    assert.equal(opts(s, 'A').pivot.usesAction, true);
    s = run(s, { type: 'pivot', degrees: 10 });
    assert.equal(unit(s, 'A').angle, 20);
    assert.throws(() => run(s, { type: 'move', inches: 1 }));
    assert.throws(() => run(s, { type: 'pivot', degrees: 10 }));
});
test('pivot: after a Move there is no Extra Pivot, only the free pivots', () => {
    let s = run(started(open(), 'A'), { type: 'move', inches: 1 }, { type: 'pivot', degrees: 20 });
    assert.equal(unit(s, 'A').angle, 20);
    assert.equal(opts(s, 'A').pivot.remaining, 0);
    assert.throws(() => run(s, { type: 'pivot', degrees: 20 }), /pivot/i);
    // but it can carry on moving (in the same direction relative to its new facing)
    s = run(s, { type: 'move', inches: 2 });
    near(unit(s, 'A').x, 400 + Math.sin(20 * Math.PI / 180) * 2 * PX, 0.1);
});
test('pivot: a Mobility 0 unit can pivot once, only by spending its action', () => {
    let s = started([U('A', 'p1', 400, 400, { mobility: 0 }), U('B', 'p2', 100, 100)], 'A');
    assert.equal(opts(s, 'A').pivot.usesAction, true);
    assert.equal(opts(s, 'A').pivot.remaining, 1);
    s = run(s, { type: 'pivot', degrees: 45 });
    assert.equal(unit(s, 'A').angle, 45);
    assert.throws(() => run(s, { type: 'pivot', degrees: 10 }));
    assert.throws(() => run(s, { type: 'move', inches: 1 }));
    // having moved first, a Mobility 0 unit has no pivot left
    const m = run(started([U('A', 'p1', 400, 400, { mobility: 0 }), U('B', 'p2', 100, 100)], 'A'), { type: 'move', inches: 1 });
    assert.equal(opts(m, 'A').pivot.remaining, 0);
    assert.throws(() => run(m, { type: 'pivot', degrees: 10 }));
});
test('pivot: more than 90 degrees, zero, and non-numbers are rejected; 90 and negative work', () => {
    const s = started(open(), 'A');
    assert.throws(() => run(s, { type: 'pivot', degrees: 91 }), /90/);
    assert.throws(() => run(s, { type: 'pivot', degrees: -120 }), /90/);
    assert.throws(() => run(s, { type: 'pivot', degrees: 0 }));
    assert.throws(() => run(s, { type: 'pivot', degrees: 'x' }));
    assert.equal(unit(run(s, { type: 'pivot', degrees: 90 }), 'A').angle, 90);
    assert.equal(unit(run(s, { type: 'pivot', degrees: -90 }), 'A').angle, -90);
});
test('pivot: not allowed while touching an enemy', () => {
    const s = started([U('A', 'p1', 400, 400), U('B', 'p2', 400, 360, { angle: 180 })], 'A');
    assert.throws(() => run(s, { type: 'pivot', degrees: 10 }), /touching/);
});
test('pivot: blocked by a neighbour, the edge, or impassable terrain in the way', () => {
    // friendly unit 0.1px beside A: any turn would clip it
    let s = started([U('A', 'p1', 400, 400), U('F', 'p1', 460.1, 400), U('B', 'p2', 100, 100)], 'A');
    assert.equal(opts(s, 'A').pivot.left + opts(s, 'A').pivot.right, 0);
    assert.equal(opts(s, 'A').pivot.rightBlocker.id, 'F');
    assert.throws(() => run(s, { type: 'pivot', degrees: 10 }), /room/);
    // an enemy neighbour likewise
    s = started([U('A', 'p1', 400, 400), U('B', 'p2', 460.1, 400)], 'A');
    assert.equal(opts(s, 'A').pivot.rightBlocker.id, 'B', 'A cached pivot must resolve the blocker in the current position');
    assert.throws(() => run(s, { type: 'pivot', degrees: 10 }), /room/);
    // battlefield edge
    s = started([U('A', 'p1', 0, 400), U('B', 'p2', 100, 100)], 'A');
    assert.equal(opts(s, 'A').pivot.leftBlocker, 'edge');
    assert.throws(() => run(s, { type: 'pivot', degrees: 10 }), /room/);
    // swamp hugging the side
    s = started(open(), 'A', { terrain: [{ type: 'swamp', x: 460.1, y: 380, w: 60 }] });
    assert.equal(opts(s, 'A').pivot.left + opts(s, 'A').pivot.right, 0);
    // with some space the turn is limited but possible
    s = started([U('A', 'p1', 400, 400), U('F', 'p1', 463, 400), U('B', 'p2', 100, 100)], 'A');
    const p = opts(s, 'A').pivot;
    assert.ok(p.right > 0 && p.right < 90, `right ${p.right}`);
    assert.throws(() => run(s, { type: 'pivot', degrees: 90 }), /room/);
    assert.doesNotThrow(() => run(s, { type: 'pivot', degrees: p.right }));
});

// ---------------------------------------------------------------- 6. shoot
const shooter = (o = {}) => U('S', 'p1', 400, 400, { shoot: 3, range: 10, ...o });
const target = (o = {}) => U('T', 'p2', 400, 200, { angle: 180, ...o });
const shot = (s, from = 'S', to = 'T') => E.shotError(s, unit(s, from), unit(s, to));

test('shoot: needs a Shoot value, and a clear target in range', () => {
    let s = started([shooter(), target()], 'S');
    assert.equal(shot(s), '');
    assert.ok(opts(s, 'S').shoot.find(t => t.id === 'T').ok);
    s = run(s, { type: 'shoot', targetId: 'T' });
    const ev = lastAttack(s);
    assert.equal(ev.kind, 'shoot');
    checkAttackEvent(ev);
    // no shoot value
    const none = started([shooter({ shoot: 0 }), target()], 'S');
    assert.match(shot(none), /can’t shoot/);
    assert.throws(() => run(none, { type: 'shoot', targetId: 'T' }));
});
test('shoot: range runs from the centre of the front edge to the nearest point of the target', () => {
    // origin (430,400). target bottom edge at y=300 -> 100px = 5"
    const mk = range => started([shooter({ range }), target({ y: 260 })], 'S');
    assert.equal(shot(mk(5)), '');
    assert.equal(shot(mk(4.9)), 'Out of range.');
    // measured from the centre of the front edge, not the corner: sideways offset counts
    const side = started([shooter({ range: 5 }), U('T', 'p2', 470, 260, { angle: 180 })], 'S');   // nearest point (470,300): dx 40, dy 100
    assert.equal(shot(side), 'Out of range.');
    assert.equal(shot(started([shooter({ range: 5.4 }), U('T', 'p2', 470, 260, { angle: 180 })], 'S')), '');
});
test('shoot: the target must be entirely in front of the shooter', () => {
    // target straddles the shooter's front line (its lowest corners are behind y=400)
    assert.match(shot(started([shooter(), U('T', 'p2', 500, 380, { angle: 180 })], 'S')), /entirely in front/);
    // behind
    assert.match(shot(started([shooter(), U('T', 'p2', 400, 500, { angle: 180 })], 'S')), /entirely in front/);
    // flush with the front line is fine
    assert.equal(shot(started([shooter(), U('T', 'p2', 600, 360)], 'S')), '');
    // rotated shooter: facing right, target to the right
    assert.equal(shot(started([shooter({ angle: 90 }), U('T', 'p2', 600, 400)], 'S')), '');
    assert.match(shot(started([shooter({ angle: 90 }), U('T', 'p2', 200, 400)], 'S')), /entirely in front/);
});
test('shoot: an intervening unit (either side) blocks the line', () => {
    for (const owner of ['p1', 'p2']) {
        const s = started([shooter(), target(), U('X', owner, 400, 330)], 'S');
        assert.match(shot(s), /sight/i, `blocker owned by ${owner}`);
    }
    // a unit off to the side does not block
    assert.equal(shot(started([shooter(), target(), U('X', 'p1', 200, 330)], 'S')), '');
    // partial cover still blocks "the whole target must be visible"
    assert.match(shot(started([shooter(), target(), U('X', 'p1', 430, 330, { w: 20 })], 'S')), /sight/i);
});
test('shoot: forests and mountains block, even with nothing else around', () => {
    for (const type of ['forest', 'mountain']) {
        const s = started([shooter(), target()], 'S', { terrain: [{ type, x: 410, y: 300, w: 40 }] });
        assert.match(shot(s), /sight/i, type);
        assert.equal(E.shotCheck(s, unit(s, 'S'), unit(s, 'T')).blocker.type, type);
    }
    for (const type of ['swamp', 'field']) {
        const s = started([shooter(), target()], 'S', { terrain: [{ type, x: 410, y: 300, w: 40 }] });
        assert.equal(shot(s), '', `${type} does not block sight`);
    }
});
test('shoot: a hill blocks when both shooter and target are outside it', () => {
    const hill = { type: 'hills', x: 410, y: 300, w: 40 };
    assert.match(shot(started([shooter(), target()], 'S', { terrain: [hill] })), /sight/i);
    // target standing on the hill: no block
    assert.equal(shot(started([shooter(), target()], 'S', { terrain: [{ type: 'hills', x: 400, y: 190, w: 60 }] })), '');
    // shooter standing on the hill: no block
    assert.equal(shot(started([shooter(), target()], 'S', { terrain: [{ type: 'hills', x: 400, y: 390, w: 60 }] })), '');
});
test('shoot: a shooter on a hill sees over units but not over terrain', () => {
    const hill = { type: 'hills', x: 400, y: 390, w: 60 };
    const units = [shooter(), target(), U('X', 'p2', 400, 330)];
    assert.match(shot(started(units, 'S')), /sight/i, 'blocked on the flat');
    assert.equal(shot(started(units, 'S', { terrain: [hill] })), '', 'sees over the unit from the hill');
    const forest = { type: 'forest', x: 410, y: 300, w: 40 };
    assert.match(shot(started([shooter(), target()], 'S', { terrain: [hill, forest] })), /sight/i, 'still blocked by a forest');
    const hill2 = { type: 'hills', x: 410, y: 300, w: 40 };
    assert.match(shot(started([shooter(), target()], 'S', { terrain: [hill, hill2] })), /sight/i, 'still blocked by another hill');
});
test('shoot: not when the shooter touches an enemy, nor when the target touches a unit of the shooter side', () => {
    const touchy = started([shooter(), target(), U('E', 'p2', 400, 360, { angle: 180 })], 'S');
    assert.match(shot(touchy), /touching an enemy/);
    assert.equal(opts(touchy, 'S').shoot.length, 0);
    assert.throws(() => run(touchy, { type: 'shoot', targetId: 'T' }));
    const engaged = started([shooter(), target(), U('F', 'p1', 400, 240)], 'S');   // F touches T's bottom edge
    assert.match(shot(engaged), /contact/);
    assert.throws(() => run(engaged, { type: 'shoot', targetId: 'T' }), /contact/);
});
test('shoot uses the action: no second shoot, no move afterwards, none after a move', () => {
    let s = started([shooter({ mobility: 2 }), target()], 'S');
    s = run(s, { type: 'shoot', targetId: 'T' });
    assert.ok(s.activation === null || s.activation.action === 'shoot');
    assert.throws(() => run(s, { type: 'shoot', targetId: 'T' }));
    assert.throws(() => run(s, { type: 'move', inches: 1 }));
    const m = run(started([shooter({ mobility: 2 }), target()], 'S'), { type: 'move', inches: 1 });
    assert.throws(() => run(m, { type: 'shoot', targetId: 'T' }), /action/);
    // pivoting before the shot is fine
    const p = run(started([shooter({ mobility: 2 }), target()], 'S'), { type: 'pivot', degrees: 5 }, { type: 'shoot', targetId: 'T' });
    assert.equal(lastAttack(p).kind, 'shoot');
    assert.throws(() => run(started([shooter(), U('F', 'p1', 100, 100)], 'S'), { type: 'shoot', targetId: 'F' }), /enemy/);
});

// ---------------------------------------------------------------- 7. attack maths
// A (p1) strikes B (p2), front to front, B marked so that no "no marker" bonus is in play.
const duel = (a = {}, b = {}, extra = [], o = {}) => mark(battle([U('A', 'p1', 400, 400, a), U('B', 'p2', 400, 360, { angle: 180, ...b }), ...extra], o), 'B');
const prev = (s, kind = 'strike', from = 'A', to = 'B') => E.attackPreview(s, from, to, kind);
const modLabels = p => p.mods.map(m => m.label).sort();

test('attack: base pool is the Melee value and target number is Defence', () => {
    const p = prev(duel({ melee: 3 }, { defence: 4 }));
    assert.equal(p.pool, 3);
    assert.equal(p.base, 3);
    assert.equal(p.tn, 4);
    assert.deepEqual(p.mods, []);
    assert.equal(prev(duel({ melee: 5 }, { defence: 2 })).tn, 2);
});
test('attack: striking an unmarked target gets +1 die, shooting does not', () => {
    const s = battle([U('A', 'p1', 400, 400, { shoot: 3, range: 10 }), U('B', 'p2', 400, 200, { angle: 180 })]);
    assert.equal(prev(s, 'strike').pool, 4);
    assert.deepEqual(modLabels(prev(s, 'strike')), ['Target has no command marker']);
    assert.equal(prev(s, 'shoot').pool, 3);
    assert.equal(prev(mark(s, 'B'), 'strike').pool, 3);
});
test('attack: shooting uses Shoot, not Melee', () => {
    const s = mark(battle([U('A', 'p1', 400, 400, { shoot: 2, melee: 5, range: 10 }), U('B', 'p2', 400, 200, { angle: 180 })]), 'B');
    assert.equal(prev(s, 'shoot').pool, 2);
    assert.equal(prev(s, 'strike').pool, 5);
});
test('attack: target outflanked +1, attacker outflanked −1', () => {
    // A touches B's rear: B (facing up) is outflanked
    const behind = mark(battle([U('A', 'p1', 400, 400), U('B', 'p2', 400, 360)]), 'B');
    assert.deepEqual(modLabels(prev(behind)), ['Target outflanked']);
    assert.equal(prev(behind).pool, 4);
    // enemy C touches A's flank (and nothing else of ours): A is outflanked while striking B
    const flanked = mark(battle([U('A', 'p1', 400, 400), U('B', 'p2', 400, 360, { angle: 180 }), U('C', 'p2', 460, 410)]), 'B');
    assert.deepEqual(modLabels(prev(flanked)), ['Attacker outflanked']);
    assert.equal(prev(flanked).pool, 2);
});
test('attack: pool never drops below one die', () => {
    const s = duel({ melee: 1 }, { defence: 4 }, [U('C', 'p2', 460, 410)]);
    assert.equal(E.attackPreview(s, 'A', 'B', 'strike').pool, 1);
    const worse = mark(battle([U('A', 'p1', 400, 440, { melee: 1 }), U('B', 'p2', 400, 400, { angle: 180 }), U('C', 'p2', 460, 450),
        U('H', 'p2', 400, 340)]), 'B');
    assert.equal(prev(worse).pool, 1);
});
test('attack: higher +1, lower −1, both in or out of elevated terrain no change', () => {
    const hillUnderA = { type: 'hills', x: 410, y: 425, w: 40 };      // overlaps A (y 400-440) only
    const hillUnderB = { type: 'hills', x: 410, y: 335, w: 40 };      // overlaps B (y 360-400) only
    const hillBoth = { type: 'hills', x: 400, y: 370, w: 60 };
    assert.deepEqual(modLabels(prev(duel({}, {}, [], { terrain: [hillUnderA] }))), ['Attacker higher']);
    assert.equal(prev(duel({}, {}, [], { terrain: [hillUnderA] })).pool, 4);
    assert.deepEqual(modLabels(prev(duel({}, {}, [], { terrain: [hillUnderB] }))), ['Attacker lower']);
    assert.equal(prev(duel({}, {}, [], { terrain: [hillUnderB] })).pool, 2);
    assert.deepEqual(prev(duel({}, {}, [], { terrain: [hillBoth] })).mods, []);
    // non-elevated terrain does not make anyone higher
    assert.deepEqual(prev(duel({}, {}, [], { terrain: [{ type: 'forest', x: 410, y: 425, w: 40 }] })).mods, []);
});
test('attack: modifiers stack', () => {
    // target unmarked (+1), target outflanked (+1), attacker higher (+1)
    const s = battle([U('A', 'p1', 400, 400, { melee: 3 }), U('B', 'p2', 400, 360)], { terrain: [{ type: 'hills', x: 410, y: 425, w: 40 }] });
    assert.deepEqual(modLabels(prev(s)), ['Attacker higher', 'Target has no command marker', 'Target outflanked'].sort());
    assert.equal(prev(s).pool, 6);
});
test('attack: armour-piercing caps the target number at 3 (never raises it)', () => {
    assert.equal(prev(duel({ meleeAP: true }, { defence: 5 })).tn, 3);
    assert.equal(prev(duel({ meleeAP: true }, { defence: 6 })).tn, 3);
    assert.equal(prev(duel({ meleeAP: true }, { defence: 3 })).tn, 3);
    assert.equal(prev(duel({ meleeAP: true }, { defence: 2 })).tn, 2);
    assert.equal(prev(duel({ meleeAP: false }, { defence: 5 })).tn, 5);
    const sh = (shootAP, meleeAP, defence, defenceStar = false) => mark(battle([U('A', 'p1', 400, 400, { shoot: 2, range: 10, shootAP, meleeAP }),
        U('B', 'p2', 400, 200, { angle: 180, defence, defenceStar })]), 'B');
    assert.equal(prev(sh(true, false, 5), 'shoot').tn, 3);
    assert.equal(prev(sh(false, true, 5), 'shoot').tn, 5, 'Melee asterisk does not help shooting');
    assert.equal(prev(sh(false, true, 5), 'strike').tn, 3, 'Shoot asterisk does not help striking');
    assert.equal(prev(sh(true, false, 5), 'strike').tn, 5);
});
test('attack: shooting a Loose Formation (Defence*) unit is always 6, even with armour-piercing', () => {
    const sh = (shootAP, defence, defenceStar) => mark(battle([U('A', 'p1', 400, 400, { shoot: 2, range: 10, shootAP }),
        U('B', 'p2', 400, 200, { angle: 180, defence, defenceStar })]), 'B');
    assert.equal(prev(sh(false, 4, true), 'shoot').tn, 6);
    assert.equal(prev(sh(true, 4, true), 'shoot').tn, 6);
    assert.equal(prev(sh(true, 2, true), 'shoot').tn, 6);
    assert.equal(prev(sh(true, 4, false), 'shoot').tn, 3);
    // melee is unaffected by the asterisk
    assert.equal(prev(duel({}, { defence: 4, defenceStar: true })).tn, 4);
    assert.equal(prev(duel({ meleeAP: true }, { defence: 5, defenceStar: true })).tn, 3);
});
test('attack: expected strain and rout chance are sensible', () => {
    const p1 = prev(duel({ melee: 1 }, { defence: 6 }));                    // one die, needs a 6
    near(p1.expected, 7 / 36, 0.011);
    near(p1.routChance, 0, 0.001);
    const p2 = prev(duel({ melee: 4 }, { defence: 4 }));
    near(p2.expected, 4 * (3 / 6) * (7 / 6), 0.011);
    const easy = prev(duel({ melee: 1 }, { defence: 2 }));
    near(easy.expected, 35 / 36, 0.011);
    assert.ok(p2.expected > p1.expected);
    // rout chance: with 6 strain already, one strain routs it
    let s = clone(duel({ melee: 1 }, { defence: 2 })); unit(s, 'B').strain = 6;
    const r = prev(s);
    assert.equal(r.need, 1);
    near(r.routChance, 5 / 6, 0.011);
    s = clone(duel({ melee: 4 }, { defence: 4 }));
    assert.equal(prev(s).need, 7);
    assert.ok(prev(s).routChance >= 0 && prev(s).routChance < 0.01);
    // more dice -> higher expected, easier target -> higher expected
    assert.ok(prev(duel({ melee: 5 }, { defence: 4 })).expected > p2.expected);
    assert.ok(prev(duel({ melee: 4 }, { defence: 3 })).expected > p2.expected);
});
test('attack events: strain equals dice meeting the target number; one bonus die per 6', () => {
    let seen6 = false, count = 0;
    for (let seed = 1; seed <= 60; seed++) {
        let s = started([U('A', 'p1', 400, 400, { melee: 6 }), U('B', 'p2', 400, 360, { angle: 180, defence: 5 }), U('B2', 'p2', 700, 40), U('B3', 'p2', 800, 40)], 'A', { seed });
        const pre = prev(s);
        s = run(s, { type: 'strike', targetId: 'B' });
        const ev = lastAttack(s);
        checkAttackEvent(ev);
        assert.equal(ev.rolls.length, pre.pool);
        assert.equal(ev.tn, pre.tn);
        assert.equal(unit(s, 'B').strain, ev.strain);
        if (ev.bonus.length) seen6 = true;
        count++;
    }
    assert.ok(seen6, 'some seed rolled a 6');
    assert.equal(count, 60);
});
test('attack: dice are deterministic per seed', () => {
    const mk = seed => run(started([U('A', 'p1', 400, 400, { melee: 6 }), U('B', 'p2', 400, 360, { angle: 180 })], 'A', { seed }), { type: 'strike', targetId: 'B' });
    assert.deepEqual(lastAttack(mk(7)).rolls, lastAttack(mk(7)).rolls);
    assert.ok([1, 2, 3, 4, 5, 6].some(seed => JSON.stringify(lastAttack(mk(seed)).rolls) !== JSON.stringify(lastAttack(mk(7)).rolls)));
});

test('outflanking: a flank/rear contact outflanks, a front-only contact does not', () => {
    const rear = battle([U('A', 'p1', 400, 400), U('B', 'p2', 400, 360)]);
    assert.equal(E.outflanked(rear, unit(rear, 'B')), true);
    assert.equal(E.outflanked(rear, unit(rear, 'A')), false);
    const front = battle([U('A', 'p1', 400, 400), U('B', 'p2', 400, 360, { angle: 180 })]);
    assert.equal(E.outflanked(front, unit(front, 'A')), false);
    assert.equal(E.outflanked(front, unit(front, 'B')), false);
    const side = battle([U('A', 'p1', 400, 400), U('C', 'p2', 460, 410)]);
    assert.equal(E.outflanked(side, unit(side, 'A')), true);
    const sideL = battle([U('A', 'p1', 400, 400), U('C', 'p2', 340, 410)]);
    assert.equal(E.outflanked(sideL, unit(sideL, 'A')), true, 'left flank');
    const none = battle([U('A', 'p1', 400, 400), U('C', 'p2', 400, 100)]);
    assert.equal(E.outflanked(none, unit(none, 'A')), false);
});
test('outflanking: a flanker that touches another unit of the victim army does not count', () => {
    // D (p1) touches C's underside, so C is not "only" touching A
    const s = battle([U('A', 'p1', 400, 400), U('C', 'p2', 460, 410), U('D', 'p1', 460, 450)]);
    assert.equal(E.outflanked(s, unit(s, 'A')), false);
    // without D it does count
    const t = battle([U('A', 'p1', 400, 400), U('C', 'p2', 460, 410), U('D', 'p1', 700, 450)]);
    assert.equal(E.outflanked(t, unit(t, 'A')), true);
    // a second, free flanker still outflanks
    const u = battle([U('A', 'p1', 400, 400), U('C', 'p2', 460, 410), U('D', 'p1', 460, 450), U('C2', 'p2', 340, 410)]);
    assert.equal(E.outflanked(u, unit(u, 'A')), true);
});
test('outflanking: a charge that touches both front and flank still counts as touching the flank', () => {
    // C overlaps the front-right corner region and the right edge
    const s = battle([U('A', 'p1', 400, 400), U('C', 'p2', 460, 380)]);
    assert.equal(E.outflanked(s, unit(s, 'A')), true);
});
test('free Strike after a charge uses the height from before the move', () => {
    const hill = { type: 'hills', x: 415, y: 410, w: 30 };           // covers y 410-440: A starts on it, not after moving
    const units = [U('A', 'p1', 400, 400), U('B', 'p2', 400, 320, { angle: 180 })];
    let s = started(units, 'A', { terrain: [hill] });
    const o = opts(s, 'A');
    near(o.forward.max, 2);
    s = run(s, { type: 'move', inches: o.forward.max });
    assert.equal(s.activation.startHigh, true);
    const free = opts(s, 'A').strike[0].preview;
    assert.ok(free.mods.some(m => m.label === 'Attacker higher'), 'free strike counts the starting hill');
    assert.equal(E.attackPreview(s, 'A', 'B', 'strike').mods.some(m => m.label === 'Attacker higher'), false, 'plain preview uses the current position');
    const after = run(s, { type: 'strike', targetId: 'B' });
    assert.match(after.log[0], /attacker higher/);
    // and the reverse: starting low, ending on a hill, is still "not higher"
    const hill2 = { type: 'hills', x: 400, y: 340, w: 60 };          // covers y 340-400, A ends there
    let t = started([U('A', 'p1', 400, 440), U('B', 'p2', 400, 320, { angle: 180 })], 'A', { terrain: [hill2] });
    t = run(t, { type: 'move', inches: opts(t, 'A').forward.max });
    assert.equal(t.activation.startHigh, false);
    assert.ok(!opts(t, 'A').strike[0].preview.mods.some(m => m.label === 'Attacker higher'));
});

// ---------------------------------------------------------------- 8. strain, rout, victory
const touchingPair = (id, ox, defence = 2, strain = 6) => [U(`A${id}`, 'p1', ox, 400, { melee: 10 }), U(`B${id}`, 'p2', ox, 360, { angle: 180, defence, strain })];

test('7 strain routs and removes a unit; fewer does not', () => {
    for (let seed = 1; seed <= 30; seed++) {
        const base = started([...touchingPair(1, 100, 4, 4), U('X1', 'p2', 700, 40), U('X2', 'p2', 800, 40), U('X3', 'p2', 600, 40), U('X4', 'p2', 500, 40)], 'A1', { seed });
        const s = run(base, { type: 'strike', targetId: 'B1' });
        const ev = lastAttack(s);
        checkAttackEvent(ev);
        if (4 + ev.strain >= 7) {
            assert.equal(unit(s, 'B1'), undefined, `seed ${seed}: routed`);
            assert.ok(s.events.some(e => e.type === 'rout' && e.unitId === 'B1'));
            assert.equal(s.routed.p2, 1);
        } else {
            assert.equal(unit(s, 'B1').strain, 4 + ev.strain);
            assert.equal(s.routed.p2, 0);
        }
    }
    const one = run(started([...touchingPair(1, 100, 2, 6), U('X', 'p2', 700, 40), U('Y', 'p2', 800, 40)], 'A1'), { type: 'strike', targetId: 'B1' });
    assert.equal(unit(one, 'B1'), undefined, '6 strain + any hit = 7 routs');
    assert.equal(E.ROUT_STRAIN, 7);
});
test('victory: the game ends at once when ceil(half) of starting units have routed', () => {
    // p2 starts with 3, so the second rout (ceil(3/2) = 2) ends the battle
    const units = [...touchingPair(1, 100), ...touchingPair(2, 400), U('B3', 'p2', 800, 40)];
    let s = battle(units);
    assert.deepEqual(s.starting, { p1: 2, p2: 3 });
    s = fin(run(s, { type: 'activate', unitId: 'A1' }, { type: 'strike', targetId: 'B1' }));
    assert.equal(s.routed.p2, 1);
    assert.equal(s.winner, null);
    assert.equal(s.phase, 'command');
    s = run(s, { type: 'activate', unitId: 'A2' }, { type: 'strike', targetId: 'B2' });
    assert.equal(s.routed.p2, 2);
    assert.equal(s.winner, 'p1');
    assert.equal(s.phase, 'finished');
    assert.ok(s.events.some(e => e.type === 'victory' && e.winner === 'p1'));
    assert.throws(() => E.apply(s, { type: 'pass' }), /over/);
    assert.throws(() => E.apply(s, { type: 'bid', player: 'p1', value: 1 }));
    assert.deepEqual(E.legalActions(s), []);
});
test('victory thresholds: 1 of 1, 2 of 4 and 3 of 5 starting units', () => {
    // 1 of 1
    let s = run(battle(touchingPair(1, 100)), { type: 'activate', unitId: 'A1' }, { type: 'strike', targetId: 'B1' });
    assert.equal(s.winner, 'p1');
    // 2 of 4: the second rout wins
    s = battle([...touchingPair(1, 100), ...touchingPair(2, 400), U('B3', 'p2', 700, 40), U('B4', 'p2', 800, 40)]);
    s = fin(run(s, { type: 'activate', unitId: 'A1' }, { type: 'strike', targetId: 'B1' }));
    assert.equal(s.winner, null);
    s = run(s, { type: 'activate', unitId: 'A2' }, { type: 'strike', targetId: 'B2' });
    assert.equal(s.winner, 'p1');
    // 3 of 5: two routs are not enough
    s = battle([...touchingPair(1, 100), ...touchingPair(2, 400), U('B3', 'p2', 600, 40), U('B4', 'p2', 700, 40), U('B5', 'p2', 800, 40)]);
    s = run(fin(run(s, { type: 'activate', unitId: 'A1' }, { type: 'strike', targetId: 'B1' })), { type: 'activate', unitId: 'A2' }, { type: 'strike', targetId: 'B2' });
    assert.equal(s.routed.p2, 2);
    assert.equal(s.winner, null);
    assert.equal(s.phase, 'command');
});
test('victory: routs of the attacker side also count (defender wins the race)', () => {
    // routed counts are per owner; a p2 attack that routs a p1 unit gives p2 the win
    let s = battle([U('A', 'p1', 400, 400, { strain: 6, defence: 2 }), U('B', 'p2', 400, 360, { melee: 10, angle: 180 })], { master: 'p2' });
    s = run(s, { type: 'activate', unitId: 'B' }, { type: 'strike', targetId: 'A' });
    assert.equal(s.winner, 'p2');
    assert.equal(s.routed.p1, 1);
});

// ---------------------------------------------------------------- 9. rally
test('rally removes ceil(d6/2) strain, never below zero, and uses the action', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 40; seed++) {
        const s = run(started([U('A', 'p1', 400, 400, { strain: 4 }), U('B', 'p2', 100, 100)], 'A', { seed }), { type: 'rally' });
        const ev = s.events.find(e => e.type === 'rally');
        assert.ok(ev.die >= 1 && ev.die <= 6);
        assert.equal(ev.removed, Math.min(4, Math.ceil(ev.die / 2)));
        assert.equal(unit(s, 'A').strain, 4 - ev.removed);
        seen.add(ev.removed);
        const low = run(started([U('A', 'p1', 400, 400, { strain: 1 }), U('B', 'p2', 100, 100)], 'A', { seed }), { type: 'rally' });
        assert.equal(unit(low, 'A').strain, 0);
        assert.equal(low.events.find(e => e.type === 'rally').removed, 1);
    }
    assert.deepEqual([...seen].sort(), [1, 2, 3]);
});
test('rally: not at zero strain; uses the action (no Move/Shoot after, none after a Move)', () => {
    const calm = started([U('A', 'p1', 400, 400), U('B', 'p2', 100, 100)], 'A');
    assert.equal(opts(calm, 'A').canRally, false);
    assert.throws(() => run(calm, { type: 'rally' }), /no strain/);
    const s = run(started([U('A', 'p1', 400, 400, { strain: 5, mobility: 2 }), U('B', 'p2', 100, 100)], 'A'), { type: 'rally' });
    assert.throws(() => run(s, { type: 'move', inches: 1 }));
    assert.throws(() => run(s, { type: 'rally' }));
    assert.equal(opts(s, 'A').canRally, false);
    const moved = run(started([U('A', 'p1', 400, 400, { strain: 5 }), U('B', 'p2', 100, 100)], 'A'), { type: 'move', inches: 1 });
    assert.throws(() => run(moved, { type: 'rally' }), /action/);
    // pivot before rallying is fine
    assert.doesNotThrow(() => run(started([U('A', 'p1', 400, 400, { strain: 5 }), U('B', 'p2', 100, 100)], 'A'), { type: 'pivot', degrees: 10 }, { type: 'rally' }));
});

// ---------------------------------------------------------------- 10. slowing terrain
test('slowing: a unit that starts in a field or forest is limited to 4" for the Move', () => {
    for (const type of ['field', 'forest']) {
        const terrain = [{ type, x: 390, y: 260, w: 80 }];
        const s = started([U('A', 'p1', 400, 300, { pace: 10 }), U('B', 'p2', 100, 40)], 'A', { terrain });
        near(opts(s, 'A').forward.max, 4, 0.02);
        near(opts(s, 'A').backward.max, 4, 0.02);   // half pace 5 capped to 4
        assert.throws(() => run(s, { type: 'move', inches: 4.5 }));
        const t = run(s, { type: 'move', inches: 4 });
        assert.equal(opts(t, 'A').forward.max, 0, 'the 4" cap covers the whole Move');
    }
});
test('slowing: entering slowing terrain caps the whole Move at 4"', () => {
    const terrain = [{ type: 'field', x: 390, y: 260, w: 80 }];       // bottom at y=340, 3" ahead of A
    const s = started([U('A', 'p1', 400, 400, { pace: 8 }), U('B', 'p2', 100, 40)], 'A', { terrain });
    near(opts(s, 'A').forward.max, 4, 0.02);
    assert.equal(opts(s, 'A').forward.blocker.type, 'field');
    assert.throws(() => run(s, { type: 'move', inches: 5 }));
    // 1" first, then in: total still 4
    const t = run(s, { type: 'move', inches: 1 });
    near(opts(t, 'A').forward.max, 3, 0.02);
});
test('slowing: a unit that has already moved more than 4" cannot enter slowing terrain', () => {
    const terrain = [{ type: 'field', x: 390, y: 160, w: 80 }];       // bottom at y=240
    let s = started([U('A', 'p1', 400, 400, { pace: 10 }), U('B', 'p2', 100, 40)], 'A', { terrain });
    s = run(s, { type: 'move', inches: 5 });                         // y = 300; field edge 3" ahead
    const o = opts(s, 'A');
    assert.ok(o.forward.max < 3, `max ${o.forward.max}`);
    assert.ok(o.forward.max > 2.9);
    const t = run(s, { type: 'move', inches: o.forward.max });
    assert.ok(geo.satGap(geo.rect(unit(t, 'A')), geo.disc(t.terrain[0])) >= -0.02, 'stopped outside the field');
});
test('slowing: Pace-asterisk units ignore slowing terrain; other terrain does not slow', () => {
    const terrain = [{ type: 'field', x: 390, y: 260, w: 80 }];
    const star = started([U('A', 'p1', 400, 400, { pace: 8, paceStar: true }), U('B', 'p2', 100, 40)], 'A', { terrain });
    near(opts(star, 'A').forward.max, 8, 0.02);
    const inside = started([U('A', 'p1', 400, 300, { pace: 8, paceStar: true }), U('B', 'p2', 100, 40)], 'A', { terrain });
    near(opts(inside, 'A').forward.max, 8, 0.02);
    for (const type of ['hills', 'swamp'].slice(0, 1)) {
        const s = started([U('A', 'p1', 400, 400, { pace: 8 }), U('B', 'p2', 100, 40)], 'A', { terrain: [{ type, x: 390, y: 260, w: 80 }] });
        near(opts(s, 'A').forward.max, 8, 0.02);
    }
    // a charge into a unit sitting in a field is still limited for a non-star unit
    const field = [{ type: 'field', x: 390, y: 100, w: 80 }];
    const chargeIn = started([U('A', 'p1', 400, 400, { pace: 12 }), U('B', 'p2', 400, 200, { angle: 180 })], 'A', { terrain: field });
    assert.ok(opts(chargeIn, 'A').forward.max <= 12);
});

// ---------------------------------------------------------------- 11. draft
const pool = () => [U('u1', null, 100, 300), U('u2', null, 300, 300), U('u3', null, 500, 300), U('u4', null, 700, 300)];
const draftGame = (deck = ['hills', 'x', 'forest', 'swamp'], units = pool(), firstPick = 'p1') =>
    E.createGame({ units, terrainDeck: deck, firstPick, seed: 3 });
const centreOf = id => s => geo.centre(unit(s, id));

test('draft: starts in the draft phase with the first picker choosing', () => {
    const s = draftGame();
    assert.equal(s.phase, 'draft');
    assert.equal(s.draft.picker, 'p1');
    assert.equal(s.draft.step, 'pick');
    assert.equal(E.activePlayer(s), 'p1');
    assert.equal(draftGame(undefined, undefined, 'p2').draft.picker, 'p2');
    assert.throws(() => E.apply(s, { type: 'bid', player: 'p1', value: 1 }));
    assert.throws(() => E.apply(s, { type: 'deploy', x: 100, y: 640 }), /Choose a unit/);
    assert.throws(() => E.apply(s, { type: 'placeTerrain', x: 130, y: 320 }));
});
test('draft: pick, terrain, deploy alternate between players', () => {
    let s = draftGame();
    assert.throws(() => E.apply(s, { type: 'pick', player: 'p2', unitId: 'u1' }), /pick/);
    assert.throws(() => E.apply(s, { type: 'pick', player: 'p1', unitId: 'nope' }));
    s = E.apply(s, { type: 'pick', player: 'p1', unitId: 'u1' });
    assert.equal(s.draft.step, 'terrain');
    assert.equal(s.draft.picker, 'p1', 'same player finishes the pick');
    assert.throws(() => E.apply(s, { type: 'pick', unitId: 'u2' }), /Finish/);
    assert.throws(() => E.apply(s, { type: 'deploy', x: 100, y: 640 }), /terrain/);
    assert.throws(() => E.apply(s, { type: 'placeTerrain', player: 'p2', x: 130, y: 320 }));
    s = E.apply(s, { type: 'placeTerrain', player: 'p1', x: 130, y: 320 });
    assert.equal(s.draft.step, 'deploy');
    assert.equal(s.terrain.length, 1);
    assert.equal(s.terrain[0].type, 'hills');
    assert.equal(s.terrainDeck.length, 3);
    assert.ok(s.events.some(e => e.type === 'terrain'));
    assert.throws(() => E.apply(s, { type: 'deploy', player: 'p2', x: 100, y: 40 }));
    s = E.apply(s, { type: 'deploy', player: 'p1', x: 100, y: 640 });
    assert.equal(unit(s, 'u1').owner, 'p1');
    assert.equal(unit(s, 'u1').angle, 0, 'p1 faces up by default');
    assert.equal(s.draft.picker, 'p2');
    assert.equal(s.draft.step, 'pick');
    assert.equal(s.phase, 'draft');
});
test('draft: an open-ground card is discarded automatically', () => {
    let s = draftGame(['x', 'forest']);
    s = E.apply(s, { type: 'pick', unitId: 'u1' });
    assert.equal(s.draft.step, 'deploy', 'no terrain step');
    assert.equal(s.terrainDeck.length, 1);
    assert.equal(s.terrain.length, 0);
    assert.throws(() => E.apply(s, { type: 'placeTerrain', x: 130, y: 320 }));
    s = E.apply(s, { type: 'deploy', x: 100, y: 640 });
    // next card is placeable
    s = E.apply(s, { type: 'pick', unitId: 'u2' });
    assert.equal(s.draft.step, 'terrain');
    // an empty deck also goes straight to deploy
    const empty = E.apply(draftGame([]), { type: 'pick', unitId: 'u1' });
    assert.equal(empty.draft.step, 'deploy');
});
test('draft: terrain must overlap the picked unit', () => {
    const s = E.apply(draftGame(), { type: 'pick', unitId: 'u1' });
    assert.throws(() => E.apply(s, { type: 'placeTerrain', x: 600, y: 200 }), /overlap/);
    // just touching the unit's edge is not overlapping
    assert.throws(() => E.apply(s, { type: 'placeTerrain', x: 200, y: 320 }), /overlap/);
    assert.doesNotThrow(() => E.apply(s, { type: 'placeTerrain', x: 150, y: 320 }));
});
test('draft: terrain may not touch the edge, a deployment zone, or another tile', () => {
    const units = [U('u1', null, 100, 300), U('e', null, 0, 300), U('z', null, 100, 540), U('t', null, 130, 300), U('top', null, 300, 140)];
    // edge: tile (80 wide) centred 30 from the left edge
    let s = E.apply(draftGame(['hills', 'hills', 'hills', 'hills'], units), { type: 'pick', unitId: 'e' });
    assert.throws(() => E.apply(s, { type: 'placeTerrain', x: 30, y: 320 }), /edge/);
    assert.throws(() => E.apply(s, { type: 'placeTerrain', x: 40, y: 320 }), /edge/, 'exactly touching');
    assert.doesNotThrow(() => E.apply(s, { type: 'placeTerrain', x: 41, y: 320 }));
    // deployment zone (p1 zone starts at y=600; p2 zone ends at y=120)
    s = E.apply(draftGame(['hills'], units), { type: 'pick', unitId: 'z' });
    assert.throws(() => E.apply(s, { type: 'placeTerrain', x: 130, y: 570 }), /deployment/);
    assert.throws(() => E.apply(s, { type: 'placeTerrain', x: 130, y: 560 }), /deployment/, 'touching exactly');
    assert.doesNotThrow(() => E.apply(s, { type: 'placeTerrain', x: 130, y: 555 }));
    s = E.apply(draftGame(['hills'], units), { type: 'pick', unitId: 'top' });
    assert.throws(() => E.apply(s, { type: 'placeTerrain', x: 330, y: 160 }), /deployment/);
    assert.doesNotThrow(() => E.apply(s, { type: 'placeTerrain', x: 330, y: 170 }));
    // another tile
    s = E.apply(draftGame(['hills', 'forest'], units), { type: 'pick', unitId: 'u1' });
    s = E.apply(s, { type: 'placeTerrain', x: 130, y: 320 });
    s = E.apply(s, { type: 'deploy', x: 100, y: 640 });
    s = E.apply(s, { type: 'pick', unitId: 't' });
    assert.throws(() => E.apply(s, { type: 'placeTerrain', x: 200, y: 320 }), /another terrain/);
    assert.throws(() => E.apply(s, { type: 'placeTerrain', x: 210, y: 320 }), /another terrain/, 'tiles may not even touch');
    assert.doesNotThrow(() => E.apply(s, { type: 'placeTerrain', x: 213, y: 320 }));
    assert.ok(E.terrainSpots(s).length > 0);
});
test('draft: a tile that cannot legally be placed is discarded automatically', () => {
    // the unit sits in the middle of a region where every overlapping tile would touch another tile
    const units = [U('u1', null, 100, 300), U('u2', null, 130, 300)];
    let s = E.apply(draftGame(['hills', 'forest'], units), { type: 'pick', unitId: 'u1' });
    s = E.apply(s, { type: 'placeTerrain', x: 130, y: 320 });
    s = E.apply(s, { type: 'deploy', x: 100, y: 640 });
    // u2 is covered by the first hill; any further tile that overlaps u2 would touch the hill
    s = E.apply(s, { type: 'pick', unitId: 'u2' });
    if (E.terrainSpots(s).length === 0) assert.equal(s.draft.step, 'deploy', 'discarded when nowhere to go');
    else assert.equal(s.draft.step, 'terrain');
});
test('draft: deploy must be wholly inside the picker zone, without overlap', () => {
    let s = E.apply(draftGame(['x', 'x', 'x', 'x']), { type: 'pick', unitId: 'u1' });
    for (const [x, y] of [[100, 500], [100, 590], [100, 600.5 - 0.1 - 1], [-5, 640], [905, 640], [100, 690]])
        assert.throws(() => E.apply(s, { type: 'deploy', x, y }), /deployment zone/, `(${x},${y})`);
    assert.doesNotThrow(() => E.apply(s, { type: 'deploy', x: 100, y: 600 }));
    assert.doesNotThrow(() => E.apply(s, { type: 'deploy', x: 900, y: 680 }));
    // rotated unit uses its rotated outline: 60-long unit at 90° is 60 tall
    assert.throws(() => E.apply(s, { type: 'deploy', x: 100, y: 605, angle: 90 }), /deployment zone/);
    assert.doesNotThrow(() => E.apply(s, { type: 'deploy', x: 100, y: 620, angle: 90 }));
    assert.doesNotThrow(() => E.apply(s, { type: 'deploy', x: 100, y: 640, angle: 180 }));
    // p2 zone is the top strip
    s = E.apply(s, { type: 'deploy', x: 100, y: 640 });
    s = E.apply(s, { type: 'pick', unitId: 'u2' });
    assert.throws(() => E.apply(s, { type: 'deploy', x: 300, y: 640 }), /deployment zone/);
    assert.throws(() => E.apply(s, { type: 'deploy', x: 300, y: 90 }), /deployment zone/);
    const p2 = E.apply(s, { type: 'deploy', x: 300, y: 40 });
    assert.equal(unit(p2, 'u2').angle, 180, 'p2 faces down by default');
    assert.equal(unit(p2, 'u2').owner, 'p2');
});
test('draft: deployed units may not overlap, but may touch', () => {
    let s = E.apply(draftGame(['x', 'x', 'x', 'x'], [U('u1', null, 100, 300), U('u2', null, 300, 300), U('u3', null, 500, 300), U('u4', null, 700, 300)]), { type: 'pick', unitId: 'u1' });
    s = E.apply(s, { type: 'deploy', x: 100, y: 640 });
    s = E.apply(s, { type: 'pick', unitId: 'u2' });
    s = E.apply(s, { type: 'deploy', x: 100, y: 40 });
    s = E.apply(s, { type: 'pick', unitId: 'u3' });
    assert.throws(() => E.apply(s, { type: 'deploy', x: 130, y: 650 }), /overlap/);
    assert.throws(() => E.apply(s, { type: 'deploy', x: 100, y: 640 }), /overlap/);
    assert.doesNotThrow(() => E.apply(s, { type: 'deploy', x: 160, y: 640 }), 'touching edge to edge is allowed');
});
test('draft: a full draft ends in the bidding phase with starting counts', () => {
    let s = draftGame();
    const order = [];
    const spots = { u1: [100, 640], u2: [100, 40], u3: [300, 640], u4: [300, 40] };
    for (const id of ['u1', 'u2', 'u3', 'u4']) {
        order.push(s.draft.picker);
        s = E.apply(s, { type: 'pick', unitId: id });
        if (s.draft.step === 'terrain') {
            const c = centreOf(id)(s);
            s = E.apply(s, { type: 'placeTerrain', x: c.x, y: c.y });
        }
        assert.equal(s.draft.step, 'deploy');
        s = E.apply(s, { type: 'deploy', x: spots[id][0], y: spots[id][1] });
    }
    assert.deepEqual(order, ['p1', 'p2', 'p1', 'p2']);
    assert.equal(s.phase, 'bidding');
    assert.equal(s.draft, null);
    assert.equal(s.round, 1);
    assert.deepEqual(s.starting, { p1: 2, p2: 2 });
    assert.deepEqual(s.units.map(u => u.owner).sort(), ['p1', 'p1', 'p2', 'p2']);
    assert.equal(s.terrain.length, 3, 'hills, forest and swamp placed; the open-ground card was discarded');
    assert.deepEqual(s.terrain.map(t => t.type), ['hills', 'forest', 'swamp']);
    // bidding proceeds normally; firstPick p1 => p2 wins a round-1 tie
    s = run(s, { type: 'bid', player: 'p1', value: 2 }, { type: 'bid', player: 'p2', value: 2 });
    assert.equal(s.master, 'p2');
    // uneven: second player picks the extra unit if there are 3
    const three = draftGame(['x', 'x', 'x'], pool().slice(0, 3));
    let t = three;
    const where = [[100, 640], [100, 40], [300, 640]];
    ['u1', 'u2', 'u3'].forEach((id, i) => { t = E.apply(t, { type: 'pick', unitId: id }); t = E.apply(t, { type: 'deploy', x: where[i][0], y: where[i][1] }); });
    assert.equal(t.phase, 'bidding');
    assert.deepEqual(t.starting, { p1: 2, p2: 1 });
});

// ---------------------------------------------------------------- 12. purity and legalActions
const samples = () => {
    const out = [];
    out.push(draftGame());
    const pick = E.apply(draftGame(), { type: 'pick', unitId: 'u1' });
    out.push(pick);
    out.push(E.apply(pick, { type: 'placeTerrain', x: 130, y: 320 }));
    out.push(threeEach());
    out.push(bid(threeEach(), 'p1', 2));
    out.push(bid(bid(threeEach(), 'p1', 2), 'p2', 3));
    out.push(battle(open()));
    out.push(started(open(), 'A'));
    out.push(started([U('A', 'p1', 400, 400, { mobility: 2 }), U('B', 'p2', 400, 300, { angle: 180 }), U('F', 'p1', 520, 400)], 'A'));
    { const c = started(chargeSetup(), 'A'); out.push(run(c, { type: 'move', inches: opts(c, 'A').forward.max })); }
    out.push(started([shooter({ mobility: 2, strain: 2 }), target(), U('X', 'p1', 100, 300)], 'S'));
    out.push(started([U('A', 'p1', 400, 400, { melee: 4 }), U('B', 'p2', 400, 360, { angle: 180 })], 'A'));
    out.push(started([U('A', 'p1', 400, 400, { pace: 10, strain: 3 }), U('B', 'p2', 100, 40)], 'A', { terrain: [{ type: 'field', x: 390, y: 260, w: 80 }, { type: 'swamp', x: 600, y: 300, w: 80 }] }));
    out.push(started([U('A', 'p1', 0, 400, { mobility: 0 }), U('B', 'p2', 400, 100)], 'A'));
    return out;
};
test('apply never mutates its input state (legal or illegal actions)', () => {
    for (const s of samples()) {
        const before = JSON.stringify(s);
        for (const a of E.legalActions(s)) {
            E.apply(s, a);
            assert.equal(JSON.stringify(s), before, `after ${JSON.stringify(a)}`);
        }
        assert.throws(() => E.apply(s, { type: 'nonsense' }));
        assert.equal(JSON.stringify(s), before);
        const next = E.apply(s, E.legalActions(s)[0]);
        assert.notEqual(next, s);
        assert.notStrictEqual(next.units, s.units);
    }
});
test('apply output events describe only the last action', () => {
    let s = started(chargeSetup(), 'A');
    assert.deepEqual(s.events.map(e => e.type), ['activate']);
    s = run(s, { type: 'move', inches: opts(s, 'A').forward.max });
    assert.deepEqual(s.events.map(e => e.type), ['move', 'charge']);
    s = run(s, { type: 'strike', targetId: 'B' });
    assert.ok(s.events.every(e => e.type !== 'move'));
    const seqs = s.events.map(e => e.seq);
    assert.deepEqual([...seqs].sort((a, b) => a - b), seqs);
});
test('legalActions only returns actions that apply accepts', () => {
    let n = 0;
    for (const s of samples()) {
        const actions = E.legalActions(s);
        assert.ok(actions.length > 0, `some legal action in phase ${s.phase}`);
        for (const a of actions) {
            assert.doesNotThrow(() => E.apply(s, a), `${s.phase}: ${JSON.stringify(a)}`);
            n++;
        }
    }
    assert.ok(n > 50);
});
test('legalActions over a random playout stays legal and the game progresses', () => {
    let s = battle([U('A1', 'p1', 300, 500, { shoot: 2, range: 8, mobility: 2 }), U('A2', 'p1', 500, 500, { mobility: 2 }), U('B1', 'p2', 300, 200, { angle: 180, shoot: 2, range: 8, mobility: 2 }), U('B2', 'p2', 500, 200, { angle: 180, mobility: 2 })], { cmds: 0 });
    // restart from bidding for a real flow
    s = E.createGame({ units: s.units.map(u => ({ ...u, activated: false })), seed: 11 });
    let rng = 12345; const rand = n => { rng = (Math.imul(rng, 1103515245) + 12345) >>> 0; return rng % n; };
    for (let i = 0; i < 300 && s.phase !== 'finished'; i++) {
        const actions = E.legalActions(s);
        assert.ok(actions.length > 0);
        const a = actions[rand(actions.length)];
        const before = JSON.stringify(s);
        s = E.apply(s, a);
        assert.ok(JSON.stringify(before) !== undefined);
        for (const u of s.units) {
            const r = geo.rect(u);
            assert.ok(r.every(p => p.x >= -0.1 && p.x <= 960.1 && p.y >= -0.1 && p.y <= 720.1), `${u.id} stays on the board`);
        }
        for (const u of s.units) for (const v of s.units) if (u.id < v.id) assert.ok(geo.satGap(geo.rect(u), geo.rect(v)) >= -0.05, `${u.id} and ${v.id} do not overlap`);
    }
    assert.ok(s.round >= 1);
});

test('auto-draft deploys every unit with room to pivot clear of friends and the side edges', () => {
    // Twelve undrafted units, laid out in the pool so the nearest-spot rule alone would pack them flush.
    const units = Array.from({ length: 12 }, (_, i) => U('a' + i, undefined, 100 + (i % 3) * 10, 300 + Math.floor(i / 3) * 10,
        i % 3 ? {} : { w: 40, h: 60 }));
    let s = E.createGame({ units, terrainDeck: [], seed: 3, firstPick: 'p1' });
    s = E.apply(s, { type: 'autoDraft' });
    for (const u of s.units) {
        const lim = E.pivotLimit(s, u, { unitId: u.id, action: null, pivots: 0, moved: 0, dir: null, pivotedInMove: false });
        assert.ok(Math.min(Math.abs(lim.left), Math.abs(lim.right)) >= 45, `${u.id} at x=${u.x} can only pivot ${lim.left}/${lim.right}`);
    }
});
