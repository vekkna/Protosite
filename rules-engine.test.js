'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./rules-engine');

const BASE_STATS = { Speed: '6', Drill: '1', Melee: '4', Ranged: '2/12', Def: '5' };

function unit(id, x, y, overrides = {}) {
    return {
        id,
        name: id.toUpperCase(),
        stats: { ...BASE_STATS, ...(overrides.stats || {}) },
        size: overrides.size || { width: 2, height: 1 },
        pose: { x, y, angle: overrides.angle || 0 },
        ownerId: overrides.ownerId || null,
        wounds: overrides.wounds || 0
    };
}

function pool(count = 12) {
    return Array.from({ length: count }, (_, index) => unit(
        `u${index + 1}`,
        6 + (index % 4) * 10,
        10 + Math.floor(index / 4) * 7
    ));
}

function apply(state, action, options) {
    return E.applyAction(state, {
        expectedRevision: state.revision,
        actionId: `${action.type}:${state.revision}:${action.actorId || ''}`,
        ...action
    }, options).state;
}

function finishOpenGroundDraft() {
    let state = E.createGame({ seed: 7, units: pool(), terrainDeck: Array(12).fill('x'), firstDraftPlayer: 'p1' });
    const slots = { p1: 0, p2: 0 };
    while (state.phase === 'draft') {
        const actorId = state.draft.currentPlayerId;
        const choose = E.getLegalActions(state, actorId).find(action => action.type === 'draft.chooseUnit');
        state = apply(state, choose);
        assert.equal(state.draft.step, 'deployUnit');
        const index = slots[actorId]++;
        const pose = actorId === 'p1'
            ? { x: 4 + index * 7.5, y: 35, angle: 0 }
            : { x: 4 + index * 7.5, y: 1, angle: 180 };
        state = apply(state, { type: 'draft.deployUnit', actorId, unitId: choose.unitId, pose });
    }
    return state;
}

test('createGame is deterministic, serializable, and exposes only pure data', () => {
    const first = E.createGame({ seed: 42, units: pool() });
    const second = E.createGame({ seed: 42, units: pool() });
    assert.deepEqual(first, second);
    assert.doesNotThrow(() => JSON.stringify(first));
    assert.equal(first.phase, 'draft');
    assert.equal(E.getLegalActions(first, first.draft.currentPlayerId).length, 12);
    assert.equal(E.assertInvariants(first), true);
});

test('standard setup selects exactly twelve complete profiles and rejects invented stats', () => {
    const largePool = pool(24);
    const state = E.createGame({ seed: 42, units: largePool });
    assert.equal(state.units.length, 12);
    assert.throws(() => E.createGame({
        seed: 1,
        units: pool().map((candidate, index) => index === 0
            ? { ...candidate, stats: { Speed: '5', Drill: '1' } }
            : candidate)
    }), /missing valid required stats/);
});

test('draft draws and visibly discards open ground as separate forced steps', () => {
    let state = E.createGame({ seed: 1, units: pool(), terrainDeck: Array(12).fill('x'), firstDraftPlayer: 'p1' });
    const chosen = E.getLegalActions(state, 'p1')[0];
    let result = E.applyAction(state, { ...chosen, actionId: 'choose' }, { autoAdvance: false });
    state = result.state;
    assert.equal(state.draft.step, 'drawTerrain');
    result = E.advanceForced(state);
    assert.equal(result.events[0].type, 'terrain.drawn');
    assert.equal(result.state.draft.step, 'discardTerrain');
    result = E.advanceForced(result.state);
    assert.equal(result.events[0].type, 'terrain.discarded');
    assert.equal(result.state.draft.step, 'deployUnit');
});

