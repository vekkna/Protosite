#!/usr/bin/env node
/*
 * V4 unit balance study on the live sheet stats.
 *   node study.js <csv> <firstSeed> <games> <level> <out.json> [overrides]
 * overrides: "Unit Name.Stat=value;Unit.Stat=value" (Stat: Speed Drill Melee Ranged Def)
 * Plays AI v AI (same level both sides), fair pool shuffle, captures every engine event.
 */
const fs = require('fs');
const ROOT = require('path').join(__dirname, '..', '..');
const E = require(ROOT + '/engine');
const AI = require(ROOT + '/ai');
const { toMove } = require(ROOT + '/tools/selfplay');

const [csv, first, count, level = 'normal', out, overrides = ''] = process.argv.slice(2);
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const SIZE = { SW: [88 / 25.4 * 20, 63 / 25.4 * 20], SN: [63 / 25.4 * 20, 88 / 25.4 * 20] };

function loadRoster() {
    const rows = fs.readFileSync(csv, 'utf8').trim().split(/\r?\n/).map(r => r.split(','));
    const head = rows.shift(), col = n => head.indexOf(n), roster = [];
    const ov = {};
    for (const o of overrides.split(';').filter(Boolean)) { const [k, v] = o.split('='); const [u, st] = k.split('.'); (ov[u] ||= {})[st] = v; }
    for (const r of rows) {
        if (!r[col('Unit')]) continue;
        const name = r[col('Unit')];
        const stats = { Speed: r[col('Speed')], Drill: r[col('Drill')], Melee: r[col('Melee')], Ranged: r[col('Ranged')], Def: r[col('Def')], ...(ov[name] || {}) };
        const q = ov[name]?.Quantity ? Number(ov[name].Quantity) : (r[col('Quantity')] === undefined || r[col('Quantity')].trim() === '' ? 1 : parseInt(r[col('Quantity')], 10));
        for (let i = 0; i < q; i++) roster.push({ name, footprint: r[col('Footprint')] || 'SW', stats });
    }
    return roster;
}
function newGame(seed, roster) {
    const rnd = rng(seed * 7919 + 1), pool = roster.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const units = pool.slice(0, 12).map((u, i) => ({ id: 'u' + i, name: u.name, stats: u.stats, w: SIZE[u.footprint][0], h: SIZE[u.footprint][1],
        x: 70 + (i % 4) * 250, y: 190 + Math.floor(i / 4) * 140 }));
    const deck = [...['forest', 'hills', 'field', 'swamp', 'mountain'].flatMap(t => [t, t]), ...Array(10).fill('x')];
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    return E.createGame({ units, terrainDeck: deck.slice(0, 12), seed, firstPick: seed % 2 ? 'p1' : 'p2', tileSize: SIZE.SW[0], rules: 'v4' });
}
function player(seed) {
    const random = rng(seed);
    return (s, me, events) => {
        const choice = AI.choose(s, me, { level, random });
        let st = s;
        for (const a of choice.actions) {
            if (st.phase === 'finished') break;
            if (a.type === 'endActivation' && !st.activation) continue;
            try { const next = E.apply(st, a); events.push(...next.events.filter(e => e.seq > st.seq)); st = next; } catch (e) { break; }
        }
        if (st === s) throw new Error('no progress');
        return st;
    };
}
const blank = () => ({ fielded: 0, won: 0, routed: 0, attacks: 0, strikes: 0, shots: 0, dealt: 0, taken: 0, kills: 0, charges: 0, flankCharges: 0,
    flankedHits: 0, shakenEnds: 0, pickOrder: 0, survivedStrain: 0 });

const roster = loadRoster(), results = [];
for (let g = 0; g < Number(count); g++) {
    const seed = Number(first) + g;
    let s = newGame(seed, roster), n = 0;
    const P = { p1: player(seed + 11), p2: player(seed + 23) };
    const per = {}, nameOf = {}, ownerOf = {}, picks = { p1: 0, p2: 0 };
    const get = id => (per[id] ||= blank());
    while (s.phase !== 'finished' && s.round <= 30 && n++ < 5000) {
        const p = toMove(s), before = s, events = [];
        s = P[p](s, p, events);
        for (const u of s.units) if (u.owner && !before.units.find(b => b.id === u.id && b.owner)) { picks[u.owner] += 1; get(u.id).pickOrder = picks[u.owner]; }
        for (const u of s.units) if (u.owner) { nameOf[u.id] = u.name; ownerOf[u.id] = u.owner; }
        for (const e of events) {
            if (e.type === 'attack') {
                const a = get(e.attackerId), t = get(e.targetId);
                a.attacks++; a[e.kind === 'shoot' ? 'shots' : 'strikes']++; a.dealt += e.strain; t.taken += e.strain;
                const tu = before.units.find(x => x.id === e.targetId), au = before.units.find(x => x.id === e.attackerId);
                const tuNow = s.units.find(x => x.id === e.targetId) || tu, auNow = s.units.find(x => x.id === e.attackerId) || au;
                if (e.kind === 'strike' && tuNow && auNow && E.touchesFront && !E.touchesFront(tuNow, auNow)) a.flankedHits++;
            }
            if (e.type === 'charge') {
                const c = get(e.unitId); c.charges++;
                const u = s.units.find(x => x.id === e.unitId);
                if (u && e.targets.some(id => { const t = s.units.find(x => x.id === id); return t && !E.touchesFront(t, u); })) c.flankCharges++;
            }
            if (e.type === 'rout') get(e.unitId).routed = 1;
        }
        if (before.phase === 'command' && s.phase === 'command' && !s.activation)
            for (const u of s.units.filter(x => x.owner)) if (E.shaken(s, u)) get(u.id).shakenEnds++;
    }
    // kills: credit the attacker of the last attack before each rout is hard with batched events; approximate via strain share later
    for (const u of s.units) if (u.owner) get(u.id).survivedStrain = u.strain;
    const units = Object.keys(nameOf).map(id => ({ id, name: nameOf[id], owner: ownerOf[id], ...get(id) }));
    results.push({ seed, winner: s.winner || null, rounds: s.round, units });
    process.stderr.write(`${seed}:${s.winner || '-'}:${s.round} `);
}
fs.writeFileSync(out, JSON.stringify(results));
