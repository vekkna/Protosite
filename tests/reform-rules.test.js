// The 'reform' rules variant: no Rally, Reform action (face any direction), pivots only as part of a Move,
// and a charge is allowed only if every pivot came before the unit started moving.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine');

const U = (id, owner, x, y, o = {}) => ({ id, owner, x, y, w: 60, h: 40, angle: 0, pace: 6, mobility: 1, melee: 3, shoot: 0, range: 0, defence: 4, ...o });
const unit = (s, id) => s.units.find(u => u.id === id);
const run = (s, ...actions) => { for (const a of actions) s = E.apply(s, a); return s; };
function battle(units, rules = 'reform', terrain = []) {
    let s = E.createGame({ units, seed: 1, rules, terrain });
    s = run(s, { type: 'bid', player: 'p1', value: 1 }, { type: 'bid', player: 'p2', value: 1 });
    s = JSON.parse(JSON.stringify(s)); s.master = 'p1'; s.commands = { p1: 5, p2: 5 }; s.turnStep = 0;
    return s;
}
const far = [U('e', 'p2', 800, 40)];

test('reform rules: no rally', () => {
    let s = battle([U('a', 'p1', 400, 400, { strain: 3 }), ...far]);
    s = run(s, { type: 'activate', unitId: 'a' });
    assert.equal(E.unitOptions(s, 'a').canRally, false);
    assert.throws(() => E.apply(s, { type: 'rally' }), /no Rally/);
    assert.equal(E.unitOptions(run(battle([U('a', 'p1', 400, 400, { strain: 3 }), ...far], 'classic'), { type: 'activate', unitId: 'a' }), 'a').canRally, true);
});

test('reform rules: Reform turns any amount, even with Mobility 0, and is the action', () => {
    let s = run(battle([U('a', 'p1', 400, 400, { mobility: 0 }), ...far]), { type: 'activate', unitId: 'a' });
    assert.equal(E.unitOptions(s, 'a').pivot.remaining, 0);
    assert.equal(E.unitOptions(s, 'a').reform.right, 180);
    s = E.apply(s, { type: 'pivot', degrees: 180, reform: true });
    assert.equal(unit(s, 'a').angle, 180);
    assert.equal(s.activation, null, 'nothing else left to do, so the activation ends');
});

test('reform rules: a pivot commits the action to Move, so the unit cannot shoot after it', () => {
    let s = run(battle([U('a', 'p1', 400, 400, { shoot: 3, range: 24 }), U('e', 'p2', 400, 200)]), { type: 'activate', unitId: 'a' });
    assert.ok(E.unitOptions(s, 'a').shoot.some(t => t.ok));
    s = E.apply(s, { type: 'pivot', degrees: 10 });
    assert.equal(s.activation.action, 'move');
    assert.ok(!E.unitOptions(s, 'a').shoot.some(t => t.ok));
});

test('reform rules: no pivot after shooting', () => {
    let s = run(battle([U('a', 'p1', 400, 400, { shoot: 3, range: 24, mobility: 2 }), U('e', 'p2', 400, 200)]),
        { type: 'activate', unitId: 'a' });
    s = E.apply(s, { type: 'shoot', targetId: 'e' });
    assert.equal(s.activation, null, 'a shooter has nothing left to do once it has fired');
});

test('reform rules: pivot at the start keeps the charge, pivot mid-move loses it', () => {
    // Enemy straight ahead after a 90-degree turn to the right.
    const units = () => [U('a', 'p1', 400, 400, { mobility: 2, pace: 10 }), U('e', 'p2', 600, 400)];
    let s = run(battle(units()), { type: 'activate', unitId: 'a' }, { type: 'pivot', degrees: 90 });
    assert.ok(E.unitOptions(s, 'a').forward.charge, 'pivot before moving: can still charge');
    s = run(battle(units()), { type: 'activate', unitId: 'a' }, { type: 'pivot', degrees: 45 }, { type: 'move', inches: 0.5 }, { type: 'pivot', degrees: 45 });
    assert.equal(E.unitOptions(s, 'a').forward.charge, null, 'pivot after moving: no charge');
});

