const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('fullscreen fits the whole board between the controls and the battle log', () => {
    const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
    const elements = Object.fromEntries(['container', 'table-container', 'game-table', 'left-sidebar', 'battle-log-panel']
        .map(id => [id, { style: {}, classList: { contains: () => false, toggle() {} } }]));
    const app = elements.container;
    const field = elements['table-container'];
    const log = elements['battle-log-panel'];
    Object.defineProperty(log, 'offsetWidth', { get: () => Math.round(Math.max(116, Math.min(208, app.clientWidth * .13))) });
    Object.defineProperties(field, {
        clientWidth: { get: () => app.clientWidth - parseFloat(elements['left-sidebar'].style.width) - log.offsetWidth - 16 },
        clientHeight: { get: () => app.clientHeight }
    });
    const document = { fullscreenElement: {}, getElementById: id => elements[id] };
    const context = vm.createContext({
        document, window: {}, tableWidthPx: 960, tableHeightPx: 720,
        isRightSidebarHidden: false, isHost: true, currentScale: 1,
        getFullscreenElement: () => document.fullscreenElement
    });
    vm.runInContext(source.slice(source.indexOf('function battleLogSpace('), source.indexOf("window.addEventListener('resize', fitTableToScreen)")), context);
    for (const [width, height] of [[568, 320], [844, 390], [960, 600], [1024, 768], [1180, 820], [1280, 800], [1366, 1024], [1920, 1080], [2560, 1440]]) {
        app.clientWidth = width;
        app.clientHeight = height;
        vm.runInContext('fitTableToScreen()', context);
        const panelWidth = parseFloat(elements['left-sidebar'].style.width);
        assert.ok(context.currentScale * 720 <= height - 4, 'Board fits vertically');
        assert.ok(context.currentScale * 960 + panelWidth + log.offsetWidth + 20 <= width + 0.01, 'Board fits horizontally between both panels');
        assert.equal(context.currentScale, Math.min((height - 4) / 720, (field.clientWidth - 4) / 960), 'Board uses the maximum undistorted scale');
        assert.ok(panelWidth >= 208 && panelWidth <= 720);
        assert.equal(field.style.minWidth, '', 'No width reservation can push the board offscreen');
    }
    document.fullscreenElement = null;
    vm.runInContext('fitTableToScreen()', context);
    assert.equal(field.style.minWidth, '', 'Normal mode releases the fullscreen width reservation');
    assert.equal(context.currentScale, Math.min((app.clientHeight - 4) / 720, (field.clientWidth - 4) / 960), 'Normal mode also fits the available rectangle');
});

test('automatic sizing narrows the controls when the log would otherwise take space from the board', () => {
    const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
    const context = vm.createContext({ tableWidthPx: 960, tableHeightPx: 720 });
    vm.runInContext(source.slice(source.indexOf('function calculatePanelLayout('), source.indexOf('function fitTableToScreen(')), context);
    for (const [width, height] of [[1024, 768], [1180, 820], [1280, 800], [1366, 1024], [1920, 1080]]) {
        const logSpace = Math.round(Math.max(116, Math.min(208, width * .13))) + 8;
        const layout = context.calculatePanelLayout(width, height, null, logSpace);
        assert.equal(layout.twoColumns, false);
        assert.ok(layout.left >= 208 && layout.left <= 320);
        assert.ok(layout.left + layout.boardScale * 960 + logSpace + 12 <= width + 0.01);
        if (layout.left > 208) assert.equal(layout.boardScale, (height - 4) / 720, 'The sidebar only uses surplus width');
        assert.ok(layout.boardScale * 720 <= height - 4 + 0.01);
    }
    const phone = context.calculatePanelLayout(844, 390);
    assert.equal(phone.twoColumns, false, 'Phone orders use a single column');
    assert.ok(phone.left <= 270, 'Leave most of the landscape viewport for the field');
});

test('manual sidebar widths reflow at the column boundary and leave a usable battlefield', () => {
    const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
    const context = vm.createContext({ tableWidthPx: 960, tableHeightPx: 720 });
    vm.runInContext(source.slice(source.indexOf('function calculatePanelLayout('), source.indexOf('function fitTableToScreen(')), context);
    for (const preferred of [208, 300, 419, 420, 560, 720]) {
        const layout = context.calculatePanelLayout(1920, 1080, preferred);
        assert.equal(layout.left, preferred);
        assert.equal(layout.twoColumns, preferred >= 420);
        assert.ok(layout.boardScale * 960 + layout.left + 12 <= 1920);
    }
    assert.equal(context.calculatePanelLayout(1920, 1080, 0).left, 208);
    assert.equal(context.calculatePanelLayout(800, 600, 720).left, 480);
    assert.equal(context.calculatePanelLayout(800, 600, 720, 124).left, 356, 'Manual resizing also reserves room for the log');
});
