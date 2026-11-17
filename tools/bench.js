#!/usr/bin/env node
/*
 * Decision benchmark for the hard AI: speed, and how often its choices match a reference version.
 *   node tools/bench.js [ai=current|vN] [--states=60] [--ref=v5]
 * The positions come from v4-v-v4 games (fixed seeds), so every version is timed on the same decisions.
 * Prints ms/decision and the share of decisions that match the reference version's (same actions).
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { playGame, loadRoster, newGame, makePlayer, toMove } = require('./selfplay');

// Positions are cached (JSON) so repeated runs and profiles time only the AI.
const CACHE = path.join(os.tmpdir(), 'seize-bench-positions.json');
function positions(n) {
    if (fs.existsSync(CACHE)) { const c = JSON.parse(fs.readFileSync(CACHE, 'utf8')); if (c.n === n) return c.list; }
    const list = generate(n);
    fs.writeFileSync(CACHE, JSON.stringify({ n, list }));
    return JSON.parse(fs.readFileSync(CACHE, 'utf8')).list;
}
function generate(n) {
    const roster = loadRoster(), out = [];
    for (let seed = 101; out.length < n * 4 && seed < 140; seed++) {
        let s = newGame(seed, roster);
        const players = { p1: makePlayer('v4', seed + 11), p2: makePlayer('v4', seed + 23) };
        for (let i = 0; i < 4000 && s.phase !== 'finished' && s.round <= 30; i++) {
            const p = toMove(s);
            if (s.phase === 'command' && !s.activation) out.push({ s, p });
            s = players[p](s, p);
        }
    }
    const step = out.length / n;   // spread evenly over the games
    return Array.from({ length: n }, (_, i) => out[Math.floor(i * step)]);
}
function brain(name) { return name === 'current' ? require('../ai') : require(`./baselines/ai-${name}.js`); }
function run(name, list) {
    const AI = brain(name), picks = [];
    const t0 = performance.now();
    for (const { s, p } of list) picks.push(JSON.stringify(AI.choose(s, p, { level: 'hard', random: () => 0.5 }).actions));
    return { ms: (performance.now() - t0) / list.length, picks };
}
if (require.main === module) {
    const args = process.argv.slice(2), opt = k => (args.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
    const name = args.find(a => !a.startsWith('--')) || 'current', n = Number(opt('states')) || 60, ref = opt('ref') || 'v5';
    const list = positions(n), a = run(name, list), b = name === ref ? a : run(ref, list);
    const same = a.picks.filter((x, i) => x === b.picks[i]).length;
    console.log(`${name}: ${a.ms.toFixed(0)} ms/decision over ${list.length} positions | ${ref}: ${b.ms.toFixed(0)} ms | same choice ${same}/${list.length}`);
}
module.exports = { positions, run };
