const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('E2E Simulation: Clicking Host New Game transitions screen and spawns 12 units', () => {
    // Build minimal DOM environment
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

    // Prepopulate expected IDs from index.html
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
        'my-role-label', 'opp-role-label', 'mt-badge-wrap'
    ];
    expectedIds.forEach(id => getOrCreateEl(id));

    // Initial styles
    elements['landing-screen'].style.display = 'flex';
    elements['container'].style.display = 'none';

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

    // Load command tracker
    const CommandTracker = require('../command-tracker');
    global.CommandTracker = CommandTracker;

    // Load app.js code in this context
    const appCode = fs.readFileSync('app.js', 'utf8');
    const fn = new Function(appCode);
    fn();

    // Verify initial landing state
    assert.equal(elements['landing-screen'].style.display, 'flex');
    assert.equal(elements['container'].style.display, 'none');

    // Simulate clicking "Host New Game"
    try {
        global.window.hostGameFromLanding();
    } catch (e) {
        console.error('Error during hostGameFromLanding:', e);
    }

    // Verify UI switched immediately
    assert.equal(elements['landing-screen'].style.display, 'none', 'Landing screen should be hidden');
    assert.equal(elements['container'].style.display, 'flex', 'Container should be visible');

    // Verify draft units spawned on game-table
    const tableEl = elements['game-table'];
    console.log('tableEl.children count:', tableEl.children.length);
    const unitsOnTable = tableEl.children.filter(c => c.classList.contains('unit'));
    assert.equal(unitsOnTable.length, 12, 'Should spawn 12 units for the draft');

    // Verify player badge updated to Host (P1)
    assert.equal(elements['player-role-badge'].textContent, 'Player 1 (Host)');

    // Verify draft notice banner is visible
    assert.equal(elements['draft-notice-banner'].style.display, 'block');

    console.log('E2E simulation passed: Host New Game executed smoothly without errors!');
});