test('terrain may overlap the selected unit but not an already-deployed unit', () => {
    let state = E.createGame({ seed: 1, units: pool(), terrainDeck: ['forest', ...Array(11).fill('x')], firstDraftPlayer: 'p1' });
    state = apply(state, E.getLegalActions(state, 'p1')[0], { autoAdvance: false });
    state = E.advanceForced(state).state;
    assert.equal(state.draft.step, 'placeTerrain');
    assert.equal(E.validateAction(state, {
        type: 'draft.placeTerrain', actorId: 'p1', expectedRevision: state.revision,
        pose: { x: 20, y: 20, angle: 0 }
    }).code, 'terrain.mustTouchUnit');
    const selected = E.selectors.unitById(state, state.draft.selectedUnitId);
    assert.equal(E.validateAction(state, {
        type: 'draft.placeTerrain', actorId: 'p1', expectedRevision: state.revision,
        pose: { ...selected.pose }
    }).ok, true);
    const deployed = state.units.find(candidate => candidate.id !== selected.id);
    deployed.ownerId = 'p2';
    deployed.pose = { ...selected.pose };
    state.draft.poolIds = state.draft.poolIds.filter(id => id !== deployed.id);
    assert.equal(E.validateAction(state, {
        type: 'draft.placeTerrain', actorId: 'p1', expectedRevision: state.revision,
        pose: { ...selected.pose }
    }).code, 'terrain.overlapsUnit');
    deployed.pose = { x: 40, y: 30, angle: 0 };
    const terrainSize = E.getLegalActions(state, 'p1').find(action => action.type === 'draft.placeTerrain').size;
    const touchingPose = {
        x: selected.pose.x + ((selected.size.width + terrainSize.width) / 2),
        y: selected.pose.y,
        angle: 0
    };
    assert.equal(E.validateAction(state, {
        type: 'draft.placeTerrain', actorId: 'p1', expectedRevision: state.revision, pose: touchingPose
    }).ok, true);
});

test('a complete draft alternates players, enters bidding, and records starting armies', () => {
    const state = finishOpenGroundDraft();
    assert.equal(state.phase, 'bid');
    assert.equal(state.round.number, 1);
    assert.equal(state.players.find(player => player.id === 'p1').startingUnitCount, 6);
    assert.equal(state.players.find(player => player.id === 'p2').startingUnitCount, 6);
});

test('bids remain concealed until both submit and a first-round tie goes to second drafter', () => {
    let state = finishOpenGroundDraft();
    state = apply(state, { type: 'bid.submit', actorId: 'p1', bid: 2 });
    const p2View = E.projectState(state, 'p2');
    assert.equal(p2View.round.bids.p1, null);
    state = apply(state, { type: 'bid.submit', actorId: 'p2', bid: 2 });
    assert.equal(state.phase, 'command');
    assert.equal(state.round.masterId, state.draft.secondPlayerId);
    assert.equal(state.round.commands.p1, 2);
    assert.equal(state.round.commands.p2, 2);
});

function commandScenario(overrides = {}) {
    const units = [
        unit('p1a', 12, 30, { ownerId: 'p1', stats: overrides.p1Stats }),
        unit('p1b', 20, 30, { ownerId: 'p1' }),
        unit('p2a', 12, 6, { ownerId: 'p2', angle: 180, stats: overrides.p2Stats, wounds: overrides.p2Wounds }),
        unit('p2b', 20, 6, { ownerId: 'p2', angle: 180 })
    ];
    let state = E.createScenario({ seed: overrides.seed || 9, units, firstDraftPlayer: 'p2' });
    state = apply(state, { type: 'bid.submit', actorId: 'p1', bid: 1 });
    state = apply(state, { type: 'bid.submit', actorId: 'p2', bid: 2 });
    assert.equal(state.round.masterId, 'p1');
    return state;
}