test('reform rules: the AI finds a charge that needs a pivot first', () => {
    const AI = require('../ai');
    const s = run(battle([U('a', 'p1', 400, 400, { mobility: 1, pace: 10, melee: 6 }), U('e', 'p2', 600, 400)]), { type: 'activate', unitId: 'a' });
    const before = battle([U('a', 'p1', 400, 400, { mobility: 1, pace: 10, melee: 6 }), U('e', 'p2', 600, 400)]);
    const plans = AI.plansFor(E.observe(before, 'p1'), unit(before, 'a'), 'p1');
    assert.ok(plans.some(p => p.name === 'charge' && p.actions.some(a => a.type === 'pivot')), 'pivot-then-charge plan generated');
    assert.ok(s);
});

test('pivoting into slowing terrain during a Move counts as entering it', () => {
    for (const rules of ['classic', 'reform']) {
        // A field just to the right of the unit's path: moving straight up misses it, turning right sweeps into it.
        const terrain = [{ type: 'field', x: 450, y: 200, w: 80 }];
        let s = E.createGame({ units: [U('a', 'p1', 400, 400, { pace: 10, mobility: 2, w: 40, h: 80 }), U('e', 'p2', 800, 40)], terrain, seed: 1, rules });
        s = run(s, { type: 'bid', player: 'p1', value: 1 }, { type: 'bid', player: 'p2', value: 1 });
        s = JSON.parse(JSON.stringify(s)); s.master = 'p1'; s.commands = { p1: 5, p2: 5 }; s.turnStep = 0;
        s = run(s, { type: 'activate', unitId: 'a' }, { type: 'move', inches: 10 });
        assert.ok(!E.inTrait(s, unit(s, 'a'), 'slowing'), `${rules}: path misses the field`);
        assert.ok(E.unitOptions(s, 'a').pivot.right < 90, rules + ': turn stops short of the field');
        assert.throws(() => E.apply(s, { type: 'pivot', degrees: 90 }), /room to turn/, rules);
    }
});

const variant = 'reform-variant';
const activate = { type: 'activate', unitId: 'a' };
const move = (inches, backwards = false) => ({ type: 'move', inches, backwards });

test('Reform Variant retains Reform and forfeits the charge after any pivot', () => {
    const units = [U('a', 'p1', 400, 400, { mobility: 2, strain: 3 }), U('e', 'p2', 400, 280)];
    const initial = run(battle(units, variant), activate);
    const options = E.unitOptions(initial, 'a');
    assert.equal(initial.rules, variant);
    assert.ok(options.reform.right >= 90);
    assert.equal(options.canRally, false);
    assert.equal(run(initial, { type: 'pivot', degrees: 90, reform: true }).units[0].angle, 90);

    const charged = run(initial, move(options.forward.max));
    assert.equal(charged.activation.freeStrike, true);
    assert.throws(() => run(charged, { type: 'pivot', degrees: 15 }), /charged can’t pivot/);

    for (const steps of [[], [move(0.5)]]) {
        const pivoted = run(initial, ...steps, { type: 'pivot', degrees: 15 }, { type: 'pivot', degrees: -15 });
        assert.equal(pivoted.activation.action, 'move');
        assert.equal(pivoted.units[0].angle, 0);
        const limit = E.unitOptions(pivoted, 'a').forward;
        assert.equal(limit.charge, null);
        assert.match(limit.reason, /pivots can’t charge/);
        assert.throws(() => run(pivoted, move(options.forward.max)), /move at most/);
        const advanced = run(pivoted, move(limit.max));
        assert.equal(E.geometry.touching(unit(advanced, 'a'), unit(advanced, 'e')), false);
    }
});

