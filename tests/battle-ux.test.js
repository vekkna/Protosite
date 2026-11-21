const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../engine');
const UX = require('../battle-ux');

const U = (id, owner, x, y, extra = {}) => ({ id, name: id, owner, x, y, w: 60, h: 40, angle: 0, pace: 6, mobility: 1, melee: 3, shoot: 2, range: 12, defence: 4, ...extra });
function battle(units, terrain = []) {
    let s = E.createGame({ units, terrain, seed: 1 });
    for (const player of ['p1', 'p2']) s = E.apply(s, { type: 'bid', player, value: 1 });
    s.master = 'p1'; s.turnStep = 0;
    return s;
}

test('charge previews include legal pre-move pivots and every suggested route is executable', () => {
    const s = battle([U('A', 'p1', 400, 400), U('B', 'p2', 510, 320)]);
    const original = JSON.stringify(s), preview = UX.movementPreview(s, 'A');
    assert.ok(preview.charges.some(p => p.targetId === 'B' && p.degrees !== 0));
    for (const p of preview.charges) {
        let next = E.apply(s, { type: 'activate', unitId: 'A' });
        for (const a of p.steps) next = E.apply(next, a);
        assert.equal(next.activation.charged, true);
        assert.ok(E.geometry.touching(next.units[0], next.units[1]));
    }
    assert.equal(JSON.stringify(s), original, 'Inspection never changes the battle');
});

test('charge guides respect zero mobility, impassable terrain and pivots during a Move', () => {
    const zero = battle([U('A', 'p1', 400, 400, { mobility: 0 }), U('B', 'p2', 510, 320)]);
    assert.deepEqual(UX.movementPreview(zero, 'A').rays.map(r => r.degrees), [0]);
    const blocked = battle([U('A', 'p1', 400, 400), U('B', 'p2', 400, 250)], [{ id: 't', type: 'mountain', x: 395, y: 315, w: 70, h: 70 }]);
    assert.equal(UX.movementPreview(blocked, 'A').charges.length, 0);
    let moved = E.apply(battle([U('A', 'p1', 400, 400), U('B', 'p2', 400, 250)]), { type: 'activate', unitId: 'A' });
    moved = E.apply(moved, { type: 'move', inches: 1 });
    const guide = UX.movementPreview(moved, 'A', true);
    assert.ok(guide.rays.filter(r => r.degrees !== 0).every(r => !r.limit.charge), 'A mid-move pivot prevents a charge');
});

test('movement guide budgets slowing terrain, spent actions and multiple free pivots', () => {
    const s = battle([U('A', 'p1', 400, 400, { mobility: 2 }), U('B', 'p2', 750, 40)], [{ id: 't', type: 'field', x: 370, y: 370, w: 120, h: 120 }]);
    const guide = UX.movementPreview(s, 'A');
    assert.ok(guide.rays.some(r => Math.abs(r.degrees) === 180));
    assert.ok(guide.rays.every(r => r.limit.max <= 4.001));
    let shot = E.apply(battle([U('A', 'p1', 400, 400), U('B', 'p2', 400, 250)]), { type: 'activate', unitId: 'A' });
    shot = E.apply(shot, { type: 'shoot', targetId: 'B' });
    assert.ok(UX.movementPreview(shot, 'A', true).rays.every(r => r.limit.max === 0));
});

test('ruler snapping uses the rotated footprint edge and keeps sub-inch precision', () => {
    const u = U('A', 'p1', 400, 400, { angle: 37 });
    const [a, b] = E.geometry.rect(u), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, f = E.geometry.forwardOf(u);
    const snap = UX.nearestOnUnit(u, { x: mid.x + f.x * 7.23, y: mid.y + f.y * 7.23 });
    assert.ok(Math.hypot(snap.x - mid.x, snap.y - mid.y) < 1e-8);
});

test('a pinned ruler endpoint keeps the same point on a moving and pivoting footprint', () => {
    const u = U('A', 'p1', 400, 400, { angle: 37 });
    const edge = UX.nearestOnUnit(u, { x: 425, y: 374 });
    const anchor = UX.unitAnchor(u, edge);
    const moved = { ...u, x: 525, y: 330, angle: 127 };
    const point = UX.anchorPoint(moved, anchor), c = E.geometry.centre(moved);
    const original = E.geometry.centre(u);
    assert.ok(Math.abs(point.x - c.x + edge.y - original.y) < 1e-8);
    assert.ok(Math.abs(point.y - c.y - edge.x + original.x) < 1e-8);
    assert.ok(Math.max(Math.abs(anchor.across), Math.abs(anchor.forward)) > 0.4999);
});

test('live AI narration names the actor, target, move distance and charge', () => {
    let s = E.apply(battle([U('A', 'p1', 400, 400), U('B', 'p2', 400, 300)]), { type: 'activate', unitId: 'A' });
    const lim = E.unitOptions(s, 'A').forward;
    assert.match(UX.actionText(s, { type: 'move', inches: lim.max }), /Enemy · A charges B/);
    assert.match(UX.actionText(s, { type: 'pivot', degrees: -45 }), /A pivots anticlockwise 45°/);
    assert.match(UX.actionText(s, { type: 'shoot', targetId: 'B' }), /A shoots B/);
});

function element(tag = 'div') {
    const classes = new Set();
    const el = { tagName: tag.toUpperCase(), dataset: {}, style: { setProperty(k, v) { this[k] = v; } }, children: [], textContent: '', offsetWidth: 200, offsetHeight: 90,
        classList: { add: (...v) => v.forEach(c => classes.add(c)), remove: (...v) => v.forEach(c => classes.delete(c)), contains: v => classes.has(v), toggle(v, yes) { yes ??= !classes.has(v); if (yes) classes.add(v); else classes.delete(v); } },
        set className(value) { classes.clear(); value.split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); }, get className() { return [...classes].join(' '); },
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; }, replaceChildren(...nodes) { this.children = []; nodes.forEach(n => this.appendChild(n)); },
        insertBefore(child, before) { child.parentNode = this; const i = this.children.indexOf(before); this.children.splice(i < 0 ? this.children.length : i, 0, child); },
        remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); },
        setAttribute(key, value) { if (key === 'class') this.className = value; else this[key] = value; },
        querySelectorAll(sel) { const all = this.children.flatMap(c => [c, ...c.querySelectorAll(sel)]); return all.filter(c => sel.startsWith('.') ? c.classList.contains(sel.slice(1).split(':')[0]) : c.tagName === sel.toUpperCase()); },
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
        closest() { return null; },
    }; return el;
}