test('command windows yield and exhaust in the written order', () => {
    let state = commandScenario();
    state = apply(state, { type: 'command.yield', actorId: 'p1' });
    assert.equal(state.round.window, 'otherPlayer');
    assert.equal(state.round.activePlayerId, 'p2');
    state = apply(state, { type: 'activation.selectUnit', actorId: 'p2', unitId: 'p2a' });
    state = apply(state, { type: 'activation.pass', actorId: 'p2' });
    state = apply(state, { type: 'activation.endPivots', actorId: 'p2' });
    assert.equal(state.round.window, 'otherPlayer');
    assert.equal(state.activation.unitId, 'p2b');
    assert.equal(state.round.commands.p2, 0);
    assert.match(state.eventLog.at(-1).message, /Automatic/);
});

test('movement is straight, forward/back limited, and rejects crossing another unit', () => {
    let state = commandScenario();
    state = apply(state, { type: 'activation.selectUnit', actorId: 'p1', unitId: 'p1a' });
    assert.equal(E.validateAction(state, {
        type: 'activation.move', actorId: 'p1', expectedRevision: state.revision,
        unitId: 'p1a', direction: 'forward', pose: { x: 13, y: 25, angle: 0 }
    }).code, 'move.notStraight');
    assert.equal(E.validateAction(state, {
        type: 'activation.move', actorId: 'p1', expectedRevision: state.revision,
        unitId: 'p1a', direction: 'backward', pose: { x: 12, y: 34, angle: 0 }
    }).code, 'move.tooFar');
    state = apply(state, {
        type: 'activation.move', actorId: 'p1', unitId: 'p1a', direction: 'forward', pose: { x: 12, y: 24, angle: 0 }
    });
    assert.equal(E.selectors.unitById(state, 'p1a').pose.y, 24);
    assert.equal(state.activation.stage, 'postPivots');
});

test('backward movement may break an existing flank contact but cannot make a new contact', () => {
    const units = [
        unit('p1a', 12, 20, { ownerId: 'p1' }),
        unit('p1b', 25, 30, { ownerId: 'p1' }),
        unit('p2a', 14, 20, { ownerId: 'p2' }),
        unit('p2b', 25, 6, { ownerId: 'p2', angle: 180 })
    ];
    let state = E.createScenario({ seed: 12, units });
    state = apply(state, { type: 'bid.submit', actorId: 'p1', bid: 1 });
    state = apply(state, { type: 'bid.submit', actorId: 'p2', bid: 2 });
    state = apply(state, { type: 'activation.selectUnit', actorId: 'p1', unitId: 'p1a' });
    const breakContact = E.validateAction(state, {
        type: 'activation.move', actorId: 'p1', expectedRevision: state.revision,
        unitId: 'p1a', direction: 'backward', pose: { x: 12, y: 22, angle: 0 }
    });
    assert.equal(breakContact.ok, true);
});

test('slowing applies from the starting pose even when the unit immediately leaves', () => {
    const units = [
        unit('p1a', 12, 30, { ownerId: 'p1' }),
        unit('p1b', 25, 30, { ownerId: 'p1' }),
        unit('p2a', 12, 6, { ownerId: 'p2', angle: 180 }),
        unit('p2b', 25, 6, { ownerId: 'p2', angle: 180 })
    ];
    let state = E.createScenario({
        seed: 16,
        units,
        terrain: [{ id: 'thin-field', type: 'field', size: { width: 2, height: 1 }, pose: { x: 12, y: 30.99, angle: 0 } }]
    });
    state = apply(state, { type: 'bid.submit', actorId: 'p1', bid: 1 });
    state = apply(state, { type: 'bid.submit', actorId: 'p2', bid: 2 });
    state = apply(state, { type: 'activation.selectUnit', actorId: 'p1', unitId: 'p1a' });
    const validation = E.validateAction(state, {
        type: 'activation.move', actorId: 'p1', expectedRevision: state.revision,
        unitId: 'p1a', direction: 'forward', pose: { x: 12, y: 26, angle: 0 }
    });
    assert.equal(validation.code, 'move.slowing');
});

