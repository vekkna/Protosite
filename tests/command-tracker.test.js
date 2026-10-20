const { test } = require('node:test');
const assert = require('node:assert/strict');
const tracker = require('../command-tracker');
const counts = { p1: 6, p2: 6 };
const start = (bids = { p1: 2, p2: 3 }) => tracker.start(tracker.create(), bids, counts);

test('lower bidder commands in the first and final windows', () => {
    let state = start();
    assert.equal(state.round, 1);
    assert.equal(state.master, 'p1');
    assert.equal(tracker.activePlayer(state), 'p1');
    state = tracker.pass(state, 'p1');
    assert.equal(tracker.activePlayer(state), 'p2');
    state = tracker.pass(state, 'p2');
    assert.equal(tracker.activePlayer(state), 'p1');
    state = tracker.pass(state, 'p1');
    assert.equal(state.phase, 'complete');
    assert.equal(tracker.activePlayer(state), null);
    assert.deepEqual(state.remaining, { p1: 0, p2: 0 });
});

test('commands carry into final window, and can be spent or returned', () => {
    let state = tracker.activate(start(), 'p1', true);
    assert.equal(state.remaining.p1, 1);
    state = tracker.activate(state, 'p1', false);
    assert.equal(state.remaining.p1, 2);
    state = tracker.activate(state, 'p1', true);
    state = tracker.pass(state, 'p1');
    assert.throws(() => tracker.activate(state, 'p1', true));
    assert.throws(() => tracker.pass(state, 'p1'));
    state = tracker.pass(state, 'p2');
    state = tracker.activate(state, 'p1', true);
    assert.equal(state.remaining.p1, 0);
    assert.throws(() => tracker.activate(state, 'p1', true));
    assert.equal(tracker.pass(state, 'p1').phase, 'complete');
});

test('first-round ties use draft order, later ties retain the previous master', () => {
    let state = start({ p1: 2, p2: 2 });
    assert.equal(state.master, 'p2');
    for (const player of ['p2', 'p1', 'p2']) state = tracker.pass(state, player);
    state = tracker.next(state);
    assert.equal(state.round, 2);
    assert.equal(state.phase, 'bidding');
    state = tracker.start(state, { p1: 1, p2: 1 }, counts);
    assert.equal(state.master, 'p2');
    const first = { ...tracker.create(), firstTie: 'p1' };
    assert.equal(tracker.start(first, { p1: 1, p2: 1 }, counts).master, 'p1');
});

test('bids must be integers within the surviving army size', () => {
    for (const bid of [0, -1, 7, 1.5, NaN, Infinity]) {
        assert.throws(() => tracker.start(tracker.create(), { p1: bid, p2: 1 }, counts));
    }
    assert.throws(() => tracker.start(tracker.create(), { p1: 1, p2: 1 }, { p1: 0, p2: 6 }));
    assert.throws(() => tracker.start(start(), { p1: 1, p2: 1 }, counts));
    assert.throws(() => tracker.next(start()));
    assert.throws(() => tracker.start(tracker.create(), { p1: 7, p2: 1 }, { p1: 24, p2: 24 }),
        'An army larger than six still cannot bid more than six');
});

test('saved tracker state preserves windows, commands and tie history', () => {
    const original = start();
    const spent = tracker.activate(original, 'p1', true);
    assert.equal(original.remaining.p1, 2);
    const saved = JSON.parse(JSON.stringify(tracker.pass(spent, 'p1')));
    assert.equal(tracker.activePlayer(saved), 'p2');
    assert.equal(saved.remaining.p1, 1);
    assert.equal(saved.master, 'p1');
});