test('only the variant lets starred units cross friendly units and slowing terrain in one move', () => {
    const units = [U('a', 'p1', 400, 400, { stats: { Move: '6*' } }), U('f', 'p1', 400, 340), U('e', 'p2', 400, 240)];
    delete units[0].pace;
    const terrain = [{ type: 'field', x: 390, y: 330, w: 80 }];
    const started = run(battle(units, variant, terrain), activate);
    const limit = E.unitOptions(started, 'a').forward;
    assert.deepEqual(limit.charge.targets, ['e']);
    assert.equal(limit.max, 6);
    assert.throws(() => run(started, move(3)), /finish its move clear/);
    for (const action of E.legalActions(started).filter(a => a.type === 'move')) E.apply(started, action);
    const charged = run(started, move(limit.max));
    assert.equal(charged.activation.freeStrike, true);
    assert.equal(charged.activation.slowed, false);
    for (const rules of ['classic', 'reform']) {
        assert.equal(E.unitOptions(run(battle(units, rules, terrain), activate), 'a').forward.max, 1);
    }

    units[0].stats = { Move: '6' };
    assert.equal(E.unitOptions(run(battle(units, variant, terrain), activate), 'a').forward.max, 1);
});

test('Reform Variant requires full clearance within pace and before charging', () => {
    const units = [U('a', 'p1', 400, 400, { paceStar: true }), U('f', 'p1', 400, 340), U('g', 'p1', 400, 285), ...far];
    const started = run(battle(units, variant), activate);
    assert.equal(E.unitOptions(started, 'a').forward.max, 1, 'the unit cannot fit between allies or clear both');

    units[0].pace = 8;
    let state = run(battle(units, variant), activate);
    assert.throws(() => run(state, move(5)), /finish its move clear/);
    state = run(state, move(7.75));
    assert.equal(unit(state, 'a').y, 245, 'the unit can finish as soon as it clears the second ally');

    const shortCharge = run(battle([units[0], units[1], U('e', 'p2', 400, 280)], variant), activate);
    assert.equal(E.unitOptions(shortCharge, 'a').forward.charge, null);
    assert.equal(E.unitOptions(shortCharge, 'a').forward.max, 1);

    const withdrawal = run(battle([U('a', 'p1', 400, 300, { pace: 10, paceStar: true }), U('f', 'p1', 400, 360), ...far], variant), activate);
    assert.throws(() => run(withdrawal, move(4, true)), /finish its move clear/);
    assert.equal(unit(run(withdrawal, move(5, true)), 'a').y, 400);
});

test('Reform Variant charge previews and AI plans use the straight, clear route', () => {
    const AI = require('../ai'), UX = require('../battle-ux');
    const friendly = U('f', 'p1', 400, 340);
    const actor = U('a', 'p1', 400, 400, { pace: 8, paceStar: true });
    const inline = battle([actor, friendly, U('e', 'p2', 400, 240)], variant);
    assert.deepEqual(UX.movementPreview(inline, 'a').charges.map(c => c.degrees), [0]);
    assert.ok(AI.plansFor(E.observe(inline, 'p1'), unit(inline, 'a'), 'p1').some(p => p.name === 'charge'));

    const offAxis = battle([actor, U('e', 'p2', 510, 320)], variant);
    assert.equal(UX.movementPreview(offAxis, 'a').charges.length, 0);
    const plans = AI.plansFor(E.observe(offAxis, 'p1'), unit(offAxis, 'a'), 'p1');
    assert.ok(plans.some(p => p.name === 'advance' && p.actions.some(a => a.type === 'pivot')));
    assert.ok(plans.every(p => p.name !== 'charge'));
});

// V3: Reform, plus pivots that pass through obstacles (but can't end on one).
// Unlike the Reform Variant, starred units can't move through friends.
const v3rules = 'v3';