function client(s, { ai = null } = {}) {
    const elements = new Map();
    const handlers = {};
    let frameId = 0;
    const frames = new Map();
    const get = id => { if (!elements.has(id)) { const el = element(); el.id = id; elements.set(id, el); } return elements.get(id); };
    const table = get('game-table');
    for (const u of s.units) {
        const el = element(); el.classList.add('unit'); el.dataset = { unitId: u.id, name: u.name, owner: u.owner, angle: u.angle };
        Object.assign(el.style, { left: `${u.x}px`, top: `${u.y}px`, width: `${u.w}px`, height: `${u.h}px` }); table.appendChild(el);
    }
    const boardElement = id => table.children.flatMap(el => [el, ...el.children]).find(el => el.id === id);
    const context = vm.createContext({ SeizeEngine: E, BattleUX: UX, table, document: { getElementById: id => id.startsWith('gp-') ? boardElement(id) : get(id), createElement: element, createElementNS: (_, tag) => element(tag), querySelector: () => null },
        window: { addEventListener(type, handler) { handlers[type] = handler; } }, conn: null, tableWidthPx: 960, tableHeightPx: 720, terrainDeck: [],
        biddingState: { p1: { value: 1 }, p2: { value: 1 } }, commandTokens: [], undoStack: [], selectedPiece: table.children[0],
        renderAllCommandTokens() {}, renderTerrainCard() {}, updateSelectionRanges() {}, getTerrainCardLabel: t => t,
        selectPiece(el) { context.selectedPiece = el; },
        createTerrainDOM(type, x, y, w, h, angle, id) {
            const el = element(); el.classList.add('terrain'); el.dataset = { pieceId: id, subType: type, angle };
            Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
            return table.appendChild(el);
        },
        getLocalBidPlayerKey: () => 'p1', getUnitStats: () => ({ stats: {} }),
        saves: 0, pushUndo() { context.undoStack.push(context.GP.snapshot()); },
        undo() { context.GP.restore(context.undoStack.pop()); context.GP.render(); },
        saveGame() { context.saves++; context.GP.render(); },
        setTimeout: () => 1, clearTimeout() {}, clearPieceSelection() {},
        requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame(id) { frames.delete(id); },
    });
    vm.runInContext(fs.readFileSync(require.resolve('../guided-play'), 'utf8'), context);
    context.GP = vm.runInContext('GuidedPlay', context);
    context.GP.restore({ version: 2, game: s, ai }); context.GP.render();
    const keydown = (target, key, shiftKey = false) => {
        let handled = false;
        handlers.keydown({ target, key, shiftKey, preventDefault() { handled = true; } });
        return handled;
    };
    const frameAt = time => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback(time));
    };
    return { context, gp: context.GP, get, buttons: () => [...get('guided-play').querySelectorAll('button'), get('board-undo')].filter(b => b.textContent && !(b.id === 'board-undo' && b.hidden)), table, keydown, frameAt };
}

test('connected deployment keeps legal changes reversible until its single confirmation hands off play', () => {
    const h = client(E.createGame({ units: [U('A', null, 400, 320), U('B', null, 650, 320)], terrainDeck: ['forest', 'hills'] }));
    h.context.conn = { open: true };
    const button = name => h.buttons().find(b => b.textContent === name && !b.hidden);
    const highlighted = cls => h.table.querySelectorAll(`.${cls}`).map(el => el.dataset.unitId);
    const unit = h.table.children[0];
    assert.equal(h.get('field-turn').textContent, 'Select a unit');
    assert.deepEqual(highlighted('guided-draft-option'), ['A', 'B']);
    assert.equal(h.get('terrain-card').classList.contains('is-playable'), false);
    assert.equal(h.get('deployment-zone-bottom').dataset.current, 'false');
    assert.equal(h.gp.tap(unit), true);
    assert.equal(h.gp.terrainAllowed(), true);
    assert.deepEqual(highlighted('guided-draft-option'), []);
    assert.deepEqual(highlighted('guided-picked'), []);
    assert.equal(h.get('terrain-card').classList.contains('is-playable'), true);
    h.gp.terrainDrop({ x: 430, y: 340 }, 'forest');
    assert.deepEqual(highlighted('guided-picked'), ['A']);
    assert.equal(h.get('terrain-card').classList.contains('is-playable'), false);
    assert.equal(h.get('deployment-zone-bottom').dataset.current, 'true');
    assert.equal(button('Confirm Unit Deployment'), undefined);
    assert.deepEqual(h.gp.state().terrainDeck, ['hills']);
    const tile = h.table.querySelector('.terrain');
    const originalTileX = h.gp.state().terrain[0].x;
    assert.equal(h.gp.canDrag(tile), true);
    tile.style.left = '10px';
    h.gp.dropPiece(tile, false);
    assert.equal(parseFloat(tile.style.left), originalTileX, 'An illegal tile drop returns to the last legal position');
    tile.style.left = `${originalTileX + 12}px`;
    h.gp.dropPiece(tile, false);
    assert.equal(h.gp.state().terrain[0].x, originalTileX + 12);
    h.gp.positionForDeployment({ x: 430, y: 340 });
    assert.equal(h.gp.canDrag(tile), true, 'An invalid unit placement leaves the terrain adjustable');
    h.gp.positionForDeployment({ x: 430, y: 650 });
    assert.ok(button('Confirm Unit Deployment'));
    assert.equal(h.gp.state().units[0].owner, null, 'The unit is still uncommitted');
    assert.equal(h.gp.canDrag(tile), false);
    assert.equal(h.get('deployment-terrain-grip').hidden, true);
    assert.throws(() => E.apply(h.gp.state(), { type: 'repositionTerrain', x: originalTileX, y: h.gp.state().terrain[0].y }), /terrain is fixed/i);
    h.gp.rotate(unit, 15);
    assert.equal(h.gp.state().draft.position.angle, 15);
    button('Undo').onclick();
    assert.equal(h.gp.state().draft.position.angle, 0);
    button('Undo').onclick();
    assert.equal(button('Confirm Unit Deployment'), undefined);
    assert.equal(h.gp.canDrag(tile), true, 'Undoing the unit placement makes the tile adjustable again');
    assert.equal(h.get('deployment-terrain-grip').hidden, false);
    button('Undo').onclick();
    assert.equal(h.gp.state().terrain[0].x, originalTileX);
    button('Undo').onclick();
    assert.equal(h.gp.state().terrain.length, 0);
    assert.deepEqual([...h.gp.state().terrainDeck], ['forest', 'hills']);
    assert.deepEqual(highlighted('guided-picked'), []);
    assert.equal(h.get('terrain-card').classList.contains('is-playable'), true);
    button('Undo').onclick();
    assert.equal(h.gp.state().draft.step, 'pick');
    assert.deepEqual(highlighted('guided-draft-option'), ['A', 'B']);
    h.gp.tap(unit);
    h.gp.terrainDrop({ x: 430, y: 340 }, 'forest');
    h.gp.positionForDeployment({ x: 430, y: 650 });
    button('Confirm Unit Deployment').onclick();
    assert.equal(h.gp.state().draft.picker, 'p2');
    assert.equal(h.gp.state().units[0].owner, 'p1');
    assert.deepEqual(highlighted('guided-draft-option'), [], 'The online opponent gets their own deployment highlights');
    assert.deepEqual(highlighted('guided-picked'), []);
    assert.equal(h.gp.canUndo(), false);
    assert.equal(h.context.undoStack.length, 0);
});

