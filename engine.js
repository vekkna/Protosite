/*
 * Seize the Day — headless rules engine.
 *
 * Pure functions over a plain JSON game state: no DOM, no globals, no hidden
 * randomness (dice come from a seeded generator stored in the state). The same
 * module runs in the browser, in Node tests, and inside an AI search.
 *
 *   state  = SeizeEngine.createGame({...})
 *   state2 = SeizeEngine.apply(state, action)   // throws Error if illegal
 *   SeizeEngine.legalActions(state)             // sampled list, for AI / fuzzing
 *   SeizeEngine.unitOptions(state, unitId)      // everything a UI needs to draw
 *
 * Distances are board pixels (20 per inch) internally; actions and unit stats
 * use inches and degrees. A unit faces "up" (−y) at angle 0.
 */
const SeizeEngine = (() => {
    const PX = 20;                 // pixels per inch
    const TOUCH = 0.02;            // px: pieces this close are touching
    const STANDOFF = 1;            // px: gap kept when a non-charging move stops short of an enemy
    const PIVOT_CLEARANCE = 0.5;   // px: clearance needed while turning
    const DEPLOY_IN = 6, SLOW_IN = 4, ROUT_STRAIN = 7;
    const FLANK_DICE = 1;   // outflanking: +1 to strike/shoot an outflanked target, -1 when the attacker is outflanked
    const SPENT_STRAIN = 5;        // V3: a unit with this much strain can't attack (no Shoot, Strike or charge)
    const TERRAIN = {
        hills:    { elevated: true },
        forest:   { concealing: true, slowing: true },
        mountain: { concealing: true, impassable: true },
        swamp:    { impassable: true },
        field:    { slowing: true }
    };
    const other = p => (p === 'p1' ? 'p2' : 'p1');
    const label = p => (p === 'p1' ? 'Player 1' : 'Player 2');
    /** Copy of a state that `apply` may mutate. Terrain pieces are never changed in place, so they are shared. */
    const clone = s => ({ ...s, events: [], units: s.units.map(u => ({ ...u })), terrain: s.terrain.slice(), terrainDeck: s.terrainDeck.slice(),
        draft: s.draft && { ...s.draft }, bids: { ...s.bids }, commands: { ...s.commands }, activation: s.activation && { ...s.activation },
        starting: { ...s.starting }, routed: { ...s.routed }, log: s.log.slice() });
    const fail = msg => { throw new Error(msg); };
    const round2 = n => Math.round(n * 100) / 100;

    // ---------- geometry ----------
    const dot = (a, b) => a.x * b.x + a.y * b.y;
    const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
    const forwardOf = u => { const a = u.angle * Math.PI / 180; return { x: Math.sin(a), y: -Math.cos(a) }; };
    const centre = u => ({ x: u.x + u.w / 2, y: u.y + u.h / 2 });

    /** Unit corners: front-left, front-right, rear-right, rear-left. */
    const rectCache = new WeakMap(), discCache = new WeakMap();
    function rect(u, angle = u.angle) {
        const hit = rectCache.get(u);
        if (hit && hit.x === u.x && hit.y === u.y && hit.a === angle && hit.w === u.w) return hit.poly;
        const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), o = centre(u), hw = u.w / 2, hh = u.h / 2;
        const poly = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({ x: o.x + x * hw * c - y * hh * s, y: o.y + x * hw * s + y * hh * c }));
        poly.ax = [{ x: c, y: s }, { x: -s, y: c }];   // a rectangle has two distinct edge normals
        rectCache.set(u, { x: u.x, y: u.y, a: angle, w: u.w, poly });
        return poly;
    }
    function disc(t) {
        const hit = discCache.get(t);
        if (hit && hit.x === t.x && hit.y === t.y) return hit.poly;
        const o = centre(t), r = t.w / 2, n = 48;
        const poly = Array.from({ length: n }, (_, i) => ({ x: o.x + Math.cos(i * 2 * Math.PI / n) * r, y: o.y + Math.sin(i * 2 * Math.PI / n) * r }));
        poly.ax = Array.from({ length: n / 2 }, (_, i) => { const m = (i + 0.5) * 2 * Math.PI / n; return { x: Math.cos(m), y: Math.sin(m) }; });
        discCache.set(t, { x: t.x, y: t.y, poly });
        return poly;
    }
    /** Radius of the circle around a piece's centre that contains it. */
    const reach = p => (p.type ? p.w / 2 : Math.hypot(p.w, p.h) / 2);
    const centreGap = (a, b) => Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2) - reach(a) - reach(b);
    const shape = p => (p.type ? disc(p) : rect(p));

    function axes(poly) {
        if (poly.ax) return poly.ax;
        const out = [];
        for (let i = 0; i < poly.length; i++) {
            const d = sub(poly[(i + 1) % poly.length], poly[i]), len = Math.hypot(d.x, d.y);
            if (len > 1e-9) out.push({ x: -d.y / len, y: d.x / len });
        }
        poly.ax = out;
        return out;
    }
    function span(poly, axis) {
        let min = Infinity, max = -Infinity;
        for (const p of poly) { const v = dot(p, axis); if (v < min) min = v; if (v > max) max = v; }
        return [min, max];
    }
    /** Largest separating gap over all edge normals. Negative = penetration depth. */
    function satGap(a, b) {
        let best = -Infinity;
        for (const list of [axes(a), axes(b)]) for (const axis of list) {
            const [a0, a1] = span(a, axis), [b0, b1] = span(b, axis);
            best = Math.max(best, Math.max(b0 - a1, a0 - b1));
        }
        return best;
    }
    /** satGap(a, b) < limit, stopping at the first axis that rules it out (fewest axes first). Same answer as satGap. */
    function gapBelow(a, b, limit) {
        const A = axes(a), B = axes(b);
        for (const list of A.length <= B.length ? [A, B] : [B, A]) for (const axis of list) {
            const [a0, a1] = span(a, axis), [b0, b1] = span(b, axis);
            if (b0 - a1 >= limit || a0 - b1 >= limit) return false;
        }
        return true;
    }
    /** Distance from a point to a triangle (0 inside). */
    function pointTriangleGap(p, [a, b, c]) {
        const side = (q, r) => (r.x - q.x) * (p.y - q.y) - (r.y - q.y) * (p.x - q.x), d1 = side(a, b), d2 = side(b, c), d3 = side(c, a);
        if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) return 0;
        return Math.min(pointSeg(p, a, b), pointSeg(p, b, c), pointSeg(p, c, a));
    }
    function pointSeg(p, a, b) {
        const d = sub(b, a), l2 = dot(d, d), t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
        return Math.hypot(p.x - a.x - t * d.x, p.y - a.y - t * d.y);
    }
    function polyDist(a, b) {
        if (satGap(a, b) <= 0) return 0;
        let best = Infinity;
        for (const [p, q] of [[a, b], [b, a]]) for (const v of p) for (let i = 0; i < q.length; i++)
            best = Math.min(best, pointSeg(v, q[i], q[(i + 1) % q.length]));
        return best;
    }
    /** Axis-aligned bounds of a polygon, kept on the (cached) polygon. */
    function bounds(poly) {
        if (poly.bb) return poly.bb;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of poly) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
        return (poly.bb = { x0, y0, x1, y1 });
    }
    // Convex shapes with disjoint bounds are disjoint, so SAT would find a separating axis: skip it (same answer, much cheaper).
    const overlapping = (a, b) => {
        const p = bounds(a), q = bounds(b);
        if (p.x0 >= q.x1 || q.x0 >= p.x1 || p.y0 >= q.y1 || q.y0 >= p.y1) return false;
        return gapBelow(a, b, -TOUCH);
    };
    const touchingPolys = (a, b) => polyDist(a, b) <= TOUCH;

    /**
     * Swept SAT. `a` moves by vector v (px). Returns the entry and exit distances
     * if the sweep reaches `b`. A zero margin uses contact as the boundary.
     */
    function sweepInterval(a, b, v, margin = 0) {
        const len = Math.hypot(v.x, v.y);
        if (len < 1e-9) return null;
        let enter = -Infinity, exit = Infinity;
        for (const list of [axes(a), axes(b)]) for (const axis of list) {
            const [a0, a1] = span(a, axis), [b0, b1] = span(b, axis);
            const gapAB = b0 - a1, gapBA = a0 - b1, s = dot(v, axis) / len;   // px of closure per px travelled
            if (Math.abs(s) < 1e-9) { if (gapAB >= margin - TOUCH / 2 || gapBA >= margin - TOUCH / 2) return null; continue; }   // sliding alongside is not a collision
            const t1 = (gapAB - margin) / s, t2 = (margin - gapBA) / s;
            enter = Math.max(enter, Math.min(t1, t2)); exit = Math.min(exit, Math.max(t1, t2));
        }
        if (enter >= exit || exit <= 1e-7 || enter > len) return null;
        return { enter: Math.max(0, enter), exit };
    }
    const sweep = (a, b, v, margin) => sweepInterval(a, b, v, margin)?.enter ?? null;

    // ---------- state helpers ----------
    const live = s => s.units.filter(u => u.owner);
    const unitById = (s, id) => s.units.find(u => u.id === id);
    const army = (s, p) => s.units.filter(u => u.owner === p);
    const trait = (t, name) => Boolean(TERRAIN[t.type] && TERRAIN[t.type][name]);
    // V3: a hill slows a unit entering it, but not one that started its Move on it.
    // The hills a unit stood on when its Move began (its current hills if the Move hasn't begun).
    const hillsOf = (s, u) => s.terrain.filter(t => trait(t, 'elevated') && inFeature(u, t)).map(t => t.id);
    const startHills = (s, u, act) => (act && act.startHills) || hillsOf(s, u);
    const slows = (s, t, hills) => trait(t, 'slowing') || (hillsSlow(s) && trait(t, 'elevated') && !hills.includes(t.id));
    const inSlowing = (s, u, hills) => s.terrain.some(t => slows(s, t, hills) && inFeature(u, t));
    const inFeature = (u, t) => centreGap(u, t) < 0 && overlapping(rect(u), disc(t));
    const inTrait = (s, u, name) => s.terrain.some(t => trait(t, name) && inFeature(u, t));
    const touching = (a, b) => centreGap(a, b) <= TOUCH && touchingPolys(rect(a), rect(b));
    const enemiesTouching = (s, u) => live(s).filter(v => v.owner !== u.owner && touching(u, v));

    function activePlayer(s) {
        if (s.phase === 'draft') return s.draft.picker;
        if (s.phase !== 'command') return null;
        return s.turnStep === 1 ? other(s.master) : s.master;
    }

    function rollDie(s) {   // mulberry32, state kept in s.rng
        s.rng = (s.rng + 0x6D2B79F5) >>> 0;
        let t = s.rng;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return 1 + Math.floor(((t ^ (t >>> 14)) >>> 0) / 4294967296 * 6);
    }
    function log(s, text) { s.log.unshift(text); if (s.log.length > 60) s.log.length = 60; }
    function emit(s, event) { s.seq += 1; s.events.push({ seq: s.seq, ...event }); }

    // ---------- setup ----------
    /** Convert a stats row ({Speed:'7*', Drill:'4', Melee:'3', Ranged:'1 * /4', Def:'4*'}) to engine numbers. */
    function parseStats(stats = {}) {
        const pick = (...keys) => { for (const k of keys) if (stats[k] !== undefined && `${stats[k]}`.trim() !== '') return `${stats[k]}`.trim(); return ''; };
        const num = (text, fallback = 0) => { const n = parseFloat(text); return Number.isFinite(n) ? n : fallback; };
        const pace = pick('Pace', 'Speed', 'Move'), melee = pick('Melee'), def = pick('Defence', 'Defense', 'Def');
        const ranged = pick('Shoot', 'Ranged'), [shoot, range] = ranged.split('/');
        return {
            pace: num(pace), paceStar: pace.includes('*'), mobility: num(pick('Mobility', 'Drill')),
            melee: num(melee), meleeAP: melee.includes('*'),
            shoot: num(shoot), shootAP: (shoot || '').includes('*'), range: num(pick('Range'), num(range)),
            defence: num(def, 6), defenceStar: def.includes('*')
        };
    }
    function makeUnit(spec) {
        return { id: spec.id, name: spec.name || spec.id, owner: spec.owner || null,
            x: spec.x, y: spec.y, w: spec.w, h: spec.h, angle: spec.angle || 0, strain: spec.strain || 0, activated: false,
            ...(spec.stats ? parseStats(spec.stats) : {}),
            ...Object.fromEntries(['pace', 'paceStar', 'mobility', 'melee', 'meleeAP', 'shoot', 'shootAP', 'range', 'defence', 'defenceStar']
                .filter(k => spec[k] !== undefined).map(k => [k, spec[k]])) };
    }
    // 'skirmishers' was V3's name for its first day.
    const normalizeRules = rules => rules === 'skirmishers' ? 'v3' : ['reform', 'reform-variant', 'v3', 'v4', 'v5'].includes(rules) ? rules : 'classic';
    /** Name players see for each rule set. */
    const RULES_NAMES = { classic: 'Classic', reform: 'Reform', 'reform-variant': 'Reform Variant', v3: 'V3', v4: 'V4', v5: 'V5' };
    const rulesName = rules => RULES_NAMES[normalizeRules(rules)];

    /**
     * options: { units:[spec], terrain:[{id,type,x,y,w,h}], terrainDeck:[type|'x'], firstPick:'p1'|'p2',
     *            seed, width, height, tileSize, rules }.
     * If every unit already has an owner the draft is skipped (prepared battle).
     */
    function createGame(options = {}) {
        const s = {
            version: 2, rng: (options.seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0, seq: 0, events: [],
            width: options.width || 960, height: options.height || 720, tileSize: options.tileSize || 80,
            units: (options.units || []).map(makeUnit),
            terrain: (options.terrain || []).map((t, i) => ({ id: t.id || `t${i + 1}`, type: t.type, x: t.x, y: t.y, w: t.w, h: t.h || t.w })),
            terrainDeck: [...(options.terrainDeck || [])],
            rules: normalizeRules(options.rules),
            phase: 'draft', firstPick: options.firstPick || 'p1',
            draft: { picker: options.firstPick || 'p1', step: 'pick', picked: null },
            round: 0, bids: { p1: null, p2: null }, master: null, turnStep: 0, commands: { p1: 0, p2: 0 },
            activation: null, starting: { p1: 0, p2: 0 }, routed: { p1: 0, p2: 0 }, winner: null, log: []
        };
        if (s.units.length && s.units.every(u => u.owner)) beginBattle(s);
        return s;
    }
    function beginBattle(s) {
        s.starting = { p1: army(s, 'p1').length, p2: army(s, 'p2').length };
        s.phase = 'bidding'; s.round = 1; s.draft = null; s.bids = { p1: null, p2: null };
        log(s, 'Deployment complete. Both players secretly bid for commands.');
    }

    // ---------- draft ----------
    const zoneOf = (s, p) => (p === 'p1' ? [s.height - DEPLOY_IN * PX, s.height] : [0, DEPLOY_IN * PX]);
    function terrainPlacementError(s, tile, pickedUnit, movingId) {
        const o = centre(tile), r = tile.w / 2;
        if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return 'Place the tile on the battlefield.';
        if (o.x - r <= TOUCH || o.x + r >= s.width - TOUCH) return 'Terrain can’t touch the battlefield edge.';
        if (o.y - r <= DEPLOY_IN * PX + TOUCH || o.y + r >= s.height - DEPLOY_IN * PX - TOUCH) return 'Terrain can’t touch a deployment zone.';
        if (s.terrain.some(t => (!movingId || t.id !== movingId) && Math.hypot(centre(t).x - o.x, centre(t).y - o.y) <= r + t.w / 2 + TOUCH)) return 'Terrain can’t touch another terrain tile.';
        if (!overlapping(rect(pickedUnit), disc(tile))) return 'Terrain must overlap the unit you chose.';
        return '';
    }
    function tileAt(s, cx, cy) { return { type: s.terrainDeck[0], x: cx - s.tileSize / 2, y: cy - s.tileSize / 2, w: s.tileSize, h: s.tileSize }; }
    /** Sampled centre points where the top tile can legally go (empty = must discard). */
    function terrainSpots(s, limit = Infinity, step = 8) {
        if (s.phase !== 'draft' || s.draft.step !== 'terrain') return [];
        const u = unitById(s, s.draft.picked), o = centre(u), reach = s.tileSize / 2 + Math.hypot(u.w, u.h) / 2, spots = [];
        for (let dy = -reach; dy <= reach; dy += step) for (let dx = -reach; dx <= reach; dx += step) {
            if (!terrainPlacementError(s, tileAt(s, o.x + dx, o.y + dy), u)) { spots.push({ x: o.x + dx, y: o.y + dy }); if (spots.length >= limit) return spots; }
        }
        return spots.sort((a, b) => Math.hypot(a.x - o.x, a.y - o.y) - Math.hypot(b.x - o.x, b.y - o.y));
    }
    function deployError(s, u, pos) {
        if (![pos.x, pos.y, pos.angle].every(Number.isFinite)) return 'Place the whole unit inside your deployment zone.';
        const moved = { ...u, ...pos }, poly = rect(moved), [y0, y1] = zoneOf(s, s.draft.picker);
        if (poly.some(p => p.x < -TOUCH || p.x > s.width + TOUCH || p.y < y0 - TOUCH || p.y > y1 + TOUCH)) return 'Place the whole unit inside your deployment zone.';
        if (live(s).some(v => v.id !== u.id && overlapping(poly, rect(v)))) return 'Units can’t overlap.';
        return '';
    }
    function draftAction(s, a) {
        const d = s.draft, p = d.picker;
        if (a.player && a.player !== p) fail(`It is ${label(p)}’s pick.`);
        if (a.type === 'autoDraft') return autoDraft(s);
        if (a.type === 'pick') {
            if (d.step !== 'pick') fail('Finish the current pick first.');
            const u = unitById(s, a.unitId);
            if (!u || u.owner) fail('Select an available unit on the battlefield.');
            d.picked = u.id; d.position = null; log(s, `${label(p)} chose ${u.name}.`);
            if (!s.terrainDeck.length || !TERRAIN[s.terrainDeck[0]]) {
                s.terrainDeck.shift(); d.step = 'deploy'; log(s, 'No terrain to place this turn.');
            } else {
                d.step = 'terrain';
                if (!terrainSpots(s, 1).length && !terrainSpots(s, 1, 1.5).length) {
                    const t = s.terrainDeck.shift();
                    d.step = 'deploy';
                    log(s, `No legal place for the ${t}; it is discarded.`);
                }
            }
        } else if (a.type === 'placeTerrain') {
            if (d.step !== 'terrain') fail('There is no terrain tile to place now.');
            const tile = tileAt(s, a.x, a.y), why = terrainPlacementError(s, tile, unitById(s, d.picked));
            if (why) fail(why);
            d.terrainId = `t${s.seq + 1}_${s.terrain.length + 1}`;
            s.terrainDeck.shift(); s.terrain.push({ id: d.terrainId, ...tile }); d.step = 'deploy';
            log(s, `${label(p)} placed ${tile.type} terrain.`); emit(s, { type: 'terrain' });
        } else if (a.type === 'repositionTerrain') {
            const i = s.terrain.findIndex(t => t.id === d.terrainId);
            if (d.step !== 'deploy' || i === -1) fail('There is no terrain tile to reposition.');
            if (d.position) fail('Terrain is fixed once the unit is in its deployment zone.');
            const tile = { ...s.terrain[i], x: a.x, y: a.y };
            const why = terrainPlacementError(s, tile, unitById(s, d.picked), d.terrainId);
            if (why) fail(why);
            s.terrain[i] = tile;
        } else if (a.type === 'positionDeployment' || a.type === 'deploy') {
            if (d.step !== 'deploy') fail('Choose a unit and deal with its terrain tile first.');
            const u = unitById(s, d.picked), pos = { x: a.x, y: a.y, angle: a.angle ?? (p === 'p1' ? 0 : 180) }, why = deployError(s, u, pos);
            if (why) fail(why);
            if (a.type === 'positionDeployment') { d.position = pos; return; }
            Object.assign(u, pos, { owner: p });
            s.draft = { picker: other(p), step: 'pick', picked: null };
            if (s.units.every(v => v.owner)) beginBattle(s);
        } else fail('That isn’t possible during the draft.');
    }

    /** Distance from a point to the nearest part of a unit's rectangle (0 inside it). */
    function pointRectDist(p, u) {
        const o = centre(u), a = (u.angle || 0) * Math.PI / 180, dx = p.x - o.x, dy = p.y - o.y;
        const lx = Math.abs(dx * Math.cos(a) + dy * Math.sin(a)) - u.w / 2, ly = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a)) - u.h / 2;
        return Math.hypot(Math.max(0, lx), Math.max(0, ly));
    }
    /** Inches by which a unit at this pose is too close to a side edge or another unit (or that unit to it) to pivot freely (0 = room to turn). */
    function deploymentCramp(s, u) {
        const c = centre(u);
        let worst = Math.max(0, reach(u) + PIVOT_CLEARANCE - Math.min(c.x, s.width - c.x));   // the side edges
        for (const v of live(s)) {
            if (v.id === u.id) continue;
            worst = Math.max(worst, reach(u) - pointRectDist(c, v) + PIVOT_CLEARANCE, reach(v) - pointRectDist(centre(v), u) + PIVOT_CLEARANCE);
        }
        return worst / PX;
    }
    function automaticDeployment(s, u) {
        const { picker, position } = s.draft;
        if (position && !deployError(s, u, position)) return position;
        const spots = legalActions(s);
        if (spots.length) {
            // Nearest spot that leaves this unit and its neighbours room to pivot; if none does, the least cramped one.
            const cost = spot => 1000 * deploymentCramp(s, { ...u, x: spot.x, y: spot.y, angle: spot.angle }) + Math.abs(spot.x - u.x);
            return spots.reduce((best, spot) => cost(spot) < cost(best) ? spot : best);
        }
        // A partially deployed army can fill the usual front rank.
        const [top, bottom] = zoneOf(s, picker);
        const angle = picker === 'p1' ? 0 : 180;
        for (let y = top; y + u.h <= bottom; y += 4) {
            for (let x = 0; x + u.w <= s.width; x += 4) {
                const pose = { x, y, angle };
                if (!deployError(s, u, pose)) return pose;
            }
        }
        fail(`No space to auto-deploy ${u.name} in its deployment zone.`);
    }

    function autoDraft(s) {
        while (s.phase === 'draft') {
            const { step, picked } = s.draft;
            if (step === 'pick') {
                const next = s.units.find(u => !u.owner);
                if (!next) fail('There are no units to auto-draft.');
                draftAction(s, { type: 'pick', unitId: next.id });
            } else if (step === 'terrain') {
                const spot = terrainSpots(s)[0] || terrainSpots(s, 1, 1.5)[0];
                if (!spot) fail('There is no legal spot for the current terrain tile.');
                draftAction(s, { type: 'placeTerrain', ...spot });
            } else {
                draftAction(s, { ...automaticDeployment(s, unitById(s, picked)), type: 'deploy' });
            }
        }
        log(s, 'Auto-draft completed for both sides.');
    }

    // ---------- bidding and round flow ----------
    function bidAction(s, a) {
        if (a.type !== 'bid') fail('Both players must bid first.');
        const max = army(s, a.player).length;
        if (!['p1', 'p2'].includes(a.player) || !Number.isInteger(a.value) || a.value < 1 || a.value > max) fail(`Bid a whole number from 1 to ${max}.`);
        if (s.bids[a.player] !== null) fail('That bid is already set.');
        s.bids[a.player] = a.value;
        if (s.bids.p1 === null || s.bids.p2 === null) return;
        const { p1, p2 } = s.bids;
        s.master = p1 === p2 ? (s.master || other(s.firstPick)) : (p1 < p2 ? 'p1' : 'p2');
        s.commands = { p1, p2 }; s.phase = 'command'; s.turnStep = 0; s.activation = null;
        log(s, `Round ${s.round}: bids ${p1} / ${p2}. ${label(s.master)} is Master Tactician.`);
        emit(s, { type: 'round', round: s.round, bids: { p1, p2 }, master: s.master });
        skipEmptyTurns(s);
    }
    function nextTurn(s) {
        delete s.awaitingRoundEnd;
        delete s.awaitingTurnEnd;
        if (s.turnStep < 2) { s.turnStep += 1; return; }
        s.units.forEach(u => { u.activated = false; });
        s.round += 1; s.phase = 'bidding'; s.bids = { p1: null, p2: null }; s.commands = { p1: 0, p2: 0 }; s.turnStep = 0;
        log(s, 'Clean up: command markers removed. Bid for the next round.');
        emit(s, { type: 'cleanup' });
    }
    /** A player with no commands (or no unit left to command) must pass. */
    const canCommand = (s, p) => s.commands[p] > 0 && army(s, p).some(u => !u.activated);
    function skipEmptyTurns(s) {
        while (s.phase === 'command' && !s.activation) {
            if (canCommand(s, activePlayer(s))) break;
            nextTurn(s);
        }
    }

    // ---------- activation queries ----------
    const newActivation = (unitId) => ({ unitId, action: null, pivots: 0, moved: 0, dir: null, pivotedInMove: false,
        slowed: false, charged: false, freeStrike: false, startHigh: null, overlap: false });
    const pivotAllowance = (u, act) => u.mobility + (act.action === 'extraPivot' ? 1 : 0);
    /**
     * Pivots allowed in a Reform-style Manoeuvre. V4 (rules doc, 2026-11-25): a unit that doesn't move forwards or
     * backwards may pivot one additional time, so a Mobility 0 unit can pivot once if it stays put. Using that extra
     * pivot rules out moving (see `extraPivotUsed` in moveLimit).
     */
    const pivotsAllowed = (s, u, act) => u.mobility + (v4Only(s) && !(act.moved > 0) ? 1 : 0);
    const extraPivotUsed = (s, u, act) => v4Only(s) && act.pivots > u.mobility;
    // Reform and everything after it: pivots belong to a Move.
    const reformRules = s => s.rules === 'reform' || s.rules === 'reform-variant' || s.rules === 'v3' || s.rules === 'v4' || s.rules === 'v5';
    // V3 (built on Reform): pivots may sweep through units, impassable terrain and the edge, but
    // may not stop overlapping. Unlike the Reform Variant, no unit may move through friendly units.
    // V4 keeps all of that, V3's sight line and its lack of dice modifiers, so v3Rules is true for both.
    const v3Rules = s => s.rules === 'v3' || s.rules === 'v4' || s.rules === 'v5';
    // V4 (built on V3): no Reform or Rally, no 5-strain limit, hills don't slow, no bonus dice for 6s,
    // a Pace asterisk does nothing, any touching enemy can be struck, and Shaken units can't strike.
    // V5 (rules doc 2026-11-26) keeps V4's shooting, Shaken, dice and terrain, so v4Rules is true
    // for it too; its movement is new (see moveLimitV5, chargeAt, faceAbout). V4-only movement rules test v4Only.
    const v4Rules = s => s.rules === 'v4' || s.rules === 'v5';
    const v4Only = s => s.rules === 'v4';
    const v5Rules = s => s.rules === 'v5';
    // V3 only: a pivot may sweep through units, impassable terrain and the edge. V4 (rules doc, 2026-11-25): a unit may
    // not make contact with another unit or blocking terrain (read as impassable terrain, and the edge) while pivoting.
    const pivotThrough = s => s.rules === 'v3';
    const reformAction = s => reformRules(s) && (!v4Rules(s) || v5Rules(s));
    const rallyAllowed = s => !reformRules(s) || s.rules === 'v3';
    const hillsSlow = s => s.rules === 'v3' || s.rules === 'v5';
    const explodingSixes = s => !v4Rules(s);
    const ignoresSlowing = (s, u) => Boolean(u.paceStar) && !v4Rules(s);
    const unmarkedStrikeDice = (s, marked) => !marked && !v3Rules(s) ? 1 : 0;
    const spent = (s, u) => s.rules === 'v3' && u.strain >= SPENT_STRAIN;
    const SPENT_TEXT = `A unit with ${SPENT_STRAIN} or more strain can’t attack.`;
    const friendlyPassage = s => s.rules === 'reform-variant';
    const crossingAt = (crossings, inches) => crossings?.find(c => inches > c.from + 1e-7 && inches < c.to - 1e-7);

    /**
     * Pace left for a move along the unit's facing, with slowing terrain applied: a Move that is in slowing terrain
     * at any point is capped at 4 inches, and one that has gone further can't enter it. slowAt is px to the first
     * slowing feature (Infinity if none, 0 if already in one).
     */
    function slowBudget(s, u, act, backwards) {
        const f = forwardOf(u), sign = backwards ? -1 : 1, me = rect(u);
        let budget = (backwards ? u.pace / 2 : u.pace) - act.moved, stop = 'pace', blocker = null, slowAt = Infinity;
        if (!ignoresSlowing(s, u)) {
            const hills = startHills(s, u, act);
            const occupied = act.slowed ? null : s.terrain.find(t => slows(s, t, hills) && inFeature(u, t));
            if (act.slowed || occupied) { slowAt = 0; blocker = occupied; }
            else for (const t of s.terrain) {
                if (!slows(s, t, hills) || centreGap(u, t) > budget * PX + 2) continue;
                const d = sweep(me, disc(t), { x: f.x * sign * budget * PX, y: f.y * sign * budget * PX }, -TOUCH);
                if (d !== null && d < slowAt) { slowAt = d; blocker = t; }
            }
            if (slowAt < Infinity) {
                if (act.moved + slowAt / PX >= SLOW_IN) { if (slowAt / PX < budget) { budget = Math.max(0, slowAt / PX - 0.01); stop = 'slow'; } }
                else if (SLOW_IN - act.moved < budget) { budget = SLOW_IN - act.moved; stop = 'slow'; }
            }
        }
        return { budget, stop, blocker, slowAt };
    }

    /** How far (inches) a unit can travel along its facing right now. */
    function moveLimit(s, u, act, backwards) {
        if (v5Rules(s)) return moveLimitV5(s, u, act, backwards);
        const dir = backwards ? 'back' : 'fwd', none = why => ({ max: 0, reason: why, charge: null, stop: 'rule' });
        if (act.action && act.action !== 'move') return none('This unit has already used its action.');
        if (act.charged) return none('A charge stops on contact.');
        if (act.overlap) return none('Keep pivoting until the unit is clear of other units, impassable terrain and the edge.');
        if (act.dir && act.dir !== dir) return none('A Move can’t switch between forwards and backwards.');
        if (extraPivotUsed(s, u, act)) return none('This unit used its extra pivot, so it can’t move this activation.');
        const stuck = enemiesTouching(s, u);
        if (v4Rules(s)) {
            // V4 (rules doc, 2026-11-25): a unit touching an enemy's front can't Manoeuvre, unless it belongs to the
            // Master Tactician and is moving backwards. Touching only flanks or rears doesn't hold a unit.
            if ((frontHeld(s, u) || act.heldBack) && (u.owner !== s.master || !backwards))
                return none(u.owner === s.master ? 'Touching an enemy’s front: this unit can only move backwards.' : 'Touching an enemy’s front: only the Master Tactician’s units can move, and only backwards.');
        } else if (stuck.length && u.owner !== s.master) return none('Only the Master Tactician’s units can move out of contact.');
        const f = forwardOf(u), sign = backwards ? -1 : 1, me = rect(u);
        let { budget, stop, blocker, slowAt } = slowBudget(s, u, act, backwards);
        if (budget <= 1e-6) return { max: 0, reason: stop === 'slow' ? 'Slowing terrain limits this Move to 4 inches.' : 'No movement left.', charge: null, stop, blocker, slowAt };
        const v = { x: f.x * sign * budget * PX, y: f.y * sign * budget * PX };
        let px = budget * PX, charge = null, frontOnly = null;
        if (stop !== 'slow') blocker = null;
        const block = (d, why, obstacle) => {
            if (d !== null && d < px) { px = Math.max(0, d); stop = why; charge = null; blocker = obstacle; }
        };
        // battlefield edge
        for (const p of me) {
            if (v.x > 1e-9) block((s.width - p.x) / v.x * budget * PX, 'edge', 'edge');
            if (v.x < -1e-9) block((0 - p.x) / v.x * budget * PX, 'edge', 'edge');
            if (v.y > 1e-9) block((s.height - p.y) / v.y * budget * PX, 'edge', 'edge');
            if (v.y < -1e-9) block((0 - p.y) / v.y * budget * PX, 'edge', 'edge');
        }
        const far = o => centreGap(u, o) > budget * PX + 2;   // can't be reached this Move
        for (const t of s.terrain) if (trait(t, 'impassable') && !far(t)) block(sweep(me, disc(t), v), 'terrain', t);
        // Reform Variant: any pivot this activation, even before moving, rules out a charge.
        // V3 (like Reform): pivots before moving keep the charge; a pivot after starting to move loses it.
        // V4: pivots never rule out a charge.
        const reformVariant = s.rules === 'reform-variant';
        const canCharge = !backwards && (v4Rules(s) || (reformVariant ? !act.pivots : !act.pivotedInMove)) && !spent(s, u);
        const crossings = friendlyPassage(s) && u.paceStar ? [] : null;
        for (const o of live(s)) {
            if (o.id === u.id || far(o)) continue;
            const poly = rect(o);
            if (crossings && o.owner === u.owner) {
                const interval = sweepInterval(me, poly, v);
                if (interval) crossings.push({ from: interval.enter / PX, to: interval.exit / PX, unit: o });
                continue;
            }
            if (o.owner === u.owner || stuck.includes(o)) { block(sweep(me, poly, v), 'unit', o); continue; }
            // Use the exact contact point. A small gap along a separating axis can
            // still leave the corners too far apart for a charge at an angle.
            const d = sweep(me, poly, v);
            if (d === null) continue;
            if (canCharge) { if (d <= px) { px = d; stop = 'charge'; charge = { distance: d / PX, targets: [] }; blocker = o; } }
            else block(d - STANDOFF, 'enemy', o);
        }
        if (charge) {
            const at = { ...u, x: u.x + f.x * px, y: u.y + f.y * px };
            const touched = live(s).filter(o => o.owner !== u.owner && !stuck.includes(o) && canStrikeAt(s, at, o));
            // V4: which faces may be charged is decided where the Manoeuvre began, before any pivots or moves.
            const from = act.startPose ? { ...u, ...act.startPose } : u;
            charge.targets = touched.filter(o => !chargeFrontOnly(s, from, o) || touchesFront(o, at)).map(o => o.id);
            if (!charge.targets.length) {
                if (touched.length) frontOnly = touched[0];
                charge = null; stop = 'enemy'; px = Math.max(0, px - STANDOFF);
            }
            else charge.distance = px / PX;
        }
        // Combine overlapping intervals so a destination between two friendlies
        // is offered only if the moving card fits there.
        const passages = crossings?.sort((a, b) => a.from - b.from).reduce((list, crossing) => {
            const previous = list[list.length - 1];
            if (previous && crossing.from < previous.to - 1e-7) previous.to = Math.max(previous.to, crossing.to);
            else list.push(crossing);
            return list;
        }, []);
        const blocked = crossingAt(passages, px / PX);
        if (blocked) block(blocked.from * PX, 'unit', blocked.unit);
        let reason = '';
        if (stop === 'enemy' && !canCharge) {
            if (backwards) reason = 'Only a forward Move can charge.';
            else reason = reformVariant ? 'A unit that pivots can’t charge this activation.' : 'A unit can’t charge after pivoting during a Move.';
        } else if (frontOnly && stop === 'enemy') {
            reason = `The line from this unit’s front to ${frontOnly.name}’s centre crosses its front edge, so it can only charge its front.`;
        } else if (blocked) {
            reason = `Not enough room to clear ${blocked.unit.name}.`;
        } else if (stop === 'unit' && stuck.includes(blocker)) {
            reason = `Already touching ${blocker.name}.`;
        }
        const max = Math.max(0, px / PX);
        return { max, reason, charge, stop, blocker, slowAt: slowAt / PX,
            ...(passages?.length ? { crossings: passages.filter(c => c.from < max && c.to <= max + 1e-7) } : {}) };
    }

    /**
     * V5 (rules doc 2026-11-26). A Move is a March, a Charge or a Withdraw:
     * - March: straight forwards up to Pace or backwards up to half Pace, with up to Mobility pivots, each at the start
     *   or the end (so after a pivot that follows moving, the unit can't move on). No part of it may touch another unit,
     *   impassable terrain or the edge, so it stops STANDOFF short of them.
     * - Charge: a forward move straight into an enemy, with at most one pivot, made before it moves. Only the edge that
     *   the line from the charger's front-edge centre to the target's centre crosses (where the Manoeuvre began) may be
     *   met; the charger then hinges flush against it (chargeAt). If it can't, the move stops short.
     * - Withdraw: an engaged unit of the Master Tactician may face about (faceAbout), then March without pivots.
     * Engaged units of the other player can't move at all.
     */
    function moveLimitV5(s, u, act, backwards) {
        const dir = backwards ? 'back' : 'fwd', none = why => ({ max: 0, reason: why, charge: null, stop: 'rule' });
        if (act.action && act.action !== 'move') return none('This unit has already used its action.');
        if (act.charged) return none('A charge stops on contact.');
        if (act.dir && act.dir !== dir) return none('A March can’t switch between forwards and backwards.');
        if (act.pivotedInMove) return none('Pivots come at the start or the end of a March: after pivoting at the end, the unit can’t move on.');
        const stuck = enemiesTouching(s, u), withdrawing = Boolean(act.withdraw) || stuck.length > 0;
        if (withdrawing && u.owner !== s.master) return none('Engaged: this unit can only Strike. Only the Master Tactician’s units can Withdraw.');
        const f = forwardOf(u), sign = backwards ? -1 : 1, me = rect(u);
        let { budget, stop, blocker, slowAt } = slowBudget(s, u, act, backwards);
        if (budget <= 1e-6) return { max: 0, reason: stop === 'slow' ? 'Slowing terrain limits this Move to 4 inches.' : 'No movement left.', charge: null, stop, blocker, slowAt: slowAt / PX };
        if (stop !== 'slow') blocker = null;
        const full = budget * PX, v = { x: f.x * sign * full, y: f.y * sign * full }, hits = [];
        for (const p of me) {
            if (v.x > 1e-9) hits.push({ d: (s.width - p.x) / v.x * full, why: 'edge', o: 'edge' });
            if (v.x < -1e-9) hits.push({ d: (0 - p.x) / v.x * full, why: 'edge', o: 'edge' });
            if (v.y > 1e-9) hits.push({ d: (s.height - p.y) / v.y * full, why: 'edge', o: 'edge' });
            if (v.y < -1e-9) hits.push({ d: (0 - p.y) / v.y * full, why: 'edge', o: 'edge' });
        }
        const far = o => centreGap(u, o) > full + 2;
        for (const t of s.terrain) if (trait(t, 'impassable') && !far(t)) { const d = sweep(me, disc(t), v); if (d !== null) hits.push({ d, why: 'terrain', o: t }); }
        for (const o of live(s)) {
            if (o.id === u.id || far(o)) continue;
            const d = sweep(me, rect(o), v);
            if (d !== null) hits.push({ d, why: o.owner === u.owner || stuck.includes(o) ? 'unit' : 'enemy', o, touching: stuck.includes(o) });
        }
        hits.sort((a, b) => a.d - b.d);
        const canCharge = !backwards && !withdrawing && act.pivots <= 1;
        const first = hits.find(h => h.d <= full + 1e-7);
        let px = full, charge = null, reason = '';
        if (first) {
            if (first.why === 'enemy' && canCharge) {
                const c = chargeAt(s, u, act, first.o, first.d);
                if (c.ok) { px = first.d; stop = 'charge'; blocker = first.o; charge = { distance: px / PX, targets: [first.o.id], pose: c.pose, edge: c.edge }; }
                else reason = c.reason;
            }
            if (!charge) {
                px = first.touching ? Math.max(0, first.d) : Math.max(0, first.d - STANDOFF); stop = first.why; blocker = first.o;
                if (!reason && first.why === 'enemy') reason = backwards ? 'Only a forward move can charge; a March can’t touch an enemy.'
                    : withdrawing ? 'A Withdraw can’t touch an enemy.' : act.pivots > 1 ? 'A charge allows only one pivot, made before it moves.' : '';
                if (!reason && first.touching) reason = `Already touching ${first.o.name}.`;
            }
        }
        return { max: Math.max(0, px / PX), reason, charge, stop, blocker, slowAt: slowAt / PX };
    }

    const EDGE_NAMES = ['front', 'right flank', 'rear', 'left flank'];   // rect edge i runs from corner i to corner i + 1
    /** V5: the target edges a charge may meet: the edge crossed by the line from the charger's front-edge centre to the target's centre (both of a corner's edges). */
    function chargeEdges(from, target) {
        const [a, b] = rect(from), t = rect(target), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, c = centre(target);
        const hit = [0, 1, 2, 3].filter(i => segmentsMeet(m, c, t[i], t[(i + 1) % 4]));
        return hit.length ? hit : [0];
    }
    /** Where the front edge of `at` meets `target` (they touch): a corner of one on the other, or the middle of a shared stretch. */
    function contactPoint(at, target) {
        const p = rect(at), t = rect(target), tol = 0.05, pts = [];
        for (const q of t) if (pointSeg(q, p[0], p[1]) <= tol) pts.push(q);
        for (const c of [p[0], p[1]]) if ([0, 1, 2, 3].some(i => pointSeg(c, t[i], t[(i + 1) % 4]) <= tol)) pts.push(c);
        if (!pts.length) return null;
        return { x: pts.reduce((n, q) => n + q.x, 0) / pts.length, y: pts.reduce((n, q) => n + q.y, 0) / pts.length };
    }
    /** The pose of `at` turned about P (which keeps its place on the front edge) to `angle`. */
    function hingedTo(at, P, angle) {
        const a0 = at.angle * Math.PI / 180, a = angle * Math.PI / 180, p = rect(at);
        const along = Math.max(0, Math.min(at.w, (P.x - p[0].x) * Math.cos(a0) + (P.y - p[0].y) * Math.sin(a0)));
        const dir = { x: Math.cos(a), y: Math.sin(a) }, fwd = { x: Math.sin(a), y: -Math.cos(a) };
        const cx = P.x + dir.x * (at.w / 2 - along) - fwd.x * at.h / 2, cy = P.y + dir.y * (at.w / 2 - along) - fwd.y * at.h / 2;
        return { x: cx - at.w / 2, y: cy - at.h / 2, angle };
    }
    /** Why a unit at this pose has no room ('' if it has): touching a friend, impassable terrain or the edge, or overlapping an enemy. */
    function roomError(s, u, pose) {
        const poly = rect({ ...u, ...pose });
        if (poly.some(q => q.x <= TOUCH || q.y <= TOUCH || q.x >= s.width - TOUCH || q.y >= s.height - TOUCH)) return 'it would touch the battlefield’s edge';
        for (const t of s.terrain) if (trait(t, 'impassable') && satGap(poly, disc(t)) <= TOUCH) return `it would touch the ${t.type}`;
        for (const o of live(s)) {
            if (o.id === u.id) continue;
            if (o.owner === u.owner ? polyDist(poly, rect(o)) <= TOUCH : overlapping(poly, rect(o))) return `it would ${o.owner === u.owner ? 'touch' : 'overlap'} ${o.name}`;
        }
        return '';
    }
    /**
     * V5: can `u`, moving forwards `d` px, charge `target`? It must first meet the target on an edge allowed by
     * chargeEdges (drawn from where the Manoeuvre began), then hinge about the contact point until its front is flush
     * with that edge, with room to do so (not touching a friend, impassable terrain or the edge; enemies may be touched).
     */
    function chargeAt(s, u, act, target, d) {
        const f = forwardOf(u), at = { ...u, x: u.x + f.x * d, y: u.y + f.y * d };
        const from = act.startPose ? { ...u, ...act.startPose } : u, edges = chargeEdges(from, target), t = rect(target);
        const allowed = edges.map(i => EDGE_NAMES[i]).join(' or ');
        const P = contactPoint(at, target);
        const onEdge = P ? edges.filter(i => pointSeg(P, t[i], t[(i + 1) % 4]) <= 0.05) : [];
        if (!onEdge.length) return { ok: false, edges, reason: `The line from this unit’s front to ${target.name}’s centre crosses its ${allowed}, so only that may be charged, and this charge would meet another part first.` };
        let why = '';
        const tc = centre(target), poses = onEdge.map(i => {
            const a = t[i], b = t[(i + 1) % 4], n = sub({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, tc);
            // Face against the edge's outward normal n: forwardOf(angle) = -n.
            const want = Math.atan2(-n.x, n.y) * 180 / Math.PI;
            return { edge: i, turn: ((want - at.angle) % 360 + 540) % 360 - 180 };
        }).sort((p, q) => Math.abs(p.turn) - Math.abs(q.turn));
        for (const { edge, turn } of poses) {
            const pose = hingedTo(at, P, at.angle + turn);
            why = roomError(s, u, pose);
            for (let k = 1; k < 12 && !why && Math.abs(turn) > 1e-6; k++) why = roomError(s, u, hingedTo(at, P, at.angle + turn * k / 12));
            if (!why) return { ok: true, pose: slideToCentre(s, u, target, edge, pose), edge, turn, edges };
        }
        return { ok: false, edges, reason: `No room to line up flush against ${target.name}’s ${allowed}: ${why}.` };
    }
    /**
     * V5 (designer, 2026-11-26): once flush, a charger whose front edge doesn't reach the centre of the target edge
     * slides along that edge towards the centre until it touches it, or as far as it has room (roomError). Not movement,
     * so slowing terrain doesn't limit it.
     */
    function slideToCentre(s, u, target, edge, pose) {
        const t = rect(target), a = t[edge], b = t[(edge + 1) % 4], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const [f0, f1] = rect({ ...u, ...pose }), w = Math.hypot(f1.x - f0.x, f1.y - f0.y) || 1, dir = { x: (f1.x - f0.x) / w, y: (f1.y - f0.y) / w };
        const along = dot(sub(m, f0), dir), need = along < 0 ? along : along > w ? along - w : 0;
        if (Math.abs(need) < 1e-6) return pose;
        const at = d => ({ ...pose, x: pose.x + dir.x * d, y: pose.y + dir.y * d });
        if (!roomError(s, u, at(need))) {
            // Clear at the end: check the way there too (small steps, so nothing thin is slid through).
            let ok = true;
            for (let k = 1; k < 40 && ok; k++) ok = !roomError(s, u, at(need * k / 40));
            if (ok) return at(need);
        }
        // Blocked: go as far as there is room, to within 0.05 px.
        let lo = 0, hi = Math.abs(need), sign = Math.sign(need);
        for (let d = 0.5; d < hi; d += 0.5) if (roomError(s, u, at(sign * d))) { hi = d; break; } else lo = d;
        while (hi - lo > 0.05) { const mid = (lo + hi) / 2; if (roomError(s, u, at(sign * mid))) hi = mid; else lo = mid; }
        return at(sign * lo);
    }
    /** V5 Withdraw: why this unit can't face about now ('' if it can). */
    function faceAboutError(s, u, act) {
        if (!v5Rules(s)) return 'There is no Withdraw in these rules.';
        if (act.faced) return 'This unit has already faced about.';
        if (act.action || act.moved) return 'A unit faces about at the start of its Withdraw.';
        if (!enemiesTouching(s, u).length) return 'Only an engaged unit can Withdraw.';
        if (u.owner !== s.master) return 'Only the Master Tactician’s units can Withdraw.';
        return '';
    }

    const pivotCache = new Map();
    /** Largest legal pivot (degrees) anticlockwise and clockwise. */
    function pivotLimit(s, u, act, reform = false) {
        const lim = pivotScan(s, u, act, reform);
        if (reform || !lim.remaining || ignoresSlowing(s, u) || act.moved <= SLOW_IN + 1e-6) return lim;
        const hills = startHills(s, u, act);
        if (!s.terrain.some(t => slows(s, t, hills) && centreGap(u, t) < 1)) return lim;
        // Already moved more than 4": the turn must stop before the card would overlap slowing terrain.
        const clear = (sign, max, originalBlocker) => {
            for (let k = 0; k < max; k++) {
                const pose = { ...u, angle: u.angle + sign * (k + 1) };
                const blocker = s.terrain.find(t => slows(s, t, hills) && inFeature(pose, t));
                if (blocker) return [k, blocker];
            }
            return [max, originalBlocker];
        };
        const [left, leftBlocker] = clear(-1, lim.left, lim.leftBlocker);
        const [right, rightBlocker] = clear(1, lim.right, lim.rightBlocker);
        return { ...lim, left, right, leftBlocker, rightBlocker,
            reason: left || right ? lim.reason : 'Slowing terrain limits this Move to 4 inches; there isn’t room to turn without entering it.' };
    }
    function pivotScan(s, u, act, reform) {
        const none = why => ({ left: 0, right: 0, remaining: 0, usesAction: false, reason: why });
        if (act.charged) return none('A unit that charged can’t pivot for the rest of its activation.');
        // V5: a Reform is picked up and put down, so only where it ends matters: every obstacle is 'soft' for it.
        const through = pivotThrough(s) || (reform && v5Rules(s));
        const canStartInContact = s.rules === 'v3' && !reform && u.owner === s.master;
        const contact = enemiesTouching(s, u);
        if (v5Rules(s)) {
            // V5: an engaged unit (touching any enemy) can only Strike, or Withdraw without pivots.
            if (act.withdraw || contact.length) return none(reform ? 'An engaged unit can’t Reform.' : u.owner === s.master
                ? 'Engaged: this unit can Strike, or Withdraw (face about if you like, then March without pivots).' : 'Engaged: this unit can only Strike.');
        } else if (v4Rules(s)) {
            // Held by an enemy's front: no Manoeuvre, except the Master Tactician's moving backwards, which may pivot as
            // usual where it has room (designer, 2026-11-25). Contact with flanks or rears doesn't stop a pivot (turning
            // into them does).
            if (frontHeld(s, u) && u.owner !== s.master) return none('Touching an enemy’s front: this unit can’t Manoeuvre.');
        } else if (!act.overlap && !canStartInContact && contact.length) return none('A unit touching an enemy can’t pivot.');
        let remaining, usesAction, maxDeg = 90;
        if (reform) {
            // Reform: the activation's action, one turn of any size.
            if (!reformAction(s)) return none('Reform is not in these rules.');
            if (act.action) return none('This unit has already used its action.');
            remaining = 1; usesAction = true; maxDeg = 180;
        } else if (reformRules(s)) {
            // Pivots belong to a Move: available before the action is chosen (they start a Move) or during one.
            if (act.action && act.action !== 'move') return none('Pivots are only allowed as part of a Move.');
            usesAction = false; remaining = Math.max(0, pivotsAllowed(s, u, act) - act.pivots);
        } else {
            const used = act.pivots, free = u.mobility - used;
            usesAction = free <= 0 && !act.action;
            remaining = Math.max(0, pivotAllowance(u, act) - used) + (usesAction ? 1 : 0);
        }
        if (remaining <= 0) return none('No pivots left.');
        // Sampling every degree with half a pixel of clearance is conservative: no point of a unit moves
        // more than 0.4 px between a sample and the midpoint to the next, so nothing can be passed through.
        const obstacles = [...live(s).filter(o => o.id !== u.id && centreGap(u, o) < PIVOT_CLEARANCE),
            ...s.terrain.filter(t => trait(t, 'impassable') && centreGap(u, t) < PIVOT_CLEARANCE)];
        const polygons = obstacles.map(shape);
        // Soft obstacles may be turned through but not stopped on: all of them in V3, none otherwise.
        const soft = obstacles.map(() => through);
        const anySoft = soft.some(Boolean);
        // V4: something already touching may be turned away from; only pushing into it is making contact. The usual
        // clearance would block both ways, so those are tested for overlap instead.
        const start = rect(u), limitOf = polygons.map(o => v4Only(s) && gapBelow(start, o, PIVOT_CLEARANCE) ? -TOUCH : PIVOT_CLEARANCE);
        const c0 = centre(u), r0 = reach(u) + PIVOT_CLEARANCE;
        const nearEdge = c0.x < r0 || c0.y < r0 || c0.x > s.width - r0 || c0.y > s.height - r0;
        if (!obstacles.length && !nearEdge) return { left: maxDeg, right: maxDeg, remaining, usesAction, reason: '' };
        // The scan depends only on this geometry, which the AI meets many times over: keep its answer.
        let key = `${through ? 'T' : ''}${v4Only(s) ? '4' : ''}${maxDeg},${s.width},${s.height},${u.x},${u.y},${u.w},${u.h},${u.angle}`;
        polygons.forEach((o, i) => { key += `|${soft[i] ? 's' : ''}${o.length}:${o[0].x},${o[0].y},${o[1].x},${o[1].y},${o[2].x},${o[2].y}`; });
        let limits = pivotCache.get(key);
        if (!limits) {
            const probe = { x: u.x, y: u.y, w: u.w, h: u.h, angle: u.angle };
            const scan = sign => {
                // Soft obstacles (all of them in V3) are passed through, recording the facings where the unit would
                // overlap; anything else stops the turn.
                let last = 0, open = null;
                const spans = [];
                for (let k = 0; k < maxDeg; k++) {
                    const poly = rect(probe, u.angle + sign * (k + 1));
                    let hit = null;
                    if (nearEdge && poly.some(p => p.x < PIVOT_CLEARANCE || p.y < PIVOT_CLEARANCE || p.x > s.width - PIVOT_CLEARANCE || p.y > s.height - PIVOT_CLEARANCE)) hit = 'edge';
                    if (hit === null) {
                        const index = polygons.findIndex((o, i) => !soft[i] && gapBelow(poly, o, limitOf[i]));
                        if (index !== -1) hit = index;
                    }
                    if (hit !== null && !through) {
                        if (open) spans.push(open);
                        return [last, hit, spans];
                    }
                    if (hit === null && anySoft) { const index = polygons.findIndex((o, i) => soft[i] && gapBelow(poly, o, PIVOT_CLEARANCE)); if (index !== -1) hit = index; }
                    if (hit === null) { if (open) { spans.push(open); open = null; } last = k + 1; continue; }
                    if (open) open.to = k + 1; else open = { from: k + 1, to: k + 1, hit };
                }
                if (open) spans.push(open);
                return [last, spans.length ? spans[0].hit : null, spans];
            };
            limits = [scan(-1), scan(1)];
            if (pivotCache.size > 50000) pivotCache.clear();
            pivotCache.set(key, limits);
        }
        const [[clearLeft, li, ls], [clearRight, ri, rs]] = limits;
        // V3: with another pivot to follow, this one may end overlapping (pivotEndError checks it can finish clear).
        const chain = through && remaining >= 2, left = chain ? maxDeg : clearLeft, right = chain ? maxDeg : clearRight;
        const blocker = index => index === 'edge' ? 'edge' : (obstacles[index] || null);
        // Only spans short of the farthest clear facing matter: they are facings the turn passes through.
        const spans = (list, max) => (list || []).filter(b => b.from < max).map(b => ({ from: b.from, to: b.to, blocker: blocker(b.hit) }));
        return { left, right, leftBlocker: blocker(li), rightBlocker: blocker(ri), remaining, usesAction,
            ...(through || anySoft ? { chain, blocked: { left: spans(ls, left), right: spans(rs, right) } } : {}),
            reason: left || right ? '' : 'There isn’t room to turn here.' };
    }

    /** What the unit would overlap (with pivot clearance) at this facing: a unit, a terrain feature, 'edge' or null. */
    function overlapAt(s, u, angle) {
        const poly = rect(u, angle);
        if (poly.some(p => p.x < PIVOT_CLEARANCE || p.y < PIVOT_CLEARANCE || p.x > s.width - PIVOT_CLEARANCE || p.y > s.height - PIVOT_CLEARANCE)) return 'edge';
        for (const o of live(s)) if (o.id !== u.id && centreGap(u, o) < PIVOT_CLEARANCE && gapBelow(poly, rect(o), PIVOT_CLEARANCE)) return o;
        for (const t of s.terrain) if (trait(t, 'impassable') && centreGap(u, t) < PIVOT_CLEARANCE && gapBelow(poly, disc(t), PIVOT_CLEARANCE)) return t;
        return null;
    }
    const obstacleLabel = b => b === 'edge' ? 'the battlefield’s edge' : b?.name || b?.type || 'an obstacle';
    /**
     * V3: a run of pivots may pass through anything, but the facing after the last one must be clear.
     * A pivot may end overlapping only if a later pivot can still reach a clear facing.
     */
    function pivotEndError(s, u, lim, deg) {
        if (!pivotThrough(s)) return '';
        const angle = u.angle + deg, blocker = overlapAt(s, u, angle);
        if (!blocker) return '';
        const more = lim.remaining - 1, reach = 90 * more;
        if (more < 1) return `A unit can pivot through ${obstacleLabel(blocker)} but can’t finish its pivots overlapping it.`;
        // Turning back to where the run started is usually clear, so try that first.
        if (Math.abs(deg) <= reach + 1e-6 && !overlapAt(s, u, u.angle)) return '';
        for (let k = 1; k <= reach; k++) if (!overlapAt(s, u, angle - k) || !overlapAt(s, u, angle + k)) return '';
        return `There’s no room to finish pivoting clear of ${obstacleLabel(blocker)}.`;
    }
    /** The overlap span (if any) that would stop a turn of `deg` from ending there. Samples are whole degrees. */
    function pivotOverlap(lim, deg) {
        if (lim?.chain) return null;
        const a = Math.abs(deg);
        return (lim?.blocked?.[deg < 0 ? 'left' : 'right'] || []).find(b => a > b.from - 1 + 1e-6 && a < b.to + 1 - 1e-6) || null;
    }
    function pivotAllowed(lim, deg) {
        return Math.abs(deg) <= (deg < 0 ? lim.left : lim.right) + 1e-6 && !pivotOverlap(lim, deg);
    }
    /** The legal turn nearest `deg` on the same side (0 if none). */
    function nearestPivot(lim, deg) {
        const sign = deg < 0 ? -1 : 1, max = sign < 0 ? lim.left : lim.right;
        let a = Math.min(Math.abs(deg), max);
        const span = pivotOverlap(lim, sign * a);
        if (span) {
            const before = span.from - 1, after = span.to + 1;
            a = after <= max && after - a < a - before ? after : before;
        }
        return sign * a;
    }

    const shotError = (s, u, v) => shotCheck(s, u, v).reason;
    function shotCheck(s, u, v) {
        if (!(u.shoot > 0)) return { reason: 'This unit can’t shoot.' };
        if (spent(s, u)) return { reason: SPENT_TEXT };
        if (enemiesTouching(s, u).length) return { reason: 'A unit touching an enemy can’t shoot.' };
        if (enemiesTouching(s, v).length) return { reason: 'Target is in contact with one of your units.' };
        const arc = firingArc(u), target = rect(v), { origin } = arc;
        const outsideArc = shotArcError(s, u, v);
        if (outsideArc) return { reason: outsideArc };
        const high = inTrait(s, u, 'elevated');
        const blockers = [
            // V4: no firing arc, but a sight line may not pass through the shooter itself (so none goes backwards).
            ...(v4Rules(s) ? [{ poly: rect(u), what: 'the shooter itself', piece: u, c: centre(u), r: reach(u) }] : []),
            ...(high ? [] : live(s).filter(o => o.id !== u.id && o.id !== v.id).map(o => ({ poly: rect(o), what: o.name, piece: o, c: centre(o), r: reach(o) }))),
            ...s.terrain.filter(t => trait(t, 'concealing') || (trait(t, 'elevated') && !inFeature(u, t) && !inFeature(v, t)))
                .map(t => ({ poly: disc(t), what: t.type, piece: t, c: centre(t), r: reach(t) }))
        ];
        // The fan of triangles from the firing point to each target edge covers every sight line.
        // A blocker lies inside its circle, so one whose circle clears a triangle cannot overlap it (same answer, cheaper).
        const fan = [0, 1, 2, 3].map(i => [origin, target[i], target[(i + 1) % 4]]);
        const inFan = b => fan.some(tri => pointTriangleGap(b.c, tri) <= b.r + 1e-6 && overlapping(tri, b.poly));
        if (!v3Rules(s)) {
            const b = blockers.find(inFan);
            return b ? { reason: `Line of sight blocked by ${b.what}.`, blocker: b.piece } : { reason: '' };
        }
        // V3: one clear straight line to the centre of any target edge the shooter can see is enough.
        // The target blocks too, so only edges facing the shooter count: an edge faces it when the
        // firing point lies outside that edge's line (an edge seen exactly side-on doesn't count).
        const hiding = blockers.filter(inFan);
        const tc = centre(v), facing = [0, 1, 2, 3].map(i => ({ x: (target[i].x + target[(i + 1) % 4].x) / 2, y: (target[i].y + target[(i + 1) % 4].y) / 2 }))
            .filter(q => dot(sub(origin, q), sub(q, tc)) > 1e-6);
        // V4: Range is measured along that same line, so the edge centre must also be within range.
        const mids = v4Rules(s) ? facing.filter(q => Math.hypot(q.x - origin.x, q.y - origin.y) <= arc.radius + TOUCH) : facing;
        if (!mids.length && facing.length) return { reason: 'Out of range: no edge centre it can see is within range.' };
        if (mids.some(q => !hiding.some(b => overlapping([origin, q], b.poly)))) return { reason: '' };
        if (!hiding.length) return { reason: 'Line of sight blocked by the target itself.' };
        return { reason: `Line of sight blocked by ${hiding[0].what}.`, blocker: hiding[0].piece };
    }

    function firingArc(u) {
        const [a, b] = rect(u);
        return {
            origin: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            forward: forwardOf(u), radius: u.range * PX
        };
    }

    /**
     * The cheap part of a shot check. V4 (designer, 2026-11-25) drops the rule that the whole target must be in front
     * of the shooter: only the sight line counts, so here just the range to the nearest point (the exact range check,
     * to an edge centre, is in shotCheck).
     */
    function shotArcError(s, u, v) {
        const arc = firingArc(u), target = rect(v);
        if (!v4Rules(s)) return firingArcError(arc, target);
        return target.every((q, i) => pointSeg(arc.origin, q, target[(i + 1) % 4]) > arc.radius + TOUCH) ? 'Out of range.' : '';
    }
    function firingArcError({ origin, forward, radius }, target) {
        if (target.some(q => dot(sub(q, origin), forward) < -TOUCH)) return 'Target isn’t entirely in front of the shooter.';
        if (target.every((q, i) => pointSeg(origin, q, target[(i + 1) % 4]) > radius + TOUCH)) return 'Out of range.';
        return '';
    }

    function touchesFlank(a, enemy) {
        const p = rect(a), e = rect(enemy), trim = (from, to) => { const d = sub(to, from), l = Math.hypot(d.x, d.y) || 1; return { x: from.x + d.x / l, y: from.y + d.y / l }; };
        // The front corners belong to the front, so the side edges start just behind them.
        const flank = [[trim(p[1], p[2]), p[2]], [p[2], p[3]], [p[3], trim(p[0], p[3])]];
        return flank.some(seg => touchingPolys(seg, e));
    }
    /**
     * True when an enemy touches the front edge (corners included) of unit a. A unit lying flush
     * alongside touches only a front corner from the side; it counts only if part of it is ahead of the front.
     */
    function touchesFront(a, enemy) {
        const p = rect(a), e = rect(enemy), f = forwardOf(a);
        return touchingPolys([p[0], p[1]], e) && e.some(q => dot(sub(q, p[0]), f) > TOUCH);
    }
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    /** Do segments pq and ab meet (end points included)? */
    function segmentsMeet(p, q, a, b) {
        const d1 = cross(a, b, p), d2 = cross(a, b, q), d3 = cross(p, q, a), d4 = cross(p, q, b), e = 1e-9;
        if (((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e))) return true;
        return pointSeg(p, a, b) <= TOUCH || pointSeg(q, a, b) <= TOUCH || pointSeg(a, p, q) <= TOUCH || pointSeg(b, p, q) <= TOUCH;
    }
    /**
     * V4 (rules doc, 2026-11-25): at the very start of the charger's Manoeuvre, draw a line from the centre of its front
     * edge to the centre of the target. If it passes through the target's front edge (corners included), the charger may
     * only make contact with that front edge.
     */
    function lineThroughFront(u, target) {
        const [a, b] = rect(u), t = rect(target);
        return segmentsMeet({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, centre(target), t[0], t[1]);
    }
    const chargeFrontOnly = (s, u, target) => v4Only(s) && lineThroughFront(u, target);
    // V3: a unit can only strike (and so only charge) enemies touching its front. V4: any enemy it touches.
    const canStrikeAt = (s, u, v) => touching(u, v) && (s.rules !== 'v3' || touchesFront(u, v));
    /** V4: enemy y's front edge (corners included) touches the flank of unit x. */
    const flanksWithFront = (y, x) => touchesFront(y, x) && touchesFlank(x, y);
    /**
     * V4: a unit is Shaken while an enemy's front edge touches its flank and that enemy is not touching another unit of
     * the Shaken unit's side (any contact counts: front, flank or rear). Designer, 2026-11-21 (replaces "unless that enemy
     * is Shaken itself").
     */
    const shaken = (s, u) => v4Rules(s) && enemiesTouching(s, u).some(y => flanksWithFront(y, u)
        && !live(s).some(o => o.owner === u.owner && o.id !== u.id && touching(o, y)));
    /** V4: an enemy's front edge (corners included) touches this unit. */
    const frontHeld = (s, u) => enemiesTouching(s, u).some(e => touchesFront(e, u));
    const SHAKEN_TEXT = 'This unit is Shaken: an enemy’s front is touching its flank, so it can’t strike.';
    function outflanked(s, a) {
        return enemiesTouching(s, a).some(e => touchesFlank(a, e) && !live(s).some(o => o.owner === a.owner && o.id !== a.id && touching(o, e)));
    }

    const distCache = new Map();
    /** Exact probabilities of causing 0, 1, 2... strain with `pool` dice needing `tn`+ (with `explode`, each 6 rolls a bonus die; not in V4). */
    function strainDist(pool, tn, explode = true) {
        const key = (pool * 10 + tn) * (explode ? 1 : -1);
        if (distCache.has(key)) return distCache.get(key);
        const hit = (7 - tn) / 6, one = explode ? [(tn - 1) / 6, (6 - tn) / 6 + (1 - hit) / 6, hit / 6] : [1 - hit, hit];
        let dist = [1];
        for (let i = 0; i < pool; i++) { const next = Array(dist.length + one.length - 1).fill(0); dist.forEach((p, k) => one.forEach((q, j) => { next[k + j] += p * q; })); dist = next; }
        distCache.set(key, dist);
        return dist;
    }
    /** Dice pool, target number and odds for an attack, without rolling. */
    function attackPreview(s, attackerId, targetId, kind, startHigh = null) {
        const u = unitById(s, attackerId), v = unitById(s, targetId), shooting = kind === 'shoot', mods = [];
        // V3 has no combat modifiers: the pool is the unit's stat.
        if (!v3Rules(s)) {
        if (outflanked(s, v)) mods.push({ label: 'Target outflanked', dice: FLANK_DICE });
        if (outflanked(s, u)) mods.push({ label: 'Attacker outflanked', dice: -FLANK_DICE });
        const high = startHigh === null ? inTrait(s, u, 'elevated') : startHigh, targetHigh = inTrait(s, v, 'elevated');
        if (high && !targetHigh) mods.push({ label: 'Attacker higher', dice: 1 });
        if (!high && targetHigh) mods.push({ label: 'Attacker lower', dice: -1 });
        const unmarked = shooting ? 0 : unmarkedStrikeDice(s, v.activated);
        if (unmarked) mods.push({ label: 'Target has no command marker', dice: unmarked });
        }
        const base = shooting ? u.shoot : u.melee, pool = Math.max(1, base + mods.reduce((n, m) => n + m.dice, 0));
        let tn = v.defence, tnNote = '';
        if (shooting ? u.shootAP : u.meleeAP) { if (tn > 3) { tn = 3; tnNote = 'Armour-piercing'; } }
        // V5: striking the target's flank (anything but its front edge and front corners) needs 3s, like Armour-piercing.
        if (!shooting && v5Rules(s) && tn > 3 && touchesFlank(v, u)) { tn = 3; tnNote = 'Flank attack'; }
        if (shooting && v.defenceStar) { tn = 6; tnNote = 'Loose formation'; }
        tn = Math.max(2, Math.min(6, tn));
        // Exact strain distribution: each die scores 0, 1, or (on a 6) 1 plus a bonus die.
        const dist = strainDist(pool, tn, explodingSixes(s));
        const need = ROUT_STRAIN - v.strain;
        return { kind, base, pool, mods, tn, tnNote, dist, expected: dist.reduce((n, p, k) => n + p * k, 0),
            routChance: dist.reduce((n, p, k) => n + (k >= need ? p : 0), 0), need };
    }

    /** Everything the acting player could do with this unit now (for UI and AI). */
    function unitOptions(s, unitId) {
        const u = unitById(s, unitId), off = why => ({ canAct: false, reason: why });
        if (!u || !u.owner) return off('');
        if (s.phase !== 'command') return off('');
        const p = activePlayer(s);
        if (u.owner !== p) return off(`It is ${label(p)}’s turn.`);
        let act = s.activation;
        if (act && act.unitId !== u.id) return off(`Finish ${unitById(s, act.unitId).name}’s activation first.`);
        if (!act) {
            if (u.activated) return off('Already activated this round.');
            if (s.commands[p] < 1) return off('No commands left.');
            act = newActivation(u.id);
        }
        return optionsWith(s, u, act);
    }
    function optionsWith(s, u, act) {
        const actionFree = !act.action, contact = enemiesTouching(s, u);
        const targetsFor = kind => live(s).filter(v => v.owner !== u.owner).map(v => {
            const check = kind === 'shoot' ? shotCheck(s, u, v) : { reason: canStrikeAt(s, u, v) ? '' : touching(u, v) ? 'Not touching this unit’s front.' : 'Not in contact.' };
            return { id: v.id, ok: !check.reason, ...check, preview: check.reason ? null : attackPreview(s, u.id, v.id, kind, kind === 'strike' && act.freeStrike ? act.startHigh : null) };
        });
        const canShoot = actionFree && u.shoot > 0 && !contact.length && !spent(s, u);
        const canStrike = (actionFree || act.freeStrike) && contact.length > 0 && !spent(s, u) && !shaken(s, u);
        const onlyTarget = t => !(act.freeStrike && act.chargeTarget) || t.id === act.chargeTarget;
        return {
            canAct: true, reason: '', activated: Boolean(s.activation), activation: act,
            forward: moveLimit(s, u, act, false), backward: moveLimit(s, u, act, true), pivot: pivotLimit(s, u, act),
            reform: reformAction(s) ? pivotLimit(s, u, act, true) : null, rules: s.rules || 'classic',
            shoot: canShoot ? targetsFor('shoot') : [], strike: canStrike ? targetsFor('strike').filter(t => t.ok && onlyTarget(t)) : [],
            faceAbout: v5Rules(s) && !faceAboutError(s, u, act), engaged: contact.length > 0,
            freeStrike: act.freeStrike, canRally: actionFree && u.strain > 0 && rallyAllowed(s), actionFree, inContact: contact.length > 0,
            shaken: contact.length > 0 && shaken(s, u)
        };
    }

    // ---------- command phase ----------
    function applyStrain(s, target, amount) {
        target.strain += amount;
        if (target.strain < ROUT_STRAIN) return;
        const p = target.owner;
        s.units = s.units.filter(u => u.id !== target.id); s.routed[p] += 1;
        log(s, `${target.name} routs!`); emit(s, { type: 'rout', unitId: target.id, name: target.name, owner: p, x: target.x + target.w / 2, y: target.y + target.h / 2 });
        if (s.routed[p] >= Math.ceil(s.starting[p] / 2)) {
            s.winner = other(p); s.phase = 'finished'; s.activation = null;
            log(s, `${label(s.winner)} wins the battle!`); emit(s, { type: 'victory', winner: s.winner });
        }
    }
    function resolveAttack(s, u, v, kind, act, forced) {
        const pre = attackPreview(s, u.id, v.id, kind, kind === 'strike' && act.freeStrike ? act.startHigh : null);
        const rolls = forced === undefined ? Array.from({ length: pre.pool }, () => rollDie(s)) : [], bonus = explodingSixes(s) ? rolls.filter(n => n === 6).map(() => rollDie(s)) : [];
        const strain = forced === undefined ? [...rolls, ...bonus].filter(n => n >= pre.tn).length : forced;
        const mods = pre.mods.map(m => `${m.dice > 0 ? '+' : '−'}1 ${m.label.toLowerCase()}`).join(', ');
        log(s, `${u.name} ${kind === 'shoot' ? 'shoots' : 'strikes'} ${v.name}: ${pre.pool} dice${mods ? ` (${mods})` : ''}, needing ${pre.tn}+${pre.tnNote ? ` (${pre.tnNote})` : ''}. Rolled ${rolls.join(' ')}${bonus.length ? ` + bonus ${bonus.join(' ')}` : ''} → ${strain} strain.`);
        emit(s, { type: 'attack', kind, attackerId: u.id, targetId: v.id, attacker: u.name, target: v.name, owner: u.owner, rolls, bonus, tn: pre.tn, strain,
            x: v.x + v.w / 2, y: v.y + v.h / 2 });
        applyStrain(s, v, strain);
    }
    function endActivation(s, { reviewRoundEnd, reviewTurnEnd }) {
        s.activation = null;
        if ((reviewRoundEnd || reviewTurnEnd) && !canCommand(s, activePlayer(s))) {
            const hasLaterOrders = [s.master, other(s.master), s.master].slice(s.turnStep + 1).some(p => canCommand(s, p));
            if (hasLaterOrders ? reviewTurnEnd : reviewRoundEnd) {
                if (hasLaterOrders) s.awaitingTurnEnd = true;
                else s.awaitingRoundEnd = true;
                return;
            }
        }
        skipEmptyTurns(s);
    }
    /** Close the activation by itself once nothing further is possible. */
    function autoEnd(s, review) {
        const act = s.activation;
        if (!act || s.phase !== 'command') return;
        const u = unitById(s, act.unitId);
        if (!u) return endActivation(s, review);
        const o = unitOptions(s, u.id);
        const canMove = o.forward.charge || o.forward.max > 0.005 || o.backward.max > 0.005;
        const canPivot = (o.pivot.remaining > 0 && (o.pivot.left > 0 || o.pivot.right > 0))
            || Boolean(o.reform && o.reform.remaining > 0 && (o.reform.left > 0 || o.reform.right > 0));
        if (!canMove && !canPivot && !o.strike.length && !o.shoot.some(t => t.ok) && !o.canRally && !o.faceAbout) endActivation(s, review);
    }

    function updatePivotActivation(s, u, act, deg, reform, usesAction) {
        if (reform) act.action = 'reform';
        else if (reformRules(s)) {
            // A pivot starts a Move. Once the unit has moved, it can no longer charge.
            if (act.moved > 0 && !act.charged) act.pivotedInMove = true;
            act.action = 'move';
        } else if (usesAction) act.action = 'extraPivot';
        else if (act.action === 'move' && !act.charged) act.pivotedInMove = true;
        if (!reform) act.pivots += 1;
        if (act.action === 'move' && v3Rules(s) && !act.startHills) act.startHills = hillsOf(s, u);
        if (v4Rules(s)) {
            // Where the Manoeuvre began decides which faces may be charged, and whether it must be a move backwards.
            if (!act.startPose) { act.startPose = { x: u.x, y: u.y, angle: u.angle }; if (v4Only(s) && frontHeld(s, u)) act.heldBack = true; }
        }
        // A turn during a Move can sweep through slowing terrain before it reaches its final facing.
        if (act.action === 'move' && !ignoresSlowing(s, u) && !act.slowed && act.moved <= SLOW_IN + 1e-6) {
            const hills = startHills(s, u, act);
            for (let k = 1; k <= 6; k++) if (inSlowing(s, { ...u, angle: u.angle + deg * k / 6 }, hills)) { act.slowed = true; break; }
        }
    }

    function movementAfterPivot(s, u, activation, degrees, { reform, usesAction }) {
        const projected = { ...activation };
        const pose = { ...u, angle: u.angle + degrees };
        if (Math.abs(degrees) >= 0.5) {
            updatePivotActivation(s, u, projected, degrees, reform, usesAction);
            projected.overlap = pivotThrough(s) && Boolean(overlapAt(s, pose, pose.angle));
        }
        return { pose, forward: moveLimit(s, pose, projected, false), backward: moveLimit(s, pose, projected, true) };
    }

    function commandAction(s, a, review) {
        const p = activePlayer(s);
        if (a.player && a.player !== p) fail(`It is ${label(p)}’s turn.`);
        if (a.type === 'pass') {
            if (s.activation) fail('Finish the current activation before passing.');
            log(s, `${label(p)} passes.`); nextTurn(s); skipEmptyTurns(s); return;
        }
        if (a.type === 'activate') {
            if (s.activation) fail('Finish the current activation first.');
            const u = unitById(s, a.unitId);
            if (!u || u.owner !== p) fail(`Choose one of ${label(p)}’s units.`);
            if (u.activated) fail('That unit has already been activated this round.');
            if (s.commands[p] < 1) fail('No commands left.');
            s.commands[p] -= 1; u.activated = true; s.activation = newActivation(u.id);
            emit(s, { type: 'activate', unitId: u.id });
            return;
        }
        const act = s.activation;
        if (!act) fail('Activate a unit first.');
        const u = unitById(s, act.unitId);
        if (a.type === 'endActivation') {
            if (s.activation?.overlap) fail(`Keep pivoting: ${unitById(s, s.activation.unitId).name} can’t finish overlapping another unit, impassable terrain or the edge.`);
            return endActivation(s, review);
        }
        if (a.type === 'move') {
            const inches = Number(a.inches), backwards = Boolean(a.backwards);
            if (!Number.isFinite(inches) || inches <= 0) fail('Move a positive distance.');
            const limit = moveLimit(s, u, act, backwards);
            if (limit.max <= 0) fail(limit.reason || 'This unit can’t move that way.');
            if (inches > limit.max + 0.011) fail(`This unit can move at most ${limit.max.toFixed(2)}″ that way.`);
            const charging = Boolean(limit.charge) && inches >= limit.max - 1e-6;
            const dist = charging ? limit.max : Math.min(inches, limit.max), f = forwardOf(u), sign = backwards ? -1 : 1;
            if (crossingAt(limit.crossings, dist)) fail('The unit must finish its move clear of friendly units.');
            if (act.startHigh === null) act.startHigh = inTrait(s, u, 'elevated');
            if (v3Rules(s) && !act.startHills) act.startHills = hillsOf(s, u);
            if (v4Rules(s) && !act.startPose) act.startPose = { x: u.x, y: u.y, angle: u.angle };
            if (v5Rules(s) && enemiesTouching(s, u).length) act.withdraw = true;
            if (!ignoresSlowing(s, u) && dist * PX > limit.slowAt * PX - 1e-6) act.slowed = true;
            u.x += f.x * sign * dist * PX; u.y += f.y * sign * dist * PX;
            // V5: a charger hinges flush against the edge it charged.
            if (charging && limit.charge.pose) { Object.assign(u, limit.charge.pose); act.chargeTarget = limit.charge.targets[0]; }
            act.action = 'move'; act.dir = backwards ? 'back' : 'fwd'; act.moved += dist;
            if (!ignoresSlowing(s, u) && inSlowing(s, u, startHills(s, u, act))) act.slowed = true;
            emit(s, { type: 'move', unitId: u.id });
            if (!charging) log(s, `${label(u.owner)} · ${u.name} ${backwards ? 'withdraws' : 'advances'} ${dist.toFixed(2)}″ (${act.moved.toFixed(2)}″ moved).`);
            if (charging) {
                act.charged = true; act.freeStrike = true;
                log(s, `${u.name} charges ${limit.charge.targets.map(id => unitById(s, id).name).join(' and ')}${limit.charge.pose ? `’s ${EDGE_NAMES[limit.charge.edge]}` : ''}.`);
                emit(s, { type: 'charge', unitId: u.id, targets: limit.charge.targets });
            }
        } else if (a.type === 'pivot') {
            const deg = Number(a.degrees), reform = Boolean(a.reform), lim = pivotLimit(s, u, act, reform);
            if (!Number.isFinite(deg) || Math.abs(deg) < 0.01) fail('Choose an angle to pivot.');
            if (lim.remaining <= 0) fail(lim.reason);
            if (Math.abs(deg) > (reform ? 180 : 90) + 1e-6) fail(reform ? 'Reform turns a unit up to 180° either way.' : 'A pivot turns a unit up to 90°.');
            if (Math.abs(deg) > (deg < 0 ? lim.left : lim.right) + 1e-6) fail('There isn’t room to turn that far without touching something.');
            const endError = pivotEndError(s, u, lim, deg);
            if (endError) fail(endError);
            if (v5Rules(s) && pivotOverlap(lim, deg)) fail(`A Reform can’t end touching ${obstacleLabel(pivotOverlap(lim, deg).blocker)}.`);
            updatePivotActivation(s, u, act, deg, reform, lim.usesAction);
            u.angle += deg;
            act.overlap = pivotThrough(s) && Boolean(overlapAt(s, u, u.angle));
            log(s, reform ? `${label(u.owner)} · ${u.name} reforms, turning ${deg > 0 ? 'clockwise' : 'anticlockwise'} ${Math.abs(deg)}°.`
                : `${label(u.owner)} · ${u.name} pivots ${deg > 0 ? 'clockwise' : 'anticlockwise'} ${Math.abs(deg)}° (${Math.max(0, (reformRules(s) ? pivotsAllowed(s, u, act) : u.mobility) - act.pivots)} pivots left).`);
            emit(s, { type: 'pivot', unitId: u.id });
        } else if (a.type === 'faceAbout') {
            const why = faceAboutError(s, u, act); if (why) fail(why);
            if (!act.startHills) act.startHills = hillsOf(s, u);
            if (!act.startPose) act.startPose = { x: u.x, y: u.y, angle: u.angle };
            u.angle += 180; act.action = 'move'; act.withdraw = true; act.faced = true;
            log(s, `${label(u.owner)} · ${u.name} faces about to Withdraw.`);
            emit(s, { type: 'pivot', unitId: u.id });
        } else if (a.type === 'shoot') {
            if (act.action) fail('This unit has already used its action.');
            const v = unitById(s, a.targetId);
            if (!v || v.owner === u.owner) fail('Choose an enemy target.');
            const why = shotError(s, u, v); if (why) fail(why);
            act.action = 'shoot'; resolveAttack(s, u, v, 'shoot', act, a.forcedStrain);
        } else if (a.type === 'strike') {
            if (act.action && !act.freeStrike) fail('This unit has already used its action.');
            const v = unitById(s, a.targetId);
            if (!v || v.owner === u.owner || !touching(u, v)) fail('Strike an enemy this unit is touching.');
            if (!canStrikeAt(s, u, v)) fail('A unit can only strike an enemy touching its front.');
            if (spent(s, u)) fail(SPENT_TEXT);
            if (shaken(s, u)) fail(SHAKEN_TEXT);
            if (act.freeStrike && act.chargeTarget && v.id !== act.chargeTarget) fail('The free strike is against the unit this one charged.');
            if (!act.action) act.action = 'strike';
            resolveAttack(s, u, v, 'strike', act, a.forcedStrain); act.freeStrike = false;
        } else if (a.type === 'rally') {
            if (act.action) fail('This unit has already used its action.');
            if (!rallyAllowed(s)) fail('There is no Rally action in these rules.');
            if (u.strain < 1) fail('This unit has no strain to remove.');
            // V3: no roll; rallying removes one strain, even in contact with an enemy.
            const die = s.rules === 'v3' ? null : a.forcedDie === undefined ? rollDie(s) : a.forcedDie, removed = die === null ? 1 : Math.min(u.strain, Math.ceil(die / 2));
            u.strain -= removed; act.action = 'rally';
            log(s, die === null ? `${u.name} rallies, removing 1 strain.` : `${u.name} rallies: rolled ${die}, removes ${removed} strain.`);
            emit(s, { type: 'rally', unitId: u.id, die, removed, owner: u.owner, x: u.x + u.w / 2, y: u.y + u.h / 2 });
        } else fail('Unknown action.');
        if (s.phase === 'command') autoEnd(s, review);
    }

    /** Returns a new state. Throws an Error with a player-readable message if the action is illegal. */
    function apply(state, action, review = {}) {
        if (state.phase === 'finished') fail('The battle is over.');
        if ((action.forcedStrain !== undefined || action.forcedDie !== undefined) && !state.hypothetical) fail('Dice can only be fixed in a hypothetical state.');
        const s = clone(state);
        if (s.phase === 'draft') draftAction(s, action);
        else if (s.phase === 'bidding') bidAction(s, action);
        else commandAction(s, action, review);
        return s;
    }

    /**
     * What `player` is allowed to know, as a state an AI may search freely. The dice seed is replaced, the
     * opponent's unrevealed bid is removed and the terrain stack below the top tile is hidden. States made
     * from it are marked hypothetical, which is the only kind in which dice results may be fixed.
     */
    function observe(state, player) {
        const s = clone(state);
        s.hypothetical = true; s.rng = 0; s.log = []; s.events = [];
        if (s.phase === 'bidding') s.bids[other(player)] = null;
        s.terrainDeck = s.terrainDeck.map((t, i) => (i === 0 ? t : '?'));
        return s;
    }
    /** Options a unit would have if it were activated now, whoever's turn it is. */
    function optionsAsIf(s, unitId) { const u = unitById(s, unitId); return u && u.owner ? optionsWith(s, u, newActivation(u.id)) : null; }

    // ---------- enumeration (AI, fuzzing) ----------
    function legalActions(s, options = {}) {
        const out = [];
        if (s.phase === 'draft') {
            const d = s.draft, p = d.picker;
            if (d.step === 'pick') s.units.filter(u => !u.owner).forEach(u => out.push({ type: 'pick', player: p, unitId: u.id }));
            else if (d.step === 'terrain') terrainSpots(s).slice(0, options.terrainSamples || 6).forEach(q => out.push({ type: 'placeTerrain', player: p, x: q.x, y: q.y }));
            else {
                const u = unitById(s, d.picked), [y0, y1] = zoneOf(s, p), y = p === 'p1' ? y0 + 4 : y1 - 4 - u.h, angle = p === 'p1' ? 0 : 180;
                for (let x = 8; x + u.w < s.width - 8; x += 12) if (!deployError(s, u, { x, y, angle })) out.push({ type: 'deploy', player: p, x, y, angle });
            }
        } else if (s.phase === 'bidding') {
            for (const p of ['p1', 'p2']) if (s.bids[p] === null) for (let v = 1; v <= army(s, p).length; v++) out.push({ type: 'bid', player: p, value: v });
        } else if (s.phase === 'command') {
            const p = activePlayer(s);
            if (!s.activation) {
                out.push({ type: 'pass', player: p });
                if (s.commands[p] > 0) army(s, p).filter(u => !u.activated).forEach(u => out.push({ type: 'activate', player: p, unitId: u.id }));
            } else {
                const o = unitOptions(s, s.activation.unitId);
                if (!s.activation.overlap) out.push({ type: 'endActivation', player: p });
                const mover = unitById(s, s.activation.unitId), endsOK = (lim, deg) => pivotAllowed(lim, deg) && !pivotEndError(s, mover, lim, deg);
                o.strike.forEach(t => out.push({ type: 'strike', player: p, targetId: t.id }));
                o.shoot.filter(t => t.ok).forEach(t => out.push({ type: 'shoot', player: p, targetId: t.id }));
                if (o.canRally) out.push({ type: 'rally', player: p });
                if (o.faceAbout) out.push({ type: 'faceAbout', player: p });
                for (const [lim, backwards] of [[o.forward, false], [o.backward, true]]) {
                    if (lim.max <= 0.05) {
                        if (lim.charge) out.push({ type: 'move', player: p, inches: lim.max, backwards });
                        continue;
                    }
                    for (const f of options.moveFractions || [1, 0.5, 0.25]) {
                        const inches = f === 1 ? lim.max : round2(lim.max * f);
                        if (!crossingAt(lim.crossings, inches)) out.push({ type: 'move', player: p, inches, backwards });
                    }
                }
                if (o.pivot.remaining > 0) for (const deg of options.pivotAngles || [15, 45, 90]) {
                    if (endsOK(o.pivot, -deg)) out.push({ type: 'pivot', player: p, degrees: -deg });
                    if (endsOK(o.pivot, deg)) out.push({ type: 'pivot', player: p, degrees: deg });
                }
                if (o.reform && o.reform.remaining > 0) for (const deg of options.reformAngles || [45, 90, 135, 180]) {
                    if (endsOK(o.reform, -deg)) out.push({ type: 'pivot', player: p, degrees: -deg, reform: true });
                    if (endsOK(o.reform, deg) && deg < 180) out.push({ type: 'pivot', player: p, degrees: deg, reform: true });
                }
            }
        }
        return out;
    }

    return {
        PX, TERRAIN, ROUT_STRAIN, FLANK_DICE, SPENT_STRAIN, createGame, normalizeRules, rulesName, RULES_NAMES, reformRules, v3Rules, v4Rules, v4Only, v5Rules, chargeEdges, chargeAt, faceAboutError, EDGE_NAMES, reformAction, rallyAllowed, hillsSlow, explodingSixes, ignoresSlowing, spent, shaken, unmarkedStrikeDice, pivotThrough, frontHeld, pivotAllowed, nearestPivot, pivotOverlap, pivotEndError, overlapAt, apply, legalActions, unitOptions, attackPreview, activePlayer, parseStats,
        observe, optionsAsIf, strainDist, clone, inTrait, enemiesTouching: (s, u) => enemiesTouching(s, u),
        terrainSpots, terrainPlacementError, deployError, tileAt, outflanked, touchesFront, touchesFlank, canStrikeAt, lineThroughFront, chargeFrontOnly, shotError, shotCheck, shotArcError, firingArc, firingArcError, moveLimit, crossingAt, pivotLimit, movementAfterPivot,
        geometry: { rect, disc, satGap, polyDist, sweep, forwardOf, centre, touching, inFeature, reach },
        other, label
    };
})();
if (typeof module !== 'undefined') module.exports = SeizeEngine;