test('V3: the Master Tactician can begin a Move by pivoting out of enemy contact', () => {
    const units = [U('a', 'p1', 400, 400), U('e', 'p2', 460, 400)];
    const initial = battle(units, v3rules);
    const s = run(initial, activate);
    assert.equal(E.unitOptions(s, 'a').inContact, true);
    assert.throws(() => run(s, { type: 'pivot', degrees: 30 }), /overlapping/);
    assert.throws(() => run(s, { type: 'pivot', degrees: 90, reform: true }), /touching/);
    const clear = run(s, { type: 'pivot', degrees: 90 });
    assert.equal(clear.activation.action, 'move');
    assert.equal(E.unitOptions(clear, 'a').inContact, false);
    assert.ok(E.unitOptions(clear, 'a').forward.max > 0);

    const nonMaster = battle(units, v3rules);
    nonMaster.master = 'p2';
    nonMaster.turnStep = 1;
    assert.throws(() => run(nonMaster, activate, { type: 'pivot', degrees: 90 }), /touching/);
    assert.throws(() => run(battle(units), activate, { type: 'pivot', degrees: 90 }), /touching/);

    const AI = require('../ai');
    const plans = AI.plansFor(E.observe(initial, 'p1'), unit(initial, 'a'), 'p1');
    assert.ok(plans.some(plan => plan.name === 'advance' && plan.actions.some(action => action.type === 'pivot')));
});

test('V3: a pivot can turn through a neighbouring unit but not finish overlapping it', () => {
    // A long card with a friend just off its right-front corner: a clockwise turn sweeps through the friend.
    const units = (mobility = 1) => [U('a', 'p1', 400, 400, { w: 120, h: 20, mobility }), U('f', 'p1', 500, 440, { w: 30, h: 30 }), ...far];
    const reformed = run(battle(units(), 'reform'), activate);
    assert.ok(E.unitOptions(reformed, 'a').pivot.right < 90, 'Reform stops the turn at the friend');
    assert.throws(() => run(reformed, { type: 'pivot', degrees: 90 }), /room to turn/);

    // Mobility 1: the single pivot is the whole run, so it must end clear.
    const s = run(battle(units(), v3rules), activate);
    const lim = E.unitOptions(s, 'a').pivot;
    assert.equal(lim.right, 90, 'V3 can turn all the way');
    assert.equal(lim.chain, false);
    const span = lim.blocked.right[0];
    assert.equal(span.blocker.id, 'f');
    const inside = Math.round((span.from + span.to) / 2);
    assert.throws(() => run(s, { type: 'pivot', degrees: inside }), /can’t finish its pivots overlapping/);
    assert.equal(E.pivotAllowed(lim, inside), false);
    assert.ok(!E.pivotOverlap(lim, E.nearestPivot(lim, inside)));
    assert.equal(unit(run(s, { type: 'pivot', degrees: 90 }), 'a').angle, 90);
    for (const a of E.legalActions(s).filter(a => a.type === 'pivot')) E.apply(s, a);

    // Mobility 2: a pivot may end overlapping if another pivot follows, and only the last facing must be clear.
    const two = run(battle(units(2), v3rules), activate);
    assert.equal(E.unitOptions(two, 'a').pivot.chain, true);
    const mid = run(two, { type: 'pivot', degrees: inside });
    assert.equal(mid.activation.overlap, true);
    assert.equal(E.unitOptions(mid, 'a').forward.max, 0, 'no moving while overlapping');
    assert.throws(() => run(mid, { type: 'endActivation' }), /Keep pivoting/);
    assert.ok(!E.legalActions(mid).some(a => a.type === 'endActivation'));
    assert.throws(() => run(mid, { type: 'pivot', degrees: 1 }), /can’t finish its pivots overlapping/, 'the last pivot must end clear');
    for (const a of E.legalActions(mid).filter(a => a.type === 'pivot')) assert.equal(E.apply(mid, a).activation?.overlap ?? false, false);
    const done = run(mid, { type: 'pivot', degrees: 90 - inside });
    assert.equal(unit(done, 'a').angle, 90);
    assert.ok(E.unitOptions(done, 'a').forward.max > 0);
});

