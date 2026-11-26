#!/usr/bin/env node
// node analyse.js <tag> [tag2...]  — merges runs/<tag>-*.json and prints per-unit results.
const fs = require('fs'), path = require('path');
const dir = process.env.RUNS || path.join(process.cwd(), 'runs');
const tags = process.argv.slice(2);
const games = tags.flatMap(t => fs.readdirSync(dir).filter(f => f.startsWith(t + '-') && f.endsWith('.json')).flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f)))));
const decided = games.filter(g => g.winner);
const names = [...new Set(games.flatMap(g => g.units.map(u => u.name)))];
const order = ['Heavy Infantry', 'Fanatics', 'Heavy Cavalry', 'Infantry', 'Halberds', 'Spears', 'Cavalry', 'Lancers', 'Light Infantry', 'Light Cavalry', 'Archers', 'Crossbows', 'Mounted Archers'].filter(n => names.includes(n));
const rounds = games.map(g => g.rounds);
console.log(`${games.length} games, ${decided.length} decided, ${games.length - decided.length} unfinished; mean rounds ${(rounds.reduce((a, b) => a + b, 0) / rounds.length).toFixed(1)}`);

// Logistic regression: y = p1 wins, x_u = count_p1(u) - count_p2(u). Ridge, then centre by fielded share.
const X = decided.map(g => order.map(n => g.units.filter(u => u.name === n && u.owner === 'p1').length - g.units.filter(u => u.name === n && u.owner === 'p2').length));
const Y = decided.map(g => g.winner === 'p1' ? 1 : 0);
const K = order.length + 1, lambda = 2;
let w = Array(K).fill(0), lastH = null;
for (let it = 0; it < 50; it++) {
    const g = Array(K).fill(0), H = Array.from({ length: K }, () => Array(K).fill(0));
    X.forEach((x, i) => {
        const xi = [1, ...x], z = xi.reduce((s, v, j) => s + v * w[j], 0), p = 1 / (1 + Math.exp(-z));
        for (let a = 0; a < K; a++) { g[a] += (Y[i] - p) * xi[a]; for (let b = 0; b < K; b++) H[a][b] += p * (1 - p) * xi[a] * xi[b]; }
    });
    for (let a = 1; a < K; a++) { g[a] -= lambda * w[a]; H[a][a] += lambda; }
    lastH = H.map(r => r.slice());
    // solve H d = g
    const M = H.map((r, i) => [...r, g[i]]);
    for (let c = 0; c < K; c++) { let piv = c; for (let r = c + 1; r < K; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]];
        for (let r = 0; r < K; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= K; k++) M[r][k] -= f * M[c][k]; } }
    const d = M.map((r, i) => r[K] / r[i]);
    w = w.map((v, i) => v + d[i]);
    if (Math.max(...d.map(Math.abs)) < 1e-8) break;
}
function invDiag(H) { const n = H.length, M = H.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => +(i === j))]);
    for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]];
        const d = M[c][c]; for (let k = 0; k < 2 * n; k++) M[c][k] /= d; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k]; } }
    return M.map((r, i) => r[n + i]); }
const se = invDiag(lastH).map(Math.sqrt);
const all = games.flatMap(g => g.units.map(u => ({ ...u, gameWinner: g.winner, decided: !!g.winner })));
const fielded = n => all.filter(u => u.name === n);
const totalF = all.length;
let coef = order.map((n, i) => w[i + 1]);
const meanC = coef.reduce((s, c, i) => s + c * fielded(order[i]).length, 0) / totalF;
coef = coef.map(c => c - meanC);

const pad = (s, n) => String(s).padEnd(n), f1 = x => x.toFixed(1).padStart(5), f2 = x => x.toFixed(2).padStart(6);
console.log(pad('Unit', 16) + '  n   coef  +-se  win%  rout%  pick  att/g  shots  dealt  taken  chg  flankChg  shakenEnds');
order.forEach((n, i) => {
    const us = fielded(n), d = us.filter(u => u.decided), m = k => us.reduce((s, u) => s + u[k], 0) / us.length;
    const win = d.filter(u => u.gameWinner === u.owner).length / d.length;
    console.log(pad(n, 16) + String(us.length).padStart(4) + f2(coef[i]) + f2(se[i + 1]) + f1(win * 100) + f1(m('routed') * 100) + '  ' + m('pickOrder').toFixed(1).padStart(4) +
        f2(m('attacks')) + f2(m('shots')) + f2(m('dealt')) + f2(m('taken')) + f2(m('charges')) + f2(m('flankCharges')) + '  ' + f2(m('shakenEnds')));
});
console.log('(coef: change in log-odds of winning per extra copy v the opponent, centred on the average fielded unit)');
console.log(`seat p1 intercept ${w[0].toFixed(2)}`);
