#!/usr/bin/env node
/*
 * Self-play tournament for the AI.
 *   node tools/selfplay.js [games=20] [A=hard] [B=random] [--verbose] [--offset=N]
 * A and B are: easy | normal | hard | random | brawler | passive, optionally with weight overrides, e.g. hard:approach=0.03
 * --rules=reform plays the Reform variant (no Rally; Reform action; pivots only during a Move).
 * Each pairing is played twice per seed with sides swapped, on the same draft pool and terrain deck.
 */
const fs = require('fs');
const path = require('path');
const E = require('../engine');
const AI = require('../ai');

function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const SIZE = { SW: [88 / 25.4 * 20, 63 / 25.4 * 20], SN: [63 / 25.4 * 20, 88 / 25.4 * 20] };

function loadRoster() {
    const rows = fs.readFileSync(path.join(__dirname, '..', 'unit-cards-source.csv'), 'utf8').trim().split(/\r?\n/).map(r => r.split(','));
    const head = rows.shift(), col = n => head.indexOf(n), roster = [];
    for (const r of rows) {
        if (!r[col('Unit')]) continue;
        for (let i = 0; i < (r[col('Quantity')] === undefined || r[col('Quantity')].trim() === '' ? 1 : parseInt(r[col('Quantity')], 10)); i++) roster.push({ name: r[col('Unit')], footprint: r[col('Footprint')] || 'SW',
            stats: { Speed: r[col('Speed')], Drill: r[col('Drill')], Melee: r[col('Melee')], Ranged: r[col('Ranged')], Def: r[col('Def')] } });
    }
    return roster;
}
function newGame(seed, roster, rules = 'classic') {
    const rnd = rng(seed * 7919 + 1), pool = roster.slice().sort(() => rnd() - 0.5).slice(0, 12);
    const units = pool.map((u, i) => ({ id: 'u' + i, name: u.name, stats: u.stats, w: SIZE[u.footprint][0], h: SIZE[u.footprint][1],
        x: 70 + (i % 4) * 250, y: 190 + Math.floor(i / 4) * 140 }));
    const deck = [...['forest', 'hills', 'field', 'swamp', 'mountain'].flatMap(t => [t, t]), ...Array(10).fill('x')].sort(() => rnd() - 0.5).slice(0, 12);
    return E.createGame({ units, terrainDeck: deck, seed, firstPick: seed % 2 ? 'p1' : 'p2', tileSize: SIZE.SW[0], rules });
}