test('V3: a run of pivots can pass through an enemy', () => {
    const units = [U('a', 'p1', 400, 400, { w: 120, h: 20, mobility: 2 }), U('e', 'p2', 500, 440, { w: 30, h: 30 })];
    const s = run(battle(units, v3rules), activate);
    const span = E.unitOptions(s, 'a').pivot.blocked.right[0];
    const mid = run(s, { type: 'pivot', degrees: span.to });
    assert.ok(E.enemiesTouching(mid, unit(mid, 'a')).length, 'overlapping the enemy partway through');
    assert.equal(unit(run(mid, { type: 'pivot', degrees: 90 - span.to }), 'a').angle, 90);
});

test('V3: pivots and Reform can sweep past the battlefield edge', () => {
    // Close to the top edge: a long card's corner leaves the table midway through a 90-degree turn.
    const units = [U('a', 'p1', 400, 15, { w: 120, h: 20, mobility: 1 }), U('e', 'p2', 800, 600)];
    const reform = E.unitOptions(run(battle(units, 'reform'), activate), 'a');
    assert.ok(reform.reform.right < 180, 'Reform stops when a corner reaches the edge');
    const s = run(battle(units, v3rules), activate), o = E.unitOptions(s, 'a');
    assert.equal(o.reform.right, 180);
    assert.ok(o.reform.blocked.right.length && o.reform.blocked.right[0].blocker === 'edge');
    assert.throws(() => run(s, { type: 'pivot', degrees: 90, reform: true }), /battlefield’s edge/);
    assert.equal(unit(run(s, { type: 'pivot', degrees: 180, reform: true }), 'a').angle, 180);
});

test('V3: starred units are blocked by friends, and only a pivot after moving rules out a charge', () => {
    const units = [U('a', 'p1', 400, 400, { stats: { Move: '6*' } }), U('f', 'p1', 400, 340), U('e', 'p2', 400, 240)];
    delete units[0].pace;
    const blocked = E.unitOptions(run(battle(units, v3rules), activate), 'a').forward;
    assert.equal(blocked.charge, null, 'V3 blocks on friends, even for a Pace asterisk');
    assert.equal(blocked.crossings, undefined);
    assert.deepEqual(E.unitOptions(run(battle(units, 'reform-variant'), activate), 'a').forward.charge.targets, ['e'], 'the Reform Variant still lets it through');

    // As in Reform, a pivot before moving keeps the charge; a pivot after starting to move loses it.
    const side = [U('a', 'p1', 400, 400, { mobility: 2, pace: 10 }), U('e', 'p2', 600, 400)];
    assert.deepEqual(E.unitOptions(run(battle(side, v3rules), activate, { type: 'pivot', degrees: 90 }), 'a').forward.charge.targets, ['e'], 'pivot first: can charge');
    assert.ok(!E.unitOptions(run(battle(side, 'reform-variant'), activate, { type: 'pivot', degrees: 90 }), 'a').forward.charge, 'the Reform Variant still forbids it');
    const pivoted = run(battle(side, v3rules), activate, { type: 'pivot', degrees: 45 }, move(0.5), { type: 'pivot', degrees: 45 });
    const advance = E.unitOptions(pivoted, 'a').forward;
    assert.equal(advance.charge, null);
    assert.match(advance.reason, /after pivoting during a Move/);
    assert.equal(E.geometry.touching(unit(run(pivoted, move(advance.max)), 'a'), unit(pivoted, 'e')), false);
});

