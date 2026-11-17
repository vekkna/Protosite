// Plays random legal games and checks that the engine never produces an illegal position.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine');

const ROWS = [['Heavy Infantry','5','0','6','-','5','SW'],['Fanatics','6*','1','10','-','3','SW'],['Heavy Cavalry','10','0','4','-','5','SN'],
    ['Infantry','6','2','3','-','5','SW'],['Halberds','6','0','3*','-','4','SW'],['Spears','6','1','2','-','6','SW'],['Cavalry','12','1','4','-','4','SN'],
    ['Lancers','11','2','2*','-','4','SN'],['Light Infantry','7*','4','3','1*/4','4*','SW'],['Light Cavalry','14','3','4','-','3*','SN'],
    ['Archers','6','1','1','4/24','3','SW'],['Crossbows','6','0','1','3*/18','3','SW']];
const SIZE = { SW: [88 / 25.4 * 20, 63 / 25.4 * 20], SN: [63 / 25.4 * 20, 88 / 25.4 * 20] };
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

for (const seed of [1, 2, 3]) test(`random game ${seed} keeps every position legal`, () => {
    const rnd = rng(seed);
    const units = ROWS.map((r, i) => ({ id: 'u' + i, name: r[0], x: 80 + (i % 4) * 220, y: 200 + Math.floor(i / 4) * 130, w: SIZE[r[6]][0], h: SIZE[r[6]][1],
        stats: { Speed: r[1], Drill: r[2], Melee: r[3], Ranged: r[4], Def: r[5] } }));
    const deck = ['forest', 'hills', 'x', 'swamp', 'field', 'mountain', 'x', 'forest', 'hills', 'x', 'field', 'x'].sort(() => rnd() - 0.5);
    let s = E.createGame({ units, terrainDeck: deck, seed, firstPick: seed % 2 ? 'p1' : 'p2', tileSize: SIZE.SW[0] });
    for (let n = 0; n < 500 && s.phase !== 'finished'; n++) {
        const acts = E.legalActions(s);
        assert.ok(acts.length, `no legal action in ${s.phase}`);
        let a = acts.find(x => x.type === 'strike' || x.type === 'shoot');
        if (!a || rnd() < 0.15) a = acts[Math.floor(rnd() * acts.length)];
        if (['pass', 'endActivation'].includes(a.type) && acts.length > 1 && rnd() < 0.75) a = acts[1 + Math.floor(rnd() * (acts.length - 1))];
        s = E.apply(s, a);
        const live = s.units.filter(u => u.owner);
        for (const u of live) {
            const p = E.geometry.rect(u);
            assert.ok(p.every(q => q.x > -0.05 && q.y > -0.05 && q.x < s.width + 0.05 && q.y < s.height + 0.05), `${u.name} left the board after ${JSON.stringify(a)}`);
            assert.ok(u.strain >= 0 && u.strain < E.ROUT_STRAIN);
            for (const v of live) if (v.id < u.id) assert.ok(E.geometry.satGap(p, E.geometry.rect(v)) > -0.05, `${u.name} overlaps ${v.name} after ${JSON.stringify(a)}`);
            for (const t of s.terrain) if (E.TERRAIN[t.type].impassable) assert.ok(E.geometry.satGap(p, E.geometry.disc(t)) > -0.05, `${u.name} entered ${t.type}`);
        }
        if (s.phase === 'command') assert.ok(s.commands.p1 >= 0 && s.commands.p2 >= 0);
    }
});
