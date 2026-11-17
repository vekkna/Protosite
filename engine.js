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
    const CONTACT = 0.01;          // px: sweep margin used to reach enemy contact
    const STANDOFF = 1;            // px: gap kept when a non-charging move stops short of an enemy
    const PIVOT_CLEARANCE = 0.5;   // px: clearance needed while turning
    const DEPLOY_IN = 6, SLOW_IN = 4, ROUT_STRAIN = 7;
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
     * Swept SAT. `a` moves by vector v (px). Returns the travel distance (px) at
     * which the gap to `b` first falls below `margin`, or null if it never does
     * within |v|. margin 0 = first touch; negative margin = allowed penetration.
     */
    function sweep(a, b, v, margin = 0) {
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
        return Math.max(0, enter);
    }

    // ---------- state helpers ----------
    const live = s => s.units.filter(u => u.owner);
    const unitById = (s, id) => s.units.find(u => u.id === id);
    const army = (s, p) => s.units.filter(u => u.owner === p);
    const trait = (t, name) => Boolean(TERRAIN[t.type] && TERRAIN[t.type][name]);
    const inFeature = (u, t) => centreGap(u, t) < 0 && overlapping(rect(u), disc(t));
    const inTrait = (s, u, name) => s.terrain.some(t => trait(t, name) && inFeature(u, t));
    const touching = (a, b) => centreGap(a, b) <= TOUCH && touchingPolys(rect(a), rect(b));
    const enemiesTouching = (s, u) => live(s).filter(v => v.owner !== u.owner && touching(u, v));
    const hasMarker = u => Boolean(u.activated);

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
    /**
     * options: { units:[spec], terrain:[{id,type,x,y,w,h}], terrainDeck:[type|'x'], firstPick:'p1'|'p2',
     *            seed, width, height, tileSize }.
     * If every unit already has an owner the draft is skipped (prepared battle).
     */
    function createGame(options = {}) {
        const s = {
            version: 2, rng: (options.seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0, seq: 0, events: [],
            width: options.width || 960, height: options.height || 720, tileSize: options.tileSize || 80,
            units: (options.units || []).map(makeUnit),
            terrain: (options.terrain || []).map((t, i) => ({ id: t.id || `t${i + 1}`, type: t.type, x: t.x, y: t.y, w: t.w, h: t.h || t.w })),
            terrainDeck: [...(options.terrainDeck || [])],
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
    function terrainPlacementError(s, tile, pickedUnit) {
        const o = centre(tile), r = tile.w / 2;
        if (o.x - r <= TOUCH || o.x + r >= s.width - TOUCH) return 'Terrain can’t touch the battlefield edge.';
        if (o.y - r <= DEPLOY_IN * PX + TOUCH || o.y + r >= s.height - DEPLOY_IN * PX - TOUCH) return 'Terrain can’t touch a deployment zone.';
        if (s.terrain.some(t => Math.hypot(centre(t).x - o.x, centre(t).y - o.y) <= r + t.w / 2 + TOUCH)) return 'Terrain can’t touch another terrain tile.';
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
        const moved = { ...u, ...pos }, poly = rect(moved), [y0, y1] = zoneOf(s, s.draft.picker);
        if (poly.some(p => p.x < -TOUCH || p.x > s.width + TOUCH || p.y < y0 - TOUCH || p.y > y1 + TOUCH)) return 'Place the whole unit inside your deployment zone.';
        if (live(s).some(v => v.id !== u.id && overlapping(poly, rect(v)))) return 'Units can’t overlap.';
        return '';
    }
    function draftAction(s, a) {
        const d = s.draft, p = d.picker;
        if (a.player && a.player !== p) fail(`It is ${label(p)}’s pick.`);
        if (a.type === 'pick') {
            if (d.step !== 'pick') fail('Finish the current pick first.');
            const u = unitById(s, a.unitId);
            if (!u || u.owner) fail('Choose a unit from the draft pool.');
            d.picked = u.id; log(s, `${label(p)} chose ${u.name}.`);
            if (!s.terrainDeck.length) d.step = 'deploy';
            else if (!TERRAIN[s.terrainDeck[0]]) { s.terrainDeck.shift(); d.step = 'deploy'; log(s, 'The terrain tile was open ground and is discarded.'); }
            else { d.step = 'terrain'; if (!terrainSpots(s, 1).length && !terrainSpots(s, 1, 1.5).length) { const t = s.terrainDeck.shift(); d.step = 'deploy'; log(s, `No legal place for the ${t}; it is discarded.`); } }
        } else if (a.type === 'placeTerrain') {
            if (d.step !== 'terrain') fail('There is no terrain tile to place now.');
            const tile = tileAt(s, a.x, a.y), why = terrainPlacementError(s, tile, unitById(s, d.picked));
            if (why) fail(why);
            s.terrainDeck.shift(); s.terrain.push({ id: `t${s.seq + 1}_${s.terrain.length + 1}`, ...tile }); d.step = 'deploy';
            log(s, `${label(p)} placed a ${tile.type}.`); emit(s, { type: 'terrain' });
        } else if (a.type === 'deploy') {
            if (d.step !== 'deploy') fail('Choose a unit and deal with its terrain tile first.');
            const u = unitById(s, d.picked), pos = { x: a.x, y: a.y, angle: a.angle ?? (p === 'p1' ? 0 : 180) }, why = deployError(s, u, pos);
            if (why) fail(why);
            Object.assign(u, pos, { owner: p }); d.picked = null; d.step = 'pick'; d.picker = other(p);
            if (s.units.every(v => v.owner)) beginBattle(s);
        } else fail('That isn’t possible during the draft.');
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
        if (s.turnStep < 2) { s.turnStep += 1; return; }
        s.units.forEach(u => { u.activated = false; });
        s.round += 1; s.phase = 'bidding'; s.bids = { p1: null, p2: null }; s.commands = { p1: 0, p2: 0 }; s.turnStep = 0;
        log(s, 'Clean up: command markers removed. Bid for the next round.');
        emit(s, { type: 'cleanup' });
    }
    /** A player with no commands (or no unit left to command) must pass. */
    function skipEmptyTurns(s) {
        while (s.phase === 'command' && !s.activation) {
            const p = activePlayer(s);
            if (s.commands[p] > 0 && army(s, p).some(u => !u.activated)) break;
            nextTurn(s);
        }
    }

    // ---------- activation queries ----------
    const newActivation = (unitId) => ({ unitId, action: null, pivots: 0, moved: 0, dir: null, pivotedInMove: false,
        slowed: false, charged: false, freeStrike: false, startHigh: null });
    const pivotAllowance = (u, act) => u.mobility + (act.action === 'extraPivot' ? 1 : 0);

    /** How far (inches) a unit can travel along its facing right now. */
    function moveLimit(s, u, act, backwards) {
        const dir = backwards ? 'back' : 'fwd', none = why => ({ max: 0, reason: why, charge: null, stop: 'rule' });
        if (act.action && act.action !== 'move') return none('This unit has already used its action.');
        if (act.charged) return none('A charge stops on contact.');
        if (act.dir && act.dir !== dir) return none('A Move can’t switch between forwards and backwards.');
        const stuck = enemiesTouching(s, u);
        if (stuck.length && u.owner !== s.master) return none('Only the Master Tactician’s units can move out of contact.');
        const f = forwardOf(u), sign = backwards ? -1 : 1, me = rect(u);
        let budget = (backwards ? u.pace / 2 : u.pace) - act.moved, stop = 'pace';
        // Slowing terrain caps the whole Move at 4 inches once the unit is in it.
        let slowAt = Infinity;
        if (!u.paceStar) {
            if (act.slowed || inTrait(s, u, 'slowing')) slowAt = 0;
            else for (const t of s.terrain) {
                if (!trait(t, 'slowing') || centreGap(u, t) > budget * PX + 2) continue;
                const d = sweep(me, disc(t), { x: f.x * sign * budget * PX, y: f.y * sign * budget * PX }, -TOUCH);
                if (d !== null) slowAt = Math.min(slowAt, d);
            }
            if (slowAt < Infinity) {
                if (act.moved + slowAt / PX >= SLOW_IN) { if (slowAt / PX < budget) { budget = Math.max(0, slowAt / PX - 0.01); stop = 'slow'; } }
                else if (SLOW_IN - act.moved < budget) { budget = SLOW_IN - act.moved; stop = 'slow'; }
            }
        }
        if (budget <= 1e-6) return { max: 0, reason: stop === 'slow' ? 'Slowing terrain limits this Move to 4 inches.' : 'No movement left.', charge: null, stop, slowAt };
        const v = { x: f.x * sign * budget * PX, y: f.y * sign * budget * PX };
        let px = budget * PX, charge = null;
        const block = (d, why) => { if (d !== null && d < px) { px = Math.max(0, d); stop = why; charge = null; } };
        // battlefield edge
        for (const p of me) {
            if (v.x > 1e-9) block((s.width - p.x) / v.x * budget * PX, 'edge');
            if (v.x < -1e-9) block((0 - p.x) / v.x * budget * PX, 'edge');
            if (v.y > 1e-9) block((s.height - p.y) / v.y * budget * PX, 'edge');
            if (v.y < -1e-9) block((0 - p.y) / v.y * budget * PX, 'edge');
        }
        const far = o => centreGap(u, o) > budget * PX + 2;   // can't be reached this Move
        for (const t of s.terrain) if (trait(t, 'impassable') && !far(t)) block(sweep(me, disc(t), v), 'terrain');
        const canCharge = !backwards && !act.pivotedInMove;
        for (const o of live(s)) {
            if (o.id === u.id || far(o)) continue;
            const poly = rect(o);
            if (o.owner === u.owner || stuck.includes(o)) { block(sweep(me, poly, v), 'unit'); continue; }
            const d = sweep(me, poly, v, CONTACT);
            if (d === null) continue;
            if (canCharge) { if (d <= px) { px = d; stop = 'charge'; charge = { distance: d / PX, targets: [] }; } }
            else block(d - STANDOFF, 'enemy');
        }
        if (charge) {
            const at = { ...u, x: u.x + f.x * px, y: u.y + f.y * px };
            charge.targets = live(s).filter(o => o.owner !== u.owner && !stuck.includes(o) && touching(at, o)).map(o => o.id);
            if (!charge.targets.length) { charge = null; stop = 'enemy'; px = Math.max(0, px - STANDOFF); }
            else charge.distance = px / PX;
        }
        return { max: Math.max(0, px / PX), reason: '', charge, stop, slowAt: slowAt / PX };
    }

    const pivotCache = new Map();
    /** Largest legal pivot (degrees) anticlockwise and clockwise. */
    function pivotLimit(s, u, act) {
        const none = why => ({ left: 0, right: 0, remaining: 0, usesAction: false, reason: why });
        if (act.charged) return none('A unit that charged can’t pivot for the rest of its activation.');
        if (enemiesTouching(s, u).length) return none('A unit touching an enemy can’t pivot.');
        const used = act.pivots, free = u.mobility - used;
        const usesAction = free <= 0 && !act.action;
        const remaining = Math.max(0, pivotAllowance(u, act) - used) + (usesAction ? 1 : 0);
        if (remaining <= 0) return none('No pivots left.');
        // Sampling every degree with half a pixel of clearance is conservative: no point of a unit moves
        // more than 0.4 px between a sample and the midpoint to the next, so nothing can be passed through.
        const obstacles = [...live(s).filter(o => o.id !== u.id && centreGap(u, o) < PIVOT_CLEARANCE).map(o => rect(o)),
            ...s.terrain.filter(t => trait(t, 'impassable') && centreGap(u, t) < PIVOT_CLEARANCE).map(disc)];
        const c0 = centre(u), r0 = reach(u) + PIVOT_CLEARANCE;
        const nearEdge = c0.x < r0 || c0.y < r0 || c0.x > s.width - r0 || c0.y > s.height - r0;
        if (!obstacles.length && !nearEdge) return { left: 90, right: 90, remaining, usesAction, reason: '' };
        // The scan depends only on this geometry, which the AI meets many times over: keep its answer.
        let key = `${s.width},${s.height},${u.x},${u.y},${u.w},${u.h},${u.angle}`;
        for (const o of obstacles) key += `|${o.length}:${o[0].x},${o[0].y},${o[1].x},${o[1].y},${o[2].x},${o[2].y}`;
        const known = pivotCache.get(key);
        if (known) return { left: known.left, right: known.right, remaining, usesAction, reason: known.left || known.right ? '' : 'There isn’t room to turn here.' };
        if (pivotCache.size > 50000) pivotCache.clear();
        const probe = { x: u.x, y: u.y, w: u.w, h: u.h, angle: u.angle };
        const clearAt = angle => {
            const poly = rect(probe, angle);
            if (nearEdge && poly.some(p => p.x < PIVOT_CLEARANCE || p.y < PIVOT_CLEARANCE || p.x > s.width - PIVOT_CLEARANCE || p.y > s.height - PIVOT_CLEARANCE)) return false;
            return !obstacles.some(o => gapBelow(poly, o, PIVOT_CLEARANCE));
        };
        const scan = sign => { let k = 0; while (k < 90 && clearAt(u.angle + sign * (k + 1))) k += 1; return k; };
        const left = scan(-1), right = scan(1);
        pivotCache.set(key, { left, right });
        return { left, right, remaining, usesAction, reason: left || right ? '' : 'There isn’t room to turn here.' };
    }

    function shotError(s, u, v) {
        if (!(u.shoot > 0)) return 'This unit can’t shoot.';
        if (enemiesTouching(s, u).length) return 'A unit touching an enemy can’t shoot.';
        if (enemiesTouching(s, v).length) return 'Target is in contact with one of your units.';
        const me = rect(u), target = rect(v), origin = { x: (me[0].x + me[1].x) / 2, y: (me[0].y + me[1].y) / 2 }, f = forwardOf(u);
        if (target.some(q => dot(sub(q, origin), f) < -TOUCH)) return 'Target isn’t entirely in front of the shooter.';
        if (Math.min(...target.map((q, i) => pointSeg(origin, q, target[(i + 1) % 4]))) > u.range * PX + TOUCH) return 'Out of range.';
        const high = inTrait(s, u, 'elevated');
        const blockers = [
            ...(high ? [] : live(s).filter(o => o.id !== u.id && o.id !== v.id).map(o => ({ poly: rect(o), what: o.name, c: centre(o), r: reach(o) }))),
            ...s.terrain.filter(t => trait(t, 'concealing') || (trait(t, 'elevated') && !inFeature(u, t) && !inFeature(v, t)))
                .map(t => ({ poly: disc(t), what: t.type, c: centre(t), r: reach(t) }))
        ];
        // The fan of triangles from the firing point to each target edge covers every sight line.
        // A blocker lies inside its circle, so one whose circle clears a triangle cannot overlap it (same answer, cheaper).
        const fan = [0, 1, 2, 3].map(i => [origin, target[i], target[(i + 1) % 4]]);
        for (const b of blockers) for (const tri of fan)
            if (pointTriangleGap(b.c, tri) <= b.r + 1e-6 && overlapping(tri, b.poly)) return `Line of sight blocked by ${b.what}.`;
        return '';
    }

    function touchesFlank(a, enemy) {
        const p = rect(a), e = rect(enemy), trim = (from, to) => { const d = sub(to, from), l = Math.hypot(d.x, d.y) || 1; return { x: from.x + d.x / l, y: from.y + d.y / l }; };
        // The front corners belong to the front, so the side edges start just behind them.
        const flank = [[trim(p[1], p[2]), p[2]], [p[2], p[3]], [p[3], trim(p[0], p[3])]];
        return flank.some(seg => touchingPolys(seg, e));
    }
    function outflanked(s, a) {
        return enemiesTouching(s, a).some(e => touchesFlank(a, e) && !live(s).some(o => o.owner === a.owner && o.id !== a.id && touching(o, e)));
    }

    const distCache = new Map();
    /** Exact probabilities of causing 0, 1, 2... strain with `pool` dice needing `tn`+ (6s roll a bonus die). */
    function strainDist(pool, tn) {
        const key = pool * 10 + tn;
        if (distCache.has(key)) return distCache.get(key);
        const hit = (7 - tn) / 6, one = [(tn - 1) / 6, (6 - tn) / 6 + (1 - hit) / 6, hit / 6];
        let dist = [1];
        for (let i = 0; i < pool; i++) { const next = Array(dist.length + 2).fill(0); dist.forEach((p, k) => one.forEach((q, j) => { next[k + j] += p * q; })); dist = next; }
        distCache.set(key, dist);
        return dist;
    }
    /** Dice pool, target number and odds for an attack, without rolling. */
    function attackPreview(s, attackerId, targetId, kind, startHigh = null) {
        const u = unitById(s, attackerId), v = unitById(s, targetId), shooting = kind === 'shoot', mods = [];
        if (outflanked(s, v)) mods.push({ label: 'Target outflanked', dice: 1 });
        if (outflanked(s, u)) mods.push({ label: 'Attacker outflanked', dice: -1 });
        const high = startHigh === null ? inTrait(s, u, 'elevated') : startHigh, targetHigh = inTrait(s, v, 'elevated');
        if (high && !targetHigh) mods.push({ label: 'Attacker higher', dice: 1 });
        if (!high && targetHigh) mods.push({ label: 'Attacker lower', dice: -1 });
        if (!shooting && !hasMarker(v)) mods.push({ label: 'Target has no command marker', dice: 1 });
        const base = shooting ? u.shoot : u.melee, pool = Math.max(1, base + mods.reduce((n, m) => n + m.dice, 0));
        let tn = v.defence, tnNote = '';
        if (shooting ? u.shootAP : u.meleeAP) { if (tn > 3) { tn = 3; tnNote = 'Armour-piercing'; } }
        if (shooting && v.defenceStar) { tn = 6; tnNote = 'Loose formation'; }
        tn = Math.max(2, Math.min(6, tn));
        // Exact strain distribution: each die scores 0, 1, or (on a 6) 1 plus a bonus die.
        const dist = strainDist(pool, tn);
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
            const why = kind === 'shoot' ? shotError(s, u, v) : (touching(u, v) ? '' : 'Not in contact.');
            return { id: v.id, ok: !why, reason: why, preview: why ? null : attackPreview(s, u.id, v.id, kind, kind === 'strike' && act.freeStrike ? act.startHigh : null) };
        });
        const canShoot = actionFree && u.shoot > 0 && !contact.length;
        const canStrike = (actionFree || act.freeStrike) && contact.length > 0;
        return {
            canAct: true, reason: '', activated: Boolean(s.activation), activation: act,
            forward: moveLimit(s, u, act, false), backward: moveLimit(s, u, act, true), pivot: pivotLimit(s, u, act),
            shoot: canShoot ? targetsFor('shoot') : [], strike: canStrike ? targetsFor('strike').filter(t => t.ok) : [],
            freeStrike: act.freeStrike, canRally: actionFree && u.strain > 0, actionFree, inContact: contact.length > 0
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
        const rolls = forced === undefined ? Array.from({ length: pre.pool }, () => rollDie(s)) : [], bonus = rolls.filter(n => n === 6).map(() => rollDie(s));
        const strain = forced === undefined ? [...rolls, ...bonus].filter(n => n >= pre.tn).length : forced;
        const mods = pre.mods.map(m => `${m.dice > 0 ? '+' : '−'}1 ${m.label.toLowerCase()}`).join(', ');
        log(s, `${u.name} ${kind === 'shoot' ? 'shoots' : 'strikes'} ${v.name}: ${pre.pool} dice${mods ? ` (${mods})` : ''}, needing ${pre.tn}+${pre.tnNote ? ` (${pre.tnNote})` : ''}. Rolled ${rolls.join(' ')}${bonus.length ? ` + bonus ${bonus.join(' ')}` : ''} → ${strain} strain.`);
        emit(s, { type: 'attack', kind, attackerId: u.id, targetId: v.id, attacker: u.name, target: v.name, owner: u.owner, rolls, bonus, tn: pre.tn, strain,
            x: v.x + v.w / 2, y: v.y + v.h / 2 });
        applyStrain(s, v, strain);
    }
    function endActivation(s) { s.activation = null; skipEmptyTurns(s); }
    /** Close the activation by itself once nothing further is possible. */
    function autoEnd(s) {
        const act = s.activation;
        if (!act || s.phase !== 'command') return;
        const u = unitById(s, act.unitId);
        if (!u) return endActivation(s);
        const o = unitOptions(s, u.id);
        const canMove = o.forward.max > 0.005 || o.backward.max > 0.005;
        const canPivot = o.pivot.remaining > 0 && (o.pivot.left > 0 || o.pivot.right > 0);
        if (!canMove && !canPivot && !o.strike.length && !o.shoot.some(t => t.ok) && !o.canRally) endActivation(s);
    }

    function commandAction(s, a) {
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
        if (a.type === 'endActivation') return endActivation(s);
        if (a.type === 'move') {
            const inches = Number(a.inches), backwards = Boolean(a.backwards);
            if (!Number.isFinite(inches) || inches <= 0) fail('Move a positive distance.');
            const limit = moveLimit(s, u, act, backwards);
            if (limit.max <= 0) fail(limit.reason || 'This unit can’t move that way.');
            if (inches > limit.max + 0.011) fail(`This unit can move at most ${limit.max.toFixed(2)}″ that way.`);
            const charging = Boolean(limit.charge) && inches >= limit.max - 1e-6;
            const dist = Math.min(inches, limit.max), f = forwardOf(u), sign = backwards ? -1 : 1;
            if (act.startHigh === null) act.startHigh = inTrait(s, u, 'elevated');
            if (!u.paceStar && dist * PX > limit.slowAt * PX - 1e-6) act.slowed = true;
            u.x += f.x * sign * dist * PX; u.y += f.y * sign * dist * PX;
            act.action = 'move'; act.dir = backwards ? 'back' : 'fwd'; act.moved += dist;
            if (!u.paceStar && inTrait(s, u, 'slowing')) act.slowed = true;
            emit(s, { type: 'move', unitId: u.id });
            if (charging) {
                act.charged = true; act.freeStrike = true;
                log(s, `${u.name} charges ${limit.charge.targets.map(id => unitById(s, id).name).join(' and ')}.`);
                emit(s, { type: 'charge', unitId: u.id, targets: limit.charge.targets });
            }
        } else if (a.type === 'pivot') {
            const deg = Number(a.degrees), lim = pivotLimit(s, u, act);
            if (!Number.isFinite(deg) || Math.abs(deg) < 0.01) fail('Choose an angle to pivot.');
            if (lim.remaining <= 0) fail(lim.reason);
            if (Math.abs(deg) > 90 + 1e-6) fail('A pivot turns a unit up to 90°.');
            if (Math.abs(deg) > (deg < 0 ? lim.left : lim.right) + 1e-6) fail('There isn’t room to turn that far without touching something.');
            if (lim.usesAction) act.action = 'extraPivot';
            else if (act.action === 'move' && !act.charged) act.pivotedInMove = true;
            u.angle += deg; act.pivots += 1;
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
            if (!act.action) act.action = 'strike';
            resolveAttack(s, u, v, 'strike', act, a.forcedStrain); act.freeStrike = false;
        } else if (a.type === 'rally') {
            if (act.action) fail('This unit has already used its action.');
            if (u.strain < 1) fail('This unit has no strain to remove.');
            const die = a.forcedDie === undefined ? rollDie(s) : a.forcedDie, removed = Math.min(u.strain, Math.ceil(die / 2));
            u.strain -= removed; act.action = 'rally';
            log(s, `${u.name} rallies: rolled ${die}, removes ${removed} strain.`);
            emit(s, { type: 'rally', unitId: u.id, die, removed, owner: u.owner, x: u.x + u.w / 2, y: u.y + u.h / 2 });
        } else fail('Unknown action.');
        if (s.phase === 'command') autoEnd(s);
    }

    /** Returns a new state. Throws an Error with a player-readable message if the action is illegal. */
    function apply(state, action) {
        if (state.phase === 'finished') fail('The battle is over.');
        if ((action.forcedStrain !== undefined || action.forcedDie !== undefined) && !state.hypothetical) fail('Dice can only be fixed in a hypothetical state.');
        const s = clone(state);
        if (s.phase === 'draft') draftAction(s, action);
        else if (s.phase === 'bidding') bidAction(s, action);
        else commandAction(s, action);
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
                out.push({ type: 'endActivation', player: p });
                o.strike.forEach(t => out.push({ type: 'strike', player: p, targetId: t.id }));
                o.shoot.filter(t => t.ok).forEach(t => out.push({ type: 'shoot', player: p, targetId: t.id }));
                if (o.canRally) out.push({ type: 'rally', player: p });
                for (const [lim, backwards] of [[o.forward, false], [o.backward, true]]) {
                    if (lim.max <= 0.05) continue;
                    for (const f of options.moveFractions || [1, 0.5, 0.25]) out.push({ type: 'move', player: p, inches: f === 1 ? lim.max : round2(lim.max * f), backwards });
                }
                if (o.pivot.remaining > 0) for (const deg of options.pivotAngles || [15, 45, 90]) {
                    if (deg <= o.pivot.left) out.push({ type: 'pivot', player: p, degrees: -deg });
                    if (deg <= o.pivot.right) out.push({ type: 'pivot', player: p, degrees: deg });
                }
            }
        }
        return out;
    }

    return {
        PX, TERRAIN, ROUT_STRAIN, createGame, apply, legalActions, unitOptions, attackPreview, activePlayer, parseStats,
        observe, optionsAsIf, strainDist, clone, inTrait, enemiesTouching: (s, u) => enemiesTouching(s, u),
        terrainSpots, terrainPlacementError, deployError, tileAt, outflanked, shotError, moveLimit, pivotLimit,
        geometry: { rect, disc, satGap, polyDist, sweep, forwardOf, centre, touching, inFeature, reach },
        other, label
    };
})();
if (typeof module !== 'undefined') module.exports = SeizeEngine;