test('V3: one clear line to the centre of a target edge the shooter can see gives line of sight, with no cover modifier', () => {
    // Shooter's front-edge centre is (430, 400). The target, ahead and to the left, shows the shooter two edges:
    // its near edge (centre 330, 240) and its right edge (centre 360, 220). Its other two edges face away.
    const shooter = U('a', 'p1', 400, 400, { shoot: 3, range: 24 }), target = U('e', 'p2', 300, 200);
    // Thin units, each across the line to one facing edge centre and clear of the lines to the corners.
    const slit = (id, x) => U(id, 'p1', x, 298, { w: 2, h: 4 }), nearLine = slit('s0', 366.5), sideLine = slit('s1', 390.1);
    const shot = (units, rules) => E.unitOptions(run(battle([shooter, target, ...units], rules), activate), 'a').shoot.find(t => t.id === 'e');

    assert.match(shot([nearLine], 'reform').reason, /Line of sight blocked by s0/, 'Reform needs the whole target');
    for (const blocker of [nearLine, sideLine]) {
        const seen = shot([blocker], v3rules);
        assert.equal(seen.ok, true, `the other facing edge's centre is in sight past ${blocker.id}`);
        assert.deepEqual(seen.preview.mods, [], 'no cover modifier');
        assert.equal(seen.preview.pool, 3);
    }
    // The lines to the far edges' centres miss both thin units but cross the target itself, and the corners don't count.
    assert.match(shot([nearLine, sideLine], v3rules).reason, /Line of sight blocked/, 'only facing edges count');
    assert.match(shot([U('f', 'p1', 230, 300, { w: 300 })], v3rules).reason, /Line of sight blocked by f/, 'nothing visible: no shot');
    assert.equal(shot([], v3rules).preview.pool, 3);
});

test('V3: Rally removes one strain, even while touching an enemy', () => {
    let s = run(battle([U('a', 'p1', 400, 400, { strain: 3 }), ...far], v3rules), activate);
    assert.equal(E.unitOptions(s, 'a').canRally, true);
    s = E.apply(s, { type: 'rally' });
    assert.equal(unit(s, 'a').strain, 2, 'always one strain, no roll');

    const touching = run(battle([U('a', 'p1', 400, 400, { strain: 3 }), U('e', 'p2', 400, 360)], v3rules), activate);
    assert.equal(E.unitOptions(touching, 'a').canRally, true);
    assert.equal(unit(E.apply(touching, { type: 'rally' }), 'a').strain, 2);
    assert.equal(E.unitOptions(run(battle([U('a', 'p1', 400, 400, { strain: 3 }), ...far], 'reform'), activate), 'a').canRally, false, 'still no Rally in Reform');
});

test('V3: a unit with 5 or more strain can’t shoot, strike or charge', () => {
    const duel = (strain, rules = v3rules) => run(battle([U('a', 'p1', 400, 400, { strain }), U('e', 'p2', 400, 360, { angle: 180 })], rules), activate);
    assert.equal(E.unitOptions(duel(4), 'a').strike.length, 1);
    assert.equal(E.attackPreview(duel(4), 'a', 'e', 'strike').pool, 3, 'no strain modifier at 4');
    assert.equal(E.unitOptions(duel(5), 'a').strike.length, 0);
    assert.throws(() => run(duel(5), { type: 'strike', targetId: 'e' }), /5 or more strain can’t attack/);
    assert.equal(E.unitOptions(duel(5, 'reform'), 'a').strike.length, 1, 'Reform: no such rule');

    const archer = strain => run(battle([U('a', 'p1', 400, 400, { strain, shoot: 3, range: 24 }), U('e', 'p2', 400, 200)], v3rules), activate);
    assert.equal(E.unitOptions(archer(4), 'a').shoot.find(t => t.id === 'e').ok, true);
    assert.equal(E.unitOptions(archer(5), 'a').shoot.length, 0);
    assert.throws(() => run(archer(5), { type: 'shoot', targetId: 'e' }), /5 or more strain can’t attack/);

    const charger = strain => E.unitOptions(run(battle([U('a', 'p1', 400, 400, { strain }), U('e', 'p2', 400, 300, { angle: 180 })], v3rules), activate), 'a').forward;
    assert.deepEqual(charger(4).charge.targets, ['e']);
    const held = charger(5);
    assert.equal(held.charge, null, 'no charge at 5 strain');
    assert.ok(held.max > 0 && held.max < 60 / E.PX, 'it can still advance, stopping short of the enemy');
});

