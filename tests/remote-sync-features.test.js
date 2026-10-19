const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Remote sync, piece IDs, board flip, and responsive layout features', () => {
    // Mock minimal DOM environment
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
            insertBefore(newNode, refNode) {
                const idx = this.children.indexOf(refNode);
                if (idx !== -1) this.children.splice(idx, 0, newNode);
                else this.children.push(newNode);
                newNode.parentElement = this;
                return newNode;
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
                        if (sel === '.piece' && child.classList.contains('piece')) results.push(child);
                        else if (sel === '.unit' && child.classList.contains('unit')) results.push(child);
                        else if (sel === '.terrain' && child.classList.contains('terrain')) results.push(child);
                        else if (sel === '.unit-label' && child.classList.contains('unit-label')) results.push(child);
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
            setAttribute(k, v) { this[k] = String(v); },
            getAttribute(k) { return this[k] ?? null; },
            removeAttribute(k) { delete this[k]; },
            addEventListener() {},
            removeEventListener() {},
            getBoundingClientRect() {
                return {
                    width: parseFloat(this.style.width) || 900,
                    height: parseFloat(this.style.height) || 600,
                    top: 0,
                    left: 0,
                    right: parseFloat(this.style.width) || 900,
                    bottom: parseFloat(this.style.height) || 600
                };
            },
            cloneNode(deep) {
                const clone = createElement(this.tagName);
                clone.style = { ...this.style };
                clone.dataset = { ...this.dataset };
                classListSet.forEach(c => clone.classList.add(c));
                return clone;
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

    const requiredIds = [
        'container', 'left-sidebar', 'right-sidebar', 'table-container', 'game-table',
        'ui-layer', 'measure-line', 'measure-text', 'remote-measure-line', 'remote-measure-text',
        'unit-tooltip', 'angle-indicator', 'remote-angle-indicator', 'piece-controls',
        'multiplayer-panel', 'multiplayer-toggle', 'status-indicator', 'host-btn', 'my-id-display',
        'copy-btn', 'join-input', 'join-btn', 'starting-pool-count', 'round-panel', 'round-title',
        'round-status', 'command-windows', 'command-totals', 'tracker-bids', 'opponent-status',
        'label-p1', 'label-p2', 'cp1', 'cp2', 'subtext-p1', 'subtext-p2', 'toggle-bids-btn',
        'first-tie-field', 'first-tie-player', 'round-action-btn', 'pass-command-btn',
        'army-assignment', 'army-roster', 'command-feedback', 'fullscreen-btn',
        'matchup-analysis-btn', 'matchup-modal', 'matchup-results', 'rulebook-modal',
        'controls-modal', 'controls-help-btn', 'dice-section', 'terrain-section',
        'terrain-card', 'terrain-card-title', 'terrain-card-note', 'dice-count', 'dice-roll-card',
        'dice-values', 'dice-btn', 'stats-panel', 'stats-content', 'right-sidebar-toggle'
    ];
    requiredIds.forEach(id => getOrCreateEl(id));

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
    };

    // Load app.js
    const appCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    const fn = new Function(appCode);
    fn();

    const {
        isBoardFlipped, fitTableToScreen, joinGame, getTablePointerPosition,
        createUnitDOM, createTerrainDOM, getPieceId, findPieceById,
        getBoardState, restoreBoardState, handleIncomingData
    } = global.window;

    const tableEl = elements['game-table'];
    const containerEl = elements['container'];
    const leftSidebar = elements['left-sidebar'];
    const rightSidebar = elements['right-sidebar'];

    // 1. Initial State: Single player / Host perspective
    assert.equal(typeof isBoardFlipped, 'function', 'isBoardFlipped must be defined as a function');
    assert.equal(isBoardFlipped(), false, 'Single player should not be flipped');
    fitTableToScreen();
    assert.equal(tableEl.classList.contains('is-flipped'), false, 'Table should not have is-flipped class initially');
    assert.doesNotMatch(tableEl.style.transform || '', /rotate\(180deg\)/, 'Table transform must not have rotate(180deg)');

    // 2. Challenger Flip
    elements['join-input'].value = 'TEST_HOST';
    joinGame();
    assert.equal(isBoardFlipped(), true, 'Joining as guest must set isBoardFlipped to true');
    assert.equal(tableEl.classList.contains('is-flipped'), true, 'Challenger table must have is-flipped class');
    assert.match(tableEl.style.transform, /rotate\(180deg\)/, 'Challenger table must have rotate(180deg)');

    // 3. Pointer Coordinate Inversion when flipped
    tableEl.getBoundingClientRect = () => ({
        left: 100,
        top: 50,
        right: 1900,
        bottom: 1250,
        width: 1800,
        height: 1200
    });
    fitTableToScreen();
    // With scale = 1, pointer at screen clientX = 1900 (right edge) maps to internal table x = 0
    // and pointer at screen clientY = 1250 (bottom edge) maps to internal table y = 0
    const pt1 = getTablePointerPosition({ clientX: 1900, clientY: 1250 });
    assert.equal(Math.round(pt1.x), 0, 'Inverted coordinate right edge should be internal 0');
    assert.equal(Math.round(pt1.y), 0, 'Inverted coordinate bottom edge should be internal 0');

    // Pointer at screen clientX = 100 (left edge) maps to internal table width (tableWidthPx)
    const pt2 = getTablePointerPosition({ clientX: 100, clientY: 50 });
    assert.ok(Math.abs(pt2.x - 2175) < 2, 'Inverted coordinate left edge should be internal table width (tableWidthPx)');
    assert.ok(pt2.y > 0, 'Inverted coordinate top edge should be positive in internal table space');

    // 4. Piece IDs and Serialization
    const unit1 = createUnitDOM('Spearmen', '#2563eb', 200, 300, 45, 0);
    assert.ok(unit1.dataset.unitId, 'createUnitDOM must assign a unitId dataset');
    const assignedUnitId = unit1.dataset.unitId;

    const terrain1 = createTerrainDOM('forest', 400, 500, 100, 100, 90);
    assert.ok(terrain1.dataset.pieceId, 'createTerrainDOM must assign a pieceId dataset');
    const assignedPieceId = terrain1.dataset.pieceId;

    assert.equal(getPieceId(unit1), assignedUnitId);
    assert.equal(getPieceId(terrain1), assignedPieceId);
    assert.equal(findPieceById(assignedUnitId), unit1);
    assert.equal(findPieceById(assignedPieceId), terrain1);

    const serializedState = JSON.parse(getBoardState());
    const unitInState = serializedState.pieces.find(p => p.type === 'unit');
    const terrainInState = serializedState.pieces.find(p => p.type === 'terrain');
    assert.equal(unitInState.unitId, assignedUnitId, 'Serialized state must preserve unitId');
    assert.equal(terrainInState.pieceId, assignedPieceId, 'Serialized state must preserve pieceId');

    // Restore state and verify IDs are reattached
    restoreBoardState(JSON.stringify(serializedState));
    const restoredUnit = tableEl.querySelector('.unit');
    const restoredTerrain = tableEl.querySelector('.terrain');
    assert.equal(restoredUnit.dataset.unitId, assignedUnitId, 'Restored unit must have identical unitId');
    assert.equal(restoredTerrain.dataset.pieceId, assignedPieceId, 'Restored terrain must have identical pieceId');

    // 5. Remote movement and rotation handling
    handleIncomingData({
        type: 'PIECE_DRAG_START',
        pieceId: assignedUnitId,
        x: 250,
        y: 350,
        anchorX: 200,
        anchorY: 300
    });
    assert.equal(restoredUnit.classList.contains('is-remote-moving'), true, 'Piece must have is-remote-moving class during drag');
    assert.equal(restoredUnit.style.left, '250px');
    assert.equal(restoredUnit.style.top, '350px');
    const remoteLine = elements['remote-measure-line'];
    assert.equal(Number(remoteLine.style.opacity), 1, 'Remote measure line must be visible');

    handleIncomingData({
        type: 'PIECE_DRAG_MOVE',
        pieceId: assignedUnitId,
        x: 300,
        y: 400,
        anchorX: 200,
        anchorY: 300,
        targetX: 300,
        targetY: 400
    });
    assert.equal(restoredUnit.style.left, '300px');
    assert.equal(restoredUnit.style.top, '400px');

    handleIncomingData({
        type: 'PIECE_DRAG_END',
        pieceId: assignedUnitId,
        x: 300,
        y: 400
    });
    assert.equal(restoredUnit.classList.contains('is-remote-moving'), false, 'Piece must not have is-remote-moving class after drag ends');
    assert.equal(Number(remoteLine.style.opacity), 0, 'Remote measure line must be hidden after drag ends');

    // Remote rotation
    handleIncomingData({
        type: 'PIECE_ROTATE',
        pieceId: assignedUnitId,
        angle: 120,
        delta: 75
    });
    assert.equal(restoredUnit.classList.contains('is-remote-rotating'), true);
    assert.equal(restoredUnit.dataset.angle, '120');
    assert.equal(restoredUnit.style.transform, 'rotate(120deg)');

    handleIncomingData({
        type: 'PIECE_ROTATE_END',
        pieceId: assignedUnitId,
        angle: 120
    });
    assert.equal(restoredUnit.classList.contains('is-remote-rotating'), false);

    // 6. Dynamic Left Sidebar Sizing
    containerEl.clientWidth = 1920;
    containerEl.clientHeight = 960;
    rightSidebar.offsetWidth = 210;
    rightSidebar.classList.remove('sidebar-hidden');

    fitTableToScreen();
    const widthWithRightSidebar = parseInt(leftSidebar.style.width, 10);
    assert.ok(widthWithRightSidebar >= 260, `Left sidebar should be >= 260px (got ${widthWithRightSidebar}px)`);

    // Hide right sidebar and verify left sidebar widens
    rightSidebar.classList.add('sidebar-hidden');
    fitTableToScreen();
    const widthWithoutRightSidebar = parseInt(leftSidebar.style.width, 10);
    assert.ok(widthWithoutRightSidebar > widthWithRightSidebar, 'Left sidebar must expand when right sidebar is hidden');
    assert.ok(widthWithoutRightSidebar <= 440, 'Left sidebar width must be capped at 440px');
});