test('auto-draft finishes both armies and opens bidding even when the AI has the next pick', () => {
    const state = E.createGame({
        firstPick: 'p2',
        units: ['A', 'B', 'C', 'D'].map((id, i) => U(id, null, 140 + i * 200, 320)),
        terrainDeck: ['forest', 'x', 'hills', 'x']
    });
    const h = client(state, { ai: 'p2' });
    const quick = h.buttons().find(b => b.textContent === 'Auto-draft both sides');
    assert.ok(quick && !quick.disabled && !quick.hidden);
    quick.onclick();
    const result = h.gp.state();
    assert.equal(result.phase, 'bidding');
    assert.equal(result.round, 1);
    assert.equal(result.firstPick, 'p2');
    assert.deepEqual(result.starting, { p1: 2, p2: 2 });
    assert.deepEqual(result.bids, { p1: null, p2: null });
    assert.deepEqual(result.terrain.map(t => t.type), ['forest', 'hills']);
    assert.deepEqual(state.units.map(u => u.owner), [null, null, null, null]);
    assert.equal(h.context.saves, 1);
    assert.equal(h.gp.canUndo(), false);
    assert.ok(!h.buttons().some(b => b.textContent === 'Auto-draft both sides'));
    assert.equal(h.get('field-turn').textContent, 'Choose your command bid');
    assert.deepEqual(h.get('guided-play').children.map(el => el.tagName), ['P', 'DIV', 'BUTTON']);
    assert.deepEqual(h.buttons().map(button => button.textContent), ['1', '2', 'Lock bid']);
});

test('auto-draft preserves deployed units and the legal position of a staged unit', () => {
    let state = E.createGame({
        units: [U('A', 'p1', 100, 640), U('B', 'p2', 120, 40), U('C', null, 360, 320), U('D', null, 680, 320)],
        terrainDeck: ['x', 'forest']
    });
    state = E.apply(state, { type: 'pick', unitId: 'C' });
    state = E.apply(state, { type: 'positionDeployment', x: 440, y: 650, angle: 25 });
    const result = E.apply(state, { type: 'autoDraft' });
    assert.deepEqual(result.units.slice(0, 2), state.units.slice(0, 2));
    const staged = result.units.find(u => u.id === 'C');
    assert.equal(staged.owner, 'p1');
    assert.equal(staged.x, 440);
    assert.equal(staged.y, 650);
    assert.equal(staged.angle, 25);
    assert.equal(result.phase, 'bidding');
});

test('open ground and empty decks clearly announce the skipped terrain step throughout deployment', () => {
    for (const terrainDeck of [['x', 'forest'], []]) {
        const h = client(E.createGame({ units: [U('A', null, 400, 320), U('B', null, 650, 320)], terrainDeck }));
        const notice = h.get('deployment-terrain-notice');
        assert.match(notice.textContent, /no terrain to place this turn/i);
        h.gp.tap(h.table.children[0]);
        assert.match(notice.textContent, /no terrain to place this turn/i);
        assert.equal(h.get('terrain-section').hidden, false);
        assert.equal(h.get('terrain-card').hidden, true);
        assert.equal(h.table.children[0].classList.contains('guided-picked'), true);
        assert.equal(h.get('field-turn').textContent, 'Deploy your unit');
        h.gp.positionForDeployment({ x: 430, y: 650 });
        assert.match(notice.textContent, /no terrain to place this turn/i);
        h.gp.deploy();
        assert.equal(h.get('terrain-section').hidden, false);
        assert.equal(h.get('terrain-card').hidden, !terrainDeck.length);
        assert.deepEqual(h.table.querySelectorAll('.guided-draft-option').map(el => el.dataset.unitId), ['B']);
        if (terrainDeck.length) assert.equal(notice.textContent, '');
    }
});

test('the player’s own moves land at once; the computer’s animate and take the short pivot', () => {
    const h = client(battle([U('A', 'p1', 400, 400, { angle: 350 }), U('B', 'p2', 750, 40)]));
    const piece = h.table.children.find(el => el.dataset.unitId === 'A');
    h.gp.movePieceTo(piece, 450, 410, 0);
    assert.equal(piece.style.left, '450px');
    assert.ok(!piece.fieldMotion, 'no animation for the player');
    assert.equal(piece.style.transform, 'rotate(0deg)');
    h.gp.movePieceTo(piece, 400, 400, 350);
    h.gp.movePieceTo(piece, 500, 420, 10, { opponent: true });
    assert.equal(piece.style.left, '500px');
    const motion = piece.fieldMotion;
    assert.equal(piece.style.transform, 'translate(-100px, -20px) rotate(350deg)');
    h.frameAt(0);
    h.frameAt(500);
    const midway = h.gp.visiblePose(piece);
    assert.ok(midway.x > 400 && midway.x < 500);
    assert.ok(midway.angle > 350 && midway.angle < 370);
    h.gp.movePieceTo(piece, 500, 420, 10, { opponent: true });
    assert.equal(piece.fieldMotion, motion);
    h.frameAt(2000);
    assert.equal(piece.style.transform, 'rotate(10deg)');
    assert.equal(piece.fieldMotion, null);
});

