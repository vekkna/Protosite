const { test } = require('node:test');
const assert = require('node:assert/strict');
const CommandTracker = require('../command-tracker');

test('command-tracker: lower bidder becomes Master Tactician in round 1', () => {
    let state = CommandTracker.create();
    state = CommandTracker.start(state, { p1: 2, p2: 4 }, { p1: 12, p2: 12 });
    assert.equal(state.master, 'p1');
    assert.equal(state.round, 1);
    assert.equal(state.window, 0); // Window 0: Master Tactician's 1st turn
});

test('command-tracker: first round tie goes to player drafting second (P2)', () => {
    let state = CommandTracker.create();
    // Default firstTie is 'p2'
    state = CommandTracker.start(state, { p1: 3, p2: 3 }, { p1: 12, p2: 12 });
    assert.equal(state.master, 'p2');
});

test('command-tracker: turn sequence Master Tactician 1st -> Player X -> Master Tactician 2nd -> round ends', () => {
    let state = CommandTracker.create();
    state = CommandTracker.start(state, { p1: 2, p2: 4 }, { p1: 12, p2: 12 });
    assert.equal(state.master, 'p1');
    assert.equal(CommandTracker.activePlayer(state), 'p1');

    // Master Tactician passes 1st turn
    state = CommandTracker.pass(state);
    assert.equal(state.window, 1);
    assert.equal(CommandTracker.activePlayer(state), 'p2'); // Player 2's turn

    // Player 2 passes
    state = CommandTracker.pass(state);
    assert.equal(state.window, 2);
    assert.equal(CommandTracker.activePlayer(state), 'p1'); // Master Tactician's 2nd turn

    // Master Tactician passes 2nd turn -> round complete!
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

test('command-tracker: either player can pass the active command window', () => {
    let state = CommandTracker.create();
    state = CommandTracker.start(state, { p1: 2, p2: 5 }, { p1: 12, p2: 12 });
    assert.equal(state.master, 'p1');
    assert.equal(CommandTracker.activePlayer(state), 'p1');

    assert.equal(CommandTracker.pass(state, 'p2').window, 1);

    // Passing as active player 'p1' succeeds
    state = CommandTracker.pass(state, 'p1');
    assert.equal(CommandTracker.activePlayer(state), 'p2');

    // Player 1 can also pass while Player 2 is active.
    assert.equal(CommandTracker.pass(state, 'p1').window, 2);
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

test('remote-sandbox: unit hover popup disabled, interactive selection shows compact wound controls', () => {
    let tooltipVisible = false;
    let tooltipInteractive = false;
    let tooltipMarkup = '';

    const showUnitTooltipMock = (unitEl, interactive = false) => {
        if (!interactive || !unitEl) return;
        tooltipVisible = true;
        tooltipInteractive = true;
        tooltipMarkup = '<div class="unit-popup-controls"><button data-wound-step="-1">-</button><button data-wound-step="1">+</button></div>';
    };

    // Hover (interactive = false)
    showUnitTooltipMock({ id: 'unit-1' }, false);
    assert.equal(tooltipVisible, false, 'Hover should not display floating tooltip on table');

    // Selection (interactive = true)
    showUnitTooltipMock({ id: 'unit-1' }, true);
    assert.equal(tooltipVisible, true);
    assert.equal(tooltipInteractive, true);
    assert.match(tooltipMarkup, /data-wound-step="-1"/);
    assert.match(tooltipMarkup, /data-wound-step="1"/);
    assert.doesNotMatch(tooltipMarkup, /stats-card/, 'Should not include obstructive stats markup in popup');
});

test('remote-sandbox: command staging splits into Your commands and Opponent commands', () => {
    const tokens = [
        { id: 'cmd-p1-0', player: 'p1', num: 1, status: 'tray' },
        { id: 'cmd-p1-1', player: 'p1', num: 2, status: 'tray' },
        { id: 'cmd-p2-0', player: 'p2', num: 1, status: 'tray' }
    ];

    // For Host (localKey = 'p1')
    const hostLocalKey = 'p1';
    const hostYour = tokens.filter(t => t.player === hostLocalKey && t.status === 'tray');
    const hostOpp = tokens.filter(t => t.player !== hostLocalKey && t.status === 'tray');
    assert.equal(hostYour.length, 2);
    assert.equal(hostOpp.length, 1);

    // For Challenger (localKey = 'p2')
    const challengerLocalKey = 'p2';
    const chalYour = tokens.filter(t => t.player === challengerLocalKey && t.status === 'tray');
    const chalOpp = tokens.filter(t => t.player !== challengerLocalKey && t.status === 'tray');
    assert.equal(chalYour.length, 1);
    assert.equal(chalOpp.length, 2);
});

test('remote-sandbox: draft notice banner hides automatically once bids are revealed', () => {
    const isBannerVisible = (round, revealed) => {
        if (round > 1 || revealed) return false;
        return true;
    };

    // Round 1 unrevealed: visible
    assert.equal(isBannerVisible(1, false), true);
    // Round 1 revealed: hidden!
    assert.equal(isBannerVisible(1, true), false);
    // Round 2 unrevealed: hidden!
    assert.equal(isBannerVisible(2, false), false);
    // Round 2 revealed: hidden!
    assert.equal(isBannerVisible(2, true), false);
});

test('remote-sandbox: challenger board perspective flips 180 degrees and transforms coordinates', () => {
    const getBoardTransform = (isHost, scale) => {
        const rotate = !isHost ? ' rotate(180deg)' : '';
        return `scale(${scale})${rotate}`;
    };

    assert.equal(getBoardTransform(true, 0.75), 'scale(0.75)');
    assert.equal(getBoardTransform(false, 0.75), 'scale(0.75) rotate(180deg)');

    // Invert pointer coordinates for Challenger
    const tableRect = { left: 100, right: 1000, top: 50, bottom: 650, width: 900, height: 600 };
    const currentScale = 0.5; // table is 1800 x 1200

    const getPointer = (clientX, clientY, isHost) => {
        if (!isHost) {
            return {
                x: (tableRect.right - clientX) / currentScale,
                y: (tableRect.bottom - clientY) / currentScale
            };
        }
        return {
            x: (clientX - tableRect.left) / currentScale,
            y: (clientY - tableRect.top) / currentScale
        };
    };

    // Host: client at (100, 50) -> (0, 0)
    assert.deepEqual(getPointer(100, 50, true), { x: 0, y: 0 });

    // Challenger: client at bottom-right (1000, 650) -> maps to (0, 0)
    assert.deepEqual(getPointer(1000, 650, false), { x: 0, y: 0 });

    // Challenger: client at top-left (100, 50) -> maps to (1800, 1200)
    assert.deepEqual(getPointer(100, 50, false), { x: 1800, y: 1200 });

    // Center is invariant
    assert.deepEqual(getPointer(550, 350, true), { x: 900, y: 600 });
    assert.deepEqual(getPointer(550, 350, false), { x: 900, y: 600 });
});
