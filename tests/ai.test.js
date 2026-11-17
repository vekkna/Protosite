// Tactical checks for the AI: small positions with one clearly right answer, plus whole-game smoke tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine');
const AI = require('../ai');
const { playGame, loadRoster } = require('../tools/selfplay');

const W = 88 / 25.4 * 20, H = 63 / 25.4 * 20;
const unit = (id, owner, x, y, angle, extra = {}) => ({ id, name: id, owner, x, y, w: W, h: H, angle,
    pace: 6, mobility: 2, melee: 3, shoot: 0, range: 0, defence: 4, ...extra });
/** A battle in the command phase with `first` to act. Far-away spare units keep the game from ending early. */
function battle(units, first = 'p1', bids = { p1: 2, p2: 3 }) {
    const spare = [unit('s1', 'p1', 20, 660, 0), unit('s2', 'p1', 120, 660, 0), unit('s3', 'p1', 220, 660, 0),
        unit('t1', 'p2', 20, 10, 180), unit('t2', 'p2', 120, 10, 180), unit('t3', 'p2', 220, 10, 180)];
    let s = E.createGame({ units: [...units, ...spare], seed: 5 });
    const low = first, high = E.other(first);
    s = E.apply(s, { type: 'bid', player: low, value: Math.min(bids.p1, bids.p2) });
    s = E.apply(s, { type: 'bid', player: high, value: Math.max(bids.p1, bids.p2) });
    return s;
}
const fixed = () => 0.5;
const decide = (s, p) => AI.choose(s, p, { level: 'hard', random: fixed });

test('takes a rout when one is on offer', () => {
    const s = battle([unit('a', 'p1', 600, 400, 0, { melee: 6 }), unit('v', 'p2', 600, 300, 180, { strain: 6 })]);
    const c = decide(s, 'p1');
    assert.equal(c.actions[0].unitId, 'a', c.note);
    assert.ok(c.actions.some(a => a.type === 'strike' && a.targetId === 'v'), c.note);
});

test('charges the flank rather than the front when both are reachable', () => {
    // The enemy faces left; our unit is below it, so a straight charge hits its side.
    const s = battle([unit('a', 'p1', 600, 420, 0, { melee: 4 }), unit('v', 'p2', 600, 300, 270)]);
    const c = decide(s, 'p1'), end = AI.carryOut(s, c.actions.filter(a => a.type !== 'strike'));
    assert.ok(c.actions.some(a => a.type === 'strike' && a.targetId === 'v'), c.note);
    const before = E.apply(s, { type: 'activate', unitId: 'a' });
    assert.ok(end.units.find(u => u.id === 'a').y < before.units.find(u => u.id === 'a').y, 'moved into contact');
});

test('shoots a target in range instead of doing nothing', () => {
    // P2 is Master Tactician and passes first, so this is P1's only turn of the round: holding the shot for a second
    // turn (a fair choice for a Master Tactician) is not available.
    const s = E.apply(battle([unit('a', 'p1', 600, 520, 0, { melee: 1, shoot: 4, range: 24, defence: 3 }), unit('v', 'p2', 600, 250, 180, { defence: 3 })], 'p2'), { type: 'pass' });
    const c = decide(s, 'p1');
    assert.ok(c.actions.some(a => a.type === 'shoot' && a.targetId === 'v'), c.note);
});

test('rallies or withdraws a unit that is about to rout instead of charging in', () => {
    const s = battle([unit('a', 'p1', 600, 450, 0, { strain: 6, melee: 1 }), unit('v', 'p2', 600, 300, 180, { melee: 6 })]);
    const c = decide(s, 'p1');
    assert.ok(!(c.actions[0].unitId === 'a' && c.actions.some(a => a.type === 'strike')), `fragile unit attacked: ${c.note}`);
    const end = AI.carryOut(s, c.actions).units.find(u => u.id === 'a');
    assert.ok(end.y >= 450 - 1e-6, `fragile unit moved towards the enemy: ${c.note}`);
});

test('never proposes an illegal action in a full game against itself', () => {
    const roster = loadRoster();
    const r = playGame(3, { p1: 'hard', p2: 'hard' }, roster, 12);
    assert.ok(r.rounds >= 2);
});