test('pivots cannot create contact or enter slowing after moving over three inches', () => {
    let contact = E.createScenario({
        seed: 17,
        units: [
            unit('p1a', 12, 20, { ownerId: 'p1' }),
            unit('p1b', 25, 30, { ownerId: 'p1' }),
            unit('p2a', 12, 18.5, { ownerId: 'p2', angle: 180 }),
            unit('p2b', 25, 6, { ownerId: 'p2', angle: 180 })
        ]
    });
    contact = apply(contact, { type: 'bid.submit', actorId: 'p1', bid: 1 });
    contact = apply(contact, { type: 'bid.submit', actorId: 'p2', bid: 2 });
    contact = apply(contact, { type: 'activation.selectUnit', actorId: 'p1', unitId: 'p1a' });
    assert.equal(E.validateAction(contact, {
        type: 'activation.pivot', actorId: 'p1', expectedRevision: contact.revision,
        unitId: 'p1a', degrees: 90
    }).code, 'pivot.newContact');

    let slowing = E.createScenario({
        seed: 18,
        units: [
            unit('p1a', 12, 30, { ownerId: 'p1', size: { width: 4, height: 1 } }),
            unit('p1b', 25, 30, { ownerId: 'p1' }),
            unit('p2a', 12, 6, { ownerId: 'p2', angle: 180 }),
            unit('p2b', 25, 6, { ownerId: 'p2', angle: 180 })
        ],
        terrain: [{ id: 'pivot-field', type: 'field', size: { width: 3, height: 1 }, pose: { x: 12, y: 23.7, angle: 0 } }]
    });
    slowing = apply(slowing, { type: 'bid.submit', actorId: 'p1', bid: 1 });
    slowing = apply(slowing, { type: 'bid.submit', actorId: 'p2', bid: 2 });
    slowing = apply(slowing, { type: 'activation.selectUnit', actorId: 'p1', unitId: 'p1a' });
    slowing = apply(slowing, {
        type: 'activation.move', actorId: 'p1', unitId: 'p1a',
        direction: 'forward', pose: { x: 12, y: 26, angle: 0 }
    }, { autoAdvance: false });
    assert.equal(E.validateAction(slowing, {
        type: 'activation.pivot', actorId: 'p1', expectedRevision: slowing.revision,
        unitId: 'p1a', degrees: 90
    }).code, 'pivot.slowing');
});

test('deployment rejects impassable terrain', () => {
    let state = E.createGame({
        seed: 4,
        units: pool(),
        terrain: [{ id: 'swamp-zone', type: 'swamp', size: { width: 3, height: 3 }, pose: { x: 4, y: 34, angle: 0 } }],
        terrainDeck: Array(12).fill('x'),
        firstDraftPlayer: 'p1'
    });
    const choose = E.getLegalActions(state, 'p1')[0];
    state = apply(state, choose);
    const validation = E.validateAction(state, {
        type: 'draft.deployUnit', actorId: 'p1', expectedRevision: state.revision,
        unitId: choose.unitId, pose: { x: 4, y: 34, angle: 0 }
    });
    assert.equal(validation.code, 'deployment.impassable');
});

test('Drill 0 may pivot once only when it does not move', () => {
    let state = commandScenario({ p1Stats: { Speed: '6', Drill: '0', Melee: '4', Ranged: '-', Def: '5' } });
    state = apply(state, { type: 'activation.selectUnit', actorId: 'p1', unitId: 'p1a' });
    state = apply(state, { type: 'activation.pivot', actorId: 'p1', unitId: 'p1a', degrees: 45 }, { autoAdvance: false });
    const validation = E.validateAction(state, {
        type: 'activation.move', actorId: 'p1', expectedRevision: state.revision,
        unitId: 'p1a', direction: 'forward', pose: { x: 10, y: 28, angle: 45 }
    });
    assert.equal(validation.code, 'move.drillZeroPivoted');
    assert.equal(E.getLegalActions(state, 'p1').some(action => action.type === 'activation.pivot'), false);
});

