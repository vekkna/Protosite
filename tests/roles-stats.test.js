const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');

function loadStatsContext(parse) {
    const context = vm.createContext({
        URL, console: { log() {}, warn() {} },
        localStorage: { getItem: () => null, setItem() {} },
        Papa: { parse }, globalRulesDB: []
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
    let requests = 0;
    const context = loadStatsContext((_url, options) => {
        requests++;
        options.error(new Error('Offline'));
    });
    const rows = await vm.runInContext('loadStats()', context);
    assert.equal(rows.length, 13);
    await vm.runInContext('loadStats()', context);
    assert.equal(requests, 2);
});
