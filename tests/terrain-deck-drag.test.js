const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');

function harness(deck = ['x', 'x', 'forest'], isHost = true) {
    const previews = [], terrain = [], snapshots = [];
    const status = { textContent: '' };
    const rect = { left: 300, top: 20, right: 1260, bottom: 740 };
    const context = vm.createContext({
        window: {}, document: {
            body: { appendChild: element => previews.push(element) },
            createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, remove() { this.removed = true; } }),
            getElementById: () => status
        },
        terrainDeck: [...deck], activeTerrainCardDrag: null, activePointerId: null,
        activeTableRect: null, pointerStartX: 0, pointerStartY: 0, isTerrainCardAnimating: false,
        table: { getBoundingClientRect: () => rect }, tableWidthPx: 960, tableHeightPx: 720,
        terrainDiameterPx: 80, currentScale: 1, isHost,
        DRAG_THRESHOLD_PX: 8, TERRAIN_NO_FEATURE_CARD: 'x', battleStarted: false,
        hasBattleStarted: () => context.battleStarted,
        clearPieceSelection() {},
        getActiveTableRect: () => context.activeTableRect || rect,
        getTerrainCardLabel: type => type === 'x' ? 'X' : 'Forest',
        pushUndo: () => snapshots.push([...context.terrainDeck]),
        createTerrainDOM: (...args) => terrain.push(args),
        advanceCount: 0, saveCount: 0,
        animateTerrainCardAdvance: () => context.advanceCount++,
        saveGame: () => context.saveCount++
    });
    vm.runInContext(source.slice(source.indexOf('function getTablePointerPosition('), source.indexOf('function getPointerAngleFromPieceCenter(')), context);
    vm.runInContext(source.slice(source.indexOf('window.playTerrainCard ='), source.indexOf('function attachListeners(')), context);
    const event = (x, y, type = 'pointerup') => ({
        pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, type,
        currentTarget: { setPointerCapture() {} }, preventDefault() {}, stopPropagation() {}
    });
    return { context, previews, terrain, snapshots, status, event,
        start: () => context.window.playTerrainCard(event(100, 100, 'pointerdown')),
        drop: (x, y, type) => context.finishTerrainCardDrag(event(x, y, type)) };
}

test('tapping, cancelling and dropping outside do not consume terrain cards or create undo entries', () => {
    const h = harness();
    h.start();
    assert.deepEqual(Array.from(h.context.terrainDeck), ['x', 'x', 'forest']);
    h.drop(100, 100);
    h.start();
    h.context.updateTerrainCardDrag(h.event(700, 350, 'pointermove'));
    h.drop(700, 350, 'pointercancel');
    h.start();
    h.drop(200, 350);
    assert.deepEqual(Array.from(h.context.terrainDeck), ['x', 'x', 'forest']);
    assert.equal(h.snapshots.length, 0);
    assert.equal(h.context.saveCount, 0);
    assert.ok(h.previews.every(preview => preview.removed));
    assert.equal(h.context.activePointerId, null);
});

test('each X requires a battlefield drop and produces distinct remaining-card feedback', () => {
    const h = harness();
    h.start();
    h.drop(700, 350);
    assert.deepEqual(Array.from(h.context.terrainDeck), ['x', 'forest']);
    assert.equal(h.terrain.length, 0);
    assert.match(h.status.textContent, /X discarded.*2 cards remaining/);
    h.start();
    h.drop(700, 350);
    assert.deepEqual(Array.from(h.context.terrainDeck), ['forest']);
    assert.equal(h.terrain.length, 0);
    assert.match(h.status.textContent, /X discarded.*1 cards remaining/);
    h.start();
    h.drop(700, 350);
    assert.equal(h.terrain.length, 1);
    assert.deepEqual(h.terrain[0], ['forest', 360, 290, 80, 80, 0]);
    assert.deepEqual(h.snapshots, [['x', 'x', 'forest'], ['x', 'forest'], ['forest']]);
    assert.equal(h.context.saveCount, 3);
    assert.equal(h.context.advanceCount, 3);
});

test('drops respect the challenger perspective and keep terrain inside board edges', () => {
    const h = harness(['forest', 'forest'], false);
    h.start();
    h.drop(700, 350);
    assert.deepEqual(h.terrain[0], ['forest', 520, 350, 80, 80, 0]);
    h.start();
    h.drop(1255, 735);
    assert.deepEqual(h.terrain[1], ['forest', 0, 0, 80, 80, 0]);
});

test('first reveal prevents an in-progress terrain drop and further card draws', () => {
    const h = harness(['forest']);
    h.start();
    h.context.battleStarted = true;
    h.drop(700, 350);
    assert.equal(h.terrain.length, 0);
    assert.deepEqual(Array.from(h.context.terrainDeck), ['forest']);
    h.start();
    assert.equal(h.context.activeTerrainCardDrag, null);
});
