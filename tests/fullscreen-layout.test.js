const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('fullscreen fills board height on narrow and wide screens, then restores normal fitting', () => {
    const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
    const elements = Object.fromEntries(['container', 'table-container', 'game-table', 'left-sidebar', 'right-sidebar', 'right-sidebar-toggle']
        .map(id => [id, { style: {}, classList: { contains: () => false, toggle() {} } }]));
    const app = elements.container;
    const field = elements['table-container'];
    Object.defineProperties(field, {
        clientWidth: { get: () => parseFloat(field.style.minWidth) || 700 },
        clientHeight: { get: () => app.clientHeight }
    });
    const document = { fullscreenElement: {}, getElementById: id => elements[id] };
    const context = vm.createContext({
        document, window: {}, tableWidthPx: 960, tableHeightPx: 720,
        isRightSidebarHidden: false, isHost: true, currentScale: 1,
        getFullscreenElement: () => document.fullscreenElement
    });
    vm.runInContext(source.slice(source.indexOf('function calculatePanelLayout('), source.indexOf("window.addEventListener('resize', fitTableToScreen)")), context);
    for (const [width, height] of [[1280, 900], [1920, 1080], [2560, 1440]]) {
        app.clientWidth = width;
        app.clientHeight = height;
        vm.runInContext('fitTableToScreen()', context);
        assert.ok(Math.abs(context.currentScale * 720 - (height - 4)) < 0.01, 'Board spans the available height');
        assert.ok(parseFloat(elements['left-sidebar'].style.width) >= 180);
        assert.ok(parseFloat(elements['right-sidebar'].style.width) >= 180);
    }
    document.fullscreenElement = null;
    vm.runInContext('fitTableToScreen()', context);
    assert.equal(field.style.minWidth, '', 'Normal mode releases the fullscreen width reservation');
    assert.equal(context.currentScale, (700 - 4) / 960, 'Normal mode fits the narrower board container');
});
