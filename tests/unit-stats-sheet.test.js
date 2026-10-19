const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CommandTracker = require('../command-tracker');

test('Unit stats integration with Google Sheet', () => {
    global.CommandTracker = CommandTracker;
    // Mock minimal browser environment to load app.js
    const elements = {};
    const classList = () => {
        const s = new Set();
        return {
            add(...c) { c.forEach(x => s.add(x)); },
            remove(...c) { c.forEach(x => s.delete(x)); },
            toggle(c, force) {
                if (force !== undefined) {
                    if (force) s.add(c); else s.delete(c);
                    return force;
                }
                if (s.has(c)) { s.delete(c); return false; }
                s.add(c); return true;
            },
            contains(x) { return s.has(x); }
        };
    };
    const makeEl = (tag) => ({
        tagName: tag.toUpperCase(),
        style: {},
        dataset: {},
        children: [],
        parentElement: null,
        classList: classList(),
        appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
        setAttribute() {},
        getAttribute() { return null; },
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        replaceChildren(...nodes) {
            this.children = [];
            nodes.forEach(n => this.appendChild(n));
        },
        getBoundingClientRect() { return { left: 0, top: 0, width: 70, height: 50 }; }
    });

    const getOrCreateEl = (id) => {
        if (!elements[id]) {
            elements[id] = makeEl('div');
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
        createElement: (tag) => makeEl(tag),
        querySelectorAll: () => [],
        querySelector: (sel) => {
            if (sel.startsWith('#')) return getOrCreateEl(sel.slice(1));
            return makeEl('div');
        },
        addEventListener() {},
        removeEventListener() {},
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
    global.Peer = class MockPeer { constructor() { this.on = () => {}; } };

    const appCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    const fn = new Function(appCode);
    fn();

    const {
        SHEET_URL, DEFAULT_UNIT_STATS, unitStatsDB, availableUnitRows,
        formatSpeedDrillStat, formatShootRangeStat, buildStatsMarkup, getUnitStats,
        createUnitDOM
    } = global.window;

    // 1. Verify Sheet URL
    assert.ok(SHEET_URL.includes('1ONrDG-NfkjDlBoJvRlDNbhBSsCUkxlD_tbmZNQom1PU'), 'Must use the user Google Sheet ID');
    assert.ok(SHEET_URL.includes('export?format=csv'), 'Must export as CSV');

    // 2. Verify all 30 units exist in the database
    assert.equal(availableUnitRows.length, 30, 'Must have exactly 30 units loaded from the sheet');

    const expectedUnits = [
        'Human Swords', 'Human Spears', 'Human Cavalry', 'Human Mounted Bowmen', 'Human Archers', 'Human Light Foot',
        'Elf Swords', 'Elf Spears', 'Elf Cavalry', 'Elf Mounted Bowmen', 'Elf Archers', 'Elf Light Foot',
        'Dwarf Swords', 'Dwarf Spears', 'Dwarf Cavalry', 'Dwarf Mounted Bowmen', 'Dwarf Archers', 'Dwarf Light Foot',
        'Orc Swords', 'Orc Spears', 'Orc Cavalry', 'Orc Mounted Bowmen', 'Orc Archers', 'Orc Light Foot',
        'Undead Swords', 'Undead Spears', 'Undead Cavalry', 'Undead Mounted Bowmen', 'Undead Archers', 'Undead Light Foot'
    ];

    expectedUnits.forEach(name => {
        assert.ok(unitStatsDB[name], `unitStatsDB must contain "${name}"`);
    });

    // 3. Test Speed and Drill formatting after boot
    assert.equal(formatSpeedDrillStat({ Move: '8/2' }), '8/2');
    assert.equal(formatSpeedDrillStat({ Move: '12/3' }), '12/3');
    assert.equal(formatSpeedDrillStat({ Speed: '10', Drill: '3' }), '10/3');
    assert.equal(formatSpeedDrillStat({ Speed: '6' }), '6');
    assert.equal(formatSpeedDrillStat({}), '-');

    // 4. Test Shoot and Range formatting after bow
    assert.equal(formatShootRangeStat({ Shoot: '-' }), '-');
    assert.equal(formatShootRangeStat({ Shoot: '1/16' }), '1/16');
    assert.equal(formatShootRangeStat({ Shoot: '0/12' }), '0/12');
    assert.equal(formatShootRangeStat({ Shoot: '2', Range: '18' }), '2/18');
    assert.equal(formatShootRangeStat({}), '-');

    // 5. Test markup generation for specific unit profiles
    const humanSwordsMarkup = buildStatsMarkup('Human Swords');
    assert.ok(humanSwordsMarkup.includes('Human Swords'), 'Must show unit name');
    assert.ok(humanSwordsMarkup.includes('icons/move.svg') && humanSwordsMarkup.includes('8/2'), 'Human Swords must show 8/2 after boot');
    assert.ok(humanSwordsMarkup.includes('icons/shoot.svg') && humanSwordsMarkup.includes('>-</span>'), 'Human Swords must show - after bow');
    assert.ok(humanSwordsMarkup.includes('icons/strike.svg') && humanSwordsMarkup.includes('>3</span>'), 'Human Swords must show Strike 3');
    assert.ok(humanSwordsMarkup.includes('icons/defence.svg') && humanSwordsMarkup.includes('>8</span>'), 'Human Swords must show Defence 8');

    const elfMountedBowmenMarkup = buildStatsMarkup('Elf Mounted Bowmen');
    assert.ok(elfMountedBowmenMarkup.includes('16/4'), 'Elf Mounted Bowmen must show 16/4 after boot');
    assert.ok(elfMountedBowmenMarkup.includes('1/14'), 'Elf Mounted Bowmen must show 1/14 after bow');
    assert.ok(elfMountedBowmenMarkup.includes('>1</span>'), 'Elf Mounted Bowmen must show Strike 1');
    assert.ok(elfMountedBowmenMarkup.includes('>5</span>'), 'Elf Mounted Bowmen must show Defence 5');

    const dwarfSpearsMarkup = buildStatsMarkup('Dwarf Spears');
    assert.ok(dwarfSpearsMarkup.includes('5/2'), 'Dwarf Spears must show 5/2 after boot');
    assert.ok(dwarfSpearsMarkup.includes('>15</span>'), 'Dwarf Spears must show Defence 15');

    // 6. Test footprint inference: cavalry vs infantry
    const infantryUnit = createUnitDOM('Human Swords', '#666', 0, 0, 0, 0);
    assert.equal(infantryUnit.dataset.footprint, 'SW', 'Infantry footprint must be SW');

    const cavalryUnit = createUnitDOM('Human Cavalry', '#666', 0, 0, 0, 0);
    assert.equal(cavalryUnit.dataset.footprint, 'SN', 'Cavalry footprint must be SN');

    const mountedBowmenUnit = createUnitDOM('Dwarf Mounted Bowmen', '#666', 0, 0, 0, 0);
    assert.equal(mountedBowmenUnit.dataset.footprint, 'SN', 'Mounted unit footprint must be SN');
});
