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
                        else if (sel === '.rotation-handle' && child.classList.contains('rotation-handle')) results.push(child);
                        else if (sel === '.ring-hit' && child.classList.contains('ring-hit')) results.push(child);
                        else if (sel === '.ring-node' && child.classList.contains('ring-node')) results.push(child);
                        else if (sel === '.ring-glow' && child.classList.contains('ring-glow')) results.push(child);
                        else if (sel === '.ring-track' && child.classList.contains('ring-track')) results.push(child);
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
            closest(sel) {
                let cur = this;
                while (cur) {
                    if (sel === '.piece' && cur.classList && cur.classList.contains('piece')) return cur;
                    if (sel === '.unit' && cur.classList && cur.classList.contains('unit')) return cur;
                    if (sel.includes('.ring-hit') && cur.classList && cur.classList.contains('ring-hit')) return cur;
                    if (sel.includes('.ring-node') && cur.classList && cur.classList.contains('ring-node')) return cur;
                    cur = cur.parentElement;
                }
                return null;
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

        let _innerHTML = '';
        Object.defineProperty(el, 'innerHTML', {
            get() { return _innerHTML; },
            set(val) {
                _innerHTML = String(val);
                this.children = [];
                const regex = /<(\w+)[^>]*class="([^"]+)"[^>]*>/g;
                let match;
                while ((match = regex.exec(val)) !== null) {
                    const child = createElement(match[1]);
                    const classes = match[2].split(/\s+/).filter(Boolean);
                    child.classList.add(...classes);
                    this.appendChild(child);
                }
            }
        });

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
        'btn-set-p1', 'btn-set-p2',
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

    // 7. Enlarged Rotation Ring Sizing & Clearance
    const testUnit = createUnitDOM('Footmen', '#336699', 100, 100, 0, 0);
    tableEl.appendChild(testUnit);
    const unitW = parseFloat(testUnit.style.width) || 70;
    const unitH = parseFloat(testUnit.style.height) || 50;
    const unitHypot = Math.hypot(unitW, unitH);
    const handleEl = testUnit.querySelector('.rotation-handle');
    assert.ok(handleEl, 'Unit must have a rotation-handle element');
    const handleDiameter = parseFloat(handleEl.style.width);
    assert.ok(
        handleDiameter >= unitHypot + 60,
        `Handle diameter (${handleDiameter}px) must provide > 60px clearance over unit hypotenuse (${unitHypot.toFixed(1)}px)`
    );

    // Verify ring elements in SVG
    const ringHit = handleEl.querySelector('.ring-hit');
    assert.ok(ringHit, 'Handle must contain .ring-hit element');
    const ringNodes = handleEl.querySelectorAll('.ring-node');
    assert.equal(ringNodes.length, 4, 'Handle must contain 4 .ring-node compass elements');

    // 8. Event Separation: Unit Pressing vs Ring Touching
    testUnit.classList.add('is-selected');

    // (A) Pressing on unit body / handle container must NOT trigger rotation
    let pointerCaptured = false;
    let defaultPrevented = false;
    let propagationStopped = false;
    handleEl.setPointerCapture = () => { pointerCaptured = true; };

    const nonRingEvent = {
        isPrimary: true,
        button: 0,
        pointerId: 42,
        target: testUnit,
        currentTarget: handleEl,
        preventDefault() { defaultPrevented = true; },
        stopPropagation() { propagationStopped = true; }
    };

    window.onRotationHandlePointerDown(nonRingEvent);
    assert.equal(defaultPrevented, false, 'Pressing on unit must not preventDefault in rotation handler');
    assert.equal(propagationStopped, false, 'Pressing on unit must not stopPropagation in rotation handler');
    assert.equal(pointerCaptured, false, 'Pointer must not be captured for non-ring target');
    assert.equal(testUnit.classList.contains('is-rotating'), false, 'Piece must not be rotating');

    // (B) Pressing and dragging on the unit moves the unit (dragging state, NOT rotation)
    let piecePointerCaptured = false;
    testUnit.setPointerCapture = () => { piecePointerCaptured = true; };
    const unitPressEvent = {
        isPrimary: true,
        button: 0,
        pointerId: 43,
        clientX: 120,
        clientY: 110,
        currentTarget: testUnit,
        preventDefault() {},
        stopPropagation() {}
    };
    window.onPiecePointerDown(unitPressEvent);
    assert.equal(piecePointerCaptured, true, 'Unit must capture pointer on piece pointerdown for movement');

    // Move pointer beyond drag threshold
    window.handlePointerMove({
        pointerId: 43,
        clientX: 150,
        clientY: 140
    });
    assert.equal(testUnit.classList.contains('is-dragging'), true, 'Unit must enter is-dragging state on drag');
    assert.equal(testUnit.classList.contains('is-rotating'), false, 'Unit must NOT enter is-rotating state on unit drag');

    window.onPointerUp({ pointerId: 43 });
    assert.equal(testUnit.classList.contains('is-dragging'), false, 'Unit must exit is-dragging state after release');

    // (C) Touching the rotation ring (.ring-hit) initiates rotation
    defaultPrevented = false;
    propagationStopped = false;
    pointerCaptured = false;
    const ringTouchEvent = {
        isPrimary: true,
        button: 0,
        pointerId: 44,
        target: ringHit,
        currentTarget: handleEl,
        preventDefault() { defaultPrevented = true; },
        stopPropagation() { propagationStopped = true; }
    };

    window.onRotationHandlePointerDown(ringTouchEvent);
    assert.equal(defaultPrevented, true, 'Touching ring-hit must preventDefault');
    assert.equal(propagationStopped, true, 'Touching ring-hit must stopPropagation');
    assert.equal(pointerCaptured, true, 'Pointer must be captured on handle when touching ring-hit');
    assert.equal(testUnit.classList.contains('is-rotating'), true, 'Piece must enter is-rotating state');
    assert.equal(testUnit.classList.contains('is-dragging'), false, 'Piece must NOT enter is-dragging state when rotating');

    // Clean up rotation state via pointer up
    window.onPointerUp({ pointerId: 44 });
    assert.equal(testUnit.classList.contains('is-rotating'), false, 'Piece must exit is-rotating state on pointer up');
});