test('V3: no combat modifiers, even for a flank attack from a hill', () => {
    // a stands on a hill; e faces sideways, so a touches e's flank and e touches nothing else.
    const hill = [{ type: 'hills', x: 360, y: 360, w: 120 }];
    const s = run(battle([U('a', 'p1', 400, 400), U('e', 'p2', 400, 360, { angle: 90 })], v3rules, hill), activate);
    assert.equal(E.outflanked(s, unit(s, 'e')), true);
    const p = E.attackPreview(s, 'a', 'e', 'strike');
    assert.deepEqual(p.mods, []);
    assert.equal(p.pool, 3);
    const reform = run(battle([U('a', 'p1', 400, 400), U('e', 'p2', 400, 360, { angle: 90 })], 'reform', hill), activate);
    assert.ok(E.attackPreview(reform, 'a', 'e', 'strike').mods.length > 0, 'Reform keeps the modifiers');
});

test('V3: a unit can only strike enemies touching its front', () => {
    // e touches a's right side; a faces up, so e isn't at a's front.
    const side = run(battle([U('a', 'p1', 400, 400), U('e', 'p2', 460, 400)], v3rules), activate);
    assert.equal(E.unitOptions(side, 'a').inContact, true);
    assert.equal(E.unitOptions(side, 'a').strike.length, 0);
    assert.throws(() => run(side, { type: 'strike', targetId: 'e' }), /touching its front/);
    // e can strike a: a's flank touches e's front only if e faces it.
    const facing = run(battle([U('a', 'p1', 400, 400), U('e', 'p2', 450, 400, { angle: 270 })], v3rules), { type: 'pass', player: 'p1' }, { type: 'activate', unitId: 'e' });
    assert.equal(E.unitOptions(facing, 'e').strike.length, 1);
    const reform = run(battle([U('a', 'p1', 400, 400), U('e', 'p2', 460, 400)], 'reform'), activate);
    assert.equal(E.unitOptions(reform, 'a').strike.length, 1, 'Reform: any contact can strike');
});

test('V3: hills slow units entering them', () => {
    const hill = [{ type: 'hills', x: 360, y: 200, w: 120 }];
    const v3 = E.unitOptions(run(battle([U('a', 'p1', 400, 400, { pace: 10 }), ...far], v3rules, hill), activate), 'a').forward;
    assert.equal(v3.stop, 'slow');
    assert.ok(v3.max <= 4 + 1e-6);
    const reform = E.unitOptions(run(battle([U('a', 'p1', 400, 400, { pace: 10 }), ...far], 'reform', hill), activate), 'a').forward;
    assert.notEqual(reform.stop, 'slow');
    const star = E.unitOptions(run(battle([U('a', 'p1', 400, 400, { pace: 10, paceStar: true }), ...far], v3rules, hill), activate), 'a').forward;
    assert.notEqual(star.stop, 'slow', 'a Pace asterisk ignores it');
    // A unit that starts its Move on the hill isn't slowed by it, even after a pivot.
    const onHill = [{ type: 'hills', x: 340, y: 340, w: 160 }];
    let s = run(battle([U('a', 'p1', 400, 400, { pace: 10, mobility: 2 }), ...far], v3rules, onHill), activate);
    assert.notEqual(E.unitOptions(s, 'a').forward.stop, 'slow');
    s = run(s, { type: 'pivot', degrees: 30 }, { type: 'move', inches: 1 });
    assert.equal(s.activation.slowed, false);
    assert.notEqual(E.unitOptions(s, 'a').forward.stop, 'slow');
});

test('V3 was called Skirmishers: the old name still loads as V3', () => {
    assert.equal(E.normalizeRules('skirmishers'), 'v3');
});
