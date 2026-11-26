#!/usr/bin/env node
/*
 * Exact V4 duel maths. node duel.js <csv> [q=0.5] [overrides as in study.js]
 * V4: each die >= TN deals 1 strain, no bonus dice, 7 strain routs.
 * AP (asterisk on Melee/Shoot): TN = min(Def, 3). Shooting at Def*: TN 6 (overrides AP).
 *
 * Frontal duel: alternate strikes, charger first.
 * Flank charge: charger strikes; victim is Shaken (can't strike, can't Manoeuvre unless its side is MT).
 *   Each later round: with prob q the victim's side is MT and it turns to face (its activation, no strike),
 *   the flanker strikes it frontally; from the next round on it is a frontal duel with random order.
 *   With prob 1-q the flanker strikes and the victim does nothing.
 */
const fs = require('fs');
const [csv, qArg = '0.5', overrides = ''] = process.argv.slice(2);
const q = Number(qArg);
const rows = fs.readFileSync(csv, 'utf8').trim().split(/\r?\n/).map(r => r.split(','));
const head = rows.shift(), col = n => head.indexOf(n);
const ov = {};
for (const o of overrides.split(';').filter(Boolean)) { const [k, v] = o.split('='); const [u, st] = k.split('.'); (ov[u] ||= {})[st] = v; }
const units = rows.filter(r => r[col('Unit')]).map(r => {
    const st = { Speed: r[col('Speed')], Drill: r[col('Drill')], Melee: r[col('Melee')], Ranged: r[col('Ranged')], Def: r[col('Def')], Quantity: r[col('Quantity')], ...(ov[r[col('Unit')]] || {}) };
    const [shoot, range] = st.Ranged && st.Ranged !== '-' ? st.Ranged.split('/') : [null, null];
    return { name: r[col('Unit')], pace: +st.Speed, drill: +st.Drill, melee: parseInt(st.Melee), meleeAP: /\*/.test(st.Melee),
        shoot: shoot ? parseInt(shoot) : 0, shootAP: shoot ? /\*/.test(shoot) : false, range: range ? +range : 0,
        def: parseInt(st.Def), loose: /\*/.test(st.Def), qty: +st.Quantity };
});
const HP = 7;
const tn = (a, b, shooting) => shooting ? (b.loose ? 6 : a.shootAP ? Math.min(b.def, 3) : b.def) : (a.meleeAP ? Math.min(b.def, 3) : b.def);
function exact(n, p) { const d = []; let c = 1; for (let k = 0; k <= n; k++) { d.push(c * p ** k * (1 - p) ** (n - k)); c = c * (n - k) / (k + 1); } return d; }
const dist = (a, b, shooting = false) => exact(shooting ? a.shoot : a.melee, (7 - tn(a, b, shooting)) / 6);
const mean = d => d.reduce((s, p, k) => s + p * k, 0);