test('an enemy advance slides from the old position even in reduced-motion mode', async () => {
    for (const reduced of [false, true]) {
        const s = battle([U('A', 'p1', 400, 400), U('B', 'p2', 700, 350)]);
        s.master = 'p2';
        const h = client(s, { ai: 'p2' });
        h.context.window.matchMedia = () => ({ matches: reduced });
        const enemy = h.table.children.find(el => el.dataset.unitId === 'B');
        assert.equal(h.gp.act([{ type: 'activate', unitId: 'B' }, { type: 'move', inches: 5 }]), true);
        const motion = enemy.fieldMotion;
        assert.equal(enemy.style.top, '250px');
        assert.equal(h.gp.visiblePose(enemy).y, 350);
        h.frameAt(0);
        h.frameAt(375);
        assert.equal(h.gp.visiblePose(enemy).y, 300);
        assert.equal(enemy.style.transform, 'translate(0px, 50px) rotate(0deg)');
        h.gp.render();
        assert.equal(h.gp.visiblePose(enemy).y, 300);
        assert.equal(enemy.fieldMotion, motion);
        h.frameAt(2200);
        await motion.finished;
        assert.equal(h.gp.visiblePose(enemy).y, 250);
        assert.equal(enemy.style.transform, 'rotate(0deg)');
    }
});

test('one Move button previews the battlefield and a released drag saves one undo step', () => {
    const initial = battle([U('A', 'p1', 400, 400, { shoot: 0 }), U('B', 'p2', 750, 40)]);
    const h = client(initial), piece = h.table.children[0];
    const controls = h.get('guided-play').querySelector('.gp-unit-orders').children;
    assert.deepEqual(controls.map(b => b.textContent), ['Move']);
    controls[0].onclick();
    assert.equal(h.get('field-turn').textContent, 'Drag the unit to move');
    const forecast = () => h.table.querySelector('.gp-next-charge-lane');
    assert.equal(forecast().points, '400.0,460.0 460.0,460.0 460.0,160.0 400.0,160.0');
    assert.equal(h.table.querySelector('.gp-fwd').points, '400.0,400.0 460.0,400.0 460.0,280.0 400.0,280.0');
    assert.equal(h.gp.state(), initial);
    assert.equal(h.context.saves, 0);
    assert.equal(h.context.undoStack.length, 0);

    assert.equal(h.gp.canDrag(piece), true);
    piece.classList.add('is-dragging');
    h.gp.render();
    const pose = h.gp.constrainDrag(piece, 400, 352.6);
    assert.equal(pose.top, 352.6);
    assert.ok(forecast() && h.table.querySelector('.gp-fwd'), 'Both guides stay visible while dragging');
    assert.equal(h.gp.state(), initial);
    piece.classList.remove('is-dragging');
    h.gp.dropPiece(piece, false);
    assert.equal(forecast(), null);
    assert.equal(h.gp.state().units[0].y, 352.6);
    assert.equal(h.context.saves, 1);
    assert.equal(h.context.undoStack.length, 1);
    assert.equal(h.gp.state().commands.p1, 0);
    h.buttons().find(b => b.textContent === 'Undo').onclick();
    assert.equal(h.gp.state().units[0].y, 400);
    assert.equal(h.gp.state().commands.p1, 1);
});

test('next-turn charge reach stops at an enemy beyond this turn’s movement range', () => {
    const s = battle([U('A', 'p1', 400, 400), U('B', 'p2', 400, 200)]);
    const options = E.unitOptions(s, 'A');
    assert.equal(options.forward.max, 6);
    assert.equal(options.forward.charge, null);
    assert.deepEqual(UX.nextChargeSpans(s, s.units[0], options), [{ from: -3, to: 8 }]);
});

test('the movement corridor follows a live pivot and restores its original shape on cancel', () => {
    const initial = battle([U('A', 'p1', 400, 400, { shoot: 0 }), U('B', 'p2', 750, 40)]);
    const h = client(initial), piece = h.table.children[0];
    const corridor = () => h.table.querySelector('.gp-fwd')?.points;
    const before = corridor();
    assert.ok(before);
    assert.equal(h.gp.canDrag(piece, 'rotate'), true);
    piece.dataset.angle = h.gp.constrainRotation(piece, 0, 45);
    assert.equal(piece.dataset.angle, 45);
    assert.ok(corridor());
    assert.notEqual(corridor(), before);
    assert.equal(h.gp.state(), initial);
    h.gp.dropRotation(piece, true);
    assert.equal(corridor(), before);
});

test('V3 contact pivots restore the movement boxes as soon as the card turns clear', () => {
    const s = battle([U('A', 'p1', 400, 400, { mobility: 2, shoot: 0 }), U('B', 'p2', 460, 400)]);
    s.rules = 'v3';
    const h = client(s), piece = h.table.children[0];
    const turn = (from, to) => {
        assert.equal(h.gp.canDrag(piece, 'rotate'), true);
        piece.dataset.angle = h.gp.constrainRotation(piece, from, to);
        assert.equal(piece.dataset.angle, to);
    };

    turn(0, 30);
    assert.equal(h.table.querySelectorAll('.gp-lane').length, 0);
    h.gp.dropRotation(piece, false);
    assert.equal(h.gp.state().activation.overlap, true);
    assert.equal(h.buttons().find(button => button.textContent === 'End activation').disabled, true);

    turn(30, 90);
    assert.ok(h.table.querySelector('.gp-charge'), 'facing B after a pivot before moving, A can charge it');
    h.gp.dropRotation(piece, false);
    assert.equal(h.gp.state().activation.overlap, false);
    assert.equal(h.gp.canDrag(piece), true);
});

