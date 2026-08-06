(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SeizeTheDayRules = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const SCHEMA = 'seize-the-day-rules';
    const SCHEMA_VERSION = 1;
    const CONTACT_EPSILON = 0.075;
    const GEOMETRY_EPSILON = 1e-6;
    const MAX_WOUNDS = 7;
    const PLAYER_IDS = ['p1', 'p2'];
    const DEFAULT_BOARD = { width: 48, height: 36, deploymentDepth: 6 };
    const DEFAULT_TERRAIN_SIZE = { width: 88 / 25.4, height: 63 / 25.4 };
    const DEFAULT_TERRAIN_DECK = [
        'forest', 'forest', 'hills', 'hills', 'field', 'field',
        'swamp', 'swamp', 'mountain', 'mountain', 'x', 'x'
    ];
    const TERRAIN_TRAITS = {
        forest: ['concealing', 'slowing', 'defensible'],
        hills: ['elevated', 'concealing', 'defensible'],
        hill: ['elevated', 'concealing', 'defensible'],
        field: ['slowing'],
        swamp: ['impassable'],
        mountain: ['concealing', 'impassable']
    };
    const DEFAULT_RULES = {
        terrainGeometry: 'rectangular-tile',
        defensible: 'undefined-no-effect',
        elevatedCrest: 'tile-centre-proxy',
        armourPiercingThreshold: 3,
        boardEdgesAreImpassable: true,
        zeroDistanceMoveCountsAsMove: true,
        terrainTopIsPublic: true
    };

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function numberFrom(value, fallback = 0) {
        if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
        const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : fallback;
    }

    function firstValue(source, keys) {
        if (!source) return undefined;
        const entries = Object.entries(source);
        for (const key of keys) {
            const found = entries.find(([candidate]) => String(candidate).trim().toLowerCase() === key.toLowerCase());
            if (found && found[1] !== '' && found[1] !== null && found[1] !== undefined) return found[1];
        }
        return undefined;
    }

    function normalizeCombatStat(raw, hasRange) {
        if (raw === undefined || raw === null || String(raw).trim() === '' || String(raw).trim() === '-') return null;
        const text = String(raw).trim();
        const [dicePart, rangePart] = text.split('/');
        const diceMatch = dicePart.match(/-?\d+(?:\.\d+)?/);
        if (!diceMatch) return null;
        const dice = Math.max(0, Math.floor(Number(diceMatch[0])));
        return {
            dice,
            armourPiercing: dicePart.includes('*'),
            range: hasRange ? Math.max(0, numberFrom(rangePart, 0)) : null,
            raw: text
        };
    }

    function normalizeProfile(stats) {
        const raw = clone(stats || {});
        return {
            speed: Math.max(0, numberFrom(firstValue(raw, ['Speed', 'Move']), 0)),
            drill: Math.max(0, Math.floor(numberFrom(firstValue(raw, ['Drill']), 0))),
            strike: normalizeCombatStat(firstValue(raw, ['Melee', 'Strike']), false) || { dice: 0, armourPiercing: false, range: null },
            shoot: normalizeCombatStat(firstValue(raw, ['Ranged', 'Shoot']), true),
            defence: Math.max(1, Math.floor(numberFrom(firstValue(raw, ['Def', 'Def.', 'Defence', 'Defense']), 6))),
            raw
        };
    }

    function validateUnitDefinition(raw, index) {
        const stats = raw && (raw.stats || raw.profile || raw.definition) || {};
        const name = String((raw && raw.name) || stats.Unit || `Unit ${index + 1}`);
        const missing = [];
        const numeric = value => value !== undefined && value !== null
            && String(value).trim() !== '' && /-?\d+(?:\.\d+)?/.test(String(value));
        if (!numeric(firstValue(stats, ['Speed', 'Move']))) missing.push('Speed');
        if (!numeric(firstValue(stats, ['Drill']))) missing.push('Drill');
        if (!normalizeCombatStat(firstValue(stats, ['Melee', 'Strike']), false)) missing.push('Strike/Melee');
        const defence = firstValue(stats, ['Def', 'Def.', 'Defence', 'Defense']);
        if (!numeric(defence) || numberFrom(defence, 0) < 1) missing.push('Defence');
        const shoot = firstValue(stats, ['Ranged', 'Shoot']);
        if (shoot !== undefined && shoot !== null && String(shoot).trim() !== ''
            && String(shoot).trim() !== '-' && !normalizeCombatStat(shoot, true)) {
            missing.push('Shoot/Ranged');
        }
        if (missing.length) throw new Error(`${name} is missing valid required stats: ${missing.join(', ')}.`);
    }

    function normalizeAngle(angle) {
        let result = numberFrom(angle, 0) % 360;
        if (result > 180) result -= 360;
        if (result <= -180) result += 360;
        return result;
    }

    function normalizePose(pose, fallback) {
        const source = pose || fallback || {};
        return {
            x: numberFrom(source.x ?? source.centerX, 0),
            y: numberFrom(source.y ?? source.centerY, 0),
            angle: normalizeAngle(source.angle)
        };
    }

    function normalizeSize(size, fallback) {
        const source = size || fallback || {};
        return {
            width: Math.max(0.1, numberFrom(source.width ?? source.w, 3.465)),
            height: Math.max(0.1, numberFrom(source.height ?? source.depth ?? source.h, 2.48))
        };
    }

    function normalizeUnit(raw, index) {
        const stats = clone(raw.stats || raw.profile || raw.definition || {});
        return {
            id: String(raw.id || `unit-${index + 1}`),
            name: String(raw.name || stats.Unit || `Unit ${index + 1}`),
            ownerId: raw.ownerId || raw.owner || null,
            stats,
            profile: normalizeProfile(stats),
            size: normalizeSize(raw.size),
            pose: normalizePose(raw.pose, raw),
            wounds: Math.max(0, Math.floor(numberFrom(raw.wounds, 0))),
            woundsThisRound: Math.max(0, Math.floor(numberFrom(raw.woundsThisRound, 0))),
            distanceMovedThisRound: Math.max(0, numberFrom(raw.distanceMovedThisRound, 0)),
            activated: Boolean(raw.activated),
            status: raw.status === 'destroyed' || raw.destroyed ? 'destroyed' : 'alive'
        };
    }

    function normalizeTerrain(raw, index) {
        const type = String(raw.type || raw.subType || raw.kind || 'field').toLowerCase();
        const pose = normalizePose(raw.pose, raw);
        const rawCrest = raw.crest || {};
        return {
            id: String(raw.id || `terrain-${index + 1}`),
            type,
            subType: type,
            size: normalizeSize(raw.size || raw.featureSize, { width: raw.width, height: raw.height }),
            pose,
            crest: {
                x: numberFrom(rawCrest.x, pose.x),
                y: numberFrom(rawCrest.y, pose.y)
            },
            traits: Array.isArray(raw.traits) ? [...raw.traits] : [...(TERRAIN_TRAITS[type] || [])],
            status: raw.status || 'placed'
        };
    }

    function nextRandom(rng) {
        let value = (rng.state >>> 0) || 0x9e3779b9;
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        rng.state = value >>> 0;
        rng.counter = (rng.counter || 0) + 1;
        return rng.state / 0x100000000;
    }

    function shuffle(values, rng) {
        const result = [...values];
        for (let index = result.length - 1; index > 0; index -= 1) {
            const swap = Math.floor(nextRandom(rng) * (index + 1));
            [result[index], result[swap]] = [result[swap], result[index]];
        }
        return result;
    }

    function rollD6(state) {
        return Math.floor(nextRandom(state.rng) * 6) + 1;
    }

    function axesForAngle(angle) {
        const radians = normalizeAngle(angle) * Math.PI / 180;
        return {
            right: { x: Math.cos(radians), y: Math.sin(radians) },
            forward: { x: Math.sin(radians), y: -Math.cos(radians) }
        };
    }

    function rectangleCorners(item, overridePose) {
        const pose = normalizePose(overridePose || item.pose, item);
        const size = normalizeSize(item.size, item);
        const { right, forward } = axesForAngle(pose.angle);
        const halfWidth = size.width / 2;
        const halfHeight = size.height / 2;
        return [
            { x: pose.x + right.x * halfWidth + forward.x * halfHeight, y: pose.y + right.y * halfWidth + forward.y * halfHeight },
            { x: pose.x - right.x * halfWidth + forward.x * halfHeight, y: pose.y - right.y * halfWidth + forward.y * halfHeight },
            { x: pose.x - right.x * halfWidth - forward.x * halfHeight, y: pose.y - right.y * halfWidth - forward.y * halfHeight },
            { x: pose.x + right.x * halfWidth - forward.x * halfHeight, y: pose.y + right.y * halfWidth - forward.y * halfHeight }
        ];
    }

    function polygonAxes(points) {
        return points.map((point, index) => {
            const next = points[(index + 1) % points.length];
            const edge = { x: next.x - point.x, y: next.y - point.y };
            const length = Math.hypot(edge.x, edge.y) || 1;
            return { x: -edge.y / length, y: edge.x / length };
        });
    }

    function projectPolygon(points, axis) {
        const values = points.map(point => point.x * axis.x + point.y * axis.y);
        return { min: Math.min(...values), max: Math.max(...values) };
    }

    function polygonsOverlap(first, second, allowTouch = true) {
        for (const axis of [...polygonAxes(first), ...polygonAxes(second)]) {
            const a = projectPolygon(first, axis);
            const b = projectPolygon(second, axis);
            const overlap = Math.min(a.max, b.max) - Math.max(a.min, b.min);
            if (allowTouch ? overlap <= GEOMETRY_EPSILON : overlap < -GEOMETRY_EPSILON) return false;
        }
        return true;
    }

    function pointSegmentDistance(point, start, end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
        const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
        return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
    }

    function polygonDistance(first, second) {
        if (polygonsOverlap(first, second, false)) return 0;
        let minimum = Infinity;
        const compare = (points, edges) => {
            points.forEach(point => edges.forEach((start, index) => {
                minimum = Math.min(minimum, pointSegmentDistance(point, start, edges[(index + 1) % edges.length]));
            }));
        };
        compare(first, second);
        compare(second, first);
        return minimum;
    }

    function rectanglesOverlap(first, second, firstPose, secondPose) {
        return polygonsOverlap(rectangleCorners(first, firstPose), rectangleCorners(second, secondPose), true);
    }

    function rectanglesTouch(first, second, firstPose, secondPose) {
        const a = rectangleCorners(first, firstPose);
        const b = rectangleCorners(second, secondPose);
        return !polygonsOverlap(a, b, true) && polygonDistance(a, b) <= CONTACT_EPSILON;
    }

    function sweptRectanglesOverlap(moving, obstacle, startPose, endPose) {
        const start = normalizePose(startPose, moving.pose);
        const end = normalizePose(endPose, start);
        const movement = { x: end.x - start.x, y: end.y - start.y };
        const movingCorners = rectangleCorners(moving, start);
        const obstacleCorners = rectangleCorners(obstacle);
        const axes = [...polygonAxes(movingCorners), ...polygonAxes(obstacleCorners)];
        let entry = -Infinity;
        let exit = Infinity;
        for (const axis of axes) {
            const first = projectPolygon(movingCorners, axis);
            const second = projectPolygon(obstacleCorners, axis);
            const velocity = movement.x * axis.x + movement.y * axis.y;
            if (Math.abs(velocity) <= GEOMETRY_EPSILON) {
                if (first.max <= second.min + GEOMETRY_EPSILON
                    || first.min >= second.max - GEOMETRY_EPSILON) return false;
                continue;
            }
            const firstCrossing = (second.min + GEOMETRY_EPSILON - first.max) / velocity;
            const secondCrossing = (second.max - GEOMETRY_EPSILON - first.min) / velocity;
            entry = Math.max(entry, Math.min(firstCrossing, secondCrossing));
            exit = Math.min(exit, Math.max(firstCrossing, secondCrossing));
            if (entry >= exit - GEOMETRY_EPSILON) return false;
        }
        return Math.max(entry, 0) < Math.min(exit, 1) - GEOMETRY_EPSILON;
    }

    function poseInsideBounds(item, pose, board) {
        return rectangleCorners(item, pose).every(point => point.x >= -GEOMETRY_EPSILON
            && point.y >= -GEOMETRY_EPSILON
            && point.x <= board.width + GEOMETRY_EPSILON
            && point.y <= board.height + GEOMETRY_EPSILON);
    }

    function oppositePlayer(playerId) {
        return playerId === 'p1' ? 'p2' : 'p1';
    }

    function aliveUnits(state, ownerId) {
        return state.units.filter(unit => unit.status === 'alive' && (!ownerId || unit.ownerId === ownerId));
    }

    function unitById(state, unitId) {
        return state.units.find(unit => unit.id === unitId) || null;
    }

    function terrainById(state, terrainId) {
        return state.terrain.find(item => item.id === terrainId) || null;
    }

    function playerById(state, playerId) {
        return state.players.find(player => player.id === playerId) || null;
    }

    function terrainHasTrait(terrain, trait) {
        return terrain.status !== 'discarded' && terrain.traits.includes(trait);
    }

    function unitOverlapsTerrain(unit, terrain, pose) {
        return polygonsOverlap(rectangleCorners(unit, pose), rectangleCorners(terrain), false);
    }

    function elevatedTerrainForUnit(state, unit, pose) {
        return state.terrain.filter(terrain => terrainHasTrait(terrain, 'elevated')
            && unitOverlapsTerrain(unit, terrain, pose));
    }

    function unitHeight(state, unit, pose) {
        return elevatedTerrainForUnit(state, unit, pose).length ? 1 : 0;
    }

    function compareUnitHeight(state, first, second, firstPose, secondPose) {
        const firstTerrain = elevatedTerrainForUnit(state, first, firstPose);
        const secondTerrain = elevatedTerrainForUnit(state, second, secondPose);
        if (firstTerrain.length && !secondTerrain.length) return 1;
        if (!firstTerrain.length && secondTerrain.length) return -1;
        if (!firstTerrain.length) return 0;
        const shared = firstTerrain.find(terrain => secondTerrain.some(other => other.id === terrain.id));
        if (!shared) return 0;
        const crest = shared.crest || shared.pose || { x: 0, y: 0 };
        const firstPosition = normalizePose(firstPose, first.pose);
        const secondPosition = normalizePose(secondPose, second.pose);
        const firstDistance = Math.hypot(firstPosition.x - crest.x, firstPosition.y - crest.y);
        const secondDistance = Math.hypot(secondPosition.x - crest.x, secondPosition.y - crest.y);
        if (Math.abs(firstDistance - secondDistance) <= CONTACT_EPSILON) return 0;
        return firstDistance < secondDistance ? 1 : -1;
    }

    function unitsTouch(first, second) {
        return rectanglesTouch(first, second);
    }

    function segmentPolygonDistance(start, end, polygon) {
        let minimum = Math.min(...polygon.map(point => pointSegmentDistance(point, start, end)));
        polygon.forEach((edgeStart, index) => {
            const edgeEnd = polygon[(index + 1) % polygon.length];
            minimum = Math.min(minimum, pointSegmentDistance(start, edgeStart, edgeEnd), pointSegmentDistance(end, edgeStart, edgeEnd));
        });
        return minimum;
    }

    function touchesFrontEdge(unit, enemy) {
        if (!unitsTouch(unit, enemy)) return false;
        const corners = rectangleCorners(enemy);
        const frontStart = corners[0];
        const frontEnd = corners[1];
        return segmentPolygonDistance(frontStart, frontEnd, rectangleCorners(unit)) <= CONTACT_EPSILON;
    }

    function touchesEnemyFront(state, unit) {
        return aliveUnits(state, oppositePlayer(unit.ownerId)).some(enemy => touchesFrontEdge(unit, enemy));
    }

    function touchesTargetFlank(unit, target) {
        return unitsTouch(unit, target) && !touchesFrontEdge(unit, target);
    }

    function isMasterUnit(state, unit) {
        return state.round.masterId === unit.ownerId;
    }

    function emit(state, type, message, data) {
        const event = {
            seq: state.nextEventSeq++,
            revision: state.revision,
            type,
            message,
            ...(data || {})
        };
        state.eventLog.push(event);
        if (state.eventLog.length > 500) state.eventLog.splice(0, state.eventLog.length - 500);
        return event;
    }

    function errorResult(code, message) {
        return { ok: false, code, message };
    }

    function okResult(extra) {
        return { ok: true, ...(extra || {}) };
    }

    function createBaseState(config, scenario) {
        const board = {
            width: numberFrom(config.table && config.table.width, DEFAULT_BOARD.width),
            height: numberFrom(config.table && config.table.height, DEFAULT_BOARD.height),
            deploymentDepth: numberFrom(config.table && config.table.deploymentDepth, DEFAULT_BOARD.deploymentDepth),
            terrainSize: normalizeSize(config.terrainSize || (config.table && config.table.terrainSize), DEFAULT_TERRAIN_SIZE)
        };
        const rng = { state: (numberFrom(config.seed, 1) >>> 0) || 1, counter: 0 };
        const suppliedUnits = config.units || [];
        suppliedUnits.forEach(validateUnitDefinition);
        if (!scenario && suppliedUnits.length < 12) throw new Error('A standard rules game needs at least 12 complete unit profiles.');
        const selectedUnits = scenario ? suppliedUnits : shuffle(suppliedUnits, rng).slice(0, 12);
        const units = selectedUnits.map(normalizeUnit);
        if (units.length < 2) throw new Error('A rules game needs at least two units.');
        const terrain = (config.terrain || []).map(normalizeTerrain);
        const deck = config.terrainDeck
            ? [...config.terrainDeck].map(value => String(value).toLowerCase())
            : shuffle(DEFAULT_TERRAIN_DECK, rng);
        if (!scenario && deck.length < units.length) throw new Error(`The terrain deck needs at least ${units.length} tiles for this draft.`);
        const firstPlayerId = config.firstDraftPlayer && PLAYER_IDS.includes(config.firstDraftPlayer)
            ? config.firstDraftPlayer
            : (nextRandom(rng) < 0.5 ? 'p1' : 'p2');
        const state = {
            schema: SCHEMA,
            schemaVersion: SCHEMA_VERSION,
            matchId: String(config.matchId || 'local-match'),
            revision: 0,
            mode: 'rules',
            rules: { ...DEFAULT_RULES, ...(config.rulesOptions || {}) },
            board,
            players: [
                { id: 'p1', name: (config.players && config.players.p1 && config.players.p1.name) || 'Player 1', side: 'dark', startingUnitCount: 0, commands: 0 },
                { id: 'p2', name: (config.players && config.players.p2 && config.players.p2.name) || 'Player 2', side: 'light', startingUnitCount: 0, commands: 0 }
            ],
            units,
            terrain,
            draft: {
                complete: Boolean(scenario),
                poolIds: scenario ? [] : units.map(unit => unit.id),
                terrainDeck: scenario ? [] : deck,
                firstPlayerId,
                secondPlayerId: oppositePlayer(firstPlayerId),
                currentPlayerId: scenario ? null : firstPlayerId,
                activePlayerId: scenario ? null : firstPlayerId,
                selectedUnitId: null,
                pendingTerrainType: null,
                step: scenario ? 'complete' : 'chooseUnit',
                turn: scenario ? units.length + 1 : 1
            },
            phase: scenario ? (config.phase || 'bid') : 'draft',
            round: {
                number: scenario ? Math.max(1, numberFrom(config.roundNumber, 1)) : 0,
                previousMasterId: config.previousMasterId || null,
                masterId: config.masterId || null,
                window: config.window || null,
                activePlayerId: null,
                bids: { p1: null, p2: null },
                bidSubmitted: { p1: false, p2: false },
                bidStage: scenario ? 'commit' : null,
                commands: { p1: 0, p2: 0 }
            },
            activation: null,
            rng,
            processedActionIds: [],
            eventLog: [],
            nextEventSeq: 1,
            winner: null,
            result: null
        };
        if (scenario) {
            PLAYER_IDS.forEach(playerId => {
                const player = playerById(state, playerId);
                player.startingUnitCount = aliveUnits(state, playerId).length;
            });
            state.round.activePlayerId = 'p1';
        }
        emit(state, scenario ? 'game.scenarioReady' : 'game.prepared', scenario
            ? 'The battlefield is ready. Both players must bid.'
            : `${units.length} units entered the draft pool. ${firstPlayerId === 'p1' ? 'Player 1' : 'Player 2'} drafts first.`);
        return state;
    }

    function createGame(config) {
        return createBaseState(clone(config || {}), false);
    }

    function createScenario(config) {
        const source = clone(config || {});
        const units = source.units || [];
        const split = Math.floor(units.length / 2);
        source.units = units.map((unit, index) => ({
            ...unit,
            ownerId: unit.ownerId || unit.owner || (index < split ? 'p1' : 'p2')
        }));
        return createBaseState(source, true);
    }

    function draftTerrainSize(state) {
        return clone(state.board.terrainSize || DEFAULT_TERRAIN_SIZE);
    }

    function legalTerrainPlacement(state, type, pose, _requestedSize) {
        const selected = unitById(state, state.draft.selectedUnitId);
        if (!selected) return errorResult('draft.noSelectedUnit', 'Choose a unit before placing terrain.');
        const candidate = normalizeTerrain({ type, pose, size: draftTerrainSize(state) }, state.terrain.length);
        if (!poseInsideBounds(candidate, candidate.pose, state.board)) {
            return errorResult('terrain.outOfBounds', 'The whole terrain tile must remain on the battlefield.');
        }
        if (!rectanglesTouch(candidate, selected) && !rectanglesOverlap(candidate, selected)) {
            return errorResult('terrain.mustTouchUnit', `Place the ${type} so it touches or overlaps the chosen unit.`);
        }
        const undeployedIds = new Set(state.draft.poolIds);
        if (state.units.some(unit => !undeployedIds.has(unit.id) && rectanglesOverlap(candidate, unit))) {
            return errorResult('terrain.overlapsUnit', 'Terrain cannot overlap an already-deployed unit card.');
        }
        if (state.terrain.some(item => item.status !== 'discarded' && rectanglesOverlap(candidate, item))) {
            return errorResult('terrain.overlapsTerrain', 'Terrain tiles cannot overlap one another.');
        }
        return okResult({ candidate });
    }

    function legalDeployment(state, unit, pose) {
        const candidatePose = normalizePose(pose, unit.pose);
        const corners = rectangleCorners(unit, candidatePose);
        const zoneTop = unit.ownerId === 'p2' ? 0 : state.board.height - state.board.deploymentDepth;
        const zoneBottom = unit.ownerId === 'p2' ? state.board.deploymentDepth : state.board.height;
        if (!corners.every(point => point.x >= -GEOMETRY_EPSILON && point.x <= state.board.width + GEOMETRY_EPSILON
            && point.y >= zoneTop - GEOMETRY_EPSILON && point.y <= zoneBottom + GEOMETRY_EPSILON)) {
            return errorResult('deployment.outsideZone', `The whole unit must be inside ${unit.ownerId === 'p1' ? 'Player 1' : 'Player 2'}'s deployment zone.`);
        }
        if (aliveUnits(state).some(other => other.id !== unit.id && rectanglesOverlap(unit, other, candidatePose))) {
            return errorResult('deployment.overlap', 'Deployed units cannot overlap.');
        }
        if (state.terrain.some(terrain => terrainHasTrait(terrain, 'impassable')
            && rectanglesOverlap(unit, terrain, candidatePose))) {
            return errorResult('deployment.impassable', 'A unit cannot deploy overlapping impassable terrain.');
        }
        return okResult({ pose: candidatePose });
    }

    function finishDraft(state, events) {
        const deployed = state.units.filter(unit => unit.ownerId);
        if (deployed.length === state.units.length) {
            state.draft.complete = true;
            state.draft.step = 'complete';
            state.draft.currentPlayerId = null;
            state.draft.activePlayerId = null;
            PLAYER_IDS.forEach(playerId => {
                playerById(state, playerId).startingUnitCount = aliveUnits(state, playerId).length;
            });
            state.phase = 'bid';
            state.round.number = 1;
            state.round.bidStage = 'commit';
            state.round.activePlayerId = 'p1';
            events.push(emit(state, 'draft.complete', 'Deployment is complete. Round 1 begins with secret bids.'));
            return;
        }
        state.draft.currentPlayerId = oppositePlayer(state.draft.currentPlayerId);
        state.draft.activePlayerId = state.draft.currentPlayerId;
        state.draft.selectedUnitId = null;
        state.draft.pendingTerrainType = null;
        state.draft.step = 'chooseUnit';
        state.draft.turn += 1;
        events.push(emit(state, 'draft.turnAdvanced', `${state.draft.currentPlayerId === 'p1' ? 'Player 1' : 'Player 2'} begins draft turn ${state.draft.turn}.`, {
            playerId: state.draft.currentPlayerId
        }));
    }

    function determineBidActivePlayer(state) {
        state.round.activePlayerId = PLAYER_IDS.find(id => !state.round.bidSubmitted[id]) || null;
    }

    function currentCommandPlayer(state) {
        return state.round.activePlayerId;
    }

    function eligibleCommandUnits(state, playerId) {
        return aliveUnits(state, playerId).filter(unit => !unit.activated);
    }

    function advanceCommandWindow(state, events) {
        const masterId = state.round.masterId;
        if (state.round.window === 'masterOpening') {
            state.round.window = 'otherPlayer';
            state.round.activePlayerId = oppositePlayer(masterId);
        } else if (state.round.window === 'otherPlayer') {
            state.round.window = 'masterRemainder';
            state.round.activePlayerId = masterId;
        } else if (state.round.window === 'masterRemainder') {
            state.round.window = 'cleanup';
            state.round.activePlayerId = null;
        }
        events.push(emit(state, 'command.windowAdvanced', state.round.window === 'cleanup'
            ? 'All command windows are complete. Cleaning up the round.'
            : `${state.round.activePlayerId === 'p1' ? 'Player 1' : 'Player 2'} now spends commands.`, {
            window: state.round.window,
            playerId: state.round.activePlayerId
        }));
    }

    function advanceForced(stateInput) {
        const state = clone(stateInput);
        const events = [];
        if (!state || state.winner) return { state, events, advanced: false };

        if (state.phase === 'draft') {
            if (state.draft.step === 'drawTerrain') {
                const type = state.draft.terrainDeck.shift();
                if (!type) throw new Error('The terrain deck ran out before the draft ended.');
                state.draft.pendingTerrainType = type;
                state.draft.step = type === 'x' ? 'discardTerrain' : 'placeTerrain';
                state.revision += 1;
                events.push(emit(state, 'terrain.drawn', type === 'x' ? 'The visible open-ground tile was taken.' : `The visible ${type} tile was taken.`, { terrainType: type }));
                return { state, events, event: events[0], advanced: true };
            }
            if (state.draft.step === 'discardTerrain') {
                state.draft.pendingTerrainType = null;
                state.draft.step = 'deployUnit';
                state.revision += 1;
                events.push(emit(state, 'terrain.discarded', 'The open-ground tile is discarded. Deploy the chosen unit.'));
                return { state, events, event: events[0], advanced: true };
            }
            if (state.draft.step === 'finishTurn') {
                state.revision += 1;
                finishDraft(state, events);
                return { state, events, event: events[0], advanced: true };
            }
        }

        if (state.phase === 'bid') {
            if (state.round.bidStage === 'reveal') {
                state.round.bidStage = 'grant';
                state.revision += 1;
                events.push(emit(state, 'bid.revealed', `Bids revealed: Player 1 chose ${state.round.bids.p1}; Player 2 chose ${state.round.bids.p2}.`, {
                    bids: clone(state.round.bids)
                }));
                return { state, events, event: events[0], advanced: true };
            }
            if (state.round.bidStage === 'grant') {
                PLAYER_IDS.forEach(playerId => {
                    state.round.commands[playerId] = state.round.bids[playerId];
                    playerById(state, playerId).commands = state.round.bids[playerId];
                });
                state.round.bidStage = 'determineMaster';
                state.revision += 1;
                events.push(emit(state, 'command.granted', `Player 1 receives ${state.round.commands.p1} commands; Player 2 receives ${state.round.commands.p2}.`));
                return { state, events, event: events[0], advanced: true };
            }
            if (state.round.bidStage === 'determineMaster') {
                const p1Bid = state.round.bids.p1;
                const p2Bid = state.round.bids.p2;
                let masterId;
                if (p1Bid < p2Bid) masterId = 'p1';
                else if (p2Bid < p1Bid) masterId = 'p2';
                else masterId = state.round.previousMasterId || state.draft.secondPlayerId;
                state.round.masterId = masterId;
                state.round.window = 'masterOpening';
                state.round.activePlayerId = masterId;
                state.round.bidStage = 'complete';
                state.phase = 'command';
                state.revision += 1;
                events.push(emit(state, 'master.chosen', `${masterId === 'p1' ? 'Player 1' : 'Player 2'} is the Master Tactician.`, { playerId: masterId }));
                return { state, events, event: events[0], advanced: true };
            }
        }

        if (state.phase === 'command') {
            if (state.activation && state.activation.stage === 'complete') {
                const unit = unitById(state, state.activation.unitId);
                state.activation = null;
                state.revision += 1;
                events.push(emit(state, 'activation.complete', `${unit ? unit.name : 'The unit'} completed its activation.`, { unitId: unit && unit.id }));
                return { state, events, event: events[0], advanced: true };
            }
            if (!state.activation && state.round.window === 'cleanup') {
                state.units.forEach(unit => {
                    unit.activated = false;
                    unit.woundsThisRound = 0;
                    unit.distanceMovedThisRound = 0;
                });
                PLAYER_IDS.forEach(playerId => {
                    state.round.commands[playerId] = 0;
                    playerById(state, playerId).commands = 0;
                });
                state.round.previousMasterId = state.round.masterId;
                state.round.masterId = null;
                state.round.window = null;
                state.round.number += 1;
                state.round.bids = { p1: null, p2: null };
                state.round.bidSubmitted = { p1: false, p2: false };
                state.round.bidStage = 'commit';
                state.round.activePlayerId = 'p1';
                state.phase = 'bid';
                state.revision += 1;
                events.push(emit(state, 'round.cleaned', `Round ${state.round.number - 1} is cleaned up. Round ${state.round.number} bidding begins.`));
                return { state, events, event: events[0], advanced: true };
            }
            if (!state.activation && state.round.window) {
                const playerId = currentCommandPlayer(state);
                const eligible = eligibleCommandUnits(state, playerId);
                const commands = state.round.commands[playerId] || 0;
                if (commands > 0 && eligible.length === 0) {
                    state.round.commands[playerId] = 0;
                    playerById(state, playerId).commands = 0;
                    state.revision += 1;
                    events.push(emit(state, 'command.discarded', `${playerId === 'p1' ? 'Player 1' : 'Player 2'} has no eligible unit, so unusable commands are discarded.`, { playerId }));
                    return { state, events, event: events[0], advanced: true };
                }
                if (commands <= 0) {
                    state.revision += 1;
                    advanceCommandWindow(state, events);
                    return { state, events, event: events[0], advanced: true };
                }
            }
            const actorId = state.round.activePlayerId;
            const soleActions = actorId ? getLegalActions(stateInput, actorId) : [];
            const automaticTypes = new Set([
                'activation.selectUnit',
                'activation.pass',
                'activation.endPivots'
            ]);
            if (soleActions.length === 1 && automaticTypes.has(soleActions[0].type)) {
                const automatic = applyAction(stateInput, {
                    ...soleActions[0],
                    actionId: `automatic:${stateInput.revision}:${soleActions[0].type}`
                }, { autoAdvance: false });
                const event = automatic.events[0];
                if (event) event.message = `Automatic — only legal choice: ${event.message}`;
                return {
                    state: automatic.state,
                    events: automatic.events,
                    event,
                    advanced: true
                };
            }
        }
        return { state: stateInput, events: [], advanced: false };
    }

    function runForcedTransitions(stateInput) {
        let state = stateInput;
        const events = [];
        for (let index = 0; index < 100; index += 1) {
            const result = advanceForced(state);
            if (!result.advanced) return { state, events };
            state = result.state;
            events.push(...result.events);
        }
        throw new Error('Forced-transition safety limit exceeded.');
    }

    function sweptMoveCheck(state, unit, destination, direction) {
        const start = unit.pose;
        const target = normalizePose(destination, start);
        if (Math.abs(normalizeAngle(target.angle - start.angle)) > 0.01) {
            return errorResult('move.changedFacing', 'Movement cannot rotate the unit. Pivot separately.');
        }
        const axes = axesForAngle(start.angle);
        const movement = { x: target.x - start.x, y: target.y - start.y };
        const forwardDistance = movement.x * axes.forward.x + movement.y * axes.forward.y;
        const lateralDistance = movement.x * axes.right.x + movement.y * axes.right.y;
        const signedDistance = direction === 'backward' ? -forwardDistance : forwardDistance;
        const distance = Math.hypot(movement.x, movement.y);
        if (Math.abs(lateralDistance) > 0.04 || Math.abs(Math.abs(forwardDistance) - distance) > 0.04) {
            return errorResult('move.notStraight', 'Units must move in a straight line directly forward or backward.');
        }
        if (signedDistance < -0.02) return errorResult('move.wrongDirection', `Move the unit ${direction}, not the opposite direction.`);
        const maximum = unit.profile.speed * (direction === 'backward' ? 0.5 : 1);
        if (distance > maximum + 0.02) return errorResult('move.tooFar', `${unit.name} can move at most ${maximum}" ${direction}.`);
        if (!poseInsideBounds(unit, target, state.board)) return errorResult('move.outOfBounds', 'The whole unit must stay on the battlefield.');

        const collidingUnit = aliveUnits(state).find(other => other.id !== unit.id
            && sweptRectanglesOverlap(unit, other, start, target));
        if (collidingUnit) return errorResult('move.overlapUnit', `The move would overlap ${collidingUnit.name}.`);
        const impassable = state.terrain.find(terrain => terrainHasTrait(terrain, 'impassable')
            && sweptRectanglesOverlap(unit, terrain, start, target));
        if (impassable) return errorResult('move.impassable', `The move would cross impassable ${impassable.type}.`);

        const steps = Math.max(1, Math.ceil(distance / 0.1));
        const enteredSlowing = unit.profile.defence > 3 && state.terrain.some(terrain =>
            terrainHasTrait(terrain, 'slowing')
            && (unitOverlapsTerrain(unit, terrain, start)
                || sweptRectanglesOverlap(unit, terrain, start, target)));
        const startingEnemyContacts = new Set(aliveUnits(state, oppositePlayer(unit.ownerId))
            .filter(enemy => rectanglesTouch(unit, enemy, start))
            .map(enemy => enemy.id));
        for (let index = 1; index <= steps; index += 1) {
            const t = index / steps;
            const pose = {
                x: start.x + movement.x * t,
                y: start.y + movement.y * t,
                angle: start.angle
            };
            if (direction === 'backward') {
                const newEnemyContact = aliveUnits(state, oppositePlayer(unit.ownerId)).some(enemy =>
                    !startingEnemyContacts.has(enemy.id) && rectanglesTouch(unit, enemy, pose));
                if (newEnemyContact) return errorResult('move.backwardContact', 'A unit may contact an enemy only while moving forward.');
            }
        }
        if (enteredSlowing && unit.distanceMovedThisRound + distance > 3 + 0.02) {
            return errorResult('move.slowing', 'This unit cannot move more than 3" this round while entering slowing terrain.');
        }
        return okResult({ pose: target, distance, enteredSlowing });
    }

    function laneRectangle(shooter, length) {
        const axes = axesForAngle(shooter.pose.angle);
        return {
            size: { width: shooter.size.width, height: length },
            pose: {
                x: shooter.pose.x + axes.forward.x * (shooter.size.height / 2 + length / 2),
                y: shooter.pose.y + axes.forward.y * (shooter.size.height / 2 + length / 2),
                angle: shooter.pose.angle
            }
        };
    }

    function forwardProjection(shooter, points) {
        const axes = axesForAngle(shooter.pose.angle);
        return points.map(point => (point.x - shooter.pose.x) * axes.forward.x + (point.y - shooter.pose.y) * axes.forward.y);
    }

    function clipPolygonAtBoundary(points, axis, boundary, keepGreater) {
        const result = [];
        if (!points.length) return result;
        const isInside = point => keepGreater
            ? point[axis] >= boundary - GEOMETRY_EPSILON
            : point[axis] <= boundary + GEOMETRY_EPSILON;
        for (let index = 0; index < points.length; index += 1) {
            const current = points[index];
            const previous = points[(index + points.length - 1) % points.length];
            const currentInside = isInside(current);
            const previousInside = isInside(previous);
            if (currentInside !== previousInside) {
                const denominator = current[axis] - previous[axis];
                const t = Math.abs(denominator) <= GEOMETRY_EPSILON ? 0 : (boundary - previous[axis]) / denominator;
                result.push({
                    x: previous.x + (current.x - previous.x) * t,
                    y: previous.y + (current.y - previous.y) * t
                });
            }
            if (currentInside) result.push(current);
        }
        return result;
    }

    function targetEntryInLane(shooter, target, range) {
        const axes = axesForAngle(shooter.pose.angle);
        let polygon = rectangleCorners(target).map(point => ({
            x: (point.x - shooter.pose.x) * axes.right.x + (point.y - shooter.pose.y) * axes.right.y,
            y: (point.x - shooter.pose.x) * axes.forward.x + (point.y - shooter.pose.y) * axes.forward.y
        }));
        const halfWidth = shooter.size.width / 2;
        const front = shooter.size.height / 2;
        polygon = clipPolygonAtBoundary(polygon, 'x', -halfWidth, true);
        polygon = clipPolygonAtBoundary(polygon, 'x', halfWidth, false);
        polygon = clipPolygonAtBoundary(polygon, 'y', front, true);
        polygon = clipPolygonAtBoundary(polygon, 'y', front + range, false);
        return polygon.length ? Math.min(...polygon.map(point => point.y)) : null;
    }

    function getLegalShootTargets(state, shooter) {
        if (!shooter.profile.shoot || shooter.profile.shoot.dice < 1 || shooter.profile.shoot.range <= 0) return [];
        if (aliveUnits(state, oppositePlayer(shooter.ownerId)).some(enemy => unitsTouch(shooter, enemy))) return [];
        const range = shooter.profile.shoot.range;
        const lane = laneRectangle(shooter, range);
        return aliveUnits(state, oppositePlayer(shooter.ownerId)).filter(target => {
            if (aliveUnits(state, shooter.ownerId).some(friend => friend.id !== shooter.id && unitsTouch(friend, target))) return false;
            if (!polygonsOverlap(rectangleCorners(lane), rectangleCorners(target), false)) return false;
            const targetNear = targetEntryInLane(shooter, target, range);
            if (targetNear === null) return false;
            const betweenLength = Math.max(0, targetNear - shooter.size.height / 2);
            if (betweenLength <= GEOMETRY_EPSILON) return true;
            const betweenLane = laneRectangle(shooter, betweenLength);
            const shooterHigherThanTarget = compareUnitHeight(state, shooter, target) > 0;
            const unitBlocked = aliveUnits(state).some(blocker => {
                if (blocker.id === shooter.id || blocker.id === target.id) return false;
                if (!polygonsOverlap(rectangleCorners(betweenLane), rectangleCorners(blocker), false)) return false;
                if (shooterHigherThanTarget && compareUnitHeight(state, shooter, blocker) > 0) return false;
                return true;
            });
            if (unitBlocked) return false;
            return !state.terrain.some(terrain => terrainHasTrait(terrain, 'concealing')
                && polygonsOverlap(rectangleCorners(betweenLane), rectangleCorners(terrain), false));
        });
    }

    function getStrikeTargets(state, attacker) {
        return aliveUnits(state, oppositePlayer(attacker.ownerId)).filter(target => unitsTouch(attacker, target));
    }

    function outflankingCount(state, attacker, target) {
        return aliveUnits(state, attacker.ownerId).filter(friend => {
            if (!touchesTargetFlank(friend, target)) return false;
            return !touchesEnemyFront(state, friend);
        }).length;
    }

    function checkVictory(state, loserId, events) {
        const loser = playerById(state, loserId);
        const remaining = aliveUnits(state, loserId).length;
        if (!loser || loser.startingUnitCount <= 0 || remaining * 2 > loser.startingUnitCount) return false;
        const winnerId = oppositePlayer(loserId);
        state.winner = winnerId;
        state.result = { winnerId, loserId, reason: 'enemyHalfRemaining', remaining, starting: loser.startingUnitCount };
        state.phase = 'gameOver';
        state.activation = null;
        state.round.activePlayerId = null;
        events.push(emit(state, 'game.won', `${winnerId === 'p1' ? 'Player 1' : 'Player 2'} wins: the opposing army has half or fewer of its starting units remaining.`, {
            winnerId, loserId
        }));
        return true;
    }

    function resolveAttack(state, attacker, target, kind, events) {
        const stat = kind === 'shoot' ? attacker.profile.shoot : attacker.profile.strike;
        if (!stat) throw new Error(`${attacker.name} cannot ${kind}.`);
        const attackerHeightPose = state.activation && state.activation.moved
            ? state.activation.moveStartPose
            : attacker.pose;
        const modifiers = {
            outflanking: outflankingCount(state, attacker, target),
            height: compareUnitHeight(state, attacker, target, attackerHeightPose, target.pose) > 0 ? 1 : 0,
            disruption: -(attacker.woundsThisRound || 0)
        };
        const pool = Math.max(1, stat.dice + modifiers.outflanking + modifiers.height + modifiers.disruption);
        const threshold = stat.armourPiercing ? state.rules.armourPiercingThreshold : target.profile.defence;
        let pending = pool;
        let wounds = 0;
        let batch = 0;
        while (pending > 0) {
            const rolls = Array.from({ length: pending }, () => rollD6(state));
            wounds += rolls.filter(value => value >= threshold).length;
            pending = rolls.filter(value => value === 6).length;
            batch += 1;
            events.push(emit(state, 'combat.roll', `${attacker.name} rolled ${rolls.join(', ')}${pending ? `; ${pending} critical ${pending === 1 ? 'die' : 'dice'} follow.` : '.'}`, {
                attackerId: attacker.id,
                targetId: target.id,
                attackKind: kind,
                batch,
                rolls,
                threshold,
                pool
            }));
        }
        if (wounds > 0) {
            target.wounds += wounds;
            target.woundsThisRound += wounds;
            events.push(emit(state, 'combat.wounds', `${target.name} suffers ${wounds} ${wounds === 1 ? 'wound' : 'wounds'} (${target.wounds}/${MAX_WOUNDS}).`, {
                attackerId: attacker.id,
                targetId: target.id,
                wounds,
                totalWounds: target.wounds,
                modifiers
            }));
        } else {
            events.push(emit(state, 'combat.noWounds', `${target.name} suffers no wounds.`, {
                attackerId: attacker.id,
                targetId: target.id,
                modifiers
            }));
        }
        if (target.wounds >= MAX_WOUNDS) {
            target.status = 'destroyed';
            events.push(emit(state, 'unit.destroyed', `${target.name} is destroyed.`, { unitId: target.id, ownerId: target.ownerId }));
            checkVictory(state, target.ownerId, events);
        }
        return { pool, threshold, wounds, modifiers };
    }

    function pivotAllowance(unit) {
        return unit.profile.drill === 0 ? 1 : unit.profile.drill;
    }

    function canPivotNow(state, unit) {
        if (!state.activation || !['prePivots', 'postPivots'].includes(state.activation.stage)) return false;
        if (state.activation.pivotsUsed >= pivotAllowance(unit)) return false;
        if (unit.profile.drill === 0 && state.activation.actionTaken === 'move') return false;
        if (!isMasterUnit(state, unit) && touchesEnemyFront(state, unit)) return false;
        return true;
    }

    function validatePivotDestination(state, unit, degrees) {
        if (!canPivotNow(state, unit)) return errorResult('pivot.unavailable', 'This unit has no legal pivot remaining.');
        const delta = normalizeAngle(degrees);
        if (Math.abs(delta) < 0.01 || Math.abs(delta) > 90 + 0.01) return errorResult('pivot.angle', 'Each pivot must turn between 0° and 90°.');
        const pose = { ...unit.pose, angle: normalizeAngle(unit.pose.angle + delta) };
        if (!poseInsideBounds(unit, pose, state.board)) return errorResult('pivot.outOfBounds', 'The whole unit must finish its pivot on the battlefield.');
        if (aliveUnits(state).some(other => other.id !== unit.id && rectanglesOverlap(unit, other, pose))) {
            return errorResult('pivot.overlapUnit', 'The unit must finish its pivot clear of every unit.');
        }
        if (state.terrain.some(terrain => terrainHasTrait(terrain, 'impassable') && rectanglesOverlap(unit, terrain, pose))) {
            return errorResult('pivot.impassable', 'The unit must finish its pivot clear of impassable terrain.');
        }
        const currentContacts = new Set(aliveUnits(state, oppositePlayer(unit.ownerId))
            .filter(enemy => rectanglesTouch(unit, enemy))
            .map(enemy => enemy.id));
        if (aliveUnits(state, oppositePlayer(unit.ownerId)).some(enemy =>
            !currentContacts.has(enemy.id) && rectanglesTouch(unit, enemy, pose))) {
            return errorResult('pivot.newContact', 'A unit may make new enemy contact only by moving forward.');
        }
        if (unit.profile.defence > 3 && unit.distanceMovedThisRound > 3 + 0.02
            && state.terrain.some(terrain => terrainHasTrait(terrain, 'slowing')
                && unitOverlapsTerrain(unit, terrain, pose))) {
            return errorResult('pivot.slowing', 'A unit that moved more than 3" this round cannot pivot into slowing terrain.');
        }
        return okResult({ pose, degrees: delta });
    }

    function expectedActors(state) {
        if (state.winner) return [];
        if (state.phase === 'draft') return state.draft.currentPlayerId ? [state.draft.currentPlayerId] : [];
        if (state.phase === 'bid' && state.round.bidStage === 'commit') {
            return PLAYER_IDS.filter(id => !state.round.bidSubmitted[id]);
        }
        if (state.phase === 'command') return state.round.activePlayerId ? [state.round.activePlayerId] : [];
        return [];
    }

    function validateAction(state, action) {
        if (!state || state.schema !== SCHEMA) return errorResult('state.invalid', 'This is not a valid Seize the Day rules state.');
        if (state.schemaVersion !== SCHEMA_VERSION) return errorResult('state.version', 'This game uses an unsupported rules-state version.');
        if (!action || !action.type) return errorResult('action.missingType', 'An action type is required.');
        if (state.winner) return errorResult('game.complete', 'The game is already over.');
        if (action.expectedRevision === undefined || Number(action.expectedRevision) !== state.revision) {
            return errorResult('action.stale', 'The battlefield changed before that action arrived.');
        }
        const actorId = action.actorId;
        if (!PLAYER_IDS.includes(actorId)) return errorResult('actor.invalid', 'A valid player must perform the action.');
        if (!expectedActors(state).includes(actorId)) return errorResult('actor.wrongTurn', 'It is not that player’s choice right now.');

        if (action.type === 'draft.chooseUnit') {
            if (state.phase !== 'draft' || state.draft.step !== 'chooseUnit') return errorResult('draft.wrongStep', 'It is not time to choose a unit.');
            const unit = unitById(state, action.unitId);
            if (!unit || unit.ownerId || !state.draft.poolIds.includes(action.unitId)) return errorResult('draft.unitUnavailable', 'Choose an undrafted unit from the pool.');
            return okResult({ unit });
        }
        if (action.type === 'draft.placeTerrain') {
            if (state.phase !== 'draft' || state.draft.step !== 'placeTerrain') return errorResult('draft.wrongStep', 'It is not time to place terrain.');
            const type = state.draft.pendingTerrainType;
            if (!type || type === 'x') return errorResult('terrain.nonePending', 'There is no terrain feature to place.');
            return legalTerrainPlacement(state, type, action.pose || action.destination, action.size);
        }
        if (action.type === 'draft.deployUnit') {
            if (state.phase !== 'draft' || state.draft.step !== 'deployUnit') return errorResult('draft.wrongStep', 'It is not time to deploy a unit.');
            const unit = unitById(state, state.draft.selectedUnitId);
            if (!unit || action.unitId !== unit.id) return errorResult('draft.wrongUnit', 'Deploy the unit chosen this draft turn.');
            return legalDeployment(state, unit, action.pose || action.destination);
        }
        if (action.type === 'bid.submit') {
            if (state.phase !== 'bid' || state.round.bidStage !== 'commit') return errorResult('bid.closed', 'Bidding is not open.');
            if (state.round.bidSubmitted[actorId]) return errorResult('bid.alreadySubmitted', 'That player has already locked a bid.');
            const bid = Math.floor(numberFrom(action.bid ?? action.value, 0));
            const maximum = aliveUnits(state, actorId).length;
            if (bid < 1 || bid > maximum) return errorResult('bid.outOfRange', `Choose a bid from 1 to ${maximum}.`);
            return okResult({ bid });
        }
        if (action.type === 'command.yield') {
            if (state.phase !== 'command' || state.activation || state.round.window !== 'masterOpening' || actorId !== state.round.masterId) {
                return errorResult('command.cannotYield', 'Only the Master Tactician may yield during the opening command window.');
            }
            return okResult();
        }
        if (action.type === 'activation.selectUnit') {
            if (state.phase !== 'command' || state.activation) return errorResult('activation.busy', 'Finish the current activation first.');
            if ((state.round.commands[actorId] || 0) < 1) return errorResult('command.none', 'That player has no command remaining.');
            const unit = unitById(state, action.unitId);
            if (!unit || unit.status !== 'alive' || unit.ownerId !== actorId || unit.activated) {
                return errorResult('activation.unitIneligible', 'Choose one of your surviving units that has not activated this round.');
            }
            return okResult({ unit });
        }

        const activation = state.activation;
        if (!activation) return errorResult('activation.none', 'Select a unit to activate first.');
        const unit = unitById(state, activation.unitId);
        if (!unit || unit.ownerId !== actorId) return errorResult('activation.wrongActor', 'Only the active unit’s owner may act.');

        if (action.type === 'activation.pivot') {
            return validatePivotDestination(state, unit, action.degrees ?? action.delta);
        }
        if (action.type === 'activation.move') {
            if (activation.stage !== 'prePivots') return errorResult('move.wrongStage', 'Movement must be the unit’s action.');
            if (!['forward', 'backward'].includes(action.direction)) return errorResult('move.direction', 'Choose forward or backward movement.');
            if (unit.profile.drill === 0 && activation.pivotsUsed > 0) return errorResult('move.drillZeroPivoted', 'A Drill 0 unit cannot move after pivoting.');
            if (!isMasterUnit(state, unit) && touchesEnemyFront(state, unit)) return errorResult('move.enemyFront', 'Only the Master Tactician may move while touching an enemy front.');
            return sweptMoveCheck(state, unit, action.pose || action.destination || action.to, action.direction);
        }
        if (action.type === 'activation.shoot') {
            if (activation.stage !== 'prePivots') return errorResult('shoot.wrongStage', 'Shooting must be the unit’s action.');
            const target = unitById(state, action.targetId);
            if (!target || !getLegalShootTargets(state, unit).some(candidate => candidate.id === target.id)) {
                return errorResult('shoot.illegalTarget', 'That unit is not a legal shooting target.');
            }
            return okResult({ target });
        }
        if (action.type === 'activation.pass') {
            if (activation.stage !== 'prePivots') return errorResult('activation.cannotPass', 'The action has already been taken.');
            return okResult();
        }
        if (action.type === 'activation.endPivots') {
            if (activation.stage !== 'postPivots') return errorResult('activation.notPostPivots', 'Finish the unit’s action before ending pivots.');
            return okResult();
        }
        if (action.type === 'activation.strike') {
            if (activation.stage !== 'strike') return errorResult('strike.wrongStage', 'It is not time to strike.');
            const target = unitById(state, action.targetId);
            if (!target || !getStrikeTargets(state, unit).some(candidate => candidate.id === target.id)) {
                return errorResult('strike.illegalTarget', 'Choose an enemy touching the active unit.');
            }
            return okResult({ target });
        }
        if (action.type === 'activation.skipStrike') {
            if (activation.stage !== 'strike') return errorResult('strike.wrongStage', 'There is no strike to skip.');
            return okResult();
        }
        return errorResult('action.unknown', `Unknown action type: ${action.type}`);
    }

    function applyAction(stateInput, actionInput, options) {
        const action = clone(actionInput || {});
        if (!stateInput || stateInput.schema !== SCHEMA || stateInput.schemaVersion !== SCHEMA_VERSION
            || (stateInput.projection && stateInput.projection.authoritative === false)) {
            const trustError = new Error('Only a current authoritative rules state may apply actions.');
            trustError.code = 'state.notAuthoritative';
            throw trustError;
        }
        if (action.actionId && stateInput.processedActionIds && stateInput.processedActionIds.includes(action.actionId)) {
            return { state: stateInput, events: [], ok: true, duplicate: true };
        }
        const validation = validateAction(stateInput, action);
        if (!validation.ok) {
            const error = new Error(validation.message);
            error.code = validation.code;
            throw error;
        }
        const state = clone(stateInput);
        const events = [];
        state.revision += 1;
        if (action.actionId) {
            state.processedActionIds.push(action.actionId);
            if (state.processedActionIds.length > 100) state.processedActionIds.shift();
        }

        if (action.type === 'draft.chooseUnit') {
            const unit = unitById(state, action.unitId);
            unit.ownerId = action.actorId;
            state.draft.selectedUnitId = unit.id;
            state.draft.step = 'drawTerrain';
            events.push(emit(state, 'draft.unitChosen', `${action.actorId === 'p1' ? 'Player 1' : 'Player 2'} chose ${unit.name}. Taking the visible terrain tile…`, {
                actorId: action.actorId,
                unitId: unit.id
            }));
        } else if (action.type === 'draft.placeTerrain') {
            const candidate = validation.candidate;
            candidate.id = `terrain-${state.terrain.length + 1}`;
            state.terrain.push(candidate);
            state.draft.pendingTerrainType = null;
            state.draft.step = 'deployUnit';
            events.push(emit(state, 'terrain.placed', `${candidate.type.charAt(0).toUpperCase() + candidate.type.slice(1)} terrain was placed. Deploy the chosen unit.`, {
                actorId: action.actorId,
                terrainId: candidate.id,
                terrainType: candidate.type
            }));
        } else if (action.type === 'draft.deployUnit') {
            const unit = unitById(state, action.unitId);
            unit.pose = validation.pose;
            state.draft.poolIds = state.draft.poolIds.filter(id => id !== unit.id);
            state.draft.step = 'finishTurn';
            events.push(emit(state, 'draft.unitDeployed', `${unit.name} deployed for ${action.actorId === 'p1' ? 'Player 1' : 'Player 2'}.`, {
                actorId: action.actorId,
                unitId: unit.id,
                pose: clone(unit.pose)
            }));
        } else if (action.type === 'bid.submit') {
            state.round.bids[action.actorId] = validation.bid;
            state.round.bidSubmitted[action.actorId] = true;
            determineBidActivePlayer(state);
            events.push(emit(state, 'bid.submitted', `${action.actorId === 'p1' ? 'Player 1' : 'Player 2'} locked a secret bid.`, {
                actorId: action.actorId
            }));
            if (state.round.bidSubmitted.p1 && state.round.bidSubmitted.p2) {
                state.round.bidStage = 'reveal';
                state.round.activePlayerId = null;
            }
        } else if (action.type === 'command.yield') {
            state.round.window = 'otherPlayer';
            state.round.activePlayerId = oppositePlayer(state.round.masterId);
            events.push(emit(state, 'command.yielded', `${action.actorId === 'p1' ? 'Player 1' : 'Player 2'} yielded the opening command window.`, { actorId: action.actorId }));
        } else if (action.type === 'activation.selectUnit') {
            const unit = unitById(state, action.unitId);
            state.round.commands[action.actorId] -= 1;
            playerById(state, action.actorId).commands = state.round.commands[action.actorId];
            unit.activated = true;
            state.activation = {
                unitId: unit.id,
                playerId: action.actorId,
                stage: 'prePivots',
                pivotsUsed: 0,
                actionTaken: null,
                moved: false,
                moveDistance: 0,
                moveStartHeight: unitHeight(state, unit),
                moveStartPose: clone(unit.pose)
            };
            events.push(emit(state, 'activation.started', `${unit.name} activates.`, { actorId: action.actorId, unitId: unit.id }));
        } else if (action.type === 'activation.pivot') {
            const unit = unitById(state, state.activation.unitId);
            unit.pose = validation.pose;
            state.activation.pivotsUsed += 1;
            events.push(emit(state, 'activation.pivoted', `${unit.name} pivoted ${Math.abs(validation.degrees).toFixed(0)}° ${validation.degrees < 0 ? 'left' : 'right'}.`, {
                actorId: action.actorId,
                unitId: unit.id,
                degrees: validation.degrees
            }));
        } else if (action.type === 'activation.move') {
            const unit = unitById(state, state.activation.unitId);
            state.activation.moveStartHeight = unitHeight(state, unit);
            state.activation.moveStartPose = clone(unit.pose);
            unit.pose = validation.pose;
            unit.distanceMovedThisRound += validation.distance;
            state.activation.actionTaken = 'move';
            state.activation.moved = true;
            state.activation.moveDistance = validation.distance;
            state.activation.stage = 'postPivots';
            events.push(emit(state, 'activation.moved', `${unit.name} moved ${validation.distance.toFixed(1)}" ${action.direction}.`, {
                actorId: action.actorId,
                unitId: unit.id,
                direction: action.direction,
                distance: validation.distance,
                pose: clone(unit.pose)
            }));
        } else if (action.type === 'activation.shoot') {
            const attacker = unitById(state, state.activation.unitId);
            const target = unitById(state, action.targetId);
            state.activation.actionTaken = 'shoot';
            resolveAttack(state, attacker, target, 'shoot', events);
            if (!state.winner) state.activation.stage = 'postPivots';
        } else if (action.type === 'activation.pass') {
            const unit = unitById(state, state.activation.unitId);
            state.activation.actionTaken = 'pass';
            state.activation.stage = 'postPivots';
            events.push(emit(state, 'activation.passed', `${unit.name} holds position.`, { unitId: unit.id, actorId: action.actorId }));
        } else if (action.type === 'activation.endPivots') {
            const unit = unitById(state, state.activation.unitId);
            const targets = getStrikeTargets(state, unit);
            state.activation.stage = targets.length ? 'strike' : 'complete';
            events.push(emit(state, 'activation.pivotsEnded', targets.length
                ? `${unit.name} may strike a touching enemy.`
                : `${unit.name} has no touching enemy and completes its activation.`, { unitId: unit.id }));
        } else if (action.type === 'activation.strike') {
            const attacker = unitById(state, state.activation.unitId);
            const target = unitById(state, action.targetId);
            resolveAttack(state, attacker, target, 'strike', events);
            if (!state.winner) state.activation.stage = 'complete';
        } else if (action.type === 'activation.skipStrike') {
            const unit = unitById(state, state.activation.unitId);
            state.activation.stage = 'complete';
            events.push(emit(state, 'activation.strikeSkipped', `${unit.name} declines to strike.`, { unitId: unit.id }));
        }

        if (options && options.autoAdvance === false) return { state, events, ok: true };
        const forced = runForcedTransitions(state);
        return { state: forced.state, events: [...events, ...forced.events], ok: true };
    }

    function getLegalActions(state, requestedActorId) {
        if (!state || state.winner) return [];
        let actorId = requestedActorId;
        if (!PLAYER_IDS.includes(actorId)) {
            actorId = expectedActors(state)[0] || null;
        }
        if (!actorId || !expectedActors(state).includes(actorId)) return [];
        const base = { actorId, expectedRevision: state.revision };

        if (state.phase === 'draft') {
            if (state.draft.step === 'chooseUnit') {
                const nextTerrainType = state.draft.terrainDeck[0] || null;
                return state.units.filter(unit => !unit.ownerId && state.draft.poolIds.includes(unit.id))
                    .map(unit => ({ ...base, type: 'draft.chooseUnit', unitId: unit.id, nextTerrainType, label: `Choose ${unit.name}` }));
            }
            if (state.draft.step === 'placeTerrain') {
                return [{
                    ...base,
                    type: 'draft.placeTerrain',
                    unitId: state.draft.selectedUnitId,
                    terrainType: state.draft.pendingTerrainType,
                    size: draftTerrainSize(state),
                    label: `Place ${state.draft.pendingTerrainType}`
                }];
            }
            if (state.draft.step === 'deployUnit') {
                return [{
                    ...base,
                    type: 'draft.deployUnit',
                    unitId: state.draft.selectedUnitId,
                    zone: actorId === 'p1'
                        ? { minY: state.board.height - state.board.deploymentDepth, maxY: state.board.height }
                        : { minY: 0, maxY: state.board.deploymentDepth },
                    label: 'Deploy unit'
                }];
            }
            return [];
        }

        if (state.phase === 'bid') {
            if (state.round.bidStage !== 'commit' || state.round.bidSubmitted[actorId]) return [];
            return [{
                ...base,
                type: 'bid.submit',
                min: 1,
                max: aliveUnits(state, actorId).length,
                label: 'Lock bid'
            }];
        }

        if (state.phase !== 'command') return [];
        if (!state.activation) {
            const actions = eligibleCommandUnits(state, actorId).map(unit => ({
                ...base,
                type: 'activation.selectUnit',
                unitId: unit.id,
                label: `Activate ${unit.name}`
            }));
            if (state.round.window === 'masterOpening' && actorId === state.round.masterId) {
                actions.push({ ...base, type: 'command.yield', label: 'Yield command window' });
            }
            return actions;
        }

        const unit = unitById(state, state.activation.unitId);
        if (!unit || unit.ownerId !== actorId) return [];
        const actions = [];
        if (canPivotNow(state, unit)) {
            actions.push({
                ...base,
                type: 'activation.pivot',
                unitId: unit.id,
                minDegrees: -90,
                maxDegrees: 90,
                label: 'Pivot unit'
            });
        }
        if (state.activation.stage === 'prePivots') {
            const mayMove = !(unit.profile.drill === 0 && state.activation.pivotsUsed > 0)
                && (isMasterUnit(state, unit) || !touchesEnemyFront(state, unit));
            if (mayMove) {
                actions.push({ ...base, type: 'activation.move', unitId: unit.id, direction: 'forward', maxDistance: unit.profile.speed, label: 'Move forward' });
                actions.push({ ...base, type: 'activation.move', unitId: unit.id, direction: 'backward', maxDistance: unit.profile.speed / 2, label: 'Move backward' });
            }
            getLegalShootTargets(state, unit).forEach(target => {
                actions.push({ ...base, type: 'activation.shoot', unitId: unit.id, targetId: target.id, label: `Shoot ${target.name}` });
            });
            actions.push({ ...base, type: 'activation.pass', unitId: unit.id, label: 'Hold position' });
        } else if (state.activation.stage === 'postPivots') {
            actions.push({ ...base, type: 'activation.endPivots', unitId: unit.id, label: 'Finish activation' });
        } else if (state.activation.stage === 'strike') {
            getStrikeTargets(state, unit).forEach(target => {
                actions.push({ ...base, type: 'activation.strike', unitId: unit.id, targetId: target.id, label: `Strike ${target.name}` });
            });
            actions.push({ ...base, type: 'activation.skipStrike', unitId: unit.id, label: 'Skip strike' });
        }
        return actions;
    }

    function getPrompt(state, viewerId) {
        if (!state) return { message: 'No game is loaded.', details: '' };
        if (state.winner) {
            return {
                actorId: null,
                phase: 'gameOver',
                message: `${state.winner === 'p1' ? 'Player 1' : 'Player 2'} wins the battle.`,
                details: 'Start a new rules game to play again.'
            };
        }
        if (state.phase === 'draft') {
            const actorId = state.draft.currentPlayerId;
            const mine = !viewerId || viewerId === actorId;
            const unit = unitById(state, state.draft.selectedUnitId);
            const visibleTerrainType = state.draft.terrainDeck[0] || null;
            const visibleTerrainLabel = visibleTerrainType === 'x'
                ? 'open ground'
                : visibleTerrainType
                    ? `${visibleTerrainType} terrain`
                    : 'the terrain tile';
            const prompts = {
                chooseUnit: `Choose one highlighted unit from the draft pool. The visible top tile is ${visibleTerrainLabel}.`,
                drawTerrain: 'Taking the visible top terrain tile…',
                discardTerrain: 'Open ground has no feature and will be discarded…',
                placeTerrain: `Place the selected ${state.draft.pendingTerrainType || 'terrain'} so it touches or overlaps ${unit ? unit.name : 'the chosen unit'}.`,
                deployUnit: `Drag ${unit ? unit.name : 'the chosen unit'} wholly into your deployment zone.`,
                finishTurn: 'Finishing the draft turn…'
            };
            return {
                actorId,
                phase: 'draft',
                message: mine ? prompts[state.draft.step] : `${actorId === 'p1' ? 'Player 1' : 'Player 2'} is drafting.`,
                details: state.draft.step === 'placeTerrain'
                    ? 'It may overlap the chosen undeployed unit, but not deployed units or another terrain tile.'
                    : 'Legal pieces and the active deployment zone are highlighted.'
            };
        }
        if (state.phase === 'bid') {
            if (state.round.bidStage !== 'commit') return { actorId: null, phase: 'bid', message: 'Revealing bids and assigning commands…', details: 'Automatic results appear in the battle log.' };
            const submitted = viewerId && state.round.bidSubmitted[viewerId];
            const actorId = viewerId && !submitted ? viewerId : (PLAYER_IDS.find(id => !state.round.bidSubmitted[id]) || null);
            return {
                actorId,
                phase: 'bid',
                message: submitted ? 'Your bid is locked. Waiting for the other player.' : 'Secretly choose and lock your command bid.',
                details: `Bid from 1 to the number of your surviving units. Lower controls timing; higher grants more commands.`
            };
        }
        if (state.phase === 'command') {
            const actorId = state.round.activePlayerId;
            if (state.activation) {
                const unit = unitById(state, state.activation.unitId);
                const prompts = {
                    prePivots: `${unit.name}: pivot if desired, then move, shoot a highlighted target, or hold.`,
                    postPivots: `${unit.name}: use any remaining pivots, then finish the activation.`,
                    strike: `${unit.name}: strike a highlighted touching enemy, or skip the strike.`,
                    complete: `${unit.name}'s activation is completing…`
                };
                return { actorId, phase: 'activation', message: prompts[state.activation.stage], details: 'The engine enforces distance, facing, contact, terrain, and target restrictions.' };
            }
            const opening = state.round.window === 'masterOpening';
            return {
                actorId,
                phase: state.round.window,
                message: `${actorId === 'p1' ? 'Player 1' : 'Player 2'}: choose a highlighted unit to activate${opening ? ', or yield' : ''}.`,
                details: `${state.round.commands[actorId] || 0} command ${(state.round.commands[actorId] || 0) === 1 ? 'marker' : 'markers'} remaining.`
            };
        }
        return { actorId: null, message: 'Resolving the next required step…', details: '' };
    }

    function projectState(stateInput, viewerId) {
        const state = clone(stateInput);
        state.projection = { viewerId: viewerId || null, authoritative: false };
        state.rng = { counter: state.rng.counter, state: null };
        if (state.phase === 'bid' && state.round.bidStage === 'commit' && PLAYER_IDS.includes(viewerId)) {
            const other = oppositePlayer(viewerId);
            state.round.bids[other] = null;
        }
        if (state.draft && !state.draft.complete) {
            state.draft.terrainDeckCount = state.draft.terrainDeck.length;
            state.draft.terrainDeck = state.draft.terrainDeck.map((terrainType, index) => index === 0 ? terrainType : null);
        }
        state.eventLog = state.eventLog.map(event => {
            const type = String(event.type || '').toLowerCase();
            if (!type.includes('bid') || type.includes('reveal')) return event;
            return {
                seq: event.seq,
                revision: event.revision,
                type: event.type,
                actorId: event.actorId,
                message: `${event.actorId === 'p2' ? 'Player 2' : 'Player 1'} locked a secret bid.`
            };
        });
        return state;
    }

    function assertInvariants(state) {
        const issues = [];
        if (!state || state.schema !== SCHEMA) issues.push('Invalid schema.');
        if (!state || state.schemaVersion !== SCHEMA_VERSION) issues.push('Unsupported schema version.');
        if (state && new Set(state.units.map(unit => unit.id)).size !== state.units.length) issues.push('Unit IDs must be unique.');
        if (state && new Set(state.terrain.map(item => item.id)).size !== state.terrain.length) issues.push('Terrain IDs must be unique.');
        if (state) {
            state.units.forEach(unit => {
                if (unit.ownerId && !PLAYER_IDS.includes(unit.ownerId)) issues.push(`Invalid owner for ${unit.id}.`);
                if (unit.wounds < 0) issues.push(`Negative wounds on ${unit.id}.`);
                if (unit.status === 'alive' && unit.wounds >= MAX_WOUNDS) issues.push(`${unit.id} should be destroyed.`);
                try {
                    validateUnitDefinition({ name: unit.name, stats: unit.stats || (unit.profile && unit.profile.raw) }, 0);
                } catch (err) {
                    issues.push(err.message);
                }
            });
            if (state.activation && !unitById(state, state.activation.unitId)) issues.push('Activation references a missing unit.');
        }
        if (issues.length) {
            const error = new Error(issues.join(' '));
            error.issues = issues;
            throw error;
        }
        return true;
    }

    return Object.freeze({
        SCHEMA,
        SCHEMA_VERSION,
        MAX_WOUNDS,
        DEFAULT_RULES: clone(DEFAULT_RULES),
        TERRAIN_TRAITS: clone(TERRAIN_TRAITS),
        createGame,
        createScenario,
        getLegalActions,
        getPrompt,
        validateAction,
        applyAction,
        advanceForced,
        runForcedTransitions,
        projectState,
        assertInvariants,
        geometry: Object.freeze({
            axesForAngle,
            rectangleCorners,
            polygonsOverlap,
            polygonDistance,
            rectanglesOverlap,
            rectanglesTouch,
            sweptRectanglesOverlap,
            poseInsideBounds
        }),
        selectors: Object.freeze({
            aliveUnits,
            unitById,
            terrainById,
            getLegalShootTargets,
            getStrikeTargets,
            unitHeight,
            compareUnitHeight,
            touchesEnemyFront,
            outflankingCount
        })
    });
}));