// Frontal duel: P(A wins) at strain (sa, sb) with `next` striking next, then alternating.
function duel(a, b) {
    const dA = dist(a, b), dB = dist(b, a), memo = new Map();
    // X(side): value from that side's non-zero results. f_a = X_a + pA0 f_b, f_b = X_b + pB0 f_a.
    function X(sa, sb, side) {
        const d = side === 'a' ? dA : dB; let v = 0;
        for (let k = 1; k < d.length; k++) {
            const p = d[k]; if (!p) continue;
            if (side === 'a') v += p * (sb + k >= HP ? 1 : f(sa, sb + k, 'b'));
            else v += p * (sa + k >= HP ? 0 : f(sa + k, sb, 'a'));
        }
        return v;
    }
    function f(sa, sb, next) {
        const key = `${sa},${sb},${next}`;
        if (memo.has(key)) return memo.get(key);
        const xa = X(sa, sb, 'a'), xb = X(sa, sb, 'b'), a0 = dA[0], b0 = dB[0], den = 1 - a0 * b0;
        const fa = (xa + a0 * xb) / den, fb = (xb + b0 * xa) / den;
        memo.set(`${sa},${sb},a`, fa); memo.set(`${sa},${sb},b`, fb);
        return next === 'a' ? fa : fb;
    }
    return f;
}
// P(A wins a frontal duel) where A charges (strikes first)
const frontal = (a, b) => duel(a, b)(0, 0, 'a');
const frontalRandom = (a, b) => 0.5 * frontal(a, b) + 0.5 * (1 - frontal(b, a));
// Flank charge by A on B.
function flank(a, b) {
    const dA = dist(a, b), F = duel(a, b), memo = new Map();
    // h(sb): A has just struck; B is Shaken at strain sb (A has 0 strain). Next round.
    function h(sb) {
        if (memo.has(sb)) return memo.get(sb);
        // with prob q: B turns, A strikes, then random-order duel. with 1-q: A strikes, back to h.
        let turn = 0, stay = 0, selfStay = 0;
        for (let k = 0; k < dA.length; k++) {
            const p = dA[k]; if (!p) continue;
            const nb = sb + k;
            const after = nb >= HP ? 1 : 0.5 * F(0, nb, 'a') + 0.5 * F(0, nb, 'b');
            turn += p * after;
            if (nb >= HP) stay += p; else if (k === 0) selfStay += p; else stay += p * h(nb);
        }
        const qq = q;   // any unit, Drill 0 included, may turn to face when its side is MT
        const res = (qq * turn + (1 - qq) * stay) / (1 - (1 - qq) * selfStay);
        memo.set(sb, res); return res;
    }
    let v = 0;
    for (let k = 0; k < dA.length; k++) { const p = dA[k]; v += p * (k >= HP ? 1 : h(k)); }
    return v;
}
const pool = units.flatMap(u => Array(u.qty).fill(u)), N = pool.length;
const avgVs = (u, fn) => pool.reduce((s, v) => s + fn(u, v), 0) / N;
const pad = (s, n) => String(s).padEnd(n), pct = x => (x * 100).toFixed(0).padStart(4);
console.log(`V4 duel maths (q = ${q} chance the flanked side is MT in a later round). Field-weighted by card quantity.`);
console.log(pad('Unit', 16) + 'Pc Dr  Ml   Sh/Rg  Df |  strk dealt  taken | frontal  charge  flank  beFlanked |  shot dealt  shotsToRout | flank gain');
for (const u of units) {
    const dealt = avgVs(u, (a, b) => mean(dist(a, b))), taken = avgVs(u, (a, b) => mean(dist(b, a)));
    const fr = avgVs(u, frontalRandom), ch = avgVs(u, frontal), fl = avgVs(u, flank), bf = avgVs(u, (a, b) => 1 - flank(b, a));
    const shot = u.shoot ? avgVs(u, (a, b) => mean(dist(a, b, true))) : 0;
    console.log(pad(u.name, 16) + `${String(u.pace).padStart(2)} ${u.drill}  ${String(u.melee).padStart(2)}${u.meleeAP ? '*' : ' '} ${u.shoot ? (u.shoot + (u.shootAP ? '*' : '') + '/' + u.range).padStart(6) : '     -'}  ${u.def}${u.loose ? '*' : ' '}|` +
        `   ${dealt.toFixed(2)}   ${taken.toFixed(2)}  |  ${pct(fr)}    ${pct(ch)}   ${pct(fl)}    ${pct(bf)}    |    ${shot ? shot.toFixed(2) : '   -'}      ${shot ? (7 / shot).toFixed(1) : '  -'}      |  ${pct(fl - ch)}`);
}
if (process.env.MATRIX) {
    console.log('\nFrontal duel, random first striker: row unit win %');
    console.log(pad('', 16) + units.map(u => u.name.split(' ').map(w => w[0]).join('').padStart(4)).join(''));
    for (const a of units) console.log(pad(a.name, 16) + units.map(b => pct(frontalRandom(a, b))).join(''));
    console.log('\nFlank charge: row unit (flanker) win %');
    console.log(pad('', 16) + units.map(u => u.name.split(' ').map(w => w[0]).join('').padStart(4)).join(''));
    for (const a of units) console.log(pad(a.name, 16) + units.map(b => pct(flank(a, b))).join(''));
}