test('Heavy Cavalry shows its next activation’s movement when a turn spends its action', () => {
    for (const rules of ['classic', 'v3']) {
        const cavalry = U('Heavy Cavalry', 'p1', 400, 400, { w: 49, h: 69, pace: 12, mobility: 0, shoot: 0 });
        const initial = battle([cavalry, U('B', 'p2', 750, 40)]);
        initial.rules = rules;
        const h = client(initial), piece = h.table.children[0];
        const lanes = () => h.table.querySelectorAll('.gp-lane');
        const original = lanes().map(lane => lane.points);
        assert.equal(original.length, 2);

        assert.equal(h.gp.canDrag(piece, 'rotate'), true);
        piece.dataset.angle = h.gp.constrainRotation(piece, 0, 45);
        const preview = lanes().map(lane => lane.points);
        assert.notDeepEqual(preview, original);
        assert.equal(h.table.querySelectorAll('.gp-future-move').length, 2);
        h.gp.dropRotation(piece, true);
        assert.deepEqual(lanes().map(lane => lane.points), original);
        assert.equal(h.table.querySelectorAll('.gp-future-move').length, 0);

        assert.equal(h.gp.canDrag(piece, 'rotate'), true);
        piece.dataset.angle = h.gp.constrainRotation(piece, 0, 45);
        h.gp.dropRotation(piece, false);
        assert.equal(h.gp.state().units[0].angle, 45);
        assert.equal(h.gp.state().units[0].activated, true);
        assert.deepEqual(lanes().map(lane => lane.points), preview);
        assert.equal(h.table.querySelectorAll('.gp-future-move').length, 2);
        assert.ok(h.get('guided-play').querySelectorAll('p').some(p => p.textContent.includes('next activation')));
        assert.equal(h.gp.canDrag(piece), false);
    }
});

test('the final move stays undoable until the player ends the round', () => {
    for (const online of [false, true]) {
        const s = battle([U('A', 'p1', 400, 400, { mobility: 0, shoot: 0 }), U('B', 'p2', 750, 40)]);
        s.master = online ? 'p2' : 'p1';
        s.turnStep = online ? 1 : 2;
        s.commands.p2 = 0;
        const h = client(s);
        if (online) h.context.conn = { open: true };
        const piece = h.table.children[0];
        const move = () => {
            assert.equal(h.gp.canDrag(piece), true);
            h.gp.constrainDrag(piece, 400, 200);
            h.gp.dropPiece(piece, false);
            assert.equal(h.gp.state().units[0].y, 280);
            assert.equal(h.gp.state().round, 1);
            assert.equal(h.gp.state().turnStep, s.turnStep);
            assert.equal(h.gp.state().awaitingRoundEnd, true);
            assert.equal(h.gp.canUndo(), true);
        };
        move();
        h.buttons().find(b => b.textContent === 'Undo').onclick();
        assert.equal(h.gp.state().units[0].y, 400);
        assert.equal(h.gp.state().commands.p1, 1);
        move();
        h.buttons().find(b => b.textContent === 'End round').onclick();
        assert.equal(h.gp.state().phase, 'bidding');
        assert.equal(h.gp.state().round, 2);
        assert.equal(h.gp.canUndo(), false);
    }
});

test('the last Fanatics move stays undoable before the opponent gets the turn', () => {
    for (const usedPivot of [false, true]) {
        const fanatics = U('Fanatics', 'p1', 400, 400, { paceStar: true, shoot: 0 });
        const s = battle([fanatics, U('B', 'p2', 750, 40)]);
        const h = client(s, { ai: 'p2' }), piece = h.table.children[0];
        if (usedPivot) h.gp.act([{ type: 'activate', unitId: fanatics.id }, { type: 'pivot', degrees: 90 }]);
        const moveAndReview = () => {
            assert.equal(h.gp.canDrag(piece), true);
            h.gp.constrainDrag(piece, usedPivot ? 520 : 400, usedPivot ? 400 : 280);
            h.gp.dropPiece(piece, false);
            if (!usedPivot) h.buttons().find(b => b.textContent === 'End activation').onclick();
            assert.equal(E.activePlayer(h.gp.state()), 'p1');
            assert.equal(h.gp.state().awaitingTurnEnd, true);
            assert.equal(h.gp.canUndo(), true);
        };

        moveAndReview();
        h.buttons().find(b => b.textContent === 'Undo').onclick();
        assert.equal(h.gp.state().units[0].x, 400);
        assert.equal(h.gp.state().units[0].y, 400);
        assert.equal(h.gp.state().units[0].angle, usedPivot ? 90 : 0);

        moveAndReview();
        h.buttons().find(b => b.textContent === 'End turn').onclick();
        assert.equal(E.activePlayer(h.gp.state()), 'p2');
        assert.equal(h.gp.state().awaitingTurnEnd, undefined);
        assert.equal(h.gp.act({ type: 'pass', player: 'p2' }, { opponent: true }), true);
        assert.equal(h.gp.state().phase, 'bidding');
        assert.equal(h.gp.state().round, 2);
    }
});

test('ending the final activation after a pivot still lets one Undo restore the facing', () => {
    const s = battle([U('A', 'p1', 400, 400, { shoot: 0 }), U('B', 'p2', 750, 40)]);
    s.rules = 'v3';
    s.master = 'p2';
    s.turnStep = 1;
    s.commands.p2 = 0;
    const h = client(s);
    h.context.conn = { open: true };
    const piece = h.table.children[0];
    const rotateAndEnd = () => {
        assert.equal(h.gp.canDrag(piece, 'rotate'), true);
        piece.dataset.angle = h.gp.constrainRotation(piece, 0, 30);
        h.gp.dropRotation(piece, false);
        assert.equal(h.gp.state().units[0].angle, 30);
        assert.ok(h.gp.state().activation, 'The unit can still move after the pivot');
        h.buttons().find(b => b.textContent === 'End activation').onclick();
        assert.equal(h.gp.state().awaitingRoundEnd, true);
        assert.equal(h.gp.state().round, 1);
        assert.equal(h.gp.canUndo(), true);
    };
    rotateAndEnd();
    h.buttons().find(b => b.textContent === 'Undo').onclick();
    assert.equal(h.gp.state().units[0].angle, 0);
    rotateAndEnd();
    h.buttons().find(b => b.textContent === 'End round').onclick();
    assert.equal(h.gp.state().round, 2);
    assert.equal(h.gp.state().phase, 'bidding');
    assert.equal(h.gp.canUndo(), false);
});

