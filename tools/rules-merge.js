#!/usr/bin/env node
/* Merge rules-compare.js --json outputs and summarise them: node tools/rules-merge.js "title" a.json b.json ... */
const fs = require('fs');
const { summarise } = require('./rules-compare');
const [title, ...files] = process.argv.slice(2);
const games = files.flatMap(f => JSON.parse(fs.readFileSync(f, 'utf8')));
summarise(games, title);
const done = games.filter(g => g.winner).map(g => g.rounds).sort((a, b) => a - b), q = f => done[Math.min(done.length - 1, Math.floor(f * done.length))];
const attacks = games.reduce((n, g) => n + g.strikes + g.shots, 0), routs = games.reduce((n, g) => n + g.routs.length, 0);
console.log(`rounds p10/p50/p90: ${q(0.1)}/${q(0.5)}/${q(0.9)}; attacks per rout ${(attacks / Math.max(1, routs)).toFixed(2)}`);
