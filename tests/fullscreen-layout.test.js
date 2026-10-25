const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('fullscreen fits the whole board beside the play panel at tablet and desktop sizes', () => {
    const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
    const elements = Object.fromEntries(['container', 'table-container', 'game-table', 'left-sidebar', 'right-sidebar', 'right-sidebar-toggle']
        .map(id => [id, { style: {}, classList: { contains: () => false, toggle() {} } }]));
    const app = elements.container;
    const field = elements['table-container'];
    Object.defineProperties(field, {
        clientWidth: { get: () => app.clientWidth - parseFloat(elements['left-sidebar'].style.width) - 8 },
        clientHeight: { get: () => app.clientHeight }
    });
    const document = { fullscreenElement: {}, getElementById: id => elements[id] };
    const context = vm.createContext({
        document, window: {}, tableWidthPx: 960, tableHeightPx: 720,
        isRightSidebarHidden: false, isHost: true, currentScale: 1,
        getFullscreenElement: () => document.fullscreenElement
    });
    vm.runInContext(source.slice(source.indexOf('function calculatePanelLayout('), source.indexOf("window.addEventListener('resize', fitTableToScreen)")), context);
    for (const [width, height] of [[960, 600], [1024, 768], [1180, 820], [1280, 800], [1366, 1024], [1920, 1080], [2560, 1440]]) {
        app.clientWidth = width;
        app.clientHeight = height;
        vm.runInContext('fitTableToScreen()', context);
        const panelWidth = parseFloat(elements['left-sidebar'].style.width);
        assert.ok(context.currentScale * 720 <= height - 4, 'Board fits vertically');
        assert.ok(context.currentScale * 960 + panelWidth + 12 <= width + 0.01, 'Board fits horizontally beside controls');
        assert.equal(context.currentScale, Math.min((height - 4) / 720, (width - panelWidth - 12) / 960), 'Board uses the maximum undistorted scale');
        assert.ok(panelWidth >= 228 && panelWidth <= 280);
        assert.equal(field.style.minWidth, '', 'No width reservation can push the board offscreen');
    }
    document.fullscreenElement = null;
    vm.runInContext('fitTableToScreen()', context);
    assert.equal(field.style.minWidth, '', 'Normal mode releases the fullscreen width reservation');
    assert.equal(context.currentScale, Math.min((app.clientHeight - 4) / 720, (field.clientWidth - 4) / 960), 'Normal mode also fits the available rectangle');
});