test('heavy cavalry can finish a very short charge against angled archers', () => {
    const cavalry = U('Heavy Cavalry', 'p1', 400, 400, { w: 49, h: 69, pace: 10, mobility: 0, shoot: 0 });
    const archers = U('Archers', 'p2', 384, 300, { w: 69, h: 49, angle: 9 });
    const G = E.geometry;
    const travel = G.sweep(G.rect(cavalry), G.rect(archers), { x: 0, y: -200 });
    assert.ok(travel > 1);
    cavalry.y -= travel - 0.09;
    const state = battle([cavalry, archers]);
    const activated = E.apply(state, { type: 'activate', unitId: cavalry.id });
    const forward = E.legalActions(activated).filter(a => a.type === 'move' && !a.backwards);
    assert.equal(forward.length, 1);
    assert.ok(forward[0].inches > 0);
    const h = client(state);
    const piece = h.table.children[0];
    assert.equal(h.gp.canDrag(piece), true);
    const preview = h.gp.constrainDrag(piece, cavalry.x, cavalry.y - 25);
    assert.equal(preview.charging, true);
    h.gp.dropPiece(piece, false);
    const moved = h.gp.state();
    assert.deepEqual(moved.events.find(event => event.type === 'charge').targets, ['Archers']);
    assert.ok(G.touching(...moved.units));
    assert.equal(moved.activation.freeStrike, true);
});

test('a direct corner drag pivots and the Reform button changes the same gesture', () => {
    const initial = battle([U('A', 'p1', 400, 400), U('B', 'p2', 750, 40)]);
    initial.rules = 'reform';
    const h = client(initial), piece = h.table.children[0];
    assert.ok(!h.buttons().some(b => b.textContent === 'Pivot'));
    for (const reform of [false, true]) {
        if (reform) h.buttons().find(b => b.textContent === 'Reform').onclick();
        assert.equal(h.gp.state().activation, null);
        assert.equal(h.gp.canDrag(piece, 'rotate'), true);
        piece.dataset.angle = h.gp.constrainRotation(piece, 0, 30);
        h.gp.dropRotation(piece, false);
        assert.equal(h.gp.state().units[0].angle, 30);
        if (reform) assert.match(h.gp.state().log.find(entry => entry.includes('turning')), /reforms, turning clockwise 30°/);
        else assert.equal(h.gp.state().activation.action, 'move');
        assert.equal(h.context.undoStack.length, 1);
        h.context.undo();
    }
});


test('deterministic steps accumulate until a successful roll commits the position', () => {
    const h = client(battle([U('A', 'p1', 400, 400, { mobility: 30 }), U('B', 'p2', 400, 250)]));
    h.gp.act({ type: 'activate', unitId: 'A' });
    for (let i = 0; i < 24; i++) assert.equal(h.gp.act({ type: 'pivot', degrees: i % 2 ? -1 : 1 }), true);
    assert.equal(h.context.undoStack.length, 25);
    assert.equal(h.gp.act({ type: 'shoot', targetId: 'missing' }), false);
    assert.equal(h.context.undoStack.length, 25, 'An invalid attack never commits');
    assert.equal(h.gp.act({ type: 'shoot', targetId: 'B' }), true);
    assert.equal(h.gp.canUndo(), false);
});

test('connected play keeps reversible orders only during the current local command window', () => {
    const h = client(battle([U('A', 'p1', 400, 400), U('B', 'p2', 750, 40)]));
    h.context.conn = { open: true };
    h.gp.act([{ type: 'activate', unitId: 'A' }, { type: 'move', inches: 2 }]);
    assert.equal(h.gp.canUndo(), true);
    h.gp.pass();
    assert.equal(E.activePlayer(h.gp.state()), 'p2');
    assert.equal(h.gp.canUndo(), false);
    assert.equal(h.context.undoStack.length, 0);
});

test('the orders panel shows all windows and the effect of passing the current one', () => {
    const h = client(battle([U('A', 'p1', 400, 400), U('B', 'p2', 750, 40)]));
    h.context.selectedPiece = null;
    h.gp.render();
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.doesNotMatch(html, /id="battle-roster"/);
    assert.ok(!h.get('guided-play').querySelectorAll('p').some(p => p.textContent.includes('Choose a fresh unit')));
    const orders = () => h.get('guided-play').querySelector('.gp-order-windows').children;
    assert.deepEqual(orders().map(el => el.children.map(child => child.textContent)), [
        ['First', 'Player 1'], ['Middle', 'Player 2'], ['Final', 'Player 1']
    ]);
    assert.equal(orders()[0]['aria-current'], 'step');
    assert.match(h.get('guided-play').querySelector('.gp-pass-summary').textContent, /carries 1 command/);
    h.gp.pass();
    assert.equal(orders()[1]['aria-current'], 'step');
    assert.match(h.get('guided-play').querySelector('.gp-pass-summary').textContent, /gives up 1 command/);
    h.gp.pass();
    assert.equal(orders()[2]['aria-current'], 'step');
    assert.equal(h.gp.state().commands.p1, 1);
});

test('a projected firing arc gains and loses targets as its origin moves', () => {
    const shooter = U('A', 'p1', 400, 400, { angle: 90, range: 5 });
    const ahead = E.geometry.rect(U('B', 'p2', 570, 405));
    const behind = E.geometry.rect(U('C', 'p2', 355, 405));
    const start = E.firingArc(shooter), destination = E.firingArc({ ...shooter, x: 480 });
    assert.equal(E.firingArcError(start, ahead), 'Out of range.');
    assert.equal(E.firingArcError(destination, ahead), '');
    assert.match(E.firingArcError(destination, behind), /in front/);
});

test('shooting draws one tracer and a hit effect, without replaying effects on later renders', () => {
    const state = battle([U('A', 'p1', 400, 400), U('B', 'p2', 400, 250)]); state.hypothetical = true;
    const h = client(state);
    h.gp.act([{ type: 'activate', unitId: 'A' }, { type: 'shoot', targetId: 'B', forcedStrain: 2 }]);
    assert.equal(h.table.querySelectorAll('.gp-shot-effect').length, 1);
    assert.equal(h.table.querySelectorAll('.gp-impact').length, 1);
    assert.ok(h.table.children.find(el => el.dataset.unitId === 'B').classList.contains('gp-struck'));
    h.gp.render();
    assert.equal(h.table.querySelectorAll('.gp-shot-effect').length, 1);
});

