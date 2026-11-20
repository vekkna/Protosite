#!/usr/bin/env node
/*
 * Download the unit stats sheet (the authoritative source) into unit-cards-source.csv.
 *   node tools/sync-stats.js
 * The browser game and the card maker read the sheet live; this snapshot is what the
 * headless tools and tests (tools/selfplay.js etc.) and the offline fallbacks use.
 * Sheet: see "stats sheet url.txt".
 */
const fs = require('fs');
const path = require('path');

const SHEET_CSV = 'https://docs.google.com/spreadsheets/d/1ONrDG-NfkjDlBoJvRlDNbhBSsCUkxlD_tbmZNQom1PU/export?format=csv&gid=663136589';
const OUT = path.join(__dirname, '..', 'unit-cards-source.csv');
const NEEDED = ['Unit', 'Speed', 'Drill', 'Melee', 'Ranged', 'Def', 'Footprint', 'Quantity'];

async function main() {
    const res = await fetch(SHEET_CSV, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Sheet download failed: HTTP ${res.status}`);
    const text = (await res.text()).replace(/^﻿/, '');
    const header = text.split(/\r?\n/)[0].split(',').map(h => h.trim());
    const missing = NEEDED.filter(h => !header.includes(h));
    if (missing.length) throw new Error(`Sheet is missing columns: ${missing.join(', ')} (got ${header.join(', ')})`);
    const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (old.replace(/\r/g, '').trim() === text.replace(/\r/g, '').trim()) { console.log('unit-cards-source.csv already matches the sheet.'); return; }
    const rows = t => Object.fromEntries(t.trim().split(/\r?\n/).slice(1).map(r => [r.split(',')[0], r]).filter(([n]) => n));
    const before = rows(old), after = rows(text);
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (before[name] !== after[name]) console.log(`  ${before[name] || '(new)'}\n→ ${after[name] || '(removed)'}`);
    }
    fs.writeFileSync(OUT, text);
    console.log('unit-cards-source.csv updated from the sheet.');
}
main().catch(err => { console.error(err.message); process.exit(1); });
