const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function displayHarness({ supported = true, lockFails = false, fullscreenFails = false } = {}) {
    const elements = Object.fromEntries(['fullscreen-btn', 'landscape-btn', 'landscape-help', 'display-help']
        .map(id => [id, {}]));
    const calls = [];
    const document = {
        getElementById: id => elements[id],
        documentElement: supported ? {
            async requestFullscreen() {
                calls.push('fullscreen');
                if (fullscreenFails) throw new Error('Denied');
                document.fullscreenElement = {};
            }
        } : {},
        async exitFullscreen() { document.fullscreenElement = null; }
    };
    const orientation = supported ? {
        async lock(value) {
            calls.push(value);
            if (lockFails) throw new Error('Denied');
        },
        unlock() { calls.push('unlock'); }
    } : {};
    const context = vm.createContext({
        document, window: { screen: { orientation } }, console,
        fitTableToScreen() {}, requestAnimationFrame: cb => cb()
    });
    const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
    vm.runInContext(source.slice(source.indexOf('function getFullscreenElement('),
        source.indexOf("document.addEventListener('fullscreenchange'")), context);
    return { context, elements, calls, document };
}

test('display recommendations do not enter fullscreen or lock orientation without a click', () => {
    const h = displayHarness();
    h.context.updateFullscreenUI();
    assert.deepEqual(h.calls, []);
    assert.equal(h.elements['landscape-btn'].hidden, false);
    assert.equal(h.elements['landscape-btn'].textContent, 'Landscape + Full Screen');
});

test('landscape action enters fullscreen then locks; fullscreen alone does not lock', async () => {
    const h = displayHarness();
    await h.context.requestLandscape();
    assert.deepEqual(h.calls, ['fullscreen', 'landscape']);
    assert.equal(h.elements['landscape-btn'].disabled, false);
    assert.equal(h.elements['landscape-btn'].textContent, 'Use Landscape');
    h.document.fullscreenElement = null;
    h.context.handleFullscreenChange();
    assert.equal(h.calls.at(-1), 'unlock');
    const fullscreenOnly = displayHarness();
    await fullscreenOnly.context.toggleFullscreen();
    assert.deepEqual(fullscreenOnly.calls, ['fullscreen']);
});

test('unsupported or denied orientation and fullscreen provide manual rotation guidance', async () => {
    for (const options of [{ supported: false }, { lockFails: true }, { fullscreenFails: true }]) {
        const h = displayHarness(options);
        h.context.updateFullscreenUI();
        if (options.supported === false) {
            assert.equal(h.elements['landscape-btn'].hidden, true);
            assert.equal(h.elements['fullscreen-btn'].disabled, true);
        }
        await h.context.requestLandscape();
        assert.match(h.elements['landscape-help'].textContent, /enable auto-rotate/);
        assert.equal(h.elements['landscape-btn'].disabled, false);
    }
});
