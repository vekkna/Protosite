const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('Real-time unit movement and rotation streaming over network', () => {
    const elements = {};
    const createElement = (tag) => {
        const el = {
            tagName: tag.toUpperCase(),
            style: {},
            dataset: {},
            classList: {
                _classes: new Set(),
                add(...classes) { classes.forEach(c => this._classes.add(c)); },
                remove(...classes) { classes.forEach(c => this._classes.delete(c)); },
                toggle(c, force) {
                    if (force === undefined) {
                        if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c);
                    } else if (force) {
                        this._classes.add(c);
                    } else {
                        this._classes.delete(c);
                    }
                },
                contains(c) { return this._classes.has(c); }
            },
            children: [],
            appendChild(child) { this.children.push(child); return child; },
            remove() {},
            querySelectorAll(sel) {
                if (sel.includes('.piece')) {
                    return this.children.filter(c => c.classList.contains('piece'));
                }
                if (sel.includes('.unit')) {
                    return this.children.filter(c => c.classList.contains('unit'));
                }
                return [];
            },
            querySelector(sel) {
                if (sel === 'span') return createElement('span');
                return null;
            },
            replaceChildren(...nodes) { this.children = nodes; },
            setAttribute(k, v) { this[k] = v; },
            getAttribute(k) { return this[k]; },
            addEventListener() {},
            getBoundingClientRect() { return { width: 800, height: 600, top: 0, left: 0 }; }
        };
        return el;
    };

    const getOrCreateEl = (id) => {
        if (!elements[id]) {
            elements[id] = createElement('div');
            elements[id].id = id;
        }
        return elements[id];
    };

    const expectedIds = [
        'game-table', 'landing-screen', 'container', 'player-role-badge',
        'room-code-text', 'network-status', 'room-code-area', 'toggle-room-code-btn',
        'draft-notice-banner', 'draft-notice-text', 'bidding-zone', 'turn-zone',
        'bid-input-wrap', 'bid-locked-wrap', 'my-locked-bid-val', 'my-bid-input',
        'opponent-status-dot', 'opponent-bid-text', 'reveal-bids-btn', 'table-container',
        'command-tokens-zone', 'active-games-list', 'landing-active-games',
        'dice-count', 'dice-values', 'measure-line', 'measure-text', 'piece-controls',
        'unit-tooltip', 'stats-panel', 'range-ring', 'terrain-card', 'right-sidebar',
        'right-sidebar-toggle', 'fullscreen-btn', 'turn-indicator-badge', 'pass-turn-btn',
        'my-role-label', 'opp-role-label', 'mt-badge-wrap', 'your-command-tray', 'opp-command-tray'
    ];
    expectedIds.forEach(id => getOrCreateEl(id));

    global.window = {
        addEventListener() {},
        location: { origin: 'http://localhost:8000', pathname: '/', search: '' },
        innerWidth: 1200,
        innerHeight: 800
    };
    global.document = {
        getElementById: (id) => getOrCreateEl(id),
        createElement: (tag) => createElement(tag),
        querySelectorAll: () => [],
        addEventListener() {},
        fonts: { ready: Promise.resolve() }
    };
    global.localStorage = {
        _store: {},
        getItem(k) { return this._store[k] || null; },
        setItem(k, v) { this._store[k] = String(v); },
        removeItem(k) { delete this._store[k]; }
    };
    global.navigator = { clipboard: { writeText: () => Promise.resolve() } };
    global.requestAnimationFrame = (cb) => { cb(); return 1; };
    global.cancelAnimationFrame = () => {};
    global.Papa = { parse: () => {} };

    const CommandTracker = require('../command-tracker');
    global.CommandTracker = CommandTracker;

    const appCode = fs.readFileSync('app.js', 'utf8');
    const fn = new Function(appCode);
    fn();

    // Start a hosted game
    global.window.hostGameFromLanding();
    const tableEl = elements['game-table'];
    const units = tableEl.children.filter(c => c.classList.contains('unit'));
    assert.ok(units.length > 0, 'Should have units on table');

    const testUnit = units[0];
    const unitId = testUnit.dataset.unitId;
    assert.ok(unitId, 'Unit must have a unitId');

    // 1. Simulate incoming PIECE_DRAG_START from opponent
    global.window.handlePeerData({
        type: 'PIECE_DRAG_START',
        pieceId: unitId,
        x: 100,
        y: 150
    });
    assert.ok(testUnit.classList.contains('is-remote-moving'), 'Unit should have is-remote-moving class during drag');
    assert.equal(testUnit.style.left, '100px');
    assert.equal(testUnit.style.top, '150px');

    // 2. Simulate incoming real-time movement PIECE_DRAG_MOVE
    global.window.handlePeerData({
        type: 'PIECE_DRAG_MOVE',
        pieceId: unitId,
        x: 240,
        y: 310
    });
    assert.equal(testUnit.style.left, '240px', 'Unit left position should update in real time');
    assert.equal(testUnit.style.top, '310px', 'Unit top position should update in real time');
    assert.ok(testUnit.classList.contains('is-remote-moving'), 'Unit should still have is-remote-moving class');

    // 3. Simulate incoming PIECE_DRAG_END
    global.window.handlePeerData({
        type: 'PIECE_DRAG_END',
        pieceId: unitId,
        x: 250,
        y: 320
    });
    assert.equal(testUnit.style.left, '250px');
    assert.equal(testUnit.style.top, '320px');
    assert.ok(!testUnit.classList.contains('is-remote-moving'), 'is-remote-moving class should be removed on drag end');

    // 4. Simulate incoming real-time rotation PIECE_ROTATE
    global.window.handlePeerData({
        type: 'PIECE_ROTATE',
        pieceId: unitId,
        angle: 45
    });
    assert.equal(testUnit.dataset.angle, 45, 'Unit angle dataset should update in real time');
    assert.equal(testUnit.style.transform, 'rotate(45deg)', 'Unit transform should rotate in real time');
    assert.ok(testUnit.classList.contains('is-remote-rotating'), 'Unit should have is-remote-rotating class');

    // 5. Simulate incoming PIECE_ROTATE_END
    global.window.handlePeerData({
        type: 'PIECE_ROTATE_END',
        pieceId: unitId,
        angle: 90
    });
    assert.equal(testUnit.dataset.angle, 90);
    assert.equal(testUnit.style.transform, 'rotate(90deg)');
    assert.ok(!testUnit.classList.contains('is-remote-rotating'), 'is-remote-rotating class should be removed on rotation end');

    // 6. Verify Sandbox Bidding: reveal button becomes active as soon as local bid is locked when solo
    const revealBtn = elements['reveal-bids-btn'];
    assert.ok(revealBtn.disabled, 'Reveal button disabled initially before local bid is set');

    // Lock local bid
    global.window.lockLocalBid();
    assert.equal(revealBtn.disabled, false, 'Reveal button should be enabled in solo/sandbox once local bid is set');

    // Click reveal bids
    global.window.triggerRevealBids();
    assert.equal(global.window.getBiddingState().revealed, true, 'Bidding state should be revealed');
    assert.equal(elements['bidding-zone'].style.display, 'none', 'Bidding zone hides when revealed');
    assert.equal(elements['turn-zone'].style.display, 'flex', 'Turn zone displays when revealed');

    console.log('Real-time unit movement and rotation test passed completely!');
});
