/*
 * Game client: connects the headless rules engine (engine.js) to the tabletop renderer (app.js).
 * The engine state is the single source of truth; the board DOM is redrawn from it after every action.
 * Players act directly on the board: drag a unit to move, drag the ↻ handle behind a selected unit to pivot, click an enemy to attack.
 */
const GuidedPlay = (() => {
    const E = SeizeEngine, PX = E.PX;
    let game = null, darkPlayer = null, message = '', privateBids = {}, revealSent = false;
    let chargeFacesShown = 0;
    let pendingTarget = null, shownSeq = null, dragCtx = null, rotCtx = null, tokenSig = '', deckSig = '';
    let aiPlayer = null, aiLevel = 'normal', aiRun = 0, aiBusy = false, aiWorker = null, aiNote = '';
    // A game in progress keeps the rules it was created with (they live in its state).
    const RULES_KEY = 'seize-the-day-rules';
    const rulesDescriptions = {
        classic: 'Rally to remove strain. Pivot before or after an action.',
        reform: 'Pivot during a Move. Spend an action to Reform and change facing.',
        'reform-variant': 'Any pivot prevents a charge. Units with a Move asterisk can pass through friendly units if they can clear them.',
        v3: 'Reform, plus Rally (remove one strain, even in contact). Pivot before moving and still charge. Pivots can turn through units, terrain and the edge but must end clear. Shoot if a clear line reaches the centre of a target edge facing the shooter. No dice modifiers; strike only enemies at your front; hills slow units entering them; units with 5+ strain can’t attack.',
        v4: 'V3 without Reform, Rally, the 5-strain limit or hill slowing. No bonus dice for 6s; a Pace asterisk does nothing. Pivoting doesn’t stop a charge, but a unit with no part behind the target’s front line can only charge its front. Strike any touching enemy, but a unit is Shaken, and can’t strike, while an enemy’s front touches its flank (unless that enemy is Shaken itself).'
    };
    let rulesChoice = (() => { try { return E.normalizeRules(localStorage.getItem(RULES_KEY)); } catch (e) { return 'classic'; } })();
    function setRules(v) {
        rulesChoice = E.normalizeRules(v);
        try { localStorage.setItem(RULES_KEY, rulesChoice); } catch (e) { /* private mode */ }
        if (typeof document !== 'undefined' && document.querySelectorAll) document.querySelectorAll('[data-rules-choice]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rulesChoice === rulesChoice)));
        const description = typeof document !== 'undefined' && document.getElementById('rules-description');
        if (description) description.textContent = rulesDescriptions[rulesChoice];
    }
    const reformGame = () => game && E.reformRules(game);
    let aiAction = '', chosenOrder = null;
    const previewsByState = new WeakMap();
    let bidChoices = {};

    const other = E.other, label = E.label;
    const connected = () => Boolean(conn && conn.open);
    const onlineTable = () => connected() || (typeof sessionMode !== 'undefined' && sessionMode === 'online' && Boolean(currentRoomCode));
    const controls = p => p !== aiPlayer && (!onlineTable() || p === getLocalBidPlayerKey());
    const unitEls = () => [...table.querySelectorAll('.unit')].filter(u => !u.classList.contains('ghost'));
    const terrainEls = () => [...table.querySelectorAll('.terrain')].filter(t => !t.classList.contains('ghost'));
    const findEl = id => unitEls().find(u => u.dataset.unitId === id);
    const unit = id => game && game.units.find(u => u.id === id);
    const army = p => game.units.filter(u => u.owner === p);
    const who = p => (aiPlayer ? (p === aiPlayer ? 'Enemy' : 'You') : onlineTable() ? (p === getLocalBidPlayerKey() ? 'You' : 'Opponent') : label(p));

    // ---------- state lifecycle ----------
    function fromDOM() {
        const units = unitEls().map(el => ({
            id: el.dataset.unitId, name: el.dataset.name, owner: el.dataset.owner || (hasBattleStarted() ? getAssignedPlayer(el) : null),
            x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height),
            angle: parseFloat(el.dataset.angle) || 0, strain: Number(el.dataset.wounds) || 0, stats: getUnitStats(el).stats || {}
        }));
        const terrain = terrainEls().map(el => ({ id: getPieceId(el), type: el.dataset.subType, x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width) }));
        const s = E.createGame({ units, terrain, terrainDeck, firstPick: biddingState.firstDraftPick || 'p1', width: tableWidthPx, height: tableHeightPx, tileSize: terrainDiameterPx, rules: rulesChoice });
        if (s.phase === 'draft') {
            const done = { p1: army2(s, 'p1'), p2: army2(s, 'p2') };
            if (done.p1 !== done.p2) s.draft.picker = done.p1 > done.p2 ? 'p2' : 'p1';
        }
        return s;
    }
    const army2 = (s, p) => s.units.filter(u => u.owner === p).length;
    function ensure() {
        if (game) return game;
        const built = fromDOM();
        if (!built.units.length) return built;   // board not created yet; don't cache
        game = built; darkPlayer = darkPlayer || (Math.random() < 0.5 ? 'p1' : 'p2');
        if (shownSeq === null) shownSeq = game.seq;
        return game;
    }
    function reset() { aiRun += 1; aiBusy = false; aiAction = ''; chosenOrder = null; game = null; darkPlayer = null; privateBids = {}; bidChoices = {}; revealSent = false; message = ''; pendingTarget = null; shownSeq = 0; tokenSig = ''; deckSig = ''; }
    function snapshot() {
        const g = ensure();
        return JSON.parse(JSON.stringify({ version: 2, game: g, darkPlayer, ai: aiPlayer, aiLevel, stage: g.phase === 'draft' ? g.draft.step : g.phase, drafting: g.phase === 'draft' }));
    }
    function restore(saved, pieces) {
        bidChoices = {};
        chosenOrder = null; aiAction = '';
        if (saved && saved.version === 2 && saved.game) {
            game = saved.game; darkPlayer = saved.darkPlayer || darkPlayer;
            // Early saves stored the deployment preview on the board pieces.
            const d = game.draft;
            if (d?.step === 'deploy' && !Object.hasOwn(d, 'position')) {
                d.position = null;
                const piece = pieces?.find(p => p.unitId === d.picked);
                if (piece) {
                    const pos = { x: piece.x, y: piece.y, angle: Number(piece.angle) || 0 };
                    if (!E.deployError(game, unit(d.picked), pos)) d.position = pos;
                }
                const tile = game.terrain[game.terrain.length - 1];
                if (tile && game.log[0] === `${label(d.picker)} placed ${tile.type} terrain.`) d.terrainId = tile.id;
            }
            aiPlayer = saved.ai || null; aiLevel = saved.aiLevel || aiLevel; aiRun += 1; aiBusy = false;
            if (shownSeq === null || game.seq < shownSeq) shownSeq = game.seq;
        } else game = null;
        if (!game || game.phase !== 'bidding') { privateBids = {}; revealSent = false; }
        pendingTarget = null; message = '';
    }

    // ---------- applying actions ----------
    function note(text) { message = text; render(); return false; }
    function canUndo() {
        if (game?.phase === 'draft') return Boolean(undoStack.length && controls(game.draft.picker));
        return Boolean(undoStack.length && (!onlineTable()
            || (connected() && game?.phase === 'command' && controls(E.activePlayer(game)))));
    }
    /** Run engine actions in order; on any failure nothing changes and the reason is shown. */
    function act(actions, options = {}) {
        ensure();
        try {
            const steps = [].concat(actions);
            let next = game;
            for (const a of steps) {
                const review = !options.opponent && (a.type === 'move' || a.type === 'pivot'
                    || (a.type === 'endActivation' && options.reviewHandoff));
                next = E.apply(next, a, { reviewRoundEnd: review, reviewTurnEnd: review });
            }
            const drafting = game.phase === 'draft';
            const committed = next.phase !== game.phase || next.rng !== game.rng || options.opponent
                || (drafting && next.draft?.picker !== game.draft.picker)
                || (onlineTable() && next.turnStep !== game.turnStep);
            const reviewingLastOrder = (next.awaitingRoundEnd || next.awaitingTurnEnd) && steps.length === 1 && steps[0].type === 'endActivation';
            if (committed) undoStack.length = 0;
            else if (steps.length && !reviewingLastOrder && (drafting || !onlineTable() || (connected() && game.phase === 'command'))) pushUndo();
            game = next; message = ''; pendingTarget = null; chosenOrder = null;
            if (steps[0]?.type === 'autoDraft') {
                aiRun += 1;
                aiBusy = false;
                aiAction = '';
                aiWorker?.terminate();
                aiWorker = null;
                clearPieceSelection();
            }
            saveGame();
            return true;
        } catch (e) { note(e.message); return false; }
    }
    function previewFor(id) {
        let byUnit = previewsByState.get(game);
        if (!byUnit) previewsByState.set(game, byUnit = new Map());
        if (!byUnit.has(id)) byUnit.set(id, {});
        return byUnit.get(id);
    }
    /** The unit the acting player is working with: the activated one, else a selected unit of theirs. */
    function currentUnitId() {
        if (!game || game.phase !== 'command') return null;
        if (selectedPiece && selectedPiece.classList.contains('unit')) {
            const u = unit(selectedPiece.dataset.unitId);
            if (u && u.owner === E.activePlayer(game) && (!u.activated || game.activation?.unitId === u.id)) return u.id;
        }
        return game.activation ? game.activation.unitId : null;
    }
    /** Engine state as it would be if `id` were the unit being commanded (ends another unit's activation first). */
    function stateFor(id) {
        let s = game;
        if (s.activation && s.activation.unitId !== id) { try { s = E.apply(s, { type: 'endActivation' }); } catch (e) { return s; } }
        return s;
    }
    const optionsFor = id => previewFor(id).options ??= E.unitOptions(stateFor(id), id);
    function unitAction(id, action, options) {
        const p = E.activePlayer(game);
        if (!controls(p)) return note('Wait for your opponent.');
        const steps = [];
        if (game.activation && game.activation.unitId !== id) steps.push({ type: 'endActivation' });
        if (!game.activation || game.activation.unitId !== id) steps.push({ type: 'activate', unitId: id });
        steps.push(action);
        return act(steps, options);
    }

    // ---------- draft ----------
    const myDraftKey = () => (aiPlayer ? other(aiPlayer) : onlineTable() ? getLocalBidPlayerKey() : game.draft.picker);
    function canAutoDraft(g) {
        return g?.phase === 'draft' && (!onlineTable() || controls(g.draft.picker));
    }
    function autoDraft() {
        if (!canAutoDraft(game) || (typeof activePointerId !== 'undefined' && activePointerId !== null)) return;
        act({ type: 'autoDraft' });
    }
    function terrainAllowed() {
        const g = ensure();
        return g.phase === 'draft' && g.draft.step === 'terrain' && controls(g.draft.picker);
    }
    function terrainDropError({ x, y }) {
        if (!terrainAllowed()) return 'There is no terrain tile to place now.';
        return E.terrainPlacementError(game, E.tileAt(game, x, y), unit(game.draft.picked));
    }
    const deploymentAngle = () => game.draft.position?.angle ?? (game.draft.picker === 'p1' ? 0 : 180);
    const piecePose = el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), angle: Number(el.dataset.angle) || 0 });
    function positionUnit(pose) {
        const previous = game.draft.position;
        if (previous && previous.x === pose.x && previous.y === pose.y && previous.angle === pose.angle) return render();
        act({ type: 'positionDeployment', player: myDraftKey(), ...pose });
    }
    function positionForDeployment(point) {
        if (!game || game.phase !== 'draft' || game.draft.step !== 'deploy' || !controls(game.draft.picker)) return false;
        const u = unit(game.draft.picked);
        positionUnit({ x: point.x - u.w / 2, y: point.y - u.h / 2, angle: deploymentAngle() });
        return true;
    }
    function deploy() {
        if (game?.draft?.position && controls(game.draft.picker)) {
            act({ type: 'deploy', player: myDraftKey(), ...game.draft.position });
        }
    }

    // ---------- bidding ----------
    function bid(p, value) {
        ensure();
        const n = Number(value), max = army(p).length;
        if (onlineTable() && !connected()) return note('Connect your opponent before locking a bid.');
        if (game.phase !== 'bidding' || !controls(p) || biddingState[p].ready) return note('You can’t set that bid now.');
        if (!Number.isInteger(n) || n < 1 || n > max) return note(`Bid a whole number from 1 to ${max}.`);
        privateBids[p] = n; biddingState[p] = { value: n, ready: true }; message = '';
        if (connected()) sendData({ type: 'GUIDED_BID_READY', player: p, round: game.round });
        if (biddingState.p1.ready && biddingState.p2.ready) return reveal();
        saveGame(true);
    }
    function reveal() {
        if (game.phase !== 'bidding' || !biddingState.p1.ready || !biddingState.p2.ready) return note('Both players must bid first.');
        if (connected()) {
            const p = getLocalBidPlayerKey(); revealSent = true;
            sendData({ type: 'GUIDED_BID_REVEAL', player: p, value: privateBids[p] ?? biddingState[p].value, round: game.round });
            render();
        } else beginRound({ p1: privateBids.p1 ?? biddingState.p1.value, p2: privateBids.p2 ?? biddingState.p2.value });
    }
    function beginRound(bids, suppressBroadcast = false) {
        try {
            let next = E.apply(game, { type: 'bid', player: 'p1', value: bids.p1 });
            next = E.apply(next, { type: 'bid', player: 'p2', value: bids.p2 });
            undoStack.length = 0;
            game = next; privateBids = {}; bidChoices = {}; revealSent = false; message = '';
            for (const p of ['p1', 'p2']) biddingState[p] = { value: bids[p], ready: true };
            saveGame(suppressBroadcast);
        } catch (e) { note(e.message); }
    }
    function incoming(data) {
        ensure();
        if (data.type === 'GUIDED_BID_READY') {
            if (game.phase === 'bidding' && data.player === getOpponentPlayerKey() && data.round === game.round) {
                biddingState[data.player].ready = true;
                if (biddingState[getLocalBidPlayerKey()].ready && !revealSent) reveal(); else render();
            }
            return true;
        }
        if (data.type === 'GUIDED_BID_REVEAL') {
            const me = getLocalBidPlayerKey();
            if (game.phase !== 'bidding' || data.player !== getOpponentPlayerKey() || data.round !== game.round || !biddingState[me].ready) return true;
            const own = privateBids[me] ?? biddingState[me].value;
            if (!revealSent) { revealSent = true; sendData({ type: 'GUIDED_BID_REVEAL', player: me, value: own, round: game.round }); }
            beginRound({ [me]: own, [data.player]: data.value }, true);
            return true;
        }
        // Everything else about the position travels in committed board snapshots.
        return ['PIECE_DRAG_START', 'PIECE_DRAG_MOVE', 'PIECE_DRAG_END', 'PIECE_ROTATE_START', 'PIECE_ROTATE', 'PIECE_ROTATE_END', 'PASS_TURN', 'ROUND_RESET', 'BID_READY', 'REVEAL_BIDS'].includes(data.type);
    }

    // ---------- AI opponent ----------
    function aiToMove() {
        if (!aiPlayer || !game || connected() || document.getElementById('container').style.display === 'none') return false;
        if (game.phase === 'draft') return game.draft.picker === aiPlayer;
        if (game.phase === 'bidding') return !biddingState[aiPlayer].ready;
        return game.phase === 'command' && E.activePlayer(game) === aiPlayer;
    }
    function askAI(state) {
        const request = { state: E.observe(state, aiPlayer), player: aiPlayer, options: { level: aiLevel } };
        return new Promise(resolve => {
            const local = () => resolve(SeizeAI.choose(request.state, request.player, request.options));
            try {
                if (!aiWorker) aiWorker = new Worker('ai-worker.js');
                aiWorker.onmessage = e => resolve(e.data);
                aiWorker.onerror = () => { aiWorker = null; local(); };
                aiWorker.postMessage(request);
            } catch (e) { aiWorker = null; local(); }
        });
    }
    const pause = ms => new Promise(r => setTimeout(r, ms));
    async function runAI() {
        if (aiBusy || !aiToMove()) return;
        aiBusy = true; aiAction = ''; render(); const run = aiRun;
        try {
            await pause(game.phase === 'command' ? 250 : 150);
            if (run !== aiRun || !aiToMove()) return;
            const choice = await askAI(game);
            if (run !== aiRun || !aiToMove()) return;
            aiNote = choice.note || '';
            for (const a of choice.actions) {
                if (run !== aiRun || game.phase === 'finished') break;
                if (a.type === 'bid') { privateBids[aiPlayer] = a.value; biddingState[aiPlayer] = { value: a.value, ready: true }; if (biddingState[other(aiPlayer)].ready) reveal(); else saveGame(true); break; }
                if (a.type === 'endActivation' && !game.activation) continue;
                aiAction = BattleUX.actionText(game, a); render();
                await pause(a.type === 'activate' ? 200 : 150);
                if (run !== aiRun) break;
                const movesPiece = ['move', 'pivot', 'deploy'].includes(a.type);
                const piece = movesPiece ? findEl(a.unitId || game.activation?.unitId || game.draft?.picked) : null;
                if (!act(a, { opponent: true })) break;
                if (movesPiece) await piece?.fieldMotion?.finished;
                await pause(movesPiece ? 150 : a.type === 'shoot' || a.type === 'strike' ? 1000 : 400);
            }
        } finally { if (run === aiRun) { aiBusy = false; aiAction = ''; render(); } }
    }
    function setAI(player, level) { aiPlayer = player || null; aiAction = ''; if (level) aiLevel = level; aiRun += 1; aiBusy = false; if (game) saveGame(true); }

    // ---------- command phase: buttons ----------
    function pass() {
        ensure();
        if (game.phase !== 'command') return note('There is no turn to pass right now.');
        const p = E.activePlayer(game);
        if (!controls(p)) return note('Wait for your opponent.');
        act([...(game.activation ? [{ type: 'endActivation' }] : []), { type: 'pass', player: p }].filter((a, i, all) => {
            // Ending the activation may already hand the turn over; only pass if it is still this player's turn.
            if (a.type !== 'pass' || all.length === 1) return true;
            try { const s = E.apply(game, { type: 'endActivation' }); return s.phase === 'command' && E.activePlayer(s) === p && s.turnStep === game.turnStep; } catch (e) { return false; }
        }));
    }
    function endActivation() {
        if (controls(E.activePlayer(game))) act({ type: 'endActivation' }, { reviewHandoff: canUndo() });
    }
    function attack(targetId) {
        const id = currentUnitId(); if (!id) return;
        const o = optionsFor(id), kind = o.strike?.some(t => t.id === targetId) ? 'strike' : 'shoot';
        unitAction(id, { type: kind, targetId });
    }
    function rally() { const id = currentUnitId(); if (id) unitAction(id, { type: 'rally' }); }
    const availableTurn = limit => Boolean(limit?.remaining > 0 && (limit.left || limit.right));
    const orderFor = id => chosenOrder?.id === id ? chosenOrder.type : null;
    function attackChoices(options, order) {
        if (!order) return [...options.strike, ...options.shoot];
        return order === 'strike' ? options.strike : order === 'shoot' ? options.shoot : [];
    }
    function chooseOrder(id, type) {
        if (selectedPiece?.dataset.unitId !== id) selectPiece(findEl(id), true);
        chosenOrder = orderFor(id) === type ? null : { id, type };
        pendingTarget = null; message = ''; render();
        if (chosenOrder) (table.querySelector('.gp-target') || table).focus?.({ preventScroll: true });
    }

    // ---------- board interaction hooks (called from app.js) ----------
    function isDeployPiece(el) { return game?.phase === 'draft' && game.draft.step === 'deploy' && controls(game.draft.picker) && el?.dataset.unitId === game.draft.picked; }
    function adjustableTerrainId() {
        const d = game?.draft;
        return d?.step === 'deploy' && !d.position && controls(d.picker) ? d.terrainId : undefined;
    }
    function isDeployTerrain(el) {
        const id = adjustableTerrainId();
        return Boolean(id && el?.dataset.pieceId === id);
    }
    function canDrag(el, kind = 'move') {
        ensure(); dragCtx = null; rotCtx = null;
        if (isDeployPiece(el)) return kind === 'move' || Boolean(game.draft.position);
        if (isDeployTerrain(el)) return kind === 'move';
        if (game.phase !== 'command' || !el?.classList.contains('unit')) return game.phase === 'draft' ? false : note('Nothing to move right now.');
        const u = unit(el.dataset.unitId), p = E.activePlayer(game);
        if (!u || u.owner !== p) return false;
        if (!controls(p)) return note('Wait for your opponent.');
        const o = optionsFor(u.id);
        if (!o.canAct) return note(o.reason);
        if (kind === 'rotate') {
            const order = orderFor(u.id);
            const canPivot = order !== 'reform' && availableTurn(o.pivot);
            const rf = order !== 'pivot' && order !== 'move' && availableTurn(o.reform) ? o.reform : null;
            if (!canPivot && !rf) {
                const limit = order === 'reform' ? o.reform : o.pivot;
                note(limit?.reason || 'This unit can’t turn now.');
                const blocker = limit?.leftBlocker || limit?.rightBlocker;
                if (blocker) drawObstruction(liveOverlay('gp-obstruction'), blocker, u);
                return false;
            }
            // A direct corner drag can Reform beyond the ordinary pivot limit. The Reform order also allows a smaller turn.
            rotCtx = { id: u.id, start: u.angle, activation: o.activation, pivotLeft: canPivot ? o.pivot.left : 0, pivotRight: canPivot ? o.pivot.right : 0,
                left: rf ? Math.max(rf.left, canPivot ? o.pivot.left : 0) : o.pivot.left, right: rf ? Math.max(rf.right, canPivot ? o.pivot.right : 0) : o.pivot.right,
                usesAction: o.pivot.usesAction, startsMove: reformGame() && !o.activation.action, reform: Boolean(rf),
                pivotLimit: canPivot ? o.pivot : null, reformLimit: rf,
                leftBlocker: rf && rf.left >= o.pivot.left ? rf.leftBlocker : o.pivot.leftBlocker,
                rightBlocker: rf && rf.right >= o.pivot.right ? rf.rightBlocker : o.pivot.rightBlocker };
            return true;
        }
        if (!o.forward.charge && o.forward.max <= 0.01 && o.backward.max <= 0.01) {
            const limit = o.forward.blocker ? o.forward : o.backward;
            note(moveStopText(limit));
            drawObstruction(liveOverlay('gp-obstruction'), limit.blocker, u);
            return false;
        }
        dragCtx = { id: u.id, x: u.x, y: u.y, f: E.geometry.forwardOf(u), fwd: o.forward, back: o.backward, d: 0 };
        return true;
    }
    function constrainDrag(el, left, top) {
        if (!dragCtx || el.dataset.unitId !== dragCtx.id) return { left, top };
        const c = dragCtx, snap = 5;
        const requested = (left - c.x) * c.f.x + (top - c.y) * c.f.y;
        const limit = requested < 0 ? c.back : c.fwd;
        let d = requested;
        d = Math.max(-c.back.max * PX, Math.min(c.fwd.max * PX, d));
        if (d > 0 && c.fwd.max * PX - d < snap) d = c.fwd.max * PX;
        if (d < 0 && c.back.max * PX + d < snap) d = -c.back.max * PX;
        const crossing = E.crossingAt(limit.crossings, Math.abs(d) / PX);
        if (crossing) d = Math.sign(d) * crossing.from * PX;
        const charging = Boolean(c.fwd.charge) && d > 0 && d >= c.fwd.max * PX - 1e-6;
        if (!charging && Math.abs(d) < 2) d = 0;
        c.d = d;
        const pose = { ...unit(c.id), x: c.x + c.f.x * d, y: c.y + c.f.y * d };
        showProjectedThreat(pose);
        const reachedBlocker = limit.blocker && Math.abs(requested) > 1 && Math.abs(d) >= limit.max * PX - 1e-6;
        const stopped = !charging && (crossing || reachedBlocker || Math.abs(requested) > limit.max * PX + 1);
        const obstruction = liveOverlay('gp-obstruction');
        obstruction.replaceChildren();
        if (stopped) drawObstruction(obstruction, crossing?.unit || limit.blocker, pose);
        const hint = crossing ? `Drag farther to clear ${crossing.unit.name}` : moveStopText(limit);
        showDragLabel(pose, stopped ? hint : '', stopped);
        return { left: pose.x, top: pose.y, charging };
    }
    function dropPiece(el, cancelled) {
        hideDragLabel();
        if (isDeployPiece(el) || isDeployTerrain(el)) {
            if (cancelled) render();
            else if (isDeployPiece(el)) positionUnit(piecePose(el));
            else {
                const tile = game.terrain.find(t => t.id === game.draft.terrainId);
                const { x, y } = piecePose(el);
                if (tile.x !== x || tile.y !== y) act({ type: 'repositionTerrain', player: myDraftKey(), x, y });
            }
            return true;
        }
        if (!dragCtx || el.dataset.unitId !== dragCtx.id) return false;
        const c = dragCtx; dragCtx = null;
        const inches = Math.abs(c.d) / PX, backwards = c.d < 0, lim = backwards ? c.back : c.fwd;
        const atLimit = inches >= lim.max - 1e-6;
        if (cancelled || !inches || (inches <= 0.01 && !(lim.charge && atLimit))) render();
        else unitAction(c.id, { type: 'move', inches: atLimit ? lim.max : inches, backwards });
        return true;
    }
    function constrainRotation(el, startAngle, nextAngle) {
        if (!rotCtx || el.dataset.unitId !== rotCtx.id) return nextAngle;
        const requested = nextAngle - startAngle;
        const delta = Math.max(-rotCtx.left, Math.min(rotCtx.right, requested));
        const asReform = rotCtx.reform && (delta < -rotCtx.pivotLeft || delta > rotCtx.pivotRight);
        const obstruction = liveOverlay('gp-obstruction');
        obstruction.replaceChildren();
        // V3: the card may turn through an obstacle but can't be left overlapping it.
        const overlap = E.pivotOverlap(asReform ? rotCtx.reformLimit : rotCtx.pivotLimit, delta);
        const blocker = overlap?.blocker || (Math.abs(requested - delta) > .25 && (requested < 0 ? rotCtx.leftBlocker : rotCtx.rightBlocker));
        const pose = unit(rotCtx.id), settled = overlap ? settleTurn(rotCtx, delta) : delta;
        const settledReform = rotCtx.reform && (settled < -rotCtx.pivotLeft || settled > rotCtx.pivotRight);
        const spendsAction = Math.abs(settled) >= 0.5 && (settledReform || rotCtx.usesAction);
        if (rotCtx.previewAngle !== settled) {
            rotCtx.previewAngle = settled;
            const lanes = liveOverlay('gp-command-movement');
            lanes.replaceChildren();
            if (spendsAction) {
                const turned = { ...pose, angle: pose.angle + settled };
                drawMovementLanes(lanes, turned, BattleUX.freshMovement(game, turned), 'gp-future-move');
            } else {
                const preview = E.movementAfterPivot(game, pose, rotCtx.activation, settled, { reform: settledReform, usesAction: rotCtx.usesAction });
                drawMovementLanes(lanes, preview.pose, preview);
            }
        }
        if (blocker) drawObstruction(obstruction, blocker, { ...pose, angle: startAngle + delta });
        if (E.v4Rules(game)) drawChargeFaces(liveOverlay('gp-charge-faces'), { ...pose, angle: startAngle + settled });
        // With pivots to spare, the turn may end overlapping: the next pivot must then finish clear.
        const passing = !overlap && E.v3Rules(game) && E.overlapAt(game, pose, startAngle + delta);
        const reason = overlap ? `Can’t stop overlapping ${obstacleName(blocker)}` : passing ? `Overlapping ${obstacleName(passing)}: pivot again to finish clear` : blocker ? `Stops at ${obstacleName(blocker)}`
            : spendsAction ? `${settledReform ? 'Reform' : 'Extra Pivot'} · movement next activation` : rotCtx.startsMove ? 'Starts a Move' : '';
        showDragLabel(pose, reason, Boolean(blocker));
        return startAngle + delta;
    }
    function dropRotation(el, cancelled) {
        hideDragLabel();
        if (isDeployPiece(el)) {
            if (cancelled) render();
            else positionUnit(piecePose(el));
            return true;
        }
        if (!rotCtx || el.dataset.unitId !== rotCtx.id) return false;
        const c = rotCtx; rotCtx = null;
        const delta = settleTurn(c, (parseFloat(el.dataset.angle) || 0) - c.start), asReform = c.reform && (delta < -c.pivotLeft || delta > c.pivotRight);
        if (cancelled || Math.abs(delta) < 0.5) render();
        else unitAction(c.id, { type: 'pivot', degrees: Math.round(delta * 100) / 100, ...(asReform ? { reform: true } : {}) });
        return true;
    }
    /** The nearest turn the unit may stop at (V3 can pass through, but not end on, an overlap). */
    function settleTurn(c, delta) {
        const asReform = c.reform && (delta < -c.pivotLeft || delta > c.pivotRight), limit = asReform ? c.reformLimit : c.pivotLimit;
        return limit && E.pivotOverlap(limit, delta) ? E.nearestPivot(limit, delta) : delta;
    }
    function rotate(el, delta) {
        ensure();
        if (isDeployPiece(el) && game.draft.position) {
            positionUnit({ ...game.draft.position, angle: deploymentAngle() + delta });
            return;
        }
        if (game.phase === 'command') note('Drag the ↻ handle behind the unit to turn it.');
    }
    /** A click on a piece. Returns true when the click was an order rather than a selection. */
    function tap(el) {
        ensure();
        if (game.phase === 'draft' && game.draft.step === 'pick' && controls(game.draft.picker)
            && el.classList.contains('unit') && !unit(el.dataset.unitId)?.owner) {
            if (act({ type: 'pick', player: myDraftKey(), unitId: el.dataset.unitId })) selectPiece(el);
            return true;
        }
        if (game.phase !== 'command' || !el.classList.contains('unit')) return false;
        const id = currentUnitId(), target = unit(el.dataset.unitId);
        if (!id || !target || target.owner === E.activePlayer(game) || !controls(E.activePlayer(game))) { pendingTarget = null; return false; }
        const o = optionsFor(id);
        if (!o.canAct) return false;
        const choice = attackChoices(o, orderFor(id)).find(t => t.id === target.id);
        if (!choice) return false;
        if (!choice.ok) {
            pendingTarget = null; note(`Can’t shoot ${target.name}. ${choice.reason}`);
            drawShotWarning(liveOverlay('gp-obstruction'), unit(id), target, choice);
            return true;
        }
        if (pendingTarget === target.id) attack(target.id);
        else { pendingTarget = target.id; message = ''; render(); }
        return true;
    }

    // ---------- drawing ----------
    function setAngle(el, angle) { el.dataset.angle = angle; el.style.transform = `rotate(${angle}deg)`; }

    const visiblePose = el => el.fieldMotion?.pose || piecePose(el);

    // Only the computer's moves are animated; the player's own moves land at once.
    function pieceMotionDuration(distance, turn) {
        return Math.min(1600, Math.max(300, distance / PX * 150, Math.abs(turn) * 5));
    }

    // Inline coordinates are the authoritative destination for saving, hit testing and orders.
    // Only the painted position interpolates. A second order starts where the piece is visible.
    function movePieceTo(el, x, y, angle, { from, opponent = false } = {}) {
        const previous = piecePose(el);
        if (!from && previous.x === x && previous.y === y && previous.angle === angle) return;
        from ??= visiblePose(el);
        el.fieldMotion?.finish();
        el.style.left = x + 'px'; el.style.top = y + 'px'; setAngle(el, angle);
        const distance = Math.hypot(x - from.x, y - from.y);
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const startAngle = reduced ? angle : from.angle;
        const turn = ((angle - startAngle) % 360 + 540) % 360 - 180;
        if (!Number.isFinite(distance) || (distance < .1 && Math.abs(turn) < .1) || !opponent) return;

        // Travel still conveys the opponent's order in reduced-motion mode. Use a short, unrotated slide there.
        const normalDuration = pieceMotionDuration(distance, turn);
        const duration = reduced ? Math.min(normalDuration, 800) : normalDuration;
        let frame, startTime, complete;
        const motion = { pose: from, finish, finished: new Promise(resolve => { complete = resolve; }) };
        function finish() {
            if (el.fieldMotion !== motion) return;
            cancelAnimationFrame(frame);
            el.fieldMotion = null;
            setAngle(el, angle);
            complete();
        }
        function paint(t) {
            const pose = { x: from.x + (x - from.x) * t, y: from.y + (y - from.y) * t, angle: startAngle + turn * t };
            motion.pose = pose;
            el.style.transform = `translate(${pose.x - x}px, ${pose.y - y}px) rotate(${pose.angle}deg)`;
        }
        function tick(time) {
            startTime ??= time;
            const t = (time - startTime) / duration;
            if (t >= 1 || el.isConnected === false) { finish(); return; }
            paint(t * t * (3 - 2 * t));
            frame = requestAnimationFrame(tick);
        }
        el.fieldMotion = motion;
        paint(0);
        frame = requestAnimationFrame(tick);
    }

    function syncBoard() {
        const g = game, deployingId = g.draft?.step === 'deploy' ? g.draft.picked : null;
        const choosingUnit = g.draft?.step === 'pick' && controls(g.draft.picker);
        for (const el of unitEls()) {
            const u = unit(el.dataset.unitId);
            if (!u) { if (selectedPiece === el) clearPieceSelection(); el.remove(); continue; }
            if (!el.classList.contains('is-dragging') && !el.classList.contains('is-rotating')) {
                const pos = u.id === deployingId ? g.draft.position || { x: u.x, y: u.y, angle: deploymentAngle() } : u;
                movePieceTo(el, pos.x, pos.y, pos.angle, { opponent: Boolean(aiPlayer && u.owner === aiPlayer) });
            }
            if (u.owner) el.dataset.owner = u.owner; else delete el.dataset.owner;
            el.dataset.wounds = u.strain;
            const marker = el.querySelector('.wound-marker');
            if (marker) { marker.textContent = u.strain; marker.style.display = u.strain ? 'flex' : 'none'; }
            el.classList.toggle('guided-active', g.activation?.unitId === u.id);
            el.classList.toggle('guided-used', Boolean(u.activated) && g.activation?.unitId !== u.id);
            const deploying = isDeployPiece(el);
            el.classList.toggle('guided-draft-option', Boolean(choosingUnit && !u.owner));
            el.classList.toggle('guided-picked', deploying);
            const pose = deploying && g.draft.position;
            el.classList.toggle('gp-deploy-rotate', Boolean(pose));
            if (pose) {
                const moved = { ...u, ...pose }, f = E.geometry.forwardOf(moved), c = E.geometry.centre(moved);
                const room = side => {
                    const offset = side * (u.h / 2 + 24);
                    const x = c.x + f.x * offset, y = c.y + f.y * offset;
                    return Math.min(x, y, g.width - x, g.height - y);
                };
                el.classList.toggle('gp-deploy-grip-back', room(1) < 22 && room(-1) > room(1));
            }
            if (g.phase === 'command' && u.owner) {
                // The pivot handle sits behind the unit, or in front when the rear is at the board edge.
                const grip = parseFloat(table.style.getPropertyValue?.('--deployment-grip-size')) || 34;
                const f = E.geometry.forwardOf(u), c = E.geometry.centre(u), back = u.h / 2 + grip * 1.5;
                const x = c.x - f.x * back, y = c.y - f.y * back;
                el.classList.toggle('gp-pivot-front', x < 0 || y < 0 || x > g.width || y > g.height);
            }
            el.classList.toggle('guided-ready', g.phase === 'command' && !g.activation && u.owner === E.activePlayer(g) && !u.activated && g.commands[u.owner] > 0 && controls(u.owner));
            el.dataset.armySkin = u.owner ? (u.owner === darkPlayer ? 'dark' : 'light') : 'undrafted';
            const screenFacing = Number(el.dataset.angle) + (typeof isHost !== 'undefined' && !isHost ? 180 : 0);
            el.classList.toggle('reverse-label', Math.cos(screenFacing * Math.PI / 180) < -.001);
        }
        const wanted = new Map(g.terrain.map(t => [t.id, t]));
        for (const el of terrainEls()) {
            const tile = wanted.get(el.dataset.pieceId);
            if (!tile) { el.remove(); continue; }
            wanted.delete(tile.id);
            if (!el.classList.contains('is-dragging')) {
                el.style.left = `${tile.x}px`;
                el.style.top = `${tile.y}px`;
            }
        }
        wanted.forEach(t => createTerrainDOM(t.type, t.x, t.y, t.w, t.w, 0, t.id));
        terrainEls().forEach(el => el.classList.toggle('gp-deploy-terrain', Boolean(isDeployTerrain(el))));
        const terrainGrip = document.getElementById('deployment-terrain-grip');
        const terrainId = adjustableTerrainId();
        const repositionable = terrainId && g.terrain.find(t => t.id === terrainId);
        terrainGrip.hidden = !repositionable;
        if (repositionable) {
            terrainGrip.style.left = `${repositionable.x + repositionable.w / 2}px`;
            terrainGrip.style.top = `${repositionable.y}px`;
        }

        // Mirror into the legacy globals the renderer still reads.
        const inBattle = g.phase !== 'draft';
        Object.assign(biddingState, { round: Math.max(1, g.round), revealed: g.phase === 'command' || g.phase === 'finished', battleStarted: inBattle,
            master: g.master, turnStep: g.turnStep, firstDraftPick: g.firstPick, firstRoundTieWinner: other(g.firstPick) });
        if (g.phase !== 'bidding') for (const p of ['p1', 'p2']) biddingState[p] = { value: g.bids[p] || 1, ready: false };
        const sig = JSON.stringify([g.phase, g.commands, g.units.filter(u => u.activated).map(u => u.id)]);
        if (sig !== tokenSig) {
            tokenSig = sig; commandTokens = [];
            if (g.phase === 'command') for (const p of ['p1', 'p2']) {
                for (let i = 0; i < g.commands[p]; i++) commandTokens.push({ id: `cmd-${p}-${i}`, player: p, num: i + 1, status: 'tray' });
                army(p).filter(u => u.activated).forEach((u, i) => commandTokens.push({ id: `cmd-${p}-u${i}`, player: p, num: i + 1, status: 'unit', unitId: u.id }));
            }
            renderAllCommandTokens();
        }
        const deck = JSON.stringify(g.terrainDeck);
        if (deck !== deckSig) { deckSig = deck; terrainDeck = [...g.terrainDeck]; renderTerrainCard(); }
        table.classList.toggle('is-deploying', !inBattle);
    }

    function overlay() {
        let svg = document.getElementById('gp-overlay');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'gp-overlay';
            svg.setAttribute('viewBox', `0 0 ${tableWidthPx} ${tableHeightPx}`); table.appendChild(svg);
        }
        return svg;
    }
    function drawPoly(svg, points, cls) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        el.setAttribute('points', points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')); el.setAttribute('class', cls); svg.appendChild(el); return el;
    }
    function liveOverlay(id, parent = overlay()) {
        let group = document.getElementById(id);
        if (!group) {
            group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.id = id;
            parent.appendChild(group);
        }
        return group;
    }
    function svgMark(group, tag, attrs) {
        const mark = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [name, value] of Object.entries(attrs)) mark.setAttribute(name, value);
        group.appendChild(mark);
    }
    const terrainName = { forest: 'forest', hills: 'hill', field: 'field', swamp: 'swamp', mountain: 'mountain' };
    const obstacleName = blocker => blocker === 'edge' ? 'the board edge' : blocker.name || terrainName[blocker.type];
    function moveStopText(limit) {
        if (limit.reason) return limit.reason;
        if (limit.stop === 'slow') return limit.blocker ? `Slowed by ${obstacleName(limit.blocker)}` : 'Slowing terrain limits this move';
        if (limit.blocker) return `Stops at ${obstacleName(limit.blocker)}`;
        return 'Movement limit';
    }
    function drawObstruction(group, blocker, pose) {
        if (!blocker) return;
        const G = E.geometry;
        if (blocker === 'edge') {
            const corners = G.rect(pose);
            const nearest = corners.flatMap(p => [
                { gap: p.x, x: 6, y: p.y }, { gap: game.width - p.x, x: game.width - 6, y: p.y },
                { gap: p.y, x: p.x, y: 6 }, { gap: game.height - p.y, x: p.x, y: game.height - 6 }
            ]).reduce((a, b) => a.gap <= b.gap ? a : b);
            svgMark(group, 'circle', { cx: nearest.x, cy: nearest.y, r: 11, class: 'gp-obstruction-mark' });
        } else {
            drawPoly(group, blocker.type ? G.disc(blocker) : G.rect(blocker), 'gp-obstruction-mark');
        }
    }
    function drawShotWarning(group, shooter, target, check, showLabel = true) {
        if (check.blocker) {
            const { origin } = E.firingArc(shooter), end = E.geometry.centre(check.blocker);
            svgMark(group, 'line', { x1: origin.x, y1: origin.y, x2: end.x, y2: end.y, class: 'gp-obstructed-sightline' });
            drawObstruction(group, check.blocker, shooter);
        }
        if (showLabel) {
            const c = E.geometry.centre(target);
            const label = boardLabel(c.x, target.y - 20, check.reason, 'gp-shot-warning', 118);
            label.id = 'gp-shot-warning';
        }
    }
    function boardLabel(x, y, text, cls, edgePadding = 40) {
        const el = document.createElement('div'); el.className = `gp-label ${cls || ''}`; el.textContent = text;
        el.style.left = `${Math.max(edgePadding, Math.min(tableWidthPx - edgePadding, x))}px`; el.style.top = `${Math.max(21, Math.min(tableHeightPx - 21, y))}px`;
        table.appendChild(el); return el;
    }
    function drawAttackPreview(target, { base, pool, mods, tn, tnNote }) {
        const label = document.createElement('div');
        label.className = 'gp-label gp-hot gp-attack-preview';
        const dice = count => `${count} ${count === 1 ? 'die' : 'dice'}`;
        const line = (tag, text) => { const el = document.createElement(tag); el.textContent = text; label.appendChild(el); };
        line('strong', `${dice(pool)} · Target ${tn}+`);
        if (mods.length) {
            line('div', `Base pool ${dice(base)}`);
            for (const { dice: change, label: reason } of mods) {
                line('div', `${change > 0 ? '+' : '−'}${Math.abs(change)} ${reason}`);
            }
            if (base + mods.reduce((sum, mod) => sum + mod.dice, 0) < pool) line('div', 'Minimum 1 die');
        }
        if (tnNote) line('div', tnNote);
        line('small', 'Click again to attack');
        table.appendChild(label);

        const { x, y } = E.geometry.centre(target);
        const halfUnitHeight = Math.max(...E.geometry.rect(target).map(p => Math.abs(p.y - y)));
        const halfWidth = label.offsetWidth / 2 + 6, halfHeight = label.offsetHeight / 2 + 6;
        const gap = halfUnitHeight + halfHeight + 4;
        const above = y + (table.classList.contains('is-flipped') ? gap : -gap);
        const below = 2 * y - above;
        const tipY = above >= halfHeight && above <= tableHeightPx - halfHeight ? above : below;
        label.style.left = `${Math.max(halfWidth, Math.min(tableWidthPx - halfWidth, x))}px`;
        label.style.top = `${Math.max(halfHeight, Math.min(tableHeightPx - halfHeight, tipY))}px`;
    }
    function showDragLabel(pose, text, hot) {
        let tip = document.getElementById('gp-drag-label');
        if (!text) { tip?.remove(); return; }
        if (!tip) { tip = document.createElement('div'); tip.id = 'gp-drag-label'; tip.className = 'gp-label'; table.appendChild(tip); }
        tip.textContent = text; tip.classList.toggle('gp-hot', Boolean(hot));
        tip.style.left = `${Math.max(105, Math.min(tableWidthPx - 105, pose.x + pose.w / 2))}px`;
        tip.style.top = `${Math.max(16, pose.y - 22)}px`;
    }
    function showProjectedThreat(pose) {
        if (!(pose.shoot > 0 && pose.range > 0)) return;
        const arc = E.firingArc(pose), { origin, forward, radius } = arc;
        let group = document.getElementById('gp-live-threat');
        if (!group) {
            group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.id = 'gp-live-threat';
            overlay().appendChild(group);
            for (const name of ['gp-threat-limit', 'gp-threat-midrange']) {
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('class', name);
                group.appendChild(path);
            }
            group.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
        }
        for (const [i, distance] of [radius, radius / 2].entries()) {
            const dx = -forward.y * distance, dy = forward.x * distance;
            const path = `M ${origin.x - dx} ${origin.y - dy} A ${distance} ${distance} 0 0 1 ${origin.x + dx} ${origin.y + dy}`;
            group.children[i].setAttribute('d', i === 0 ? path + ' Z' : path);
        }
        const projected = { ...game, units: game.units.map(u => u.id === pose.id ? pose : u) };
        const targets = new Map();
        const warnings = group.children[2];
        warnings.replaceChildren();
        document.getElementById('gp-shot-warning')?.remove();
        let labelAvailable = true;
        for (const v of game.units) {
            if (!v.owner || v.owner === pose.owner || E.firingArcError(arc, E.geometry.rect(v))) continue;
            const check = E.shotCheck(projected, pose, v);
            targets.set(v.id, check);
            if (check.reason) {
                drawShotWarning(warnings, pose, v, check, labelAvailable);
                labelAvailable = false;
            }
        }
        unitEls().forEach(el => {
            const check = targets.get(el.dataset.unitId);
            el.classList.toggle('gp-projected-target', Boolean(check && !check.reason));
            el.classList.toggle('gp-shot-blocked', Boolean(check?.reason));
        });
    }
    function hideDragLabel() {
        document.getElementById('gp-drag-label')?.remove();
        document.getElementById('gp-obstruction')?.remove();
        document.getElementById('gp-shot-warning')?.remove();
        const threat = document.getElementById('gp-live-threat');
        if (threat) {
            threat.remove();
            unitEls().forEach(el => el.classList.remove('gp-projected-target', 'gp-shot-blocked'));
        }
    }
    function drawMovementLanes(group, u, { forward, backward }, previewClass = '') {
        const f = E.geometry.forwardOf(u), corners = E.geometry.rect(u);
        for (const [limit, sign, edge, cls] of [
            [forward, 1, [0, 1], forward?.charge ? 'gp-charge' : 'gp-fwd'],
            [backward, -1, [2, 3], 'gp-back']
        ]) {
            if (!limit || (limit.max <= 0.05 && !limit.charge)) continue;
            const dx = f.x * sign * limit.max * PX, dy = f.y * sign * limit.max * PX;
            const [a, b] = edge.map(i => corners[i]);
            drawPoly(group, [a, b, { x: b.x + dx, y: b.y + dy }, { x: a.x + dx, y: a.y + dy }],
                `gp-lane ${cls} ${previewClass}`);
        }
    }
    function drawNextChargeLanes(svg, u, options) {
        const spans = previewFor(u.id).chargeSpans ??= BattleUX.nextChargeSpans(game, u, options);
        if (!spans.length) return;
        const group = liveOverlay('gp-next-charge', svg);
        const f = E.geometry.forwardOf(u), [a, b] = E.geometry.rect(u);
        const shift = (p, distance) => ({ x: p.x + f.x * distance * PX, y: p.y + f.y * distance * PX });
        for (const { from, to } of spans) {
            drawPoly(group, [shift(a, from), shift(b, from), shift(b, to), shift(a, to)], 'gp-next-charge-lane');
        }
    }

    /**
     * V4: a charger with no part behind the line extending an enemy's front edge can only charge that front.
     * For each enemy in reach, draw that line; where only the front can be charged, highlight the front edge.
     */
    function drawChargeFaces(group, pose) {
        group.replaceChildren();
        if (!E.v4Rules(game) || !(pose.melee > 0)) return 0;
        const G = E.geometry, c = G.centre(pose), reach = pose.pace * PX + G.reach(pose);
        let frontOnly = 0;
        for (const v of game.units) {
            if (!v.owner || v.routed || v.owner === pose.owner) continue;
            const vc = G.centre(v);
            if (Math.hypot(vc.x - c.x, vc.y - c.y) > reach + G.reach(v)) continue;
            const [a, b] = G.rect(v), len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, ext = 1200;
            const only = E.chargeFrontOnly(game, pose, v);
            svgMark(group, 'line', { x1: a.x - d.x * ext, y1: a.y - d.y * ext, x2: b.x + d.x * ext, y2: b.y + d.y * ext,
                class: `gp-front-line ${only ? 'gp-front-line-only' : 'gp-front-line-open'}` });
            if (only) {
                svgMark(group, 'line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'gp-front-only-edge' });
                frontOnly += 1;
            }
        }
        return frontOnly;
    }

    function drawOverlay() {
        const svg = overlay(); svg.replaceChildren();
        table.querySelectorAll('.gp-label:not(#gp-drag-label)').forEach(el => el.remove());
        const actingPlayer = game?.phase === 'command' ? E.activePlayer(game) : null;
        const viewer = aiPlayer ? other(aiPlayer) : onlineTable() ? getLocalBidPlayerKey() : actingPlayer || getLocalBidPlayerKey();
        const id = actingPlayer && controls(actingPlayer) ? currentUnitId() : null;
        const o = id ? optionsFor(id) : null;
        const elements = new Map();
        unitEls().forEach(el => {
            elements.set(el.dataset.unitId, el);
            el.classList.remove('gp-target', 'gp-target-chosen', 'gp-charge-target', 'gp-projected-target', 'gp-shot-blocked');
            el.tabIndex = -1;
            el.role = null;
            el.classList.toggle('gp-no-ring', !isDeployPiece(el));
            const u = unit(el.dataset.unitId);
            el.classList.toggle('gp-can-pivot', Boolean(actingPlayer && controls(actingPlayer)
                && u?.owner === actingPlayer && !u.activated && game.commands[actingPlayer]));
        });
        // Inspection works for both armies, including between command windows.
        const inspected = new Set(typeof inspectedUnits !== 'undefined' ? inspectedUnits : []);
        if (selectedPiece?.classList.contains('unit')) inspected.add(selectedPiece);
        for (const el of inspected) {
            const u = unit(el.dataset.unitId); if (!u?.owner || !game || game.phase === 'draft') continue;
            if (el.classList.contains('is-dragging')) continue;
            if (orderFor(u.id) && orderFor(u.id) !== 'move') continue;
            const reach = previewFor(u.id).reach ??= BattleUX.movementPreview(game, u.id, true);
            if (el === selectedPiece && u.activated && game.activation?.unitId !== u.id && controls(u.owner)) {
                drawMovementLanes(svg, u, BattleUX.freshMovement(game, u), 'gp-future-move');
            } else if (viewer && u.owner !== viewer) drawMovementLanes(svg, u, E.optionsAsIf(game, u.id), 'gp-enemy-lane');
            else if (u.id !== id || !o?.canAct) {
                const forward = reach.rays.find(r => r.degrees === 0)?.limit;
                drawMovementLanes(svg, u, { forward });
            }
            for (const charge of reach.charges) elements.get(charge.targetId)?.classList.add('gp-charge-target');
        }
        if (!o?.canAct) return o;
        const u = unit(id);
        const current = elements.get(id), order = orderFor(id);
        const canPivot = order === 'reform' ? availableTurn(o.reform)
            : availableTurn(o.pivot) || (!['move', 'pivot'].includes(order) && availableTurn(o.reform));
        current?.classList.toggle('gp-no-ring', !canPivot);
        current?.classList.toggle('gp-can-pivot', canPivot);
        const dragging = current?.classList.contains('is-dragging');
        if (dragging || order === 'move') drawNextChargeLanes(svg, u, o);
        if (dragging || !order || order === 'move') {
            drawMovementLanes(liveOverlay('gp-command-movement', svg), u, o);
        } else if (order === 'shoot') {
            drawMovementLanes(liveOverlay('gp-command-movement', svg), u, { forward: o.forward });
        }
        if (!order || order === 'move') {
            const canMove = o.forward.charge || o.forward.max > .01 || availableTurn(o.pivot);
            chargeFacesShown = canMove && !o.activation.charged ? drawChargeFaces(liveOverlay('gp-charge-faces', svg), u) : 0;
        } else chargeFacesShown = 0;
        if (dragging) return o;
        const G = E.geometry;
        if (!canPivot && (o.pivot.leftBlocker || o.pivot.rightBlocker)) {
            drawObstruction(svg, o.pivot.leftBlocker || o.pivot.rightBlocker, u);
        }
        for (const t of attackChoices(o, order)) {
            const el = elements.get(t.id), v = unit(t.id);
            if (!el || !v) continue;
            if (t.ok) {
                el.tabIndex = 0;
                el.role = 'button';
                el.classList.add('gp-target'); el.classList.toggle('gp-target-chosen', pendingTarget === t.id);
                if (pendingTarget === t.id) drawAttackPreview(v, t.preview);
            } else if (!E.firingArcError(E.firingArc(u), G.rect(v))) el.classList.add('gp-shot-blocked');
        }
        return o;
    }

    function showEvents() {
        if (!game) return;
        if (shownSeq === null) { shownSeq = game.seq; return; }
        for (const e of game.events.filter(e => e.seq > shownSeq)) {
            if (e.type === 'attack') {
                showAttackEffect(e);
                floatText(e.x, e.y, e.strain ? `+${e.strain} strain` : 'No effect', e.strain ? 'gp-float-hit' : 'gp-float-miss');
            } else if (e.type === 'rout') floatText(e.x, e.y - 22, `${e.name} routs!`, 'gp-float-rout');
            else if (e.type === 'rally') floatText(e.x, e.y, `Rally −${e.removed}`, 'gp-float-miss');
        }
        shownSeq = game.seq;
    }
    function showAttackEffect(e) {
        if (e.kind === 'shoot') {
            const attacker = unit(e.attackerId);
            if (attacker) {
                const corners = E.geometry.rect(attacker), origin = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.classList.add('gp-shot-effect'); svg.setAttribute('viewBox', `0 0 ${tableWidthPx} ${tableHeightPx}`);
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                for (const [key, value] of Object.entries({ x1: origin.x, y1: origin.y, x2: e.x, y2: e.y })) line.setAttribute(key, value);
                svg.appendChild(line); table.appendChild(svg); setTimeout(() => svg.remove(), 1300);
            }
        }
        if (e.strain > 0) {
            const hit = document.createElement('div'); hit.className = 'gp-impact';
            hit.style.left = `${e.x}px`; hit.style.top = `${e.y}px`; table.appendChild(hit); setTimeout(() => hit.remove(), 1400);
            const target = findEl(e.targetId); target?.classList.add('gp-struck'); setTimeout(() => target?.classList.remove('gp-struck'), 1400);
        }
    }
    function floatText(x, y, text, cls) {
        const el = document.createElement('div'); el.className = `gp-float ${cls}`; el.textContent = text;
        el.style.left = `${x}px`; el.style.top = `${y}px`; table.appendChild(el); setTimeout(() => el.remove(), 2600);
    }

    function fieldInstruction(g) {
        if (g.phase === 'finished') return who(g.winner) === 'You' ? 'You win' : `${who(g.winner)} wins`;
        if (g.phase === 'bidding') {
            const bidder = ['p1', 'p2'].find(p => controls(p) && !biddingState[p].ready);
            if (!bidder) return 'Waiting for bids';
            return bidChoices[bidder] ? 'Lock your bid' : 'Choose your command bid';
        }
        if (g.phase === 'draft') {
            const { picker, step, position } = g.draft;
            if (!controls(picker)) return `${who(picker)}’s turn`;
            if (step === 'pick') return 'Select a unit';
            if (step === 'terrain') return 'Place terrain';
            return position ? 'Confirm unit' : 'Deploy your unit';
        }
        const side = E.activePlayer(g);
        if (!controls(side)) return `${who(side)} turn`;
        if (g.awaitingRoundEnd || g.awaitingTurnEnd) return 'Review the final order';
        if (pendingTarget) return 'Click again to attack';
        const id = currentUnitId();
        if (!id) return 'Choose a unit to command';
        const order = orderFor(id);
        if (order) return {
            move: 'Drag the unit to move', pivot: 'Drag the ↻ handle behind the unit to pivot', reform: 'Drag the ↻ handle behind the unit to Reform',
            shoot: 'Select an outlined enemy to shoot', strike: 'Select a touching enemy to strike'
        }[order];
        return g.activation?.action && g.activation.unitId === id ? 'Complete this activation' : `Give ${unit(id).name} an order`;
    }

    function hasNoTerrainThisTurn(g) {
        return (g.draft?.step === 'pick' && !E.TERRAIN[g.terrainDeck[0]])
            || (g.draft?.step === 'deploy' && !g.draft.terrainId);
    }

    function renderField(g) {
        const draft = g.phase === 'draft';
        const side = draft ? g.draft.picker : E.activePlayer(g);
        const local = aiPlayer ? other(aiPlayer) : onlineTable() ? getLocalBidPlayerKey() : side || g.winner || 'p1';
        const phase = draft ? 'Deployment' : g.phase === 'finished' ? 'Battle complete' : `Round ${g.round} · ${g.phase === 'bidding' ? 'Initiative' : 'Orders'}`;
        const set = (id, value) => { const el = document.getElementById(id); if (el && el.textContent !== value) el.textContent = value; };
        const actor = side && (draft || g.phase === 'command') ? who(side) : '';
        set('field-phase', actor ? `${phase} · ${actor === 'You' ? 'Your turn' : actor}` : phase);
        set('field-turn', fieldInstruction(g));
        set('deployment-terrain-notice', hasNoTerrainThisTurn(g) ? 'No terrain to place this turn.' : '');
        set('field-objective', draft ? '' : `${who(other(local))} routed · ${g.routed[other(local)]} / ${Math.ceil(g.starting[other(local)] / 2)}`);
        if (draft) for (const p of ['p1', 'p2']) {
            const zone = document.getElementById(p === 'p1' ? 'deployment-zone-bottom' : 'deployment-zone-top');
            zone.dataset.label = who(p) === 'You' ? 'Your deployment zone' : `${who(p)} deployment zone`;
            zone.dataset.current = String(p === side && g.draft.step === 'deploy' && controls(side));
        }
    }

    function nextReady() {
        if (!game || game.phase !== 'command') return;
        const p = E.activePlayer(game);
        if (!controls(p) || !game.commands[p]) return;
        const fresh = army(p).filter(u => !u.activated);
        if (!fresh.length) return;
        const i = fresh.findIndex(u => u.id === selectedPiece?.dataset.unitId);
        pendingTarget = null; message = ''; selectPiece(findEl(fresh[(i + 1) % fresh.length].id));
    }

    /** The Undo button in the battlefield's bottom-left corner. */
    function renderBoardUndo(g) {
        const b = document.getElementById('board-undo'); if (!b) return;
        let show = false;
        if (g.phase === 'draft') show = g.units.length > 0 && controls(g.draft.picker) && g.draft.step !== 'pick';
        else if (g.phase === 'command') show = controls(E.activePlayer(g)) || canUndo();
        b.textContent = 'Undo';
        b.hidden = !show;
        b.disabled = !canUndo();
        b.onclick = () => undo();
        if (show && typeof positionBoardUndo === 'function') positionBoardUndo();
    }
    function render() {
        const panel = document.getElementById('guided-play'); if (!panel) return;
        const previousFocus = panel.contains?.(document.activeElement) ? document.activeElement : null;
        const g = ensure(); panel.replaceChildren();
        renderBoardUndo(g);
        document.getElementById('container').classList.toggle('is-draft', g.phase === 'draft');
        if (!g.units.length && g.phase === 'draft') {
            document.getElementById('field-phase').textContent = 'Multiplayer';
            document.getElementById('field-turn').textContent = 'Waiting for the host';
            for (const id of ['field-objective', 'deployment-terrain-notice', 'battle-log-entries', 'ai-current-action']) document.getElementById(id).textContent = '';
            document.getElementById('terrain-section').hidden = true;
            delete document.getElementById('battle-log-entries').dataset.signature;
            document.getElementById('ai-current-action').hidden = true;
            document.getElementById('container').classList.remove('is-ai-game', 'is-shared-game');
            return;
        }
        if (chosenOrder && (selectedPiece?.dataset.unitId !== chosenOrder.id || chosenOrder.id !== currentUnitId())) chosenOrder = null;
        syncBoard(); showEvents(); renderField(g);
        if (typeof refreshPinnedRulers === 'function') refreshPinnedRulers();
        document.getElementById('container').classList.toggle('is-ai-game', Boolean(aiPlayer));
        document.getElementById('container').classList.toggle('is-shared-game', typeof sessionMode !== 'undefined' && sessionMode === 'shared');
        const options = drawOverlay();
        const add = (tag, text, cls, parent = panel) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; parent.appendChild(el); return el; };
        const button = (name, fn, disabled = false, why = '', cls = 'btn-blue', parent = panel) => { const b = add('button', name, cls, parent); b.type = 'button'; b.disabled = disabled; if (why) b.title = why; b.onclick = fn; return b; };
        const row = (cls = '') => add('div', undefined, `gp-row ${cls}`);
        if (g.phase === 'command') {
            const windows = add('ol', undefined, 'gp-order-windows');
            windows.setAttribute('aria-label', 'Order windows in this round');
            ['First', 'Middle', 'Final'].forEach((label, i) => {
                const step = add('li', undefined, i < g.turnStep ? 'gp-window-past' : '', windows);
                if (i === g.turnStep) step.setAttribute('aria-current', 'step');
                add('span', label, '', step);
                add('strong', who(i === 1 ? other(g.master) : g.master), '', step);
            });
        }
        if (g.phase === 'draft') {
            const { picker, step, picked, position, terrainId } = g.draft;
            const mine = controls(picker);
            const copy = add('div', undefined, 'gp-deploy-copy');
            if (message) add('p', message, 'guided-error', copy).setAttribute('role', 'alert');
            else if (!mine) {
                if (aiAction) add('p', aiAction, '', copy).setAttribute('role', 'status');
            } else {
                let instruction = 'Tap a highlighted unit.';
                if (step === 'terrain') instruction = `Drag the tile onto ${unit(picked).name}.`;
                else if (position) instruction = 'Drag to reposition. Tap or drag ↻ to rotate.';
                else if (step === 'deploy') instruction = terrainId
                    ? 'Drag your unit into the zone. You can adjust the tile with ✥ first.'
                    : 'Drag your unit fully inside the highlighted zone.';
                add('p', instruction, 'gp-deploy-guide', copy);
            }
            const actions = add('div', undefined, 'gp-deploy-actions');
            const confirm = button('Confirm Unit Deployment', deploy, !mine || !position, 'Pass play to your opponent', 'btn-blue gp-deploy-primary', actions);
            confirm.hidden = !mine || !position;
            if (canAutoDraft(g)) {
                const quick = button('Auto-draft both sides', autoDraft, Boolean(position), 'Finish deployment and go to initiative bidding', 'btn-grey gp-deploy-primary', actions);
                quick.hidden = Boolean(position);
            }
        } else if (g.phase === 'bidding') {
            add('p', 'Bid = how many units you can command this round. The lower bid becomes Master Tactician and acts first and last.', 'gp-sub');
            const shared = !onlineTable() && !aiPlayer;
            if (shared) add('p', 'On a shared screen, bid one at a time while the other player looks away.', 'gp-sub');
            for (const p of ['p1', 'p2'].filter(controls)) {
                if (shared) add('strong', `${who(p)}${g.master === p ? ' (current Master Tactician)' : ''}`);
                if (biddingState[p].ready) add('p', 'Bid placed — hidden until both are in.', 'gp-sub');
                else if (shared && p === 'p2' && !biddingState.p1.ready) add('p', 'Bids after Player 1.', 'gp-sub');
                else {
                    const r = row('gp-bids'), choices = [];
                    const refresh = () => {
                        choices.forEach((b, i) => b.setAttribute('aria-pressed', String(bidChoices[p] === i + 1)));
                        document.getElementById('field-turn').textContent = fieldInstruction(g);
                        lock.disabled = !bidChoices[p];
                        lock.textContent = bidChoices[p] ? `Lock bid · ${bidChoices[p]} command${bidChoices[p] === 1 ? '' : 's'}` : 'Lock bid';
                    };
                    for (let n = 1; n <= army(p).length; n++) choices.push(button(String(n), () => { bidChoices[p] = n; refresh(); }, false, `Bid ${n}`, 'btn-grey gp-bid', r));
                    const lock = button('Lock bid', () => { const value = bidChoices[p]; delete bidChoices[p]; bid(p, value); });
                    refresh();
                }
            }
        } else if (g.phase === 'command') {
            const p = E.activePlayer(g), mine = controls(p);
            add('h3', mine && currentUnitId() ? unit(currentUnitId()).name : 'Unit orders');
            add('p', `Bids · ${who('p1')} ${g.bids.p1}, ${who('p2')} ${g.bids.p2}.`, 'gp-sub');
            const chips = row('gp-chips');
            for (const q of ['p1', 'p2']) add('span', `${who(q)}: ${g.commands[q]} command${g.commands[q] === 1 ? '' : 's'} left`, `gp-chip ${q === p ? 'gp-chip-on' : ''}`, chips);
            if (table.querySelector('.gp-future-move')) add('p', 'Blue boxes show movement for the next activation.', 'gp-sub');
            if (mine) {
                const id = currentUnitId(), u = id && unit(id), o = options;
                if (g.awaitingRoundEnd) {
                    add('p', 'Undo the last order or end the round.');
                } else if (g.awaitingTurnEnd) {
                    add('p', 'Undo the last order or end your turn.');
                } else if (u && o?.canAct) {
                    if (g.activation && g.activation.unitId !== id) add('p', `Issuing an order ends ${unit(g.activation.unitId).name}’s activation.`, 'gp-sub');
                    const orders = row('gp-unit-orders');
                    const order = (name, type, hint) => {
                        const pressed = orderFor(id) === type;
                        const control = button(name, () => chooseOrder(id, type), false, hint, pressed ? 'btn-blue' : 'btn-grey', orders);
                        control.setAttribute('aria-pressed', String(pressed));
                    };
                    if (o.forward.charge || o.forward.max > .01 || o.backward.max > .01) order('Move', 'move', 'Drag the unit to advance, withdraw or charge');
                    if (o.pivot.usesAction && availableTurn(o.pivot)) order('Extra Pivot', 'pivot', 'Drag the ↻ handle to use Extra Pivot');
                    if (availableTurn(o.reform)) order('Reform', 'reform', 'Drag the ↻ handle. Reform uses the action.');
                    if (o.shoot.some(t => t.ok)) order('Shoot', 'shoot', 'Select an enemy on the battlefield');
                    if (o.strike.some(t => t.ok)) order('Strike', 'strike', 'Select a touching enemy on the battlefield');
                    if (o.canRally) button('Rally', rally, false, o.rules === 'v3' ? 'Remove one strain' : 'Roll to remove d6 ÷ 2 strain, rounded up', 'btn-grey', orders);
                    if (!orders.children.length) orders.remove();
                    if (o.shaken) add('p', 'Shaken: an enemy’s front is touching this unit’s flank, so it can’t strike.', 'gp-sub');
                    if (document.getElementById('gp-next-charge')) add('p', 'Next-turn charge reach', 'gp-next-charge-key');
                    if (chargeFacesShown) add('p', 'Gold edge: no part of this unit is behind that enemy’s front line (dashed), so it can only charge its front.', 'gp-front-only-key');
                    if (o.activation.overlap) add('p', 'Keep pivoting: the unit can’t finish overlapping another unit, impassable terrain or the edge.');
                    if (o.activated) button('End activation', endActivation, Boolean(o.activation.overlap), o.activation.overlap ? 'Pivot clear first' : '', 'btn-blue gp-end');
                } else if (o?.reason) add('p', o.reason);
                const left = g.commands[p], commandsLeft = `${left} ${left === 1 ? 'command' : 'commands'}`;
                if (left > 0) {
                    const effect = g.turnStep === 0 ? `Passing carries ${commandsLeft} into your final window.`
                        : `Passing gives up ${commandsLeft} for this round.`;
                    add('p', effect, 'gp-sub gp-pass-summary');
                }
                const r = row('gp-turn');
                const finalAvailable = g.commands[g.master] > 0 && army(g.master).some(u => !u.activated);
                const passLabel = g.turnStep === 2 || (g.turnStep === 1 && !finalAvailable) ? 'Pass and end round' : 'Pass turn';
                if (g.awaitingRoundEnd) button('End round', pass, false, '', 'btn-blue', r);
                else if (g.awaitingTurnEnd) button('End turn', pass, false, '', 'btn-blue', r);
                else if (g.turnStep > 0 && left > 0) {
                    const warning = add('details', undefined, 'pass-review', r);
                    add('summary', passLabel, '', warning);
                    button('Confirm pass', pass, false, '', 'btn-grey', warning);
                } else button(passLabel, pass, false, 'Pass to the next command window', 'btn-grey', r);
            }
        } else if (g.phase === 'finished') {
            add('h3', `${who(g.winner) === 'You' ? 'You win' : `${who(g.winner)} wins`} the battle`);
            add('p', `${g.routed[other(g.winner)]} of ${g.starting[other(g.winner)]} enemy units routed.`);
            if (typeof resetGame === 'function' && (!connected() || isHost)) button('New battle', () => resetGame());
        }
        if (message && g.phase !== 'draft') { const e = add('p', message, 'guided-error'); e.setAttribute('role', 'alert'); panel.insertBefore(e, panel.children[1] || null); }
        const logEntries = document.getElementById('battle-log-entries'), liveAction = document.getElementById('ai-current-action');
        if (logEntries) {
            const lines = g.log;
            const signature = JSON.stringify([aiPlayer, lines]);
            if (logEntries.dataset.signature !== signature) {
                logEntries.dataset.signature = signature; logEntries.replaceChildren();
                lines.forEach((line, i) => {
                    if (aiPlayer) {
                        line = line.replaceAll(label(aiPlayer), 'Enemy').replaceAll(label(other(aiPlayer)), 'You')
                            .replace('You wins', 'You win').replace('You passes', 'You pass').replace('You is', 'You are');
                    }
                    add('p', line, i === 0 ? 'gp-log-latest' : '', logEntries);
                });
            }
        }
        if (liveAction) { liveAction.hidden = !aiAction || g.phase === 'draft'; liveAction.textContent = aiAction; }
        document.getElementById('bidding-turn-panel').hidden = true;
        document.getElementById('draft-notice-banner').style.display = 'none';
        const section = document.getElementById('terrain-section'), inDraft = g.phase === 'draft';
        section.hidden = !inDraft;
        const card = document.getElementById('terrain-card');
        card.hidden = inDraft && hasNoTerrainThisTurn(g);
        const available = inDraft && g.draft.step === 'terrain' && controls(g.draft.picker);
        card.classList.toggle('is-playable', available);
        if (inDraft && g.terrainDeck.length) {
            const open = !E.TERRAIN[g.terrainDeck[0]], title = document.getElementById('terrain-card-title');
            if (title && open) title.textContent = 'Open ground';
            card.setAttribute('aria-disabled', String(!available));
            card.setAttribute('aria-label', available ? `Drag ${title.textContent} onto the drafted unit` : `Next terrain tile: ${title.textContent}`);
        }
        table.classList.add('guided-board');
        updateSelectionRanges();
        if (previousFocus) {
            const interactive = [...panel.querySelectorAll('button:not(:disabled):not([hidden]),summary,input')];
            const match = interactive.find(el => el.id && el.id === previousFocus.id || el.tagName === previousFocus.tagName && el.textContent === previousFocus.textContent);
            (match || interactive[0])?.focus({ preventScroll: true });
        }
        if (aiPlayer && !aiBusy && aiToMove()) setTimeout(runAI, 0);
    }

    function fieldKey(e) {
        if (game.phase !== 'command' || !controls(E.activePlayer(game)) || e.altKey || e.ctrlKey || e.metaKey
            || (typeof activePointerId !== 'undefined' && activePointerId !== null)) return false;
        if ((e.key === 'Enter' || e.key === ' ') && e.target?.classList?.contains('gp-target')) {
            if (tap(e.target) && !e.target.classList.contains('gp-target')) table.focus?.({ preventScroll: true });
            return true;
        }
        if (e.target !== table || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return false;
        const id = currentUnitId();
        if (!id) return false;
        const o = optionsFor(id);
        if (!o.canAct) return false;
        const order = orderFor(id);
        let action;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            if (order && order !== 'move') return false;
            const backwards = e.key === 'ArrowDown', limit = backwards ? o.backward : o.forward;
            if (limit.max > .01) {
                const step = Math.min(limit.max, e.shiftKey ? .1 : 1);
                const inches = E.crossingAt(limit.crossings, step)?.to ?? step;
                action = { type: 'move', inches, backwards };
            }
        } else {
            if (order === 'shoot' || order === 'strike') return false;
            const reform = order === 'reform', left = e.key === 'ArrowLeft', limit = reform ? o.reform : o.pivot;
            const max = left ? limit?.left : limit?.right;
            if (availableTurn(limit) && max > 0) {
                let degrees = Math.min(max, e.shiftKey ? 1 : 15) * (left ? -1 : 1);
                // V3: a step that would stop overlapping carries on through, if there's room beyond.
                const span = E.pivotOverlap(limit, degrees);
                if (span) degrees = (span.to + 1 <= max ? span.to + 1 : span.from - 1) * (left ? -1 : 1);
                if (degrees) action = { type: 'pivot', degrees, reform };
            }
        }
        if (action) unitAction(id, action);
        return true;
    }

    window.addEventListener('keydown', e => {
        if (!game || e.repeat || document.getElementById('container').style.display === 'none' || document.querySelector('.modal-overlay[aria-hidden="false"]') || e.target?.closest('input,textarea,select,[contenteditable="true"]')) return;
        if (e.key === 'Escape' && (pendingTarget || chosenOrder)) {
            e.preventDefault(); pendingTarget = null; chosenOrder = null; render(); return;
        }
        if (fieldKey(e)) { e.preventDefault(); return; }
        if (!e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'n') nextReady();
        if (e.key === 'Enter' && !e.target?.closest('button,summary,a') && game.phase === 'command' && game.activation && controls(E.activePlayer(game))) { e.preventDefault(); endActivation(); }
    });

    return {
        render, ensure, reset, snapshot, restore, note, incoming, canDrag, constrainDrag, dropPiece, constrainRotation, dropRotation, rotate, tap,
        canUndo, isDeployPiece, aiPlayer: () => aiPlayer,
        deploy, positionForDeployment, pass, bid, reveal, attack, endActivation, nextReady, movePieceTo, visiblePose,
        setAI, aiNote: () => aiNote, setRules, rules: () => rulesChoice, activeRules: () => game ? E.normalizeRules(game.rules) : rulesChoice,
        act: a => act(a), state: () => ensure(), counts: () => ({ p1: army('p1').length, p2: army('p2').length }),
        terrainAllowed, terrainDropError,
        terrainDrop({ x, y }, type) {
            if (terrainAllowed() && game.terrainDeck[0] === type) act({ type: 'placeTerrain', player: myDraftKey(), x, y });
        }
    };
})();

/** Start a single-player battle: the human is Player 1 at the bottom, the AI is Player 2. */
function playVsAI(level) {
    hostGameFromLanding('solo', level || 'normal');
}
// Show the remembered rules choice on the landing page.
if (typeof document !== 'undefined') {
    const syncRules = () => GuidedPlay.setRules(GuidedPlay.rules());
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncRules); else syncRules();
}
