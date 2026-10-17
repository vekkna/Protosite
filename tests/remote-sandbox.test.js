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

test('command-tracker: custom firstDraftPick P2 means P1 drafts second and wins round 1 tie', () => {
    // If P2 drafts first, P2 loses round 1 tie -> P1 wins round 1 tie
    let state = CommandTracker.create({ firstDraftPick: 'p2' });
    assert.equal(state.firstTie, 'p1');
    state = CommandTracker.start(state, { p1: 4, p2: 4 }, { p1: 12, p2: 12 });
    assert.equal(state.master, 'p1');
});

test('command-tracker: only the active player can pass', () => {
    let state = CommandTracker.create();
    state = CommandTracker.start(state, { p1: 2, p2: 5 }, { p1: 12, p2: 12 });
    assert.equal(state.master, 'p1');
    assert.equal(CommandTracker.activePlayer(state), 'p1');

    // Passing as inactive player 'p2' throws
    assert.throws(() => CommandTracker.pass(state, 'p2'), /Only the active player can pass/);

    // Passing as active player 'p1' succeeds
    state = CommandTracker.pass(state, 'p1');
    assert.equal(CommandTracker.activePlayer(state), 'p2');

    // Now 'p1' cannot pass
    assert.throws(() => CommandTracker.pass(state, 'p1'), /Only the active player can pass/);
    state = CommandTracker.pass(state, 'p2');
    assert.equal(CommandTracker.activePlayer(state), 'p1');
});

test('remote-sandbox: Master Tactician label matches local player vs opponent', () => {
    const getMasterLabel = (master, localKey) => {
        return master === localKey ? 'You are Master Tactician' : 'Your opponent is Master Tactician';
    };

    assert.equal(getMasterLabel('p1', 'p1'), 'You are Master Tactician');
    assert.equal(getMasterLabel('p2', 'p1'), 'Your opponent is Master Tactician');
    assert.equal(getMasterLabel('p2', 'p2'), 'You are Master Tactician');
    assert.equal(getMasterLabel('p1', 'p2'), 'Your opponent is Master Tactician');
});

test('remote-sandbox: multi-game index and isolation logic', () => {
    const mockStorage = new Map();
    const saveActiveGame = (list, entry) => {
        const idx = list.findIndex(g => g.roomCode === entry.roomCode);
        if (idx >= 0) list[idx] = { ...list[idx], ...entry };
        else list.unshift(entry);
        return list;
    };

    let games = [];
    games = saveActiveGame(games, { roomCode: 'ABCD', role: 'p1', isHost: true, round: 1 });
    games = saveActiveGame(games, { roomCode: 'WXYZ', role: 'p2', isHost: false, round: 2 });

    assert.equal(games.length, 2);
    assert.equal(games[0].roomCode, 'WXYZ');
    assert.equal(games[1].roomCode, 'ABCD');

    // Individual game save keys
    const getKey = (code) => 'seize_the_day_save_' + code;
    mockStorage.set(getKey('ABCD'), JSON.stringify({ roomCode: 'ABCD', round: 1 }));
    mockStorage.set(getKey('WXYZ'), JSON.stringify({ roomCode: 'WXYZ', round: 2 }));

    assert.equal(JSON.parse(mockStorage.get(getKey('ABCD'))).round, 1);
    assert.equal(JSON.parse(mockStorage.get(getKey('WXYZ'))).round, 2);
});

test('remote-sandbox: room code hideable panel tuck state transitions', () => {
    let isRoomCodeHidden = false;
    const bannerClasses = new Set();
    const areaClasses = new Set();
    let ariaExpanded = 'true';

    const updateVisibility = () => {
        if (isRoomCodeHidden) {
            bannerClasses.add('is-tucked');
            areaClasses.add('is-tucked');
            ariaExpanded = 'false';
        } else {
            bannerClasses.delete('is-tucked');
            areaClasses.delete('is-tucked');
            ariaExpanded = 'true';
        }
    };

    const toggle = () => {
        isRoomCodeHidden = !isRoomCodeHidden;
        updateVisibility();
    };

    // Initially untucked
    updateVisibility();
    assert.equal(ariaExpanded, 'true');
    assert.equal(areaClasses.has('is-tucked'), false);

    // Tuck panel
    toggle();
    assert.equal(isRoomCodeHidden, true);
    assert.equal(ariaExpanded, 'false');
    assert.equal(areaClasses.has('is-tucked'), true);
    assert.equal(bannerClasses.has('is-tucked'), true);

    // Untuck panel
    toggle();
    assert.equal(isRoomCodeHidden, false);
    assert.equal(ariaExpanded, 'true');
    assert.equal(areaClasses.has('is-tucked'), false);
    assert.equal(bannerClasses.has('is-tucked'), false);
});

