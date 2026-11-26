#!/usr/bin/env node
/*
 * V4 behaviour probe: plays whole games and counts what matters under V4 rules.
 *   node tools/v4-probe.js [games=10] [A=hard] [B=v9] [--offset=N]
 * Reports, per player: charges, charges that hit a flank (and so shake the target), strikes made,
 * activations that ended with one of its units Shaken, and mid-move pivots before a charge.
 */
const E = require('../engine');
const fs = require('fs'), path = require('path');
const AI = require('../ai');
const { newGame, loadRoster, toMove } = require('./selfplay');
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makePlayer(spec, seed) {
    const [name, ...mods] = spec.split(':'), random = rng(seed), weights = {};
    for (const m of mods.join(':').split(',').filter(Boolean)) { const [k, v] = m.split('='); weights[k] = Number(v); }
    const file = path.join(__dirname, 'baselines', `ai-${name}.js`), brain = fs.existsSync(file) ? require(file) : AI, level = brain === AI ? name : 'hard';
    return (s, me, events) => {
        const choice = brain.choose(s, me, { level, random, weights });
        let st = s;
        for (const a of choice.actions) {
            if (st.phase === 'finished') break;
            if (a.type === 'endActivation' && !st.activation) continue;
            try { const next = E.apply(st, a); events.push(...next.events.filter(e => e.seq > st.seq)); st = next; } catch (e) { break; }
        }
        if (st === s) throw new Error(`${spec} made no progress`);
        return st;
    };
}

function stats() { return { charges: 0, flankCharges: 0, pivotCharges: 0, strikes: 0, shots: 0, shakenTurns: 0, enemyShakenTurns: 0, activations: 0, reforms: 0, withdraws: 0 }; }
const RULES = (process.argv.find(x => x.startsWith('--rules=')) || '--rules=v4').split('=')[1];   // v4 | v5

function play(seed, specs, roster) {
    let s = newGame(seed, roster, RULES), n = 0;
    const players = { p1: makePlayer(specs.p1, seed + 11), p2: makePlayer(specs.p2, seed + 23) }, st = { p1: stats(), p2: stats() };
    while (s.phase !== 'finished' && s.round <= 30 && n++ < 4000) {
        const p = toMove(s), before = s;
        // Step through the decision one engine action at a time: the engine keeps only the last action's events.
        const events = [];
        s = players[p](s, p, events);
        if (before.phase !== 'command') continue;
        const newLines = s.log.slice(0, Math.max(0, s.log.indexOf(before.log[0])));
        st[p].reforms += newLines.filter(l => l.includes(' reforms, ')).length;
        st[p].withdraws += newLines.filter(l => l.includes(' withdraws from ')).length;
        for (const e of events) {
            if (e.type === 'charge') {
                const me = st[p]; me.charges += 1;
                const cut = before.log.length ? s.log.indexOf(before.log[0]) : s.log.length, lines = s.log.slice(0, cut < 0 ? s.log.length : cut).reverse();
                const moved = lines.findIndex(l => l.includes(' advances ')), turned = lines.findIndex((l, i) => i > moved && l.includes(' pivots '));
                if (moved >= 0 && turned > moved) me.pivotCharges += 1;
                const u = s.units.find(x => x.id === e.unitId);
                if (u && e.targets.some(id => { const t = s.units.find(x => x.id === id); return t && !E.touchesFront(t, u); })) me.flankCharges += 1;
            }
            if (e.type === 'attack') st[p][e.kind === 'shoot' ? 'shots' : 'strikes'] += 1;
        }
        if (s.phase === 'command' && !s.activation) {
            st[p].activations += 1;
            for (const u of s.units.filter(x => x.owner)) if (E.shaken(s, u)) st[p][u.owner === p ? 'shakenTurns' : 'enemyShakenTurns'] += 1;
        }
    }
    return { winner: s.winner, rounds: s.round, st };
}

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const offset = Number((process.argv.find(x => x.startsWith('--offset=')) || '').split('=')[1]) || 0;
const games = Number(args[0]) || 10, A = args[1] || 'hard', B = args[2] || 'v9', roster = loadRoster();
const tot = { A: stats(), B: stats() }, tally = { A: 0, B: 0, draw: 0 }, rounds = [];
for (let g = 0; g < games; g++) {
    const seed = Math.floor(g / 2) + 1 + offset, aIs = g % 2 ? 'p2' : 'p1', bIs = E.other(aIs);
    const r = play(seed, aIs === 'p1' ? { p1: A, p2: B } : { p1: B, p2: A }, roster);
    if (!r.winner) tally.draw++; else tally[r.winner === aIs ? 'A' : 'B']++;
    rounds.push(r.rounds);
    for (const [k, side] of [['A', aIs], ['B', bIs]]) for (const f in tot[k]) tot[k][f] += r.st[side][f];
}
console.log(`[${RULES}] ${A} v ${B}: ${tally.A}-${tally.B} (${tally.draw} unfinished), mean rounds ${(rounds.reduce((a, b) => a + b, 0) / games).toFixed(1)}`);
for (const k of ['A', 'B']) console.log(k === 'A' ? A : B, JSON.stringify(tot[k]));
