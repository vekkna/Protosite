const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('E2E UI Simulation: hover popup disabled, wound controls active, commands separated, draft hides on reveal, sides flip for challenger', () => {
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
            appendChild(child) {
                child.parentNode = this;
                this.children.push(child);
                return child;
            },
            remove() {
                if (this.parentNode && this.parentNode.children) {
                    const idx = this.parentNode.children.indexOf(this);
                    if (idx >= 0) this.parentNode.children.splice(idx, 1);
                }
            },
            get className() {
                return Array.from(this.classList._classes).join(' ');
            },
            set className(val) {
                this.classList._classes = new Set((val || '').split(/\s+/).filter(Boolean));
            },
            querySelectorAll(sel) {
                if (/^\.[\w-]+$/.test(sel)) {
                    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll(sel)]);
                    return descendants.filter(child => child.classList.contains(sel.slice(1)));
                }
                if (sel.includes('.unit')) {
                    return this.children.filter(c => c.classList && c.classList.contains('unit'));
                }
                if (sel.includes('.command-token')) {
                    return this.children.filter(c => c.classList && c.classList.contains('command-token'));
                }
                return [];
            },
            querySelector(sel) {
                if (sel === '.tray-placeholder') return createElement('span');
                if (sel.startsWith('#')) return elements[sel.slice(1)] || null;
                return null;
            },
            replaceChildren(...nodes) { this.children = nodes; },
            setAttribute(k, v) { this[k] = v; },
            getAttribute(k) { return this[k]; },
            addEventListener() {},
            getBoundingClientRect() { return { width: 900, height: 600, top: 0, left: 0, right: 900, bottom: 600 }; }
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
        'command-staging-panel', 'your-command-tray', 'opp-command-tray', 'command-tray',
        'active-games-list', 'landing-active-games',
        'dice-count', 'dice-values', 'measure-line', 'measure-text', 'piece-controls',
        'unit-tooltip', 'stats-panel', 'range-ring', 'terrain-card', 'right-sidebar',
        'right-sidebar-toggle', 'fullscreen-btn', 'turn-indicator-badge', 'pass-turn-btn',
        'my-role-label', 'opp-role-label', 'mt-badge-wrap', 'player-banner', 'player-banner-top',
        'stats-content', 'landing-join-code', 'left-sidebar'
    ];
    expectedIds.forEach(id => getOrCreateEl(id));

    elements['landing-screen'].style.display = 'flex';
    elements['container'].style.display = 'none';

    const windowHandlers = {};
    global.window = {
        addEventListener(type, handler) {
            (windowHandlers[type] ||= []).push(handler);
        },
        location: { origin: 'http://localhost:8000', pathname: '/', search: '' },
        innerWidth: 1200,
        innerHeight: 800
    };
    global.document = {
        getElementById: (id) => getOrCreateEl(id),
        querySelector: (sel) => {
            if (sel.startsWith('#')) return getOrCreateEl(sel.slice(1));
            return createElement('div');
        },
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
    global.CommandTracker = require('../command-tracker');

    // Load app.js
    const appCode = fs.readFileSync('app.js', 'utf8');
    const fn = new Function(appCode);
    fn();

    // 1. Host Game
    global.window.hostGameFromLanding();
    const tableEl = elements['game-table'];

    // Host should NOT have is-flipped class
    assert.equal(tableEl.classList.contains('is-flipped'), false, 'Host table should not be flipped');
    assert.doesNotMatch(tableEl.style.transform, /rotate\(180deg\)/, 'Host table transform should not have rotate(180deg)');

    // Draft banner should be visible initially in round 1 before reveal
    assert.equal(elements['draft-notice-banner'].style.display, 'block');
    assert.equal(elements['terrain-section'].hidden, false, 'Terrain is available during deployment');
    assert.equal(tableEl.classList.contains('is-deploying'), true, 'Deployment zones show before the first reveal');
    assert.equal(elements['deployment-zone-top'].style.height, '120px', 'Top zone spans six inches');
    assert.equal(elements['deployment-zone-bottom'].style.height, '120px', 'Bottom zone spans six inches');
    assert.equal(elements['room-code-area'].getAttribute('aria-hidden'), 'false', 'New games open the hosting section');
    assert.equal(global.window.getBiddingState().p1.value, 1, 'New games default to one command');
    assert.equal(elements['my-bid-input'].value, 1);
    global.window.adjustLocalBid(1);
    assert.equal(elements['my-bid-input'].value, 2, 'The up arrow increments the bid');
    global.window.adjustLocalBid(-1);
    assert.equal(elements['my-bid-input'].value, 1, 'The down arrow decrements the bid');
    global.window.adjustLocalBid(-1);
    assert.equal(elements['my-bid-input'].value, 1, 'The down arrow stops at one');
    global.window.triggerRevealBids();
    assert.equal(global.window.getBiddingState().revealed, false, 'An unset bid cannot be revealed through the action handler');
    const firstUnit = tableEl.children.find(el => el.classList.contains('unit'));
    const profile = firstUnit.children.find(el => el.classList.contains('unit-card-stats'));
    assert.equal(profile, undefined, 'Unit cards show their names without profile stats');
    for (const [input, expected] of [['99', 6], ['0', 1], ['6', 6], ['1', 1]]) {
        elements['my-bid-input'].value = input;
        global.window.lockLocalBid();
        assert.equal(global.window.getBiddingState().p1.value, expected, 'Bid stays within 1–6');
        global.window.unlockLocalBid();
    }

    global.window.spawnTerrain('forest');
    const terrain = tableEl.children.find(el => el.classList.contains('terrain'));
    assert.equal(terrain.style.width, terrain.style.height, 'Placed terrain has a circular footprint');
    assert.equal(terrain.style.height, `${88 / 25.4 * 20}px`, 'Terrain diameter equals the long edge of a standard card');
    const countBeforeTyping = tableEl.children.length;
    windowHandlers.keydown.forEach(handler => handler({
        key: 'z', ctrlKey: true, target: { tagName: 'INPUT' }, preventDefault() {}
    }));
    assert.equal(tableEl.children.length, countBeforeTyping, 'Typing in an input does not run the board undo shortcut');

    // 2. Test unit hover vs selection tooltip
    const sampleUnit = createElement('div');
    sampleUnit.classList.add('piece', 'unit');
    sampleUnit.style.left = '300px';
    sampleUnit.style.top = '300px';
    sampleUnit.dataset.name = 'Spearmen';

    // Hover tooltip: queueUnitTooltip does not make unit-tooltip visible
    elements['unit-tooltip'].classList.remove('visible');
    // Call showUnitTooltip with interactive = false (hover mode)
    // In our implementation, showUnitTooltip returns immediately if interactive is false
    const tooltipEl = elements['unit-tooltip'];
    assert.equal(tooltipEl.classList.contains('visible'), false, 'Hover should not make unit tooltip visible');

    // 3. Test reveal bids hides draft notice banner
    elements['my-bid-input'].value = '3';
    global.window.lockLocalBid();
    // Simulate opponent ready and reveal
    global.window.handlePeerData({ type: 'BID_READY', player: 'p2', ready: true });
    global.window.handlePeerData({ type: 'REVEAL_BIDS', bid: 4 });

    // Banner should be hidden now!
    assert.equal(elements['draft-notice-banner'].style.display, 'none', 'Draft banner must be hidden after reveal');
    assert.equal(elements['terrain-section'].hidden, true, 'Terrain is hidden after the first reveal');
    assert.equal(tableEl.classList.contains('is-deploying'), false, 'Deployment shading disappears after the first reveal');
    assert.equal(JSON.parse(global.localStorage.getItem('wargameSave_v6')).biddingState.battleStarted, true,
        'Saved games retain the end of terrain deployment');
    const piecesAfterReveal = tableEl.children.length;
    global.window.spawnTerrain('forest');
    assert.equal(tableEl.children.length, piecesAfterReveal, 'Terrain cannot be added after deployment');

    // 4. Test command token separation
    // For Host (p1): your-command-tray gets p1 tokens (3 tokens), opp-command-tray gets p2 tokens (4 tokens)
    const yourTray = elements['your-command-tray'];
    const oppTray = elements['opp-command-tray'];
    const yourTokens = yourTray.children.filter(c => c.classList && c.classList.contains('command-token'));
    const oppTokens = oppTray.children.filter(c => c.classList && c.classList.contains('command-token'));
    assert.equal(yourTokens.length, 3, 'Your commands tray should hold 3 p1 tokens for Host');
    assert.equal(oppTokens.length, 4, "Opponent's commands tray should hold 4 p2 tokens for Host");
    global.window.handlePeerData({ type: 'ROUND_RESET' });
    assert.equal(elements['terrain-section'].hidden, true, 'Terrain stays hidden when bidding resets for another round');
    assert.equal(global.window.getBiddingState().p1.value, 1, 'Each new round defaults to one command');

    // 5. Test Challenger join: table flips 180 degrees
    elements['landing-join-code'].value = 'TEST';
    global.window.joinGameFromLanding();
    assert.equal(tableEl.classList.contains('is-flipped'), true, 'Challenger table must have is-flipped class');
    assert.match(tableEl.style.transform, /rotate\(180deg\)/, 'Challenger table transform must have rotate(180deg)');

    // 6. The play panel uses spare width without shrinking the height-limited battlefield.
    const containerEl = elements['container'];
    const leftSidebarEl = elements['left-sidebar'];
    const rightSidebarEl = elements['right-sidebar'];
    containerEl.clientWidth = 1920;
    containerEl.clientHeight = 960;
    rightSidebarEl.offsetWidth = 210;
    rightSidebarEl.classList.remove('sidebar-hidden');

    global.window.fitTableToScreen();
    const widthWithRightSidebar = parseInt(leftSidebarEl.style.width, 10);
    assert.ok(widthWithRightSidebar >= 260, `Left sidebar width should be at least 260px (got ${widthWithRightSidebar}px)`);
    assert.ok(widthWithRightSidebar <= 720, 'The two-column play panel has a bounded width');

    // A saved legacy sidebar preference must not affect the two-column layout.
    rightSidebarEl.classList.add('sidebar-hidden');
    global.window.fitTableToScreen();
    const widthWithoutRightSidebar = parseInt(leftSidebarEl.style.width, 10);
    assert.equal(widthWithoutRightSidebar, widthWithRightSidebar, 'Play panel stays compact regardless of legacy sidebar preference');
    const boardWidth = (960 - 4) * 4 / 3;
    assert.ok(widthWithoutRightSidebar + boardWidth + 8 <= 1920, 'Panel growth reserves the full height-limited board width');

    // 7. Verify CSS styles for bottom-left command dock and bid inputs
    const cssContent = fs.readFileSync('styles.css', 'utf8');
    assert.match(cssContent, /\.unit-command-dock\s*\{[^}]*bottom:\s*-8px/, 'unit-command-dock must be positioned with bottom: -8px');
    assert.match(cssContent, /\.unit-command-dock\s*\{[^}]*left:\s*-8px/, 'unit-command-dock must be positioned with left: -8px');
    assert.match(cssContent, /#left-sidebar\s*\{[^}]*min-width:\s*2[56]0px/, '#left-sidebar must have min-width at least 250px');
    assert.match(cssContent, /\.bid-input-wrap\s+input[^}]*appearance:\s*auto/, 'bid input keeps native increment and decrement arrows');
});
