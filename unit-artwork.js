(function (root) {
    'use strict';
    // BEGIN SHEET ICONS
    const sheetFiles = {
    "Heavy Infantry": "sheet-unit-icon-6f377584a3260434.png",
    "Fanatics": "sheet-unit-icon-d747d000ca80f32f.png",
    "Heavy Cavalry": "sheet-unit-icon-6d2a9a67d92640f9.png",
    "Infantry": "sheet-unit-icon-0ebee6583c9fd512.png",
    "Halberds": "sheet-unit-icon-6ccdcb498b904988.png",
    "Spears": "sheet-unit-icon-f81bab6f4758bdf6.png",
    "Cavalry": "sheet-unit-icon-9784acce042ed2c0.png",
    "Lancers": "sheet-unit-icon-5b41497dd2348910.png",
    "Light Infantry": "sheet-unit-icon-183dbf583e70d791.png",
    "Light Cavalry": "sheet-unit-icon-aed7b541aa1b7d07.png",
    "Archers": "sheet-unit-icon-43023274c07ca80b.png",
    "Crossbows": "sheet-unit-icon-10f7c33984da4144.png",
    "Mounted Archers": "sheet-unit-icon-b6dfc0e1163a7b6d.png"
};
    // END SHEET ICONS
    const files = {
        'Heavy Infantry': 'heavyinfantry.png',
        'Fanatics': 'ChatGPT Image Oct 23, 2026, 02_55_00 PM-5.png',
        'Heavy Cavalry': 'ChatGPT Image Oct 23, 2026, 02_54_36 PM-4.png',
        'Infantry': 'ChatGPT Image Oct 23, 2026, 02_54_34 PM-2.png',
        'Halberds': 'ChatGPT Image Oct 23, 2026, 02_54_40 PM-9.png',
        'Spears': 'ChatGPT Image Oct 23, 2026, 02_55_00 PM-6.png',
        'Cavalry': 'ChatGPT Image Oct 23, 2026, 02_54_37 PM-5.png',
        'Lancers': 'ChatGPT Image Oct 23, 2026, 02_54_37 PM-6.png',
        'Light Infantry': 'ChatGPT Image Oct 23, 2026, 02_54_33 PM-1.png',
        'Light Cavalry': 'White Galloping Horse Silhouette.png',
        'Archers': 'ChatGPT Image Oct 23, 2026, 02_54_35 PM-3.png',
        'Crossbows': 'ChatGPT Image Oct 23, 2026, 02_54_35 PM-3.png',
        'Mounted Archers': 'ChatGPT Image Oct 23, 2026, 02_54_38 PM-7.png'
    };
    function fileFor(row) {
        const supplied = String(row.Icon || '').trim().replace(/^\.?[\\/]?images[\\/]/i, '');
        if (/^[^/\\<>:"|?*]+\.(png|jpe?g|webp|svg)$/i.test(supplied)) return supplied;
        return sheetFiles[row.Unit] || files[row.Unit] || '';
    }
    function cardFor(row, colour = 'blue') {
        if (!Object.prototype.hasOwnProperty.call(files, row.Unit)) return '';
        const slug = row.Unit.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return `images/unit-cards/${slug}-${colour === 'orange' ? 'orange' : 'blue'}.png`;
    }
    const api = { files: { ...files, ...sheetFiles }, fileFor, cardFor, offsetY: row => row.Unit === 'Light Cavalry' ? -28 : 0 };
    root.UnitArtwork = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
