const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Landing page flow, pool config, reset buttons removal, dice location, and terrain deck hide', () => {
    // 1. Verify index.html structure directly
    const htmlPath = path.join(__dirname, '../index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Verify Landing screen exists with host, join, solo, and starting pool
    assert.ok(htmlContent.includes('id="landing-screen"'), 'index.html must have #landing-screen');
    assert.ok(htmlContent.includes('id="starting-pool-count"'), 'index.html must have #starting-pool-count on the landing screen');
    assert.ok(htmlContent.includes('id="landing-host-btn"'), 'index.html must have #landing-host-btn');
    assert.ok(htmlContent.includes('id="landing-join-code"'), 'index.html must have #landing-join-code');
    assert.ok(htmlContent.includes('id="landing-join-btn"'), 'index.html must have #landing-join-btn');
    assert.ok(htmlContent.includes('id="landing-solo-btn"'), 'index.html must have #landing-solo-btn');

    // Verify player banner in left sidebar
    assert.ok(htmlContent.includes('id="player-banner"'), 'index.html must have #player-banner');
    assert.ok(htmlContent.includes('id="player-role-badge"'), 'index.html must have #player-role-badge');
    assert.ok(htmlContent.includes('id="exit-game-btn"'), 'index.html must have #exit-game-btn');

    // Verify reset buttons are NOT in the HTML sidebar
    assert.ok(!htmlContent.includes('Reset Board</button>'), 'Reset Board button must be removed from the sidebar');
    assert.ok(!htmlContent.includes('Reset Long Sides</button>'), 'Reset Long Sides button must be removed from the sidebar');

    // Verify dice section and terrain section are in right-sidebar
    const rightSidebarIdx = htmlContent.indexOf('id="right-sidebar"');
    const terrainIdx = htmlContent.indexOf('id="terrain-section"');
    const diceIdx = htmlContent.indexOf('id="dice-section"');
    assert.ok(rightSidebarIdx !== -1, 'Must have #right-sidebar');
    assert.ok(terrainIdx > rightSidebarIdx, '#terrain-section must be inside #right-sidebar');
    assert.ok(diceIdx > rightSidebarIdx, '#dice-section must be inside #right-sidebar');

    // 2. Setup mock DOM environment to test app.js behavior
    const elements = {};
    const classListSetMap = new Map();

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
                        else if (sel === '.terrain' && child.classList.contains('terrain')) results.push(child);
                        else if (sel === '.piece' && child.classList.contains('piece')) results.push(child);
                        search(child);
                    }
                };
                search(this);
                return results;
            },
            querySelector(sel) {
                if (sel.startsWith('#')) return elements[sel.slice(1)] || null;
                const matches = this.querySelectorAll(sel);
                return matches.length ? matches[0] : null;
            },
            replaceChildren(...nodes) {
                this.children = [];
                nodes.forEach(n => this.appendChild(n));
            },
            closest() { return null; },
            setAttribute(k, v) { this[k] = String(v); },
            getAttribute(k) { return this[k] ?? null; },
            removeAttribute(k) { delete this[k]; },
            addEventListener() {},
            removeEventListener() {},
            getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }; }
        };
        classListSetMap.set(el, classListSet);
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

    // Input defaults
    elements['starting-pool-count'].value = '12';
    elements['dice-count'].value = '2';
    elements['cp1'].value = '2';
    elements['cp2'].value = '3';

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
            return createElement('div');
        },
        querySelectorAll: (sel) => {
            if (sel === '.unit') return elements['game-table'].querySelectorAll('.unit');
            if (sel === '.terrain') return elements['game-table'].querySelectorAll('.terrain');
            if (sel === '.piece') return elements['game-table'].querySelectorAll('.piece');
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
        connect() { return { on() {}, send() {}, close() {} }; }
        destroy() {}
    };

    // Load app.js
    const appCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    const fn = new Function(appCode);
    fn();

    const {
        hostGameFromLanding, joinGameFromLanding, playSoloFromLanding,
        exitToLanding, isBoardFlipped, toggleBidVisibility, updateTerrainSectionVisibility,
        toggleSetBid, setBid, editBid, triggerRevealBids, advanceRound
    } = global.window;

    const landingScreen = elements['landing-screen'];
    const container = elements['container'];
    const roleBadge = elements['player-role-badge'];
    const terrainSection = elements['terrain-section'];
    const btnSetP1 = elements['btn-set-p1'];
    const btnSetP2 = elements['btn-set-p2'];
    const toggleBidsBtn = elements['toggle-bids-btn'];

    // 3. Test Host Battle from Landing Page
    hostGameFromLanding();
    assert.equal(landingScreen.style.display, 'none', 'Landing screen must be hidden after hosting');
    assert.equal(container.style.display, 'flex', 'Container must be visible after hosting');
    assert.equal(isBoardFlipped(), false, 'Host board must not be flipped');
    assert.ok(roleBadge.textContent.includes('Player 1'), 'Role badge must be Player 1 for host');

    // 4. Test Exit to Menu / Landing
    exitToLanding();
    assert.equal(container.style.display, 'none', 'Container must be hidden after exit');
    assert.equal(landingScreen.style.display, 'flex', 'Landing screen must be visible after exit');

    // 5. Test Play Solo / Local from Landing
    playSoloFromLanding();
    assert.equal(landingScreen.style.display, 'none', 'Landing screen must be hidden in solo mode');
    assert.equal(container.style.display, 'flex', 'Container must be visible in solo mode');
    assert.equal(isBoardFlipped(), false, 'Solo board must not be flipped');
    assert.ok(roleBadge.textContent.includes('Local Sandbox'), 'Role badge must show Local Sandbox');

    // 6. Test Join Battle from Landing Page
    elements['landing-join-code'].value = 'ABCD';
    joinGameFromLanding();
    assert.equal(landingScreen.style.display, 'none', 'Landing screen must be hidden after joining');
    assert.equal(container.style.display, 'flex', 'Container must be visible after joining');
    assert.equal(isBoardFlipped(), true, 'Challenger board must be flipped');
    assert.ok(roleBadge.textContent.includes('Player 2'), 'Role badge must show Player 2');

    // 7. Test Start of round hidden bids, Set/Edit, and Reveal Bids workflow
    exitToLanding();
    playSoloFromLanding();

    // Initial state: both bids hidden and unset, Reveal Bids disabled
    assert.equal(btnSetP1.textContent, 'Set', 'P1 button should initially be Set');
    assert.equal(btnSetP2.textContent, 'Set', 'P2 button should initially be Set');
    assert.equal(toggleBidsBtn.disabled, true, 'Reveal Bids should be disabled when bids are not both set');
    assert.equal(toggleBidsBtn.innerText, 'Reveal Bids', 'Reveal Bids button text');

    // Change and Set P1 bid
    elements['cp1'].value = '3';
    toggleSetBid('p1');
    assert.equal(btnSetP1.textContent, 'Edit', 'P1 button should switch to Edit once set');
    assert.equal(elements['cp1'].readOnly, true, 'P1 input should be readOnly while set');
    assert.equal(toggleBidsBtn.disabled, true, 'Reveal Bids must remain disabled when only P1 has set');

    // Unlock and edit P1 bid
    toggleSetBid('p1');
    assert.equal(btnSetP1.textContent, 'Set', 'P1 button should switch back to Set when editing');
    assert.equal(elements['cp1'].readOnly, false, 'P1 input should become editable when editing');
    elements['cp1'].value = '4';
    toggleSetBid('p1');
    assert.equal(btnSetP1.textContent, 'Edit', 'P1 button should switch to Edit');

    // Change and Set P2 bid
    elements['cp2'].value = '2';
    toggleSetBid('p2');
    assert.equal(btnSetP2.textContent, 'Edit', 'P2 button should switch to Edit');
    assert.equal(elements['cp2'].readOnly, true, 'P2 input should be readOnly while set');

    // Both are set: Reveal Bids is enabled
    assert.equal(toggleBidsBtn.disabled, false, 'Reveal Bids should become enabled when both bids are set');
    assert.ok(toggleBidsBtn.className.includes('btn-gold'), 'Reveal Bids button should have btn-gold class when ready');

    // Terrain section before reveal should be visible
    updateTerrainSectionVisibility();
    assert.notEqual(terrainSection.style.display, 'none', 'Terrain deck should be visible before bids are revealed');

    // Trigger Reveal Bids
    triggerRevealBids();
    assert.equal(toggleBidsBtn.innerText, 'Bids Revealed', 'Button should indicate bids are revealed');
    assert.equal(terrainSection.style.display, 'none', 'Terrain deck must hide as soon as bids are revealed');

    // Test round advance resets bids to hidden and unset
    // Set round complete and advance
    const currentRoundState = global.window.roundState || {};
    currentRoundState.phase = 'complete';
    currentRoundState.round = 1;
    currentRoundState.master = 'p2';
    currentRoundState.firstTie = 'p2';
    currentRoundState.remaining = { p1: 0, p2: 0 };
    currentRoundState.army = { p1: 4, p2: 4 };
    currentRoundState.bids = { p1: 4, p2: 2 };
    advanceRound();

    // After advancing round, both bids must be hidden and unset, Reveal Bids disabled again
    assert.equal(toggleBidsBtn.disabled, true, 'Reveal Bids must be disabled at the start of the next round');
    assert.equal(toggleBidsBtn.innerText, 'Reveal Bids', 'Reveal Bids button text should reset');
    assert.equal(btnSetP1.textContent, 'Set', 'P1 button should reset to Set for the new round');
    assert.equal(btnSetP2.textContent, 'Set', 'P2 button should reset to Set for the new round');
    assert.equal(elements['cp1'].readOnly, false, 'P1 input should be editable at start of new round');
    assert.equal(elements['cp2'].readOnly, false, 'P2 input should be editable at start of new round');

    // 8. Test adjustPoolCount helper
    assert.equal(typeof global.window.adjustPoolCount, 'function');
    global.window.adjustPoolCount(2);
    assert.equal(elements['starting-pool-count'].value, 14);
    global.window.adjustPoolCount(-4);
    assert.equal(elements['starting-pool-count'].value, 10);
});
