const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('app.js', 'utf8');
const geometrySource = source.slice(source.indexOf('function getUnitGeometry('), source.indexOf('function normalizeAngle('));

function element(classes = []) {
    const names = new Set(classes);
    return {
        style: {}, dataset: {},
        classList: {
            add: (...values) => values.forEach(value => names.add(value)),
            remove: (...values) => values.forEach(value => names.delete(value)),
            contains: value => names.has(value)
        },
        setAttribute() {},
        remove() { this.removed = true; }
    };
}

function unit(x, y, angle = 0, width = 40, height = 20) {
    const result = element(['unit']);
    Object.assign(result.style, { left: `${x - width / 2}px`, top: `${y - height / 2}px`, width: `${width}px`, height: `${height}px` });
    result.dataset.angle = angle;
    result._unitStats = { Speed: '6', Ranged: '-' };
    return result;
}

function harness(units, selected = units[0]) {
    const overlays = [];
    const table = { querySelectorAll: () => units, appendChild: el => overlays.push(el) };
    const document = { createElement: () => element() };
    const factory = new Function('table', 'document', 'selectedPiece', 'getUnitStats', 'getStatValue', 'inchesToPx', `${geometrySource}
        return { getUnitGeometry, getForwardMovement, updateSelectionRanges, clearSelectionRanges };`);
    return {
        ...factory(table, document, selected, u => ({ stats: u._unitStats }), (stats, ...keys) => keys.map(k => stats[k]).find(v => v !== undefined) || '-', n => n * 20),
        overlays
    };
}

test('movement preview stops at nearest footprint and ignores ghosts, rear and off-path units', () => {
    const moving = unit(100, 200);
    const nearest = unit(100, 130);
    const ghost = unit(100, 160);
    ghost.classList.add('ghost');
    const h = harness([moving, unit(100, 80), unit(100, 250), unit(180, 160), nearest, ghost]);
    assert.deepEqual(h.getForwardMovement(moving, 120), { distance: 50, blocker: nearest });
    assert.deepEqual(h.getForwardMovement(moving, 40), { distance: 40, blocker: null });
});

test('rotated footprints block the full swept base, including targets off the centre line', () => {
    const moving = unit(100, 200);
    const target = unit(125, 130, 45);
    const h = harness([moving, target]);
    const result = h.getForwardMovement(moving, 120);
    assert.equal(result.blocker, target);
    // Contact occurs where the moving base's right corner meets the slanted edge.
    assert.ok(Math.abs(result.distance - (65 - 10 * Math.sqrt(2))) < 1e-6);
    const sideways = unit(100, 100, 90);
    const right = unit(170, 100, 90);
    assert.equal(harness([sideways, right]).getForwardMovement(sideways, 100).distance, 50);
});

test('selection uses profile speed and shooting range and removes obsolete overlays and highlights', () => {
    const moving = unit(100, 200);
    moving._unitStats.Ranged = '3*/18';
    const blocker = unit(100, 130);
    const h = harness([moving, blocker]);
    h.updateSelectionRanges();
    const arc = h.overlays.find(el => el.classList.contains('shooting-range'));
    const line = h.overlays.find(el => el.classList.contains('movement-range'));
    assert.equal(arc.style.width, '720px');
    assert.equal(arc.style.height, '360px');
    assert.equal(arc.style.top, '190px');
    assert.equal(line.style.width, '50px');
    assert.ok(blocker.classList.contains('is-movement-blocker'));
    h.clearSelectionRanges();
    assert.ok(h.overlays.every(el => el.removed));
    assert.equal(blocker.classList.contains('is-movement-blocker'), false);
    moving._unitStats.Ranged = '-';
    moving.dataset.angle = 180;
    h.updateSelectionRanges();
    const latest = h.overlays.filter(el => !el.removed);
    assert.equal(latest.length, 1);
    assert.equal(latest[0].style.width, '120px');
    assert.equal(latest[0].style.transform, 'rotate(90deg)');
});

test('pointer dragging projects forward and backward onto facing at any angle while terrain stays free', () => {
    const handlerSource = source.slice(source.indexOf('function handlePointerMove('), source.indexOf('function onPointerUp('));
    for (const angle of [0, 45, 90, 180, 270]) {
        for (const direction of [1, -1]) {
            const moving = unit(100, 200, angle);
            moving.dataset.offsetX = 20;
            moving.dataset.offsetY = 10;
            const h = harness([moving]);
            const { forward, right } = h.getUnitGeometry(moving);
            const x = 100 + forward.x * 60 * direction + right.x * 35;
            const y = 200 + forward.y * 60 * direction + right.y * 35;
            const run = new Function('activePiece', 'getUnitGeometry', `
                const activePointerId = 1, rotatingPiece = null, pendingDragPiece = null;
                const isMeasuring = false, ghostPiece = null;
                const activePieceHalfWidth = 20, activePieceHalfHeight = 10;
                const anchorX = 100, anchorY = 200, isHost = true;
                const getTablePointerPosition = e => ({ x: e.clientX, y: e.clientY });
                const broadcastPieceMoveThrottled = () => {}, updateSelectionRanges = () => {};
                const lineElement = { setAttribute() {} };
                const measureTextElement = { setAttribute() {}, removeAttribute() {} };
                const pxToInches = n => (n / 20).toFixed(1);
                ${handlerSource}
                return handlePointerMove;
            `)(moving, h.getUnitGeometry);
            run({ pointerId: 1, clientX: x, clientY: y });
            assert.ok(Math.abs(parseFloat(moving.style.left) + 20 - (100 + forward.x * 60 * direction)) < 1e-6);
            assert.ok(Math.abs(parseFloat(moving.style.top) + 10 - (200 + forward.y * 60 * direction)) < 1e-6);
            moving.classList.remove('unit');
            run({ pointerId: 1, clientX: x, clientY: y });
            assert.equal(parseFloat(moving.style.left), x - 20);
            assert.equal(parseFloat(moving.style.top), y - 10);
        }
    }
});