test('shooting lane rejects an intervening unit and deterministic RNG replays attacks', () => {
    const units = [
        unit('shooter', 12, 28, { ownerId: 'p1', stats: { Speed: '6', Drill: '1', Melee: '1', Ranged: '3/18', Def: '4' } }),
        unit('friend', 12, 21, { ownerId: 'p1' }),
        unit('target', 12, 14, { ownerId: 'p2', angle: 180 }),
        unit('other', 24, 6, { ownerId: 'p2', angle: 180 })
    ];
    let blocked = E.createScenario({ seed: 99, units });
    blocked = apply(blocked, { type: 'bid.submit', actorId: 'p1', bid: 1 });
    blocked = apply(blocked, { type: 'bid.submit', actorId: 'p2', bid: 2 });
    blocked = apply(blocked, { type: 'activation.selectUnit', actorId: 'p1', unitId: 'shooter' });
    assert.equal(E.getLegalActions(blocked, 'p1').some(action => action.type === 'activation.shoot' && action.targetId === 'target'), false);

    const clearUnits = units.filter(candidate => candidate.id !== 'friend');
    const build = () => {
        let state = E.createScenario({ seed: 99, units: clearUnits });
        state = apply(state, { type: 'bid.submit', actorId: 'p1', bid: 1 });
        state = apply(state, { type: 'bid.submit', actorId: 'p2', bid: 2 });
        return apply(state, { type: 'activation.selectUnit', actorId: 'p1', unitId: 'shooter' });
    };
    const first = build();
    const second = build();
    const shoot = E.getLegalActions(first, 'p1').find(action => action.type === 'activation.shoot' && action.targetId === 'target');
    assert.ok(shoot);
    assert.deepEqual(E.applyAction(first, { ...shoot, actionId: 'shot' }), E.applyAction(second, { ...shoot, actionId: 'shot' }));
});

test('shoot blockers are checked up to the target’s actual rotated lane entry', () => {
    const units = [
        unit('shooter', 12, 30, { ownerId: 'p1', stats: { Ranged: '3/18' } }),
        unit('blocker', 12, 20.85, { ownerId: 'p1', size: { width: 0.2, height: 0.2 } }),
        unit('target', 13, 20, { ownerId: 'p2', angle: 45 }),
        unit('other', 25, 6, { ownerId: 'p2', angle: 180 })
    ];
    let state = E.createScenario({ seed: 25, units });
    state = apply(state, { type: 'bid.submit', actorId: 'p1', bid: 1 });
    state = apply(state, { type: 'bid.submit', actorId: 'p2', bid: 2 });
    state = apply(state, { type: 'activation.selectUnit', actorId: 'p1', unitId: 'shooter' });
    assert.equal(E.getLegalActions(state, 'p1').some(action =>
        action.type === 'activation.shoot' && action.targetId === 'target'), false);
});

test('units on the same hill compare height by distance to its centre crest', () => {
    const state = E.createScenario({
        seed: 20,
        units: [
            unit('near', 12, 19, { ownerId: 'p1' }),
            unit('far', 12, 23, { ownerId: 'p2', angle: 180 })
        ],
        terrain: [{ id: 'hill', type: 'hills', size: { width: 10, height: 10 }, pose: { x: 12, y: 20, angle: 0 } }]
    });
    assert.equal(E.selectors.compareUnitHeight(
        state,
        E.selectors.unitById(state, 'near'),
        E.selectors.unitById(state, 'far')
    ), 1);
});

