const { test } = require('node:test');
const assert = require('node:assert/strict');
const CommandTracker = require('../command-tracker');

test('command-tracker: lower bidder becomes Master Tactician in round 1', () => {
    let state = CommandTracker.create();
    state = CommandTracker.start(state, { p1: 2, p2: 4 }, { p1: 12, p2: 12 });
    assert.equal(state.master, 'p1');
    assert.equal(state.round, 1);
    assert.equal(state.window, 0); // Window 0: MT's 1st turn
});

test('command-tracker: first round tie goes to player drafting second (P2)', () => {
    let state = CommandTracker.create();
    // Default firstTie is 'p2'
    state = CommandTracker.start(state, { p1: 3, p2: 3 }, { p1: 12, p2: 12 });
    assert.equal(state.master, 'p2');
});

test('command-tracker: turn sequence MT 1st -> Player X -> MT 2nd -> round ends', () => {
    let state = CommandTracker.create();
    state = CommandTracker.start(state, { p1: 2, p2: 4 }, { p1: 12, p2: 12 });
    assert.equal(state.master, 'p1');
    assert.equal(CommandTracker.activePlayer(state), 'p1');

    // MT passes 1st turn
    state = CommandTracker.pass(state);
    assert.equal(state.window, 1);
    assert.equal(CommandTracker.activePlayer(state), 'p2'); // Player 2's turn

    // Player 2 passes
    state = CommandTracker.pass(state);
    assert.equal(state.window, 2);
    assert.equal(CommandTracker.activePlayer(state), 'p1'); // MT's 2nd turn

    // MT passes 2nd turn -> round complete!
    state = CommandTracker.pass(state);
    assert.equal(state.phase, 'complete');

    // Next round
    state = CommandTracker.next(state);
    assert.equal(state.round, 2);
    assert.equal(state.phase, 'bidding');
    assert.equal(state.master, 'p1'); // Preserves previous master for tie breaking
});

test('command-tracker: subsequent round tie retains previous round Master Tactician', () => {
    let state = CommandTracker.create();
    // Round 1: P1 bids 2, P2 bids 4 -> P1 is master
    state = CommandTracker.start(state, { p1: 2, p2: 4 }, { p1: 12, p2: 12 });
    assert.equal(state.master, 'p1');
    state = CommandTracker.pass(state);
    state = CommandTracker.pass(state);
    state = CommandTracker.pass(state);
    state = CommandTracker.next(state);

    // Round 2: P1 bids 3, P2 bids 3 -> tie! Previous master (P1) keeps it!
    state = CommandTracker.start(state, { p1: 3, p2: 3 }, { p1: 12, p2: 12 });
    assert.equal(state.master, 'p1');
});