test('a bid can be revised privately until locked and the shared-screen handoff hides it', () => {
    const h = client(E.createGame({ units: [U('A', 'p1', 100, 400), U('B', 'p1', 300, 400), U('C', 'p2', 400, 150)] }));
    const choose = name => h.buttons().find(b => b.textContent === name).onclick();
    choose('1'); choose('2');
    assert.equal(h.context.biddingState.p1.ready, undefined);
    assert.equal(h.gp.snapshot().game.bids.p1, null);
    choose('Lock bid · 2 commands');
    assert.equal(h.context.biddingState.p1.ready, true);
    assert.ok(!h.buttons().some(b => b.textContent.includes('2 commands')));
    choose('1'); choose('Lock bid · 1 command');
    assert.equal(h.gp.state().master, 'p2');
    assert.equal(h.gp.state().commands.p1, 2);
});

test('one Shoot button uses the battlefield to preview and confirm a target', () => {
    const h = client(battle([U('A', 'p1', 400, 400), U('B', 'p2', 400, 250), U('C', 'p2', 485, 250)]));
    const before = h.gp.state(), target = h.table.children.find(el => el.dataset.unitId === 'B');
    const orders = h.get('guided-play').querySelector('.gp-unit-orders');
    assert.deepEqual(orders.children.map(b => b.textContent), ['Move', 'Shoot']);
    orders.children.find(b => b.textContent === 'Shoot').onclick();
    assert.equal(h.gp.state(), before);
    assert.equal(h.table.querySelectorAll('.gp-target').length, 2);
    const lanes = h.table.querySelectorAll('.gp-lane');
    assert.equal(lanes.length, 1);
    assert.ok(lanes[0].classList.contains('gp-charge'));
    assert.equal(h.keydown(target, 'Enter'), true);
    assert.equal(h.gp.state(), before);
    assert.ok(target.classList.contains('gp-target-chosen'));
    const preview = h.table.querySelector('.gp-attack-preview');
    assert.deepEqual(preview.children.map(el => el.textContent), ['2 dice · Target 4+', 'Click again to attack']);
    assert.ok(parseFloat(preview.style.top) + preview.offsetHeight / 2 < parseFloat(target.style.top));
    assert.equal(h.gp.tap(target), true);
    assert.ok(h.gp.state().events.some(e => e.type === 'attack'));
    assert.equal(h.table.querySelector('.gp-attack-preview'), null);
    assert.equal(h.context.undoStack.length, 0, 'A rolled attack commits the position');
});

test('first click on a strike target lists signed modifiers and the adjusted target number on a flipped board', () => {
    const h = client(battle([U('A', 'p1', 400, 400, { meleeAP: true }), U('B', 'p2', 400, 360), U('C', 'p2', 460, 410)]));
    h.table.classList.add('is-flipped');
    const target = h.table.children.find(el => el.dataset.unitId === 'B');
    const before = h.gp.state();
    assert.equal(h.gp.tap(target), true);
    assert.equal(h.gp.state(), before);
    const preview = h.table.querySelector('.gp-attack-preview');
    assert.deepEqual(preview.children.map(el => el.textContent), [
        '3 dice · Target 3+', 'Base pool 3 dice', '−1 Attacker outflanked',
        '+1 Target has no command marker', 'Armour-piercing', 'Click again to attack'
    ]);
    assert.ok(parseFloat(preview.style.top) - preview.offsetHeight / 2 > 400, 'The preview is above the unit from the flipped viewer’s perspective');
    assert.equal(h.keydown(target, 'Escape'), true);
    assert.equal(h.table.querySelector('.gp-attack-preview'), null);
    assert.equal(h.gp.tap(target), true);
    assert.equal(h.gp.tap(target), true);
    const attack = h.gp.state().events.find(e => e.type === 'attack');
    assert.equal(attack.rolls.length, 3);
    assert.equal(attack.tn, 3);
});

test('V3 preview and roll the base dice against an unmarked melee target', () => {
    const state = battle([U('A', 'p1', 400, 400, { melee: 1 }), U('B', 'p2', 400, 360, { angle: 180, defence: 3 })]);
    state.rules = 'v3';
    const h = client(state);
    const target = h.table.children.find(el => el.dataset.unitId === 'B');
    assert.equal(h.gp.tap(target), true);
    const preview = h.table.querySelector('.gp-attack-preview');
    assert.deepEqual(preview.children.map(el => el.textContent), ['1 die · Target 3+', 'Click again to attack']);

    assert.equal(h.gp.tap(target), true);
    const attack = h.gp.state().events.find(e => e.type === 'attack');
    assert.equal(attack.rolls.length, 1);
    assert.equal(attack.tn, 3);
});

test('selecting a friendly unit shows its charge box while bidding, regardless of Shoot', () => {
    for (const shoot of [0, 2]) {
        const h = client(E.createGame({ units: [U('A', 'p1', 400, 400, { shoot }), U('B', 'p2', 400, 250)] }));
        const piece = h.table.children.find(el => el.dataset.unitId === 'A');
        h.context.selectedPiece = null;
        h.gp.render();
        assert.equal(h.table.querySelectorAll('.gp-lane').length, 0);

        h.context.selectPiece(piece);
        h.gp.render();
        const lanes = h.table.querySelectorAll('.gp-lane');
        assert.equal(lanes.length, 1);
        assert.ok(lanes[0].classList.contains('gp-charge'));
        assert.equal(lanes[0].points, '400.0,400.0 460.0,400.0 460.0,290.0 400.0,290.0');
    }
});

test('a focused battlefield accepts smaller keyboard steps and Undo', () => {
    const h = client(battle([U('A', 'p1', 400, 400), U('B', 'p2', 750, 40)]));
    h.buttons().find(b => b.textContent === 'Move').onclick();
    assert.equal(h.keydown(h.table, 'ArrowUp', true), true);
    assert.equal(h.gp.state().units[0].y, 398);
    h.buttons().find(b => b.textContent === 'Undo').onclick();
    assert.equal(h.gp.state().units[0].y, 400);
});

