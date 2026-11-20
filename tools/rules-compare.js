#!/usr/bin/env node
/*
 * Play AI-v-AI games under one rules variant and report what units actually did.
 *   node tools/rules-compare.js [games=40] [level=normal] --rules=classic|reform [--offset=N] [--json=out.json]
 * The same seeds give the same draft pool and terrain deck under either rules set, so runs can be compared.
 */
const fs = require('fs');
const E = require('../engine');
const AI = require('../ai');
const { newGame, loadRoster, toMove } = require('./selfplay');

function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/** What kind of activation a list of actions was. */
function kindOf(actions, before, events, unitId) {
    const t = actions.map(a => a.type);
    if (actions.some(a => a.type === 'pivot' && a.reform)) return 'reform';
    if (t.includes('rally')) return 'rally';
    const ub = before.units.find(u => u.id === unitId);
    const charged = events.some(e => e.type === 'charge');
    if (charged) return t.includes('pivot') ? 'pivot+charge' : 'charge';
    if (t.includes('strike')) return 'strike';
    if (t.includes('shoot')) return t.includes('pivot') ? 'pivot+shoot' : 'shoot';
    const pivots = t.filter(x => x === 'pivot').length;
    if (t.includes('move')) return pivots ? 'move+pivot' : 'move';
    if (pivots) return ub && ub.mobility === 0 ? 'extraPivot' : 'pivot only';
    return 'hold';
}

function play(seed, level, rules, roster) {
    let s = newGame(seed, roster, rules), decisions = 0;
    const r = { p1: rng(seed + 11), p2: rng(seed + 23) };
    const acts = [], routs = [], tally = { shoot: 0, strike: 0 }, dealt = {};
    const drafted = { p1: [], p2: [] };
    while (s.phase !== 'finished' && s.round <= 30 && decisions < 4000) {
        const p = toMove(s), before = s;
        if (s.phase !== 'draft' && !drafted.p1.length) for (const u of s.units) if (u.owner) drafted[u.owner].push(u.name);
        const choice = AI.choose(s, p, { level, random: r[p] });
        const events = [];
        for (const x of choice.actions) {
            if (s.phase === 'finished') break;
            if (x.type === 'endActivation' && !s.activation) continue;
            try { s = E.apply(s, x); } catch (e) { break; }
            events.push(...s.events);
        }
        decisions += 1;
        for (const e of events) {
            if (e.type === 'attack') { tally[e.kind] += 1; dealt[e.attacker] = (dealt[e.attacker] || 0) + e.strain; }
            if (e.type === 'rout') routs.push(e.name);
        }
        const a = choice.actions.find(x => x.type === 'activate');
        if (before.phase === 'command' && a) {
            const u = before.units.find(x => x.id === a.unitId);
            acts.push({ name: u.name, kind: kindOf(choice.actions, before, events, a.unitId), master: before.master === p, round: before.round });
        }
    }
    return { seed, rules, winner: s.winner, rounds: s.round, acts, routs, strikes: tally.strike, shots: tally.shoot, dealt, drafted, routed: s.routed, starting: s.starting };
}

function main() {
    const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
    const flag = (n, d) => { const f = process.argv.find(x => x.startsWith(`--${n}=`)); return f ? f.split('=')[1] : d; };
    const games = Number(args[0]) || 40, level = args[1] || 'normal', rules = flag('rules', 'classic'), offset = Number(flag('offset', 0));
    const roster = loadRoster(), out = [];
    for (let g = 0; g < games; g++) {
        out.push(play(g + 1 + offset, level, rules, roster));
        if (process.env.VERBOSE) console.error(`game ${g + 1}: ${out[g].winner} in ${out[g].rounds}`);
    }
    const json = flag('json', null);
    if (json) fs.writeFileSync(json, JSON.stringify(out));
    summarise(out, `${rules} / ${level}`);
}

function summarise(out, title) {
    const n = out.length, avg = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const done = out.filter(g => g.winner);
    console.log(`\n== ${title}: ${n} games, ${n - done.length} unfinished by round 30`);
    console.log(`rounds: mean ${avg(done.map(g => g.rounds)).toFixed(2)}, p1 wins ${done.filter(g => g.winner === 'p1').length}/${done.length}`);
    const acts = out.flatMap(g => g.acts), kinds = {};
    for (const a of acts) kinds[a.kind] = (kinds[a.kind] || 0) + 1;
    console.log(`activations: ${(acts.length / n).toFixed(1)} per game; attacks per game: strikes ${avg(out.map(g => g.strikes)).toFixed(1)}, shots ${avg(out.map(g => g.shots)).toFixed(1)}`);
    console.log('activation kinds: ' + Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / acts.length).toFixed(1)}%`).join(', '));
    // Per unit type: share of activations that were attacks, how often it routed.
    const by = {};
    for (const a of acts) { const b = by[a.name] ||= { n: 0, attack: 0, reform: 0, rally: 0 }; b.n++; if (/charge|strike|shoot/.test(a.kind)) b.attack++; if (a.kind === 'reform' || a.kind === 'extraPivot') b.reform++; if (a.kind === 'rally') b.rally++; }
    const routs = {}, dealt = {}, fielded = {}, won = {};
    for (const g of out) {
        for (const r of g.routs) routs[r] = (routs[r] || 0) + 1;
        for (const [k, v] of Object.entries(g.dealt)) dealt[k] = (dealt[k] || 0) + v;
        for (const side of ['p1', 'p2']) for (const nm of g.drafted[side]) { fielded[nm] = (fielded[nm] || 0) + 1; if (g.winner === side) won[nm] = (won[nm] || 0) + 1; }
    }
    console.log('unit            fielded  win%  acts/unit  attack%  reform%  rally%  strain dealt/unit  rout%');
    for (const [k, b] of Object.entries(by).sort()) {
        const f = fielded[k] || 1;
        console.log(`${k.padEnd(16)}${String(f).padStart(7)}  ${(100 * (won[k] || 0) / f).toFixed(0).padStart(4)}  ${(b.n / f).toFixed(1).padStart(9)}  ${(100 * b.attack / b.n).toFixed(0).padStart(7)}  ${(100 * b.reform / b.n).toFixed(0).padStart(7)}  ${(100 * b.rally / b.n).toFixed(0).padStart(6)}  ${((dealt[k] || 0) / f).toFixed(1).padStart(17)}  ${(100 * (routs[k] || 0) / f).toFixed(0).padStart(5)}`);
    }
}

if (require.main === module) main();
module.exports = { play, summarise };