/** Baseline bots. Each returns a new state after one decision. */
const bots = {
    random(s, me, rnd) {
        const acts = E.legalActions(s).filter(a => !a.player || a.player === me);
        return E.apply(s, acts[Math.floor(rnd() * acts.length)]);
    },
    /** Deploys, then never does anything: a sitting duck the AI should destroy quickly. */
    passive(s, me, rnd) {
        if (s.phase === 'bidding') return E.apply(s, { type: 'bid', player: me, value: 1 });
        if (s.phase === 'command') return E.apply(s, { type: s.activation ? 'endActivation' : 'pass' });
        const acts = E.legalActions(s); return E.apply(s, acts[Math.floor(rnd() * acts.length)]);
    },
    /** Always attacks if it can, otherwise charges or walks straight at the nearest enemy. */
    brawler(s, me, rnd) {
        const acts = E.legalActions(s).filter(a => !a.player || a.player === me);
        const attack = acts.find(a => a.type === 'strike' || a.type === 'shoot');
        if (attack) return E.apply(s, attack);
        if (s.phase !== 'command') return E.apply(s, acts[Math.floor(rnd() * acts.length)]);
        if (!s.activation) { const go = acts.filter(a => a.type === 'activate'); return E.apply(s, go.length ? go[Math.floor(rnd() * go.length)] : acts[0]); }
        const o = E.unitOptions(s, s.activation.unitId);
        if (o.forward.max > 0.3 && s.activation.action !== 'move') return E.apply(s, { type: 'move', inches: o.forward.max });
        return E.apply(s, { type: 'endActivation' });
    }
};
function makePlayer(spec, seed) {
    const [name, ...mods] = spec.split(':'), rnd = rng(seed), weights = {};
    for (const m of mods.join(':').split(',').filter(Boolean)) { const [k, v] = m.split('='); weights[k] = Number(v); }
    if (bots[name]) return (s, me) => bots[name](s, me, rnd);
    // "v1" (or any file in tools/baselines/ai-<name>.js) plays an earlier frozen version of the AI at hard level.
    const frozen = fs.existsSync(path.join(__dirname, 'baselines', `ai-${name}.js`)) ? require(`./baselines/ai-${name}.js`) : null;
    const brain = frozen || AI, level = frozen ? 'hard' : name;
    return (s, me) => {
        const choice = brain.choose(s, me, { level, random: rnd, weights });
        if (process.env.VERBOSE) console.log(`  [${me} ${spec}] ${choice.note}`);
        const next = AI.carryOut(s, choice.actions);
        if (next === s) throw new Error(`${spec} made no progress in ${s.phase}: ${choice.note} ${JSON.stringify(choice.actions)}`);
        return next;
    };
}
function toMove(s) {
    if (s.phase === 'draft') return s.draft.picker;
    if (s.phase === 'bidding') return s.bids.p1 === null ? 'p1' : 'p2';
    return E.activePlayer(s);
}
function playGame(seed, specs, roster, maxRounds = 30, rules = 'classic') {
    let s = newGame(seed, roster, rules), decisions = 0;
    const players = { p1: makePlayer(specs.p1, seed + 11), p2: makePlayer(specs.p2, seed + 23) }, time = { p1: 0, p2: 0 }, count = { p1: 0, p2: 0 };
    while (s.phase !== 'finished' && s.round <= maxRounds && decisions < 4000) {
        const p = toMove(s), t0 = performance.now();
        s = players[p](s, p);
        if (s.phase !== 'draft') { time[p] += performance.now() - t0; count[p] += 1; }
        decisions += 1;
    }
    return { winner: s.winner, rounds: s.round, time, count, routed: s.routed, state: s };
}

function main() {
    const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
    if (process.argv.includes('--verbose')) process.env.VERBOSE = '1';
    const offset = Number((process.argv.find(x => x.startsWith('--offset=')) || '').split('=')[1]) || 0;   // use fresh seeds to extend an earlier run
    const rules = (process.argv.find(x => x.startsWith('--rules=')) || '--rules=classic').split('=')[1];   // classic | reform
    const games = Number(args[0]) || 20, A = args[1] || 'hard', B = args[2] || 'random', roster = loadRoster();
    const tally = { A: 0, B: 0, draw: 0 }, rounds = [], ms = { A: [], B: [] };
    for (let g = 0; g < games; g++) {
        const seed = Math.floor(g / 2) + 1 + offset, aIs = g % 2 ? 'p2' : 'p1';
        const r = playGame(seed, aIs === 'p1' ? { p1: A, p2: B } : { p1: B, p2: A }, roster, 30, rules);
        if (!r.winner) tally.draw += 1; else tally[r.winner === aIs ? 'A' : 'B'] += 1;
        rounds.push(r.rounds);
        ms.A.push(r.time[aIs] / Math.max(1, r.count[aIs])); ms.B.push(r.time[E.other(aIs)] / Math.max(1, r.count[E.other(aIs)]));
        if (process.env.VERBOSE) console.log(`game ${g + 1}: ${r.winner ? (r.winner === aIs ? A : B) : 'no result'} after ${r.rounds} rounds`);
    }
    const avg = list => (list.reduce((a, b) => a + b, 0) / list.length).toFixed(1);
    const decided = tally.A + tally.B, p = decided ? tally.A / decided : 0.5, se = decided ? Math.sqrt(p * (1 - p) / decided) : 0;
    console.log(`${A} vs ${B}: ${tally.A}-${tally.B} (${tally.draw} unfinished) over ${games} games | A wins ${(p * 100).toFixed(0)}% ±${(se * 196).toFixed(0)} | avg rounds ${avg(rounds)} | ms/decision A ${avg(ms.A)} B ${avg(ms.B)}`);
}
if (require.main === module) main();
module.exports = { playGame, newGame, loadRoster, makePlayer, toMove };
