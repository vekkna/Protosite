/* Pure preview geometry: the same rules checks used by committed orders. */
const BattleUX = (() => {
    const E = typeof SeizeEngine !== 'undefined' ? SeizeEngine : require('./engine');
    const freshActivation = id => ({ unitId: id, action: null, pivots: 0, moved: 0, dir: null, pivotedInMove: false, slowed: false, charged: false, freeStrike: false, startHigh: null, overlap: false });
    function freshMovement(s, pose) {
        const act = freshActivation(pose.id);
        return { forward: E.moveLimit(s, pose, act, false), backward: E.moveLimit(s, pose, act, true) };
    }
    function facing(s, u, act, degrees) {
        let pose = { ...u }, activation = { ...act }, left = degrees;
        if (E.v4Rules(s) && !activation.startPose) activation.startPose = { x: u.x, y: u.y, angle: u.angle };
        const steps = [];
        while (Math.abs(left) > 0.001) {
            const limit = E.pivotLimit(s, pose, activation);
            if (!limit.remaining || limit.usesAction) return null;
            const turn = Math.sign(left) * Math.min(90, Math.abs(left));
            if (!E.pivotAllowed(limit, turn)) return null;
            // V3: only the facing after the last pivot must be clear.
            const last = Math.abs(left - turn) <= 0.001;
            if (last ? E.pivotEndError(s, pose, { ...limit, remaining: 1 }, turn) : E.pivotEndError(s, pose, limit, turn)) return null;
            pose = { ...pose, angle: pose.angle + turn };
            activation.overlap = E.pivotThrough(s) && Boolean(E.overlapAt(s, pose, pose.angle));
            activation.pivots++;
            // Classic: any pivot once a Move is under way forbids a charge. Reform rules: only once the unit has moved.
            if (activation.action === 'move' && (!E.reformRules(s) || activation.moved > 0)) activation.pivotedInMove = true;
            steps.push({ type: 'pivot', degrees: turn }); left -= turn;
        }
        return { pose, activation, steps };
    }
    const deltaAngle = degrees => ((degrees + 540) % 360) - 180;
    function movementPreview(s, id, current = false) {
        const u = s.units.find(v => v.id === id);
        if (!u?.owner) return { rays: [], charges: [] };
        const act = current && s.activation?.unitId === id ? s.activation : freshActivation(id);
        const free = Math.max(0, u.mobility - act.pivots), span = Math.min(180, free * 90);
        const angles = new Set([0]);
        for (let angle = -span; angle <= span; angle += 5) angles.add(angle);
        // Target bearings supplement the guide's 5° samples for narrow charge lanes.
        const c = E.geometry.centre(u);
        for (const v of s.units.filter(v => v.owner && v.owner !== u.owner)) {
            for (const p of [E.geometry.centre(v), ...E.geometry.rect(v)]) {
                const angle = deltaAngle(Math.atan2(p.x - c.x, c.y - p.y) * 180 / Math.PI - u.angle);
                if (Math.abs(angle) <= span) angles.add(angle);
            }
        }
        const rays = [], charges = new Map();
        for (const degrees of [...angles].sort((a, b) => a - b)) {
            const turn = facing(s, u, act, degrees); if (!turn) continue;
            const limit = E.moveLimit(s, turn.pose, turn.activation, false), f = E.geometry.forwardOf(turn.pose);
            const end = { ...turn.pose, x: u.x + f.x * limit.max * E.PX, y: u.y + f.y * limit.max * E.PX };
            rays.push({ degrees, end, limit });
            for (const targetId of limit.charge?.targets || []) {
                const plan = { targetId, degrees, inches: limit.max, steps: [...turn.steps, { type: 'move', inches: limit.max }] };
                if (!charges.has(targetId) || Math.abs(degrees) < Math.abs(charges.get(targetId).degrees)) charges.set(targetId, plan);
            }
        }
        return { rays, charges: [...charges.values()] };
    }
    function nextChargeSpans(s, u, { forward, backward }) {
        const start = -backward.max, end = forward.max;
        if (end - start <= .01) return [];
        const stops = new Set([0, start, end]);
        // Sample the legal stopping positions at board-pixel resolution, including exact passage boundaries.
        const steps = Math.ceil((end - start) * E.PX);
        for (let i = 1; i < steps; i++) stops.add(start + (end - start) * i / steps);
        for (const [limit, sign] of [[forward, 1], [backward, -1]]) {
            for (const crossing of limit.crossings || []) {
                stops.add(sign * crossing.from);
                stops.add(sign * crossing.to);
            }
        }
        const f = E.geometry.forwardOf(u), act = freshActivation(u.id), spans = [];
        for (const from of [...stops].sort((a, b) => a - b)) {
            const crossings = (from < 0 ? backward : forward).crossings;
            if (E.crossingAt(crossings, Math.abs(from))) continue;
            const pose = { ...u, x: u.x + f.x * from * E.PX, y: u.y + f.y * from * E.PX };
            const limit = E.moveLimit(s, pose, act, false);
            if (limit.max <= .01) continue;
            const to = from + limit.max, previous = spans[spans.length - 1];
            if (previous && from <= previous.to + 1e-7) previous.to = Math.max(previous.to, to);
            else spans.push({ from, to });
        }
        return spans;
    }
    function nearestOnUnit(u, point) {
        const corners = E.geometry.rect(u);
        let nearest, bestDistanceSquared = Infinity;
        for (let i = 0; i < corners.length; i++) {
            const a = corners[i];
            const b = corners[(i + 1) % 4], dx = b.x - a.x, dy = b.y - a.y;
            const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
            const x = a.x + t * dx, y = a.y + t * dy;
            const distanceSquared = (x - point.x) ** 2 + (y - point.y) ** 2;
            if (distanceSquared < bestDistanceSquared) {
                nearest = { x, y };
                bestDistanceSquared = distanceSquared;
            }
        }
        return nearest;
    }
    function unitAnchor(u, point) {
        const c = E.geometry.centre(u), f = E.geometry.forwardOf(u);
        const dx = point.x - c.x, dy = point.y - c.y;
        return { across: (-dx * f.y + dy * f.x) / u.w, forward: (dx * f.x + dy * f.y) / u.h };
    }
    function anchorPoint(u, anchor) {
        const c = E.geometry.centre(u), f = E.geometry.forwardOf(u);
        const across = anchor.across * u.w, forward = anchor.forward * u.h;
        return { x: c.x - across * f.y + forward * f.x, y: c.y + across * f.x + forward * f.y };
    }
    function actionText(s, a) {
        const u = s.units.find(v => v.id === (a.unitId || s.activation?.unitId || s.draft?.picked));
        const target = s.units.find(v => v.id === a.targetId), name = u?.name || 'Unit';
        switch (a.type) {
            case 'activate': return `Enemy commands ${name}`;
            case 'move': {
                const limit = u && E.moveLimit(s, u, s.activation || freshActivation(u.id), Boolean(a.backwards));
                const targets = limit?.charge && a.inches >= limit.max - 1e-6 ? limit.charge.targets.map(id => s.units.find(v => v.id === id)?.name).join(' and ') : '';
                return `Enemy · ${name} ${targets ? `charges ${targets}` : a.backwards ? 'withdraws' : 'advances'} ${Number(a.inches.toFixed(2))}″`;
            }
            case 'pivot': return `Enemy · ${name} ${a.reform ? 'reforms, turning' : 'pivots'} ${a.degrees > 0 ? 'clockwise' : 'anticlockwise'} ${Math.abs(a.degrees)}°`;
            case 'shoot': return `Enemy · ${name} shoots ${target?.name || 'target'}`;
            case 'strike': return `Enemy · ${name} strikes ${target?.name || 'target'}`;
            case 'rally': return `Enemy · ${name} rallies`;
            case 'pick': return `Enemy drafts ${name}`;
            case 'deploy': return `Enemy deploys ${name}`;
            case 'placeTerrain': return `Enemy places ${s.terrainDeck[0]}`;
            case 'pass': return 'Enemy passes its turn';
            case 'endActivation': return `Enemy finishes commanding ${name}`;
            default: return 'Enemy is choosing its next order…';
        }
    }
    return { movementPreview, freshMovement, nextChargeSpans, facing, nearestOnUnit, unitAnchor, anchorPoint, actionText };
})();
if (typeof module !== 'undefined') module.exports = BattleUX;