test('Reform Variant dragging and keyboard movement land clear of friendly units', () => {
    const s = battle([U('A', 'p1', 400, 400, { paceStar: true }), U('B', 'p1', 400, 340), U('C', 'p2', 750, 40)]);
    s.rules = 'reform-variant';
    const h = client(s), piece = h.table.children[0];
    assert.equal(h.gp.activeRules(), 'reform-variant');
    assert.ok(h.buttons().some(b => b.textContent === 'Reform'));
    assert.equal(h.gp.canDrag(piece), true);
    assert.equal(h.gp.constrainDrag(piece, 400, 340).top, 380, 'the preview stops short of the overlap');
    assert.equal(h.gp.constrainDrag(piece, 400, 295).top, 295, 'dragging farther clears the friendly');
    h.gp.dropPiece(piece, false);
    assert.equal(h.gp.state().units[0].y, 295);

    h.context.undo();
    h.buttons().find(b => b.textContent === 'Move').onclick();
    assert.equal(h.keydown(h.table, 'ArrowUp'), true);
    assert.equal(h.gp.state().units[0].y, 380);
    assert.equal(h.keydown(h.table, 'ArrowUp'), true);
    assert.equal(h.gp.state().units[0].y, 300, 'the next keyboard move lands on the far side');
});


const appSource = fs.readFileSync(require.resolve('../app'), 'utf8');
test('identical labels fit identically regardless of hidden layout, rotation and scroll measurements', () => {
    const labels = [0, 180].map(angle => ({ textContent: 'Fanatics', style: {}, clientWidth: angle ? 60 : 0, scrollWidth: angle ? 60 : 500,
        parentElement: { style: { width: '69px', height: '49px', transform: `rotate(${angle}deg)` } } }));
    const context = { font: '', measureText(text) { return { width: text.length * Number(this.font.match(/[\d.]+/)[0]) * .6 }; } };
    const document = { querySelectorAll: () => labels, createElement: () => ({ getContext: () => context }) };
    const source = appSource.slice(appSource.indexOf('let unitLabelContext;'), appSource.indexOf('function createUnitDOM('));
    const constants = appSource.match(/const UNIT_LABEL_(?:MAX_FONT_PX|MIN_FONT_PX|FONT_STEP_PX) = [\d.]+;/g).join('\n');
    new Function('document', `${constants} ${source}; fitAllUnitLabels();`)(document);
    assert.equal(labels[0].style.fontSize, labels[1].style.fontSize);
    assert.ok(parseFloat(labels[0].style.fontSize) >= 7.5 && parseFloat(labels[0].style.fontSize) <= 10);
});

test('an inspected enemy keeps its charge reach circle during its own turn', () => {
    const s = battle([U('A', 'p1', 400, 400), U('B', 'p2', 400, 250, { angle: 180 })]);
    s.master = 'p2';
    const h = client(s, { ai: 'p2' });
    h.context.selectedPiece = h.table.children.find(el => el.dataset.unitId === 'B');
    h.gp.render();
    assert.equal(h.get('field-turn').textContent, 'Enemy turn');
    assert.equal(h.table.querySelectorAll('.gp-reach-charge').length, 1);
    assert.equal(h.gp.aiPlayer(), 'p2');
});

test('an enemy that can turn shows reach circles instead of corridors; one that can’t keeps its corridors', () => {
    const s = battle([U('A', 'p1', 400, 400, { shoot: 0 }), U('B', 'p2', 400, 250, { angle: 180 })]);
    const h = client(s, { ai: 'p2' });
    assert.equal(h.table.querySelectorAll('.gp-lane').length, 2);
    assert.equal(h.table.querySelectorAll('.gp-pivot-stop').length, 0);
    assert.equal(h.table.querySelectorAll('.gp-label').length, 0);
    h.context.selectedPiece = h.table.children.find(el => el.dataset.unitId === 'B');
    h.gp.render();
    assert.equal(h.table.querySelectorAll('.gp-charge-envelope').length, 0);
    assert.equal(h.table.querySelectorAll('.gp-enemy-lane').length, 0);
    assert.equal(h.table.querySelectorAll('.gp-reach-charge').length, 1);
    assert.equal(h.table.querySelectorAll('.gp-reach-shoot').length, 1, 'B shoots, so it has a shooting circle too');
    assert.deepEqual(h.table.querySelectorAll('.gp-charge-target').map(el => el.dataset.unitId), ['A']);
    // My own selected unit keeps its boxes and gets no circle.
    h.context.selectedPiece = h.table.children.find(el => el.dataset.unitId === 'A');
    h.gp.render();
    assert.equal(h.table.querySelectorAll('.gp-reach').length, 0);
    assert.ok(h.table.querySelectorAll('.gp-lane').length > 0);
    // An enemy that can never turn (Drill 0, no Reform) keeps its forward and backward corridors.
    const stuck = battle([U('A', 'p1', 400, 400, { shoot: 0 }), U('B', 'p2', 400, 250, { angle: 180, mobility: 0 })]);
    const k = client(stuck, { ai: 'p2' });
    k.context.selectedPiece = k.table.children.find(el => el.dataset.unitId === 'B');
    k.gp.render();
    const enemyLanes = k.table.querySelectorAll('.gp-enemy-lane');
    assert.equal(enemyLanes.length, 2);
    assert.ok(enemyLanes.some(lane => lane.classList.contains('gp-charge')));
    assert.ok(enemyLanes.some(lane => lane.classList.contains('gp-back')));
    assert.equal(k.table.querySelectorAll('.gp-reach').length, 0);
});

test('network banner updates keep the solo player label free of hosting terminology', () => {
    const elements = new Map(['player-role-badge', 'room-code-text', 'network-status'].map(id => [id, element()]));
    const document = { getElementById: id => elements.get(id) };
    const source = appSource.slice(appSource.indexOf('function updatePlayerBanner('), appSource.indexOf('function hostGame('));
    new Function('document', 'GuidedPlay', `const getLocalBidPlayerKey = () => 'p1'; ${source}; updatePlayerBanner();`)(document, { aiPlayer: () => 'p2' });
    assert.equal(elements.get('player-role-badge').textContent, '');
});