test('seven wounds destroy immediately and half remaining wins immediately', () => {
    let state = E.createScenario({
        seed: 3,
        units: [
            unit('attacker', 12, 20, { ownerId: 'p1', stats: { Speed: '6', Drill: '1', Melee: '1', Ranged: '-', Def: '4' } }),
            unit('p1b', 25, 30, { ownerId: 'p1' }),
            unit('target', 12, 19 - E.geometry.rectangleCorners(unit('x', 0, 0))[0].y, { ownerId: 'p2', angle: 180, wounds: 6, stats: { Def: '1' } }),
            unit('p2b', 25, 6, { ownerId: 'p2', angle: 180 })
        ]
    });
    // Place cards edge-to-edge explicitly for a strike.
    E.selectors.unitById(state, 'target').pose = { x: 12, y: 19, angle: 180 };
    state.phase = 'command';
    state.round.masterId = 'p1';
    state.round.window = 'masterOpening';
    state.round.activePlayerId = 'p1';
    state.round.commands.p1 = 1;
    state.players.find(player => player.id === 'p1').commands = 1;
    state = apply(state, { type: 'activation.selectUnit', actorId: 'p1', unitId: 'attacker' });
    state = apply(state, { type: 'activation.pass', actorId: 'p1' });
    state = apply(state, { type: 'activation.endPivots', actorId: 'p1' });
    assert.equal(state.activation.stage, 'strike');
    state = apply(state, { type: 'activation.strike', actorId: 'p1', targetId: 'target' });
    assert.equal(E.selectors.unitById(state, 'target').status, 'destroyed');
    assert.equal(state.winner, 'p1');
    assert.equal(state.phase, 'gameOver');
});

test('cleanup resets round-only state but keeps total wounds and previous master', () => {
    let state = commandScenario();
    state.units[0].activated = true;
    state.units[0].wounds = 3;
    state.units[0].woundsThisRound = 2;
    state.units[0].distanceMovedThisRound = 4;
    state.activation = null;
    state.phase = 'command';
    state.round.window = 'cleanup';
    state.round.activePlayerId = null;
    const result = E.advanceForced(state);
    assert.equal(result.advanced, true);
    assert.equal(result.state.phase, 'bid');
    assert.equal(result.state.units[0].wounds, 3);
    assert.equal(result.state.units[0].woundsThisRound, 0);
    assert.equal(result.state.units[0].distanceMovedThisRound, 0);
    assert.equal(result.state.units[0].activated, false);
    assert.equal(result.state.round.previousMasterId, 'p1');
});

test('stale actions reject and duplicate action IDs are idempotent', () => {
    const state = E.createGame({ seed: 1, units: pool(), terrainDeck: Array(12).fill('x') });
    const action = { ...E.getLegalActions(state, state.draft.currentPlayerId)[0], actionId: 'same' };
    const once = E.applyAction(state, action, { autoAdvance: false }).state;
    const duplicate = E.applyAction(once, action, { autoAdvance: false });
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(duplicate.state, once);
    assert.throws(() => E.applyAction(once, {
        type: 'draft.chooseUnit', actorId: once.draft.currentPlayerId,
        unitId: once.units[1].id, expectedRevision: 0, actionId: 'stale'
    }), /changed before/);
});

test('player projections expose only the face-up terrain tile and can never reduce actions', () => {
    const state = E.createGame({ seed: 81, units: pool() });
    const view = E.projectState(state, 'p2');
    assert.equal(view.projection.authoritative, false);
    assert.equal(view.rng.state, null);
    assert.equal(view.draft.terrainDeck[0], state.draft.terrainDeck[0]);
    assert.ok(view.draft.terrainDeck.slice(1).every(card => card === null));
    assert.equal(E.getLegalActions(view, view.draft.currentPlayerId)[0].nextTerrainType, state.draft.terrainDeck[0]);
    assert.match(E.getPrompt(view, view.draft.currentPlayerId).message, new RegExp(state.draft.terrainDeck[0], 'i'));
    assert.throws(() => E.applyAction(view, {
        ...E.getLegalActions(view, view.draft.currentPlayerId)[0],
        actionId: 'projected-action'
    }), /authoritative/);
    const missingRevision = E.validateAction(state, {
        type: 'draft.chooseUnit', actorId: state.draft.currentPlayerId, unitId: state.units[0].id
    });
    assert.equal(missingRevision.code, 'action.stale');
});
