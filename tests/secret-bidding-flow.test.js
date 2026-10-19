const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Secret bidding flow: hidden at start, change and set, mutual reveal, and next round reset', () => {
    const elements = {};
    const createElement = (tag) => {
        const classListSet = new Set();
        const el = {
            tagName: tag.toUpperCase(),
            style: {},
            dataset: {},
            children: [],
            parentElement: null,
            classList: {
                add(...cls) { cls.forEach(c => classListSet.add(c)); },
                remove(...cls) { cls.forEach(c => classListSet.delete(c)); },
                toggle(c, force) {
                    if (force !== undefined) {
                        if (force) classListSet.add(c);
                        else classListSet.delete(c);
                        return force;
                    }
                    if (classListSet.has(c)) { classListSet.delete(c); return false; }
                    classListSet.add(c); return true;
                },
                contains(c) { return classListSet.has(c); }
            },
            appendChild(child) {
                this.children.push(child);
                child.parentElement = this;
                return child;
            },
            removeChild(child) {
                const idx = this.children.indexOf(child);
                if (idx !== -1) this.children.splice(idx, 1);
                child.parentElement = null;
                return child;
            },
            remove() {
                if (this.parentElement) {
                    this.parentElement.removeChild(this);
                }
            },
            querySelectorAll(sel) {
                const results = [];
                const search = (node) => {
                    for (const child of node.children) {
                        if (sel === '.unit' && child.classList.contains('unit')) results.push(child);
                        if (sel === '.terrain' && child.classList.contains('terrain')) results.push(child);
                        search(child);
                    }
                };
                search(this);
                return results;
            },
            querySelector(sel) {
                if (sel.startsWith('#')) return elements[sel.slice(1)] || null;
                if (sel.startsWith('[data-bid-player="')) {
                    const player = sel.match(/data-bid-player="([^"]+)"/)[1];
                    return elements[`field-${player}`] || null;
                }
                return null;
            },
            setAttribute(k, v) { this[k] = String(v); },
            getAttribute(k) { return this[k] ?? null; },
            removeAttribute(k) { delete this[k]; },
            addEventListener() {},
            removeEventListener() {},
            replaceChildren(...nodes) {
                this.children = [];
                nodes.forEach(n => this.appendChild(n));
            }
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

    const allIds = [
        'landing-screen', 'landing-card', 'landing-host-btn', 'landing-join-code', 'landing-join-btn',
        'landing-solo-btn', 'landing-active-games', 'active-games-list', 'starting-pool-count',
        'container', 'left-sidebar', 'right-sidebar', 'table-container', 'game-table',
        'ui-layer', 'measure-line', 'measure-text', 'remote-measure-line', 'remote-measure-text',
        'unit-tooltip', 'angle-indicator', 'remote-angle-indicator', 'piece-controls',
        'player-banner', 'player-role-badge', 'toggle-room-code-btn', 'room-code-area', 'room-code-badge',
        'room-code-text', 'copy-room-link-btn', 'network-status', 'exit-game-btn',
        'round-panel', 'round-title', 'round-status', 'command-windows', 'command-totals', 'tracker-bids',
        'opponent-status', 'label-p1', 'label-p2', 'cp1', 'cp2', 'subtext-p1', 'subtext-p2', 'toggle-bids-btn',
        'btn-set-p1', 'btn-set-p2',
        'first-tie-field', 'first-tie-player', 'round-action-btn', 'pass-command-btn',
        'army-assignment', 'army-roster', 'command-feedback', 'fullscreen-btn',
        'matchup-analysis-btn', 'matchup-modal', 'matchup-results', 'rulebook-modal',
        'controls-modal', 'controls-help-btn', 'dice-section', 'terrain-section',
        'terrain-card', 'terrain-card-title', 'terrain-card-note', 'dice-count', 'dice-roll-card',
        'dice-values', 'dice-btn', 'stats-panel', 'stats-content', 'right-sidebar-toggle',
        'multiplayer-panel', 'multiplayer-toggle', 'status-indicator', 'host-btn', 'my-id-display',
        'copy-btn', 'join-input', 'join-btn'
    ];
    allIds.forEach(id => getOrCreateEl(id));

    // Field wrapper elements for data-bid-player
    elements['field-p1'] = createElement('div');
    elements['field-p1'].dataset.bidPlayer = 'p1';
    elements['field-p2'] = createElement('div');
    elements['field-p2'].dataset.bidPlayer = 'p2';

    elements['cp1'].value = '1';
    elements['cp2'].value = '1';
    elements['dice-count'].value = '2';
    elements['starting-pool-count'].value = '12';

    let lastSentMessage = null;
    const mockConn = {
        open: true,
        send(data) {
            lastSentMessage = data;
        },
        close() {}
    };

    global.window = {
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({ matches: false }),
        innerWidth: 1920,
        innerHeight: 1080
    };
    global.document = {
        documentElement: { requestFullscreen() {} },
        getElementById: (id) => getOrCreateEl(id),
        querySelector: (sel) => {
            if (sel.startsWith('#')) return getOrCreateEl(sel.slice(1));
            if (sel.startsWith('[data-bid-player="')) {
                const player = sel.match(/data-bid-player="([^"]+)"/)[1];
                return elements[`field-${player}`] || null;
            }
            return createElement('div');
        },
        querySelectorAll: (sel) => {
            if (sel === '.unit') return elements['game-table'].querySelectorAll('.unit');
            if (sel === '.terrain') return elements['game-table'].querySelectorAll('.terrain');
            return [];
        },
        createElement: (tag) => createElement(tag),
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
    global.CommandTracker = require('../command-tracker');
    global.Peer = class MockPeer {
        constructor() { this.on = () => {}; }
        connect() { return mockConn; }
        destroy() {}
    };

    // Load app.js
    const appCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    const fn = new Function(appCode);
    fn();

    const {
        playSoloFromLanding, hostGameFromLanding, joinGameFromLanding,
        toggleSetBid, triggerRevealBids, handleIncomingData,
        advanceRound
    } = global.window;

    const btnSetP1 = elements['btn-set-p1'];
    const btnSetP2 = elements['btn-set-p2'];
    const toggleBidsBtn = elements['toggle-bids-btn'];
    const cp1 = elements['cp1'];
    const cp2 = elements['cp2'];
    const fieldP1 = elements['field-p1'];
    const fieldP2 = elements['field-p2'];
    const terrainSection = elements['terrain-section'];

    // --- TEST 1: Solo/Local pass-and-play flow ---
    playSoloFromLanding();

    // 1. Both bids start hidden and unset
    assert.equal(global.window.bidVisibility.p1, false);
    assert.equal(global.window.bidVisibility.p2, false);
    assert.equal(global.window.bidsSet.p1, false);
    assert.equal(global.window.bidsSet.p2, false);
    assert.equal(toggleBidsBtn.disabled, true);
    assert.equal(btnSetP1.textContent, 'Set');
    assert.equal(btnSetP2.textContent, 'Set');

    // 2. Change P1 bid and click Set
    cp1.value = '3';
    toggleSetBid('p1');
    assert.equal(global.window.bidsSet.p1, true);
    assert.equal(btnSetP1.textContent, 'Edit');
    assert.equal(cp1.readOnly, true);
    assert.equal(fieldP1.classList.contains('bid-hidden'), true, 'In local mode, set bid is masked from opponent');
    assert.equal(toggleBidsBtn.disabled, true, 'Cannot reveal until both are set');

    // 3. Edit P1 bid
    toggleSetBid('p1');
    assert.equal(global.window.bidsSet.p1, false);
    assert.equal(btnSetP1.textContent, 'Set');
    assert.equal(cp1.readOnly, false);
    assert.equal(fieldP1.classList.contains('bid-hidden'), false);

    // 4. Set P1 to 5 and P2 to 2
    cp1.value = '5';
    toggleSetBid('p1');
    cp2.value = '2';
    toggleSetBid('p2');
    assert.equal(global.window.bidsSet.p1, true);
    assert.equal(global.window.bidsSet.p2, true);
    assert.equal(toggleBidsBtn.disabled, false, 'Reveal Bids enables once both are set');
    assert.ok(toggleBidsBtn.className.includes('btn-gold'));

    // 5. Reveal bids
    triggerRevealBids();
    assert.equal(global.window.bidVisibility.p1, true);
    assert.equal(global.window.bidVisibility.p2, true);
    assert.equal(fieldP1.classList.contains('bid-hidden'), false, 'Bids are unmasked on reveal');
    assert.equal(fieldP2.classList.contains('bid-hidden'), false, 'Bids are unmasked on reveal');
    assert.equal(toggleBidsBtn.innerText, 'Bids Revealed');
    assert.equal(terrainSection.style.display, 'none', 'Terrain deck is hidden after bids revealed');

    // 6. Round reset at start of next round
    global.window.roundState.phase = 'complete';
    advanceRound();
    assert.equal(global.window.bidVisibility.p1, false, 'Bids must be hidden at start of new round');
    assert.equal(global.window.bidVisibility.p2, false, 'Bids must be hidden at start of new round');
    assert.equal(global.window.bidsSet.p1, false, 'Bids must be unset at start of new round');
    assert.equal(global.window.bidsSet.p2, false, 'Bids must be unset at start of new round');
    assert.equal(toggleBidsBtn.disabled, true, 'Reveal Bids disabled at start of new round');
    assert.equal(btnSetP1.textContent, 'Set');
    assert.equal(btnSetP2.textContent, 'Set');
    assert.equal(cp1.readOnly, false);
    assert.equal(cp2.readOnly, false);

    // --- TEST 2: Multiplayer Host vs Challenger sync ---
    hostGameFromLanding();
    // Host is P1
    assert.equal(btnSetP2.style.display, 'none', 'Opponent Set button must not be visible to host');
    assert.equal(btnSetP1.textContent, 'Set');
    assert.equal(fieldP2.classList.contains('bid-hidden'), true, 'Opponent bid must be hidden from host');
    assert.equal(toggleBidsBtn.disabled, true);

    // Host sets bid
    cp1.value = '4';
    toggleSetBid('p1');
    assert.equal(global.window.bidsSet.p1, true);
    assert.equal(btnSetP1.textContent, 'Edit');
    assert.equal(toggleBidsBtn.disabled, true, 'Reveal Bids disabled while waiting for opponent');

    // Opponent sends BID_SET
    handleIncomingData({
        type: 'BID_SET',
        player: 'p2',
        isSet: true,
        bid: '3'
    });
    assert.equal(global.window.bidsSet.p2, true);
    assert.equal(toggleBidsBtn.disabled, false, 'Reveal Bids enabled now that both have set');

    // Opponent triggers REVEAL_BIDS
    handleIncomingData({
        type: 'REVEAL_BIDS',
        player: 'p2',
        bid: '3'
    });
    assert.equal(global.window.bidVisibility.p1, true);
    assert.equal(global.window.bidVisibility.p2, true);
    assert.equal(cp2.value, '3', 'Opponent bid value revealed in input');
    assert.equal(fieldP2.classList.contains('bid-hidden'), false);
    assert.equal(toggleBidsBtn.innerText, 'Bids Revealed');

    // --- TEST 3: Structural verification and restoreBoardState defaults ---
    const htmlContent = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    assert.ok(!htmlContent.includes('bid-input-wrap'), 'Obsolete horizontal flex wrapper bid-input-wrap must be removed');
    assert.ok(htmlContent.includes('class="bid-input-box"'), 'bid-input-box must wrap input directly');

    // Verify restoreBoardState defaults bids to false when uninitialized
    global.window.restoreBoardState(JSON.stringify({ pieces: [] }), true);
    assert.equal(global.window.bidVisibility.p1, false, 'Uninitialized restoreBoardState must default p1 to hidden');
    assert.equal(global.window.bidVisibility.p2, false, 'Uninitialized restoreBoardState must default p2 to hidden');
});
