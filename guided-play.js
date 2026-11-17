/*
 * Game client: connects the headless rules engine (engine.js) to the tabletop renderer (app.js).
 * The engine state is the single source of truth; the board DOM is redrawn from it after every action.
 * Players act directly on the board: drag a unit to move, drag its ring to pivot, click an enemy to attack.
 */
const GuidedPlay = (() => {
    const E = SeizeEngine, PX = E.PX;
    let game = null, darkPlayer = null, message = '', privateBids = {}, revealSent = false;
    let pendingTarget = null, shownSeq = null, dragCtx = null, rotCtx = null, tokenSig = '', deckSig = '';
    let aiPlayer = null, aiLevel = 'normal', aiRun = 0, aiBusy = false, aiWorker = null, aiNote = '';

    const other = E.other, label = E.label;
    const connected = () => Boolean(conn && conn.open);
    const controls = p => p !== aiPlayer && (!connected() || p === getLocalBidPlayerKey());
    const unitEls = () => [...table.querySelectorAll('.unit')].filter(u => !u.classList.contains('ghost'));
    const terrainEls = () => [...table.querySelectorAll('.terrain')];
    const findEl = id => unitEls().find(u => u.dataset.unitId === id);
    const unit = id => game && game.units.find(u => u.id === id);
    const army = p => game.units.filter(u => u.owner === p);
    const who = p => (aiPlayer ? (p === aiPlayer ? 'AI' : 'You') : connected() ? (p === getLocalBidPlayerKey() ? 'You' : 'Opponent') : label(p));
    const fmt = n => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');

    // ---------- state lifecycle ----------
    function fromDOM() {
        const units = unitEls().map(el => ({
            id: el.dataset.unitId, name: el.dataset.name, owner: el.dataset.owner || (hasBattleStarted() ? getAssignedPlayer(el) : null),
            x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height),
            angle: parseFloat(el.dataset.angle) || 0, strain: Number(el.dataset.wounds) || 0, stats: getUnitStats(el).stats || {}
        }));
        const terrain = terrainEls().map(el => ({ id: getPieceId(el), type: el.dataset.subType, x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width) }));
        const s = E.createGame({ units, terrain, terrainDeck, firstPick: biddingState.firstDraftPick || 'p1', width: tableWidthPx, height: tableHeightPx, tileSize: terrainDiameterPx });
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
    function reset() { aiRun += 1; aiBusy = false; game = null; darkPlayer = null; privateBids = {}; revealSent = false; message = ''; pendingTarget = null; shownSeq = 0; tokenSig = ''; deckSig = ''; }
    function snapshot() {
        const g = ensure();
        return JSON.parse(JSON.stringify({ version: 2, game: g, darkPlayer, ai: aiPlayer, aiLevel, stage: g.phase === 'draft' ? g.draft.step : g.phase, drafting: g.phase === 'draft' }));
    }
    function restore(saved) {
        if (saved && saved.version === 2 && saved.game) {
            game = saved.game; darkPlayer = saved.darkPlayer || darkPlayer;
            aiPlayer = saved.ai || null; aiLevel = saved.aiLevel || aiLevel; aiRun += 1; aiBusy = false;
            if (shownSeq === null || game.seq < shownSeq) shownSeq = game.seq;
        } else game = null;
        if (!game || game.phase !== 'bidding') { privateBids = {}; revealSent = false; }
        pendingTarget = null; message = '';
    }

    // ---------- applying actions ----------
    function note(text) { message = text; render(); return false; }
    /** Run engine actions in order; on any failure nothing changes and the reason is shown. */
    function act(actions, options = {}) {
        ensure();
        try {
            let next = game;
            for (const a of [].concat(actions)) next = E.apply(next, a);
            if (!options.keepUndo && !connected()) pushUndo();
            game = next; message = ''; pendingTarget = null;
            saveGame();
            return true;
        } catch (e) { note(e.message); return false; }
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
    const optionsFor = id => E.unitOptions(stateFor(id), id);
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
    function pick() {
        if (!selectedPiece?.classList.contains('unit')) return note('Select a unit in the centre first.');
        act({ type: 'pick', player: myDraftKey(), unitId: selectedPiece.dataset.unitId });
    }
    const myDraftKey = () => (aiPlayer ? other(aiPlayer) : connected() ? getLocalBidPlayerKey() : game.draft.picker);
    function placeTerrain(x, y) { act({ type: 'placeTerrain', player: myDraftKey(), x, y }); }
    function placeTerrainAuto() {
        const spot = E.terrainSpots(game, 1)[0];
        if (spot) placeTerrain(spot.x, spot.y);
    }
    function deploy() {
        const el = findEl(game.draft.picked);
        act({ type: 'deploy', player: myDraftKey(), x: parseFloat(el.style.left), y: parseFloat(el.style.top), angle: parseFloat(el.dataset.angle) || 0 });
    }
    function deployAuto() {
        const a = E.legalActions(game).filter(x => x.type === 'deploy'), u = unit(game.draft.picked);
        if (!a.length) return note('No free space found. Drag the unit into your zone yourself.');
        const best = a.reduce((m, x) => (Math.abs(x.x - u.x) < Math.abs(m.x - u.x) ? x : m));
        act(best);
    }

    // ---------- bidding ----------
    function bid(p, value) {
        ensure();
        const n = Number(value), max = army(p).length;
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
            game = next; privateBids = {}; revealSent = false; message = '';
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
        if (!aiPlayer || !game || connected()) return false;
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
        aiBusy = true; const run = aiRun;
        try {
            await pause(game.phase === 'command' ? 500 : 250);
            if (run !== aiRun || !aiToMove()) return;
            const choice = await askAI(game);
            if (run !== aiRun || !aiToMove()) return;
            aiNote = choice.note || '';
            for (const a of choice.actions) {
                if (run !== aiRun || game.phase === 'finished') break;
                if (a.type === 'bid') { privateBids[aiPlayer] = a.value; biddingState[aiPlayer] = { value: a.value, ready: true }; if (biddingState[other(aiPlayer)].ready) reveal(); else saveGame(true); break; }
                if (a.type === 'endActivation' && !game.activation) continue;
                const u = a.unitId && findEl(a.unitId);
                if (a.type === 'activate' && u) selectPiece(u);
                if (!act(a, { keepUndo: true })) break;
                await pause(a.type === 'activate' ? 350 : 650);
            }
            if (run === aiRun) clearPieceSelection();
        } finally { if (run === aiRun) { aiBusy = false; render(); } }
    }
    function setAI(player, level) { aiPlayer = player || null; if (level) aiLevel = level; aiRun += 1; aiBusy = false; if (game) saveGame(true); }

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
    function endActivation() { if (controls(E.activePlayer(game))) act({ type: 'endActivation' }); }
    function attack(targetId) {
        const id = currentUnitId(); if (!id) return;
        const o = optionsFor(id), kind = o.strike?.some(t => t.id === targetId) ? 'strike' : 'shoot';
        unitAction(id, { type: kind, targetId });
    }
    function pivotBy(deg) { const id = currentUnitId(); if (id) unitAction(id, { type: 'pivot', degrees: deg }); }
    function moveBy(inches, backwards) { const id = currentUnitId(); if (id) unitAction(id, { type: 'move', inches, backwards }); }
    function rally() { const id = currentUnitId(); if (id) unitAction(id, { type: 'rally' }); }

    // ---------- board interaction hooks (called from app.js) ----------
    function isDeployPiece(el) { return game.phase === 'draft' && game.draft.step === 'deploy' && controls(game.draft.picker) && el?.dataset.unitId === game.draft.picked; }
    function canDrag(el, kind = 'move') {
        ensure(); dragCtx = null; rotCtx = null;
        if (isDeployPiece(el)) return true;
        if (game.phase !== 'command' || !el?.classList.contains('unit')) return game.phase === 'draft' ? false : note('Nothing to move right now.');
        const u = unit(el.dataset.unitId), p = E.activePlayer(game);
        if (!u || u.owner !== p) return false;
        if (!controls(p)) return note('Wait for your opponent.');
        const o = optionsFor(u.id);
        if (!o.canAct) return note(o.reason);
        if (kind === 'rotate') {
            if (o.pivot.remaining < 1 || (!o.pivot.left && !o.pivot.right)) return note(o.pivot.reason || 'This unit can’t pivot now.');
            rotCtx = { id: u.id, start: u.angle, left: o.pivot.left, right: o.pivot.right, usesAction: o.pivot.usesAction };
            return true;
        }
        if (o.forward.max <= 0.01 && o.backward.max <= 0.01) return note(o.forward.reason || o.backward.reason || 'This unit can’t move now.');
        dragCtx = { id: u.id, x: u.x, y: u.y, f: E.geometry.forwardOf(u), fwd: o.forward, back: o.backward, d: 0 };
        return true;
    }
    function constrainDrag(el, left, top) {
        if (!dragCtx || el.dataset.unitId !== dragCtx.id) return { left, top };
        const c = dragCtx, snap = 5;
        let d = (left - c.x) * c.f.x + (top - c.y) * c.f.y;
        d = Math.max(-c.back.max * PX, Math.min(c.fwd.max * PX, d));
        if (c.fwd.max * PX - d < snap) d = c.fwd.max * PX;
        if (d < 0 && c.back.max * PX + d < snap) d = -c.back.max * PX;
        if (Math.abs(d) < 2) d = 0;
        c.d = d;
        const charging = c.fwd.charge && d >= c.fwd.max * PX - 1e-6;
        showDragLabel(el, d === 0 ? 'Drag forwards or backwards' : `${fmt(Math.abs(d) / PX)}″ ${d < 0 ? 'back' : 'forward'}${charging ? ' — CHARGE' : ''}`, charging);
        return { left: c.x + c.f.x * d, top: c.y + c.f.y * d };
    }
    function dropPiece(el) {
        hideDragLabel();
        if (!dragCtx || el.dataset.unitId !== dragCtx.id) return;
        const c = dragCtx; dragCtx = null;
        const inches = Math.abs(c.d) / PX, backwards = c.d < 0, lim = backwards ? c.back : c.fwd;
        const done = inches > 0.01 && unitAction(c.id, { type: 'move', inches: inches >= lim.max - 1e-6 ? lim.max : inches, backwards }, { keepUndo: true });
        if (!done) { undoStack.pop(); render(); }
    }
    function constrainRotation(el, startAngle, nextAngle) {
        if (!rotCtx || el.dataset.unitId !== rotCtx.id) return nextAngle;
        const delta = Math.max(-rotCtx.left, Math.min(rotCtx.right, nextAngle - startAngle));
        showDragLabel(el, `Pivot ${delta > 0 ? '+' : ''}${Math.round(delta)}°${rotCtx.usesAction ? ' — uses action (Extra Pivot)' : ''}`, false);
        return startAngle + delta;
    }
    function dropRotation(el, startAngle, undoPushed) {
        hideDragLabel();
        if (!rotCtx || el.dataset.unitId !== rotCtx.id) return false;
        const c = rotCtx; rotCtx = null;
        const delta = (parseFloat(el.dataset.angle) || 0) - c.start;
        const done = Math.abs(delta) >= 0.5 && unitAction(c.id, { type: 'pivot', degrees: Math.round(delta * 100) / 100 }, { keepUndo: undoPushed });
        if (!done) { if (undoPushed) undoStack.pop(); render(); }
        return true;
    }
    function rotate(el, delta) {
        ensure();
        if (isDeployPiece(el)) { setAngle(el, (parseFloat(el.dataset.angle) || 0) + delta); saveGame(); return; }
        if (game.phase === 'command') note('Drag the ring around a unit to pivot it, or use the pivot buttons.');
    }
    /** A click on a piece. Returns true when the click was an order rather than a selection. */
    function tap(el) {
        ensure();
        if (game.phase !== 'command' || !el.classList.contains('unit')) return false;
        const id = currentUnitId(), target = unit(el.dataset.unitId);
        if (!id || !target || target.owner === E.activePlayer(game) || !controls(E.activePlayer(game))) return false;
        const o = optionsFor(id);
        if (!o.canAct) return false;
        const choice = [...o.strike, ...o.shoot].find(t => t.id === target.id);
        if (!choice) return false;
        if (!choice.ok) { pendingTarget = null; note(`Can’t shoot ${target.name}: ${choice.reason}`); return true; }
        if (pendingTarget === target.id) attack(target.id);
        else { pendingTarget = target.id; message = ''; render(); }
        return true;
    }

    // ---------- drawing ----------
    function setAngle(el, angle) { el.dataset.angle = angle; el.style.transform = `rotate(${angle}deg)`; }
    function syncBoard() {
        const g = game, deployingId = g.phase === 'draft' && g.draft.step === 'deploy' ? g.draft.picked : null;
        for (const el of unitEls()) {
            const u = unit(el.dataset.unitId);
            if (!u) { if (selectedPiece === el) clearPieceSelection(); el.remove(); continue; }
            if (u.id !== deployingId && !el.classList.contains('is-dragging') && !el.classList.contains('is-rotating')) {
                el.style.left = `${u.x}px`; el.style.top = `${u.y}px`; setAngle(el, u.angle);
            }
            if (u.owner) el.dataset.owner = u.owner; else delete el.dataset.owner;
            el.dataset.wounds = u.strain;
            const marker = el.querySelector('.wound-marker');
            if (marker) { marker.textContent = u.strain; marker.style.display = u.strain ? 'flex' : 'none'; }
            el.classList.toggle('guided-active', g.activation?.unitId === u.id);
            el.classList.toggle('guided-used', Boolean(u.activated) && g.activation?.unitId !== u.id);
            el.classList.toggle('guided-picked', g.phase === 'draft' && g.draft.picked === u.id);
            el.classList.toggle('guided-ready', g.phase === 'command' && !g.activation && u.owner === E.activePlayer(g) && !u.activated && g.commands[u.owner] > 0 && controls(u.owner));
            el.dataset.armySkin = u.owner ? (u.owner === darkPlayer ? 'dark' : 'light') : 'undrafted';
        }
        const wanted = new Map(g.terrain.map(t => [t.id, t]));
        for (const el of terrainEls()) { if (wanted.has(el.dataset.pieceId)) wanted.delete(el.dataset.pieceId); else el.remove(); }
        wanted.forEach(t => createTerrainDOM(t.type, t.x, t.y, t.w, t.w, 0, t.id));

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
    function boardLabel(x, y, text, cls) {
        const el = document.createElement('div'); el.className = `gp-label ${cls || ''}`; el.textContent = text;
        el.style.left = `${Math.max(40, Math.min(tableWidthPx - 40, x))}px`; el.style.top = `${Math.max(14, Math.min(tableHeightPx - 14, y))}px`;
        table.appendChild(el); return el;
    }
    function showDragLabel(el, text, hot) {
        let tip = document.getElementById('gp-drag-label');
        if (!tip) { tip = document.createElement('div'); tip.id = 'gp-drag-label'; tip.className = 'gp-label'; table.appendChild(tip); }
        tip.textContent = text; tip.classList.toggle('gp-hot', Boolean(hot));
        tip.style.left = `${parseFloat(el.style.left) + parseFloat(el.style.width) / 2}px`;
        tip.style.top = `${Math.max(14, parseFloat(el.style.top) - 22)}px`;
    }
    function hideDragLabel() { document.getElementById('gp-drag-label')?.remove(); }
    function previewText(p) { return `${p.pool} dice · ${p.tn}+ · ≈${fmt(p.expected)} strain${p.routChance >= 0.01 ? ` · ${Math.round(p.routChance * 100)}% rout` : ''}`; }

    function drawOverlay() {
        const svg = overlay(); svg.replaceChildren();
        table.querySelectorAll('.gp-label:not(#gp-drag-label)').forEach(el => el.remove());
        unitEls().forEach(el => { el.classList.remove('gp-target', 'gp-target-chosen'); el.classList.toggle('gp-no-ring', !(game && isDeployPiece(el))); });
        if (!game || game.phase !== 'command' || !controls(E.activePlayer(game))) return null;
        const id = currentUnitId(); if (!id) return null;
        const u = unit(id), o = optionsFor(id); if (!o.canAct) return o;
        if (o.pivot.remaining > 0 && (o.pivot.left || o.pivot.right)) findEl(id)?.classList.remove('gp-no-ring');
        const G = E.geometry, f = G.forwardOf(u), corners = G.rect(u);
        const lane = (lim, sign, cls) => {
            if (lim.max <= 0.05) return;
            const dx = f.x * sign * lim.max * PX, dy = f.y * sign * lim.max * PX, moved = corners.map(p => ({ x: p.x + dx, y: p.y + dy }));
            const [a, b] = sign > 0 ? [corners[0], corners[1]] : [corners[2], corners[3]], [c, d] = sign > 0 ? [moved[1], moved[0]] : [moved[3], moved[2]];
            drawPoly(svg, [a, b, c, d], `gp-lane ${cls}`); drawPoly(svg, moved, `gp-ghost ${cls}`);
            const mid = { x: (c.x + d.x) / 2 + f.x * sign * 14, y: (c.y + d.y) / 2 + f.y * sign * 14 };
            boardLabel(mid.x, mid.y, lim.charge ? `Charge ${fmt(lim.max)}″` : `${fmt(lim.max)}″`, lim.charge ? 'gp-hot' : '');
        };
        lane(o.forward, 1, o.forward.charge ? 'gp-charge' : 'gp-fwd'); lane(o.backward, -1, 'gp-back');
        for (const t of [...o.strike, ...o.shoot].filter(t => t.ok)) {
            const el = findEl(t.id), v = unit(t.id); if (!el || !v) continue;
            el.classList.add('gp-target'); el.classList.toggle('gp-target-chosen', pendingTarget === t.id);
            if (pendingTarget === t.id) boardLabel(v.x + v.w / 2, v.y - 20, `${previewText(t.preview)} — click again to ${o.strike.includes(t) ? 'strike' : 'shoot'}`, 'gp-hot');
        }
        return o;
    }

    function showEvents() {
        if (!game) return;
        if (shownSeq === null) { shownSeq = game.seq; return; }
        for (const e of game.events.filter(e => e.seq > shownSeq)) {
            if (e.type === 'attack') {
                renderDiceRoll([...e.rolls, ...e.bonus]);
                floatText(e.x, e.y, e.strain ? `+${e.strain} strain` : 'No effect', e.strain ? 'gp-float-hit' : 'gp-float-miss');
            } else if (e.type === 'rout') floatText(e.x, e.y - 22, `${e.name} routs!`, 'gp-float-rout');
            else if (e.type === 'rally') floatText(e.x, e.y, `Rally −${e.removed}`, 'gp-float-miss');
        }
        shownSeq = game.seq;
    }
    function floatText(x, y, text, cls) {
        const el = document.createElement('div'); el.className = `gp-float ${cls}`; el.textContent = text;
        el.style.left = `${x}px`; el.style.top = `${y}px`; table.appendChild(el); setTimeout(() => el.remove(), 2600);
    }

    function render() {
        const panel = document.getElementById('guided-play'); if (!panel) return;
        const g = ensure(); panel.replaceChildren();
        if (!g.units.length && g.phase === 'draft') return;
        syncBoard(); showEvents();
        const options = drawOverlay();
        const add = (tag, text, cls, parent = panel) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; parent.appendChild(el); return el; };
        const button = (name, fn, disabled = false, why = '', cls = 'btn-blue', parent = panel) => { const b = add('button', name, cls, parent); b.type = 'button'; b.disabled = disabled; if (why) b.title = why; b.onclick = fn; return b; };
        const row = (cls = '') => add('div', undefined, `gp-row ${cls}`);

        if (g.phase === 'draft') {
            const p = g.draft.picker, mine = controls(p), picked = unit(g.draft.picked);
            add('h3', `Draft · ${who(p)} ${who(p) === 'You' ? 'pick' : 'picks'}`);
            add('p', `${army('p1').length + army('p2').length} of ${g.units.length} units deployed.`, 'gp-sub');
            if (!mine) add('p', p === aiPlayer ? 'The AI is choosing…' : 'Waiting for your opponent. You can still select units to inspect them.');
            else if (g.draft.step === 'pick') {
                const top = g.terrainDeck[0], named = top && E.TERRAIN[top];
                add('p', `Click a unit in the centre, then draft it. ${!top ? 'The terrain stack is empty.' : named ? `The top terrain tile is ${getTerrainCardLabel(top)}: you must place it on the unit you draft.` : 'The top terrain tile is open ground, so nothing will be placed.'}`);
                const ok = selectedPiece?.classList.contains('unit') && !selectedPiece.dataset.owner;
                button(ok ? `Draft ${selectedPiece.dataset.name}` : 'Select a unit', pick, !ok);
            } else if (g.draft.step === 'terrain') {
                add('p', `Place the ${getTerrainCardLabel(g.terrainDeck[0])} tile so it overlaps ${picked.name}. Drag the terrain card onto the board, or place it automatically. It can’t touch other terrain, a deployment zone or the edge.`);
                button('Place on the unit', placeTerrainAuto);
            } else {
                add('p', `Drag ${picked.name} into ${who(p) === 'You' ? 'your' : `${label(p)}’s`} deployment zone (${p === 'p1' ? 'bottom' : 'top'} strip). Drag its ring or use the mouse wheel to turn it.`);
                const r = row(); button('Confirm position', deploy, false, '', 'btn-blue', r); button('Place for me', deployAuto, false, '', 'btn-grey', r);
            }
        } else if (g.phase === 'bidding') {
            add('h3', `Round ${g.round} · Bid for Master Tactician`);
            add('p', 'Bid = how many units you can command this round. The lower bid becomes Master Tactician and acts first and last.', 'gp-sub');
            if (!connected() && !aiPlayer) add('p', 'Shared screen: bid one at a time while the other player looks away.', 'gp-sub');
            for (const p of ['p1', 'p2']) {
                add('strong', `${who(p)}${g.master === p ? ' (current Master Tactician)' : ''}`);
                if (biddingState[p].ready) add('p', 'Bid placed — hidden until both are in.', 'gp-sub');
                else if (p === aiPlayer) add('p', 'Deciding…', 'gp-sub');
                else if (!controls(p)) add('p', 'Thinking…', 'gp-sub');
                else if (!connected() && !aiPlayer && p === 'p2' && !biddingState.p1.ready) add('p', 'Bids after Player 1.', 'gp-sub');
                else { const r = row('gp-bids'); for (let n = 1; n <= army(p).length; n++) button(String(n), () => bid(p, n), false, `Bid ${n}`, 'btn-blue gp-bid', r); }
            }
        } else if (g.phase === 'command') {
            const p = E.activePlayer(g), mine = controls(p), turn = ['Master Tactician’s first turn', 'Other player’s turn', 'Master Tactician’s second turn'][g.turnStep];
            add('h3', `Round ${g.round} · ${who(p) === 'You' ? 'Your turn' : `${who(p)}’s turn`}`);
            add('p', `${turn}. ${label(g.master)} is Master Tactician.`, 'gp-sub');
            const chips = row('gp-chips');
            for (const q of ['p1', 'p2']) add('span', `${who(q)}: ${g.commands[q]} command${g.commands[q] === 1 ? '' : 's'} left`, `gp-chip ${q === p ? 'gp-chip-on' : ''}`, chips);
            if (!mine) add('p', p === aiPlayer ? 'The AI is thinking…' : 'Waiting for your opponent…');
            else {
                const id = currentUnitId(), u = id && unit(id), o = options;
                if (!u || !o || !o.canAct) {
                    add('p', o && o.reason ? o.reason : 'Click one of your highlighted units. Then drag it to move, drag its ring to pivot, or click an enemy to attack. Its first order spends a command.');
                } else {
                    const act = o.activation, pivotsLeft = Math.max(0, u.mobility - act.pivots);
                    add('strong', `${u.name}${o.activated ? '' : ' (not yet activated)'}`);
                    add('p', `Action: ${act.action ? ({ move: 'Move', shoot: 'Shoot', strike: 'Strike', rally: 'Rally', extraPivot: 'Extra Pivot' })[act.action] + (act.action === 'move' ? ` (${fmt(act.moved)}″ so far)` : '') : 'available'} · Pivots left: ${pivotsLeft}${o.pivot.usesAction ? ' (+1 as your action)' : ''}${u.strain ? ` · Strain ${u.strain}/7` : ''}`, 'gp-sub');
                    if (o.freeStrike) add('p', 'Charge! Click a touching enemy for a free Strike.', 'gp-callout');
                    const targets = [...o.strike.map(t => ({ ...t, kind: 'Strike' })), ...o.shoot.filter(t => t.ok).map(t => ({ ...t, kind: 'Shoot' }))];
                    for (const t of targets) button(`${t.kind} ${unit(t.id).name} — ${previewText(t.preview)}`, () => attack(t.id), false, t.preview.mods.map(m => `${m.dice > 0 ? '+' : '−'}1 ${m.label}`).join(', '), `btn-gold gp-attack ${pendingTarget === t.id ? 'gp-chosen' : ''}`);
                    const move = row();
                    if (o.forward.max > 0.05) button(o.forward.charge ? `Charge (${fmt(o.forward.max)}″)` : `Advance ${fmt(o.forward.max)}″`, () => moveBy(o.forward.max, false), false, 'Or drag the unit for a shorter move', 'btn-blue', move);
                    if (o.backward.max > 0.05) button(`Back ${fmt(o.backward.max)}″`, () => moveBy(o.backward.max, true), false, 'Or drag the unit', 'btn-grey', move);
                    if (!move.children.length) { move.remove(); if (o.actionFree && (o.forward.reason || o.backward.reason)) add('p', `Move: ${o.forward.reason || o.backward.reason}`, 'gp-sub'); }
                    if (o.pivot.remaining > 0 && (o.pivot.left || o.pivot.right)) {
                        const r = row('gp-pivots'); add('span', o.pivot.usesAction ? 'Extra Pivot' : 'Pivot', 'gp-row-label', r);
                        for (const deg of [-90, -45, -15, 15, 45, 90]) button(`${deg < 0 ? '↺' : '↻'}${Math.abs(deg)}°`, () => pivotBy(deg), Math.abs(deg) > (deg < 0 ? o.pivot.left : o.pivot.right), 'Or drag the ring around the unit', 'btn-grey gp-pivot', r);
                    } else if (o.pivot.reason && !o.inContact) add('p', `Pivot: ${o.pivot.reason}`, 'gp-sub');
                    if (o.canRally) button('Rally (remove d6 ÷ 2 strain, rounded up)', rally, false, '', 'btn-grey');
                    const blocked = o.shoot.filter(t => !t.ok);
                    if (blocked.length && o.actionFree) { const d = add('details', undefined, 'gp-blocked'); add('summary', `Why can’t I shoot…? (${blocked.length})`, '', d); blocked.forEach(t => add('p', `${unit(t.id).name}: ${t.reason}`, 'gp-sub', d)); }
                    if (o.activated) button('End activation', endActivation, false, '', 'btn-blue gp-end');
                }
                const r = row('gp-turn');
                button(g.turnStep === 2 ? 'Pass — end the round' : 'Pass turn', pass, false, 'Unspent commands are kept for a later turn only by the Master Tactician', 'btn-grey', r);
                if (!connected()) button('Undo', () => undo(), !undoStack.length || aiBusy, 'Z', 'btn-grey', r);
            }
        } else if (g.phase === 'finished') {
            add('h3', `${who(g.winner) === 'You' ? 'You win' : `${who(g.winner)} wins`} the battle`);
            add('p', `${g.routed[other(g.winner)]} of ${g.starting[other(g.winner)]} enemy units routed.`);
            if (typeof resetGame === 'function' && (!connected() || isHost)) button('New battle', () => resetGame());
        }
        if (message) { const e = add('p', message, 'guided-error'); e.setAttribute('role', 'alert'); panel.insertBefore(e, panel.children[1] || null); }
        if (g.log.length) {
            const details = add('details', undefined, 'gp-log'); details.open = g.phase !== 'draft'; add('summary', 'Battle log', '', details);
            g.log.slice(0, 25).forEach(line => add('p', line, '', details));
        }
        document.getElementById('bidding-turn-panel').hidden = true;
        document.getElementById('draft-notice-banner').style.display = 'none';
        const section = document.getElementById('terrain-section'), inDraft = g.phase === 'draft';
        // The top tile is face up for the whole draft, so both players can plan around it.
        section.hidden = !inDraft; section.style.display = inDraft ? '' : 'none';
        const hint = section.querySelector('.sidebar-description');
        if (inDraft && g.terrainDeck.length) {
            const open = !E.TERRAIN[g.terrainDeck[0]], title = document.getElementById('terrain-card-title'), cardNote = document.getElementById('terrain-card-note');
            if (title && open) title.textContent = 'Open';
            if (cardNote) cardNote.textContent = open ? 'Open ground: nothing to place' : 'Goes on the next drafted unit';
        }
        if (hint && inDraft) hint.textContent = g.draft.step === 'terrain' && controls(g.draft.picker) ? 'Drag this tile onto the unit you chose.' : 'Top tile of the stack. Whoever drafts next must place it on their unit.';
        table.classList.add('guided-board');
        if (aiPlayer && !aiBusy && aiToMove()) setTimeout(runAI, 0);
    }

    window.addEventListener('keydown', e => {
        if (!game || e.target?.tagName === 'INPUT') return;
        if (e.key === 'Escape' && pendingTarget) { pendingTarget = null; render(); }
        if (e.key === 'Enter' && game.phase === 'command' && game.activation && controls(E.activePlayer(game))) { e.preventDefault(); endActivation(); }
    });

    return {
        render, ensure, reset, snapshot, restore, note, incoming, canDrag, constrainDrag, dropPiece, constrainRotation, dropRotation, rotate, tap,
        pick, deploy, pass, bid, reveal, placeTerrain, attack, endActivation,
        setAI, aiNote: () => aiNote,
        act: a => act(a), state: () => ensure(), counts: () => ({ p1: army('p1').length, p2: army('p2').length }),
        terrainDrop(pointer, type) { if (game.terrainDeck[0] === type) placeTerrain(pointer.x, pointer.y); },
        terrainAllowed() { ensure(); return game.phase === 'draft' && game.draft.step === 'terrain' && controls(game.draft.picker); }
    };
})();

/** Start a single-player battle: the human is Player 1 at the bottom, the AI is Player 2. */
function playVsAI(level) {
    hostGameFromLanding();
    GuidedPlay.setAI('p2', level || 'normal');
    GuidedPlay.render();
}
