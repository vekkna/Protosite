const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');

function loadStatsContext(parse) {
    const context = vm.createContext({
        URL, console: { log() {}, warn() {} },
        localStorage: { getItem: () => null, setItem() {} },
        Papa: { parse }, globalRulesDB: [], UnitArtwork: require('../unit-artwork')
    });
    vm.runInContext(source.slice(source.indexOf('const SHEET_URL'), source.indexOf('function updateStatsPanel(')), context);
    return context;
}

test('RolesStats loads public profiles even with immediate fallback data, and renders sheet columns', async () => {
    let requests = 0;
    const context = loadStatsContext((url, options) => {
        requests++;
        const parsed = new URL(url);
        assert.equal(parsed.pathname, '/spreadsheets/d/1ONrDG-NfkjDlBoJvRlDNbhBSsCUkxlD_tbmZNQom1PU/export');
        assert.equal(parsed.searchParams.get('gid'), '663136589');
        options.complete({ data: [
            { Unit: 'Light Infantry', Speed: '7', Drill: '4', Melee: '3', Ranged: '1*/4', Def: '4' },
            { Unit: '', Quantity: '24' }
        ] });
    });
    const rows = await vm.runInContext('loadStats()', context);
    assert.equal(requests, 1);
    assert.equal(rows.length, 1);
    const markup = vm.runInContext("buildStatsMarkup('Light Infantry')", context);
    assert.ok(markup.includes('>7/4</span>'));
    assert.ok(markup.includes('>1*/4</span>'));
    await vm.runInContext('loadStats()', context);
    assert.equal(requests, 1, 'successful live data is reused');
});

test('RolesStats connection failures preserve playable fallback profiles and allow retry', async () => {
    let requests = 0, snapshotRequests = 0;
    const context = loadStatsContext((url, options) => {
        if (url === 'unit-cards-source.csv') snapshotRequests++; else requests++;
        options.error(new Error('Offline'));
    });
    const rows = await vm.runInContext('loadStats()', context);
    assert.equal(rows.length, 13);
    await vm.runInContext('loadStats()', context);
    assert.equal(requests, 2);
    assert.equal(snapshotRequests, 2, 'the local snapshot is tried after each failed sheet request');
});

test('RolesStats falls back to the local unit-cards-source.csv snapshot when the sheet is unreachable', async () => {
    const context = loadStatsContext((url, options) => {
        if (url !== 'unit-cards-source.csv') { options.error(new Error('Offline')); return; }
        options.complete({ data: [{ Unit: 'Archers', Speed: '6', Drill: '1', Melee: '1', Ranged: '4/99', Def: '3' }, { Unit: '', Quantity: '24' }] });
    });
    const rows = await vm.runInContext('loadStats()', context);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Ranged, '4/99');
});

test('Built-in fallback stats match the unit-cards-source.csv snapshot of the sheet', () => {
    const context = loadStatsContext(() => {});
    const fallback = JSON.parse(vm.runInContext('JSON.stringify(FALLBACK_DEFAULT_UNITS)', context));
    const [head, ...lines] = fs.readFileSync(require.resolve('../unit-cards-source.csv'), 'utf8').trim().split(/\r?\n/).map(l => l.split(','));
    const snapshot = lines.filter(r => r[0]).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
    assert.equal(fallback.length, snapshot.length);
    for (const [i, row] of snapshot.entries()) {
        for (const key of ['Unit', 'Speed', 'Drill', 'Melee', 'Ranged', 'Def', 'Footprint', 'Quantity']) {
            assert.equal(fallback[i][key], row[key], `${row.Unit} ${key}: run node tools/sync-stats.js, then copy the sheet values into FALLBACK_DEFAULT_UNITS in app.js`);
        }
    }
});

test('Unit artwork reads sheet filenames and safely falls back to the local mapping', () => {
    const artwork = require('../unit-artwork');
    assert.equal(artwork.fileFor({ Unit: 'Light Cavalry', Icon: 'images/heavyinfantry.png' }), 'heavyinfantry.png');
    assert.equal(artwork.fileFor({ Unit: 'Light Cavalry', Icon: '' }), artwork.files['Light Cavalry']);
    assert.equal(artwork.fileFor({ Unit: 'Light Cavalry', Icon: '../outside.png' }), artwork.files['Light Cavalry']);
    assert.ok(artwork.offsetY({ Unit: 'Light Cavalry' }) < 0);
    assert.equal(artwork.offsetY({ Unit: 'Cavalry' }), 0);
    assert.equal(artwork.screenFileFor({ Unit: 'Light Cavalry', Icon: 'images/heavyinfantry.png' }), 'heavyinfantry.png');
    for (const Unit of Object.keys(artwork.files)) {
        const file = artwork.screenFileFor({ Unit });
        assert.ok(fs.statSync(require.resolve('../images/' + file)).size > 0);
        if (/^sheet-unit-icon-.*\.(png|jpe?g|webp)$/i.test(artwork.fileFor({ Unit }))) {
            assert.match(file, /\.screen\.webp$/);
        }
    }
});

test('Unit profiles show army artwork and live stats without the removed full-card view', () => {
    const context = loadStatsContext(() => {});
    const markup = vm.runInContext("buildStatsMarkup({ dataset: { name: 'Light Cavalry', owner: 'p2' }, _unitStats: { Unit: 'Light Cavalry', Speed: '16', Drill: '3', Melee: '4', Def: '3' } })", context);
    assert.ok(markup.includes('army-orange'));
    assert.ok(markup.includes('stats-unit-artwork'));
    assert.ok(!markup.includes('stats-unit-card-image'));
    assert.ok(!markup.includes('stats-view-switch'));
    assert.ok(markup.includes('>16/3</span>'), 'live stats remain available in Artwork + stats view');
    assert.ok(vm.runInContext("buildStatsMarkup('Light Cavalry')", context).includes('army-blue'));
    assert.ok(!vm.runInContext("buildStatsMarkup({ Unit: 'Custom unit', Speed: '4' })", context).includes('stats-unit-card-image'));
});