test('beats a bot that just charges forward', () => {
    const roster = loadRoster();
    let wins = 0;
    for (const seed of [1, 2]) for (const side of ['p1', 'p2']) {
        const r = playGame(seed, side === 'p1' ? { p1: 'hard', p2: 'brawler' } : { p1: 'brawler', p2: 'hard' }, roster);
        if (r.winner === side) wins += 1;
    }
    assert.ok(wins >= 3, `won ${wins} of 4`);
});

test('cannot see the dice or the opponent’s bid', () => {
    let s = battle([unit('a', 'p1', 600, 400, 0), unit('v', 'p2', 600, 100, 180)]);
    const view = E.observe(s, 'p1');
    assert.equal(view.rng, 0);
    assert.throws(() => E.apply(s, { type: 'activate', unitId: 'a', forcedStrain: 3 }), /hypothetical/);
    let b = E.createGame({ units: [unit('a', 'p1', 600, 640, 0), unit('v', 'p2', 600, 20, 180)], seed: 1 });
    b = E.apply(b, { type: 'bid', player: 'p2', value: 1 });
    assert.equal(E.observe(b, 'p1').bids.p2, null);
});

test('small moves are charged in full', () => {
    let s = battle([unit('a', 'p1', 600, 400, 0), unit('v', 'p2', 600, 100, 180)]);
    s = E.apply(s, { type: 'activate', unitId: 'a' });
    for (let i = 0; i < 50; i++) s = E.apply(s, { type: 'move', inches: 0.004 });
    assert.ok(Math.abs(s.activation.moved - 0.2) < 1e-9);
});

// ---------- draft ----------
function draftPool(deck, firstPick = 'p1') {
    // Two identical units: one beside Player 1's zone, one beside Player 2's.
    const twin = (id, y) => ({ id, name: id, x: 440, y, w: W, h: H, pace: 6, mobility: 2, melee: 3, shoot: 0, range: 0, defence: 4 });
    return E.createGame({ units: [twin('nearP1', 520), twin('nearP2', 150)], terrainDeck: deck, firstPick, seed: 3, tileSize: W });
}

test('draft: takes the unit that puts a hill on its own side', () => {
    assert.equal(AI.choose(draftPool(['hills']), 'p1', { level: 'hard', random: fixed }).actions[0].unitId, 'nearP1');
    assert.equal(AI.choose(draftPool(['hills'], 'p2'), 'p2', { level: 'hard', random: fixed }).actions[0].unitId, 'nearP2');
});

test('draft: takes the unit that puts a swamp in the enemy’s way', () => {
    assert.equal(AI.choose(draftPool(['swamp']), 'p1', { level: 'hard', random: fixed }).actions[0].unitId, 'nearP2');
});

test('draft: places a hill as close to its own zone as the rules allow', () => {
    let s = draftPool(['hills']);
    s = E.apply(s, { type: 'pick', player: 'p1', unitId: 'nearP1' });
    const a = AI.choose(s, 'p1', { level: 'hard', random: fixed }).actions[0];
    assert.equal(a.type, 'placeTerrain');
    const lowest = Math.max(...E.terrainSpots(s).map(q => q.y));
    assert.ok(a.y >= lowest - 1e-6, `placed at y=${a.y}, could have reached ${lowest}`);
});

test('draft: does not deploy a mover behind impassable ground when a clear lane exists', () => {
    const mover = { id: 'm', name: 'm', x: 440, y: 300, w: W, h: H, pace: 6, mobility: 2, melee: 3, shoot: 0, range: 0, defence: 4 };
    let s = E.createGame({ units: [mover], terrain: [{ type: 'swamp', x: 440, y: 500, w: W }], terrainDeck: [], firstPick: 'p1', seed: 3, tileSize: W });
    s = E.apply(s, { type: 'pick', player: 'p1', unitId: 'm' });
    const a = AI.choose(s, 'p1', { level: 'hard', random: fixed }).actions[0];
    assert.equal(a.type, 'deploy');
    assert.ok(Math.abs(a.x + W / 2 - (440 + W / 2)) > W, `deployed at x=${a.x}, directly behind the swamp`);
});
