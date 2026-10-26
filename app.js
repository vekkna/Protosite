// --- CONFIGURATION ---
const SCALE = 20;
const TABLE_WIDTH_FT = 4;
const TABLE_DEPTH_FT = 3;
const DEFAULT_UNIT_FOOTPRINT = 'SW';
const UNIT_FOOTPRINTS_MM = {
    SN: { width: 63, depth: 88 },
    SW: { width: 88, depth: 63 },
    L: { width: 126, depth: 88 },
    LW: { width: 177, depth: 63 },
    LN: { width: 88, depth: 126 }
};
const TERRAIN_TYPES = ['forest', 'hills', 'field', 'swamp', 'mountain'];
const TERRAIN_NO_FEATURE_CARD = 'x';
const TERRAIN_CARD_ANIMATION_MS = 180;
const DEPLOY_INCHES = 6;
const THREAT_RANGE_INCHES = 12;
const UNIT_HIT_POINTS = 5;
const ARCHER_SHOOTING_VALUES = [2, 3, 4];
const SAVE_KEY = 'wargameSave_v6';
const UI_STATE_KEY = 'wargameUiState_v1';
const TOOLTIP_HOVER_DELAY_MS = 350;
const TOOLTIP_SUPPRESS_AFTER_MANIPULATION_MS = 300;
const DRAG_THRESHOLD_PX = 8;
const UNIT_LONG_PRESS_MS = 500;
const TOUCH_ROTATION_STEP_DEG = 5;
const UNIT_LABEL_MAX_FONT_PX = 10.5;
const UNIT_LABEL_MIN_FONT_PX = 4.5;
const UNIT_LABEL_FONT_STEP_PX = 0.25;

// --- CONVERSIONS ---
const mmToInches = (mm) => mm / 25.4;
const inchesToPx = (inch) => inch * SCALE;
const pxToInches = (px) => (px / SCALE).toFixed(1);

// --- REMOTE SANDBOX STATE & SHELL CONTROLS ---
const ACTIVE_GAMES_KEY = 'seize_the_day_active_games_v1';
const getGameSaveKey = (roomCode) => 'seize_the_day_save_' + (roomCode || '').toUpperCase();

let currentRoomCode = '';
let isRoomCodeHidden = true;
let peer = null;
let conn = null;
let isHost = false;
let roundState = null;
let biddingState = {
    p1: { value: 1, ready: false },
    p2: { value: 1, ready: false },
    revealed: false,
    master: null,
    round: 1,
    turnStep: 0, // 0: MT 1st Turn, 1: Player X Turn, 2: MT 2nd Turn
    firstDraftPick: 'p1',
    firstRoundTieWinner: 'p2'
};
let commandTokens = [];
let statsTooltipTimer = null;
let isRightSidebarHidden = false;
let isMultiplayerPanelCollapsed = false;

function loadActiveGamesList() {
    try {
        const raw = localStorage.getItem(ACTIVE_GAMES_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.warn('Unable to load active games list:', e);
        return [];
    }
}

function saveActiveGamesList(list) {
    try {
        localStorage.setItem(ACTIVE_GAMES_KEY, JSON.stringify(list));
    } catch (e) {
        console.warn('Unable to save active games list:', e);
    }
}

function addOrUpdateActiveGame(meta) {
    if (!meta || !meta.roomCode) return;
    const cleanCode = meta.roomCode.toUpperCase();
    const list = loadActiveGamesList();
    const index = list.findIndex(g => g.roomCode === cleanCode);
    const entry = {
        roomCode: cleanCode,
        role: meta.role || (meta.isHost ? 'p1' : 'p2'),
        isHost: meta.isHost !== undefined ? Boolean(meta.isHost) : meta.role === 'p1',
        round: meta.round || 1,
        firstDraftPick: meta.firstDraftPick || 'p1',
        firstRoundTieWinner: meta.firstRoundTieWinner || 'p2',
        lastPlayed: meta.lastPlayed || Date.now()
    };
    if (index >= 0) {
        list[index] = { ...list[index], ...entry };
    } else {
        list.unshift(entry);
    }
    saveActiveGamesList(list);
    renderActiveGamesUI();
}

function removeActiveGame(roomCode) {
    if (!roomCode) return;
    const cleanCode = roomCode.toUpperCase();
    const list = loadActiveGamesList().filter(g => g.roomCode !== cleanCode);
    saveActiveGamesList(list);
    try {
        localStorage.removeItem(getGameSaveKey(cleanCode));
    } catch (e) {}
    renderActiveGamesUI();
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Recently';
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function renderActiveGamesUI() {
    const container = document.getElementById('landing-active-games');
    const listEl = document.getElementById('active-games-list');
    if (!container || !listEl) return;

    const list = loadActiveGamesList();
    if (!list || list.length === 0) {
        container.style.display = 'none';
        listEl.innerHTML = '';
        return;
    }

    container.style.display = 'flex';
    listEl.innerHTML = '';

    list.forEach(game => {
        const item = document.createElement('div');
        item.className = 'active-game-item';

        const info = document.createElement('div');
        info.className = 'active-game-info';

        const badges = document.createElement('div');
        badges.className = 'active-game-badges';

        const roleBadge = document.createElement('span');
        roleBadge.className = `option-badge ${game.role === 'p1' ? 'badge-p1' : 'badge-p2'}`;
        roleBadge.textContent = game.role === 'p1' ? 'Player 1' : 'Player 2';

        const codeStrong = document.createElement('strong');
        codeStrong.className = 'active-game-code';
        codeStrong.textContent = game.roomCode;

        badges.appendChild(roleBadge);
        badges.appendChild(codeStrong);

        const meta = document.createElement('div');
        meta.className = 'active-game-meta';
        meta.textContent = `Round ${game.round || 1} · ${formatTimeAgo(game.lastPlayed)}`;

        info.appendChild(badges);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'active-game-actions';

        const resumeBtn = document.createElement('button');
        resumeBtn.className = 'btn-blue btn-sm active-resume-btn';
        resumeBtn.textContent = 'Resume';
        resumeBtn.onclick = () => resumeGame(game.roomCode);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-grey btn-sm active-delete-btn';
        deleteBtn.textContent = '✕';
        deleteBtn.title = 'Remove active game';
        deleteBtn.setAttribute('aria-label', `Remove battle ${game.roomCode}`);
        deleteBtn.onclick = (e) => deleteActiveGame(game.roomCode, e);

        actions.appendChild(resumeBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(info);
        item.appendChild(actions);
        listEl.appendChild(item);
    });
}

function toggleRoomCodeArea() {
    isRoomCodeHidden = !isRoomCodeHidden;
    updateRoomCodeVisibility();
    saveUIState();
}

function updateRoomCodeVisibility() {
    const area = document.getElementById('room-code-area');
    const btn = document.getElementById('toggle-room-code-btn');
    const header = document.getElementById('player-banner-top');
    const banner = document.getElementById('player-banner');
    if (!area) return;
    area.inert = isRoomCodeHidden;
    area.setAttribute('aria-hidden', String(isRoomCodeHidden));

    if (isRoomCodeHidden) {
        area.classList.add('is-tucked');
        if (banner) banner.classList.add('is-tucked');
        if (btn) {
            btn.setAttribute('aria-expanded', 'false');
            btn.title = 'Show hosting info';
            btn.setAttribute('aria-label', 'Show hosting info');
        }
        if (header) {
            header.setAttribute('aria-expanded', 'false');
            header.title = 'Expand room code';
        }
    } else {
        area.classList.remove('is-tucked');
        if (banner) banner.classList.remove('is-tucked');
        if (btn) {
            btn.setAttribute('aria-expanded', 'true');
            btn.title = 'Hide hosting info';
            btn.setAttribute('aria-label', 'Hide hosting info');
        }
        if (header) {
            header.setAttribute('aria-expanded', 'true');
            header.title = 'Tuck room code';
        }
    }
}

function updateDraftNoticeUI() {
    const banner = document.getElementById('draft-notice-banner');
    const text = document.getElementById('draft-notice-text');
    if (!banner || !text) return;

    if (biddingState.round > 1 || biddingState.revealed) {
        banner.style.display = 'none';
        return;
    }

    const firstPick = biddingState.firstDraftPick || 'p1';
    const localKey = getLocalBidPlayerKey();

    banner.style.display = 'block';
    if (firstPick === localKey) {
        text.innerHTML = `<strong>You take the first draft pick!</strong><br><span class="draft-sub">Opponent wins ties in Round 1.</span>`;
    } else {
        text.innerHTML = `<strong>Opponent takes the first draft pick.</strong><br><span class="draft-sub">You win ties in Round 1.</span>`;
    }
}

function hasBattleStarted() {
    return Boolean(biddingState.battleStarted || biddingState.revealed || biddingState.round > 1);
}

function updateTerrainVisibility() {
    const deploying = !hasBattleStarted();
    table.classList.toggle('is-deploying', deploying);
    ['deployment-zone-top', 'deployment-zone-bottom'].forEach(id => {
        const zone = document.getElementById(id);
        if (zone) zone.style.height = `${inchesToPx(DEPLOY_INCHES)}px`;
    });
    const section = document.getElementById('terrain-section');
    if (section) {
        section.hidden = hasBattleStarted();
        section.style.display = section.hidden ? 'none' : '';
    }
}

function loadUIState() {
    try {
        const savedState = JSON.parse(localStorage.getItem(UI_STATE_KEY) || '{}');
        isMultiplayerPanelCollapsed = Boolean(savedState.isMultiplayerPanelCollapsed);
        isRoomCodeHidden = savedState.isRoomCodeHidden !== false;
    } catch (err) {
        console.warn("Unable to load UI state:", err);
    }
}

function saveUIState() {
    try {
        localStorage.setItem(UI_STATE_KEY, JSON.stringify({
            isMultiplayerPanelCollapsed,
            isRoomCodeHidden
        }));
    } catch (err) {
        console.warn("Unable to save UI state:", err);
    }
}

function getLocalBidPlayerKey() {
    return isHost ? 'p1' : 'p2';
}

function getOpponentPlayerKey() {
    return isHost ? 'p2' : 'p1';
}

function updateBiddingUI() {
    const roundLabel = document.getElementById('round-status');
    if (roundLabel) roundLabel.textContent = `Round ${biddingState.round} · Initiative`;
    updateTerrainVisibility();
    updateDraftNoticeUI();
    const localKey = getLocalBidPlayerKey();
    const biddingZone = document.getElementById('bidding-zone');
    const turnZone = document.getElementById('turn-zone');
    if (!biddingZone || !turnZone) return;

    if (biddingState.revealed) {
        biddingZone.style.display = 'none';
        turnZone.style.display = 'flex';
        updateTurnZoneUI();
    } else {
        biddingZone.style.display = 'flex';
        turnZone.style.display = 'none';

        const inputWrap = document.getElementById('bid-input-wrap');
        const lockedWrap = document.getElementById('bid-locked-wrap');
        const myLockedVal = document.getElementById('my-locked-bid-val');
        const myInput = document.getElementById('my-bid-input');

        if (inputWrap && lockedWrap && myLockedVal && myInput) {
            if (biddingState[localKey].ready) {
                inputWrap.style.display = 'none';
                lockedWrap.style.display = 'flex';
                myLockedVal.textContent = biddingState[localKey].value;
            } else {
                inputWrap.style.display = 'flex';
                lockedWrap.style.display = 'none';
                myInput.value = biddingState[localKey].value || 1;
            }
        }

        updateOpponentBidStatusUI();
        checkRevealReadiness();
    }
}

function updateOpponentBidStatusUI() {
    const oppKey = getOpponentPlayerKey();
    const dot = document.getElementById('opponent-status-dot');
    const text = document.getElementById('opponent-bid-text');
    if (!dot || !text) return;

    const isPeerConnected = Boolean(conn && conn.open);
    if (!isPeerConnected) {
        dot.classList.remove('is-ready');
        text.textContent = 'Not connected';
        text.title = 'No peer connected yet. Setting your bid enables Reveal.';
        return;
    }

    if (biddingState[oppKey].ready) {
        dot.classList.add('is-ready');
        text.textContent = 'Ready ✓';
    } else {
        dot.classList.remove('is-ready');
        text.textContent = 'Waiting...';
    }
}

function checkRevealReadiness() {
    const btn = document.getElementById('reveal-bids-btn');
    if (!btn) return;
    const localKey = getLocalBidPlayerKey();
    const isPeerConnected = Boolean(conn && conn.open);
    const canReveal = isPeerConnected
        ? (biddingState.p1.ready && biddingState.p2.ready)
        : Boolean(biddingState[localKey].ready);
    btn.disabled = !canReveal;
    const help = document.getElementById('bidding-help');
    const message = !biddingState[localKey].ready
        ? 'Choose 1–6 commands, then set your bid.'
        : !isPeerConnected
            ? 'Your bid is set. You can reveal to try a solo round.'
            : canReveal ? 'Both bids are set. Ready to reveal.' : 'Your bid is set. Waiting for your opponent.';
    if (help) help.textContent = message;
    btn.title = canReveal ? 'Reveal the bids and begin the round' : message;
}

function normalizeCommandBid(value) {
    const parsed = parseInt(value, 10);
    return Math.max(1, Math.min(6, Number.isFinite(parsed) ? parsed : 1));
}

function adjustLocalBid(step) {
    const localKey = getLocalBidPlayerKey();
    if (biddingState.revealed || biddingState[localKey].ready) return;
    const input = document.getElementById('my-bid-input');
    if (!input) return;
    const value = normalizeCommandBid(normalizeCommandBid(input.value) + step);
    input.value = value;
    biddingState[localKey].value = value;
}

function lockLocalBid() {
    const localKey = getLocalBidPlayerKey();
    const input = document.getElementById('my-bid-input');
    const val = normalizeCommandBid(input.value);
    biddingState[localKey].value = val;
    biddingState[localKey].ready = true;
    updateBiddingUI();
    sendData({ type: 'BID_READY', player: localKey, ready: true });
    saveGame();
}

function unlockLocalBid() {
    const localKey = getLocalBidPlayerKey();
    biddingState[localKey].ready = false;
    updateBiddingUI();
    sendData({ type: 'BID_READY', player: localKey, ready: false });
    saveGame();
    const input = document.getElementById('my-bid-input');
    if (input && input.focus) input.focus();
}

function triggerRevealBids() {
    checkRevealReadiness();
    const revealButton = document.getElementById('reveal-bids-btn');
    if (revealButton && revealButton.disabled) return;
    const localKey = getLocalBidPlayerKey();
    sendData({ type: 'REVEAL_BIDS', player: localKey, bid: biddingState[localKey].value });
    executeRevealBids();
}

function executeRevealBids() {
    biddingState.battleStarted = true;
    biddingState.revealed = true;
    const localKey = getLocalBidPlayerKey();
    const oppKey = getOpponentPlayerKey();
    const isPeerConnected = Boolean(conn && conn.open);
    if (!isPeerConnected && !biddingState[oppKey].ready) {
        biddingState[oppKey].value = biddingState[oppKey].value || biddingState[localKey].value || 1;
        biddingState[oppKey].ready = true;
    }
    const p1 = normalizeCommandBid(biddingState.p1.value);
    biddingState.p1.value = p1;
    const p2 = normalizeCommandBid(biddingState.p2.value);
    biddingState.p2.value = p2;

    let master;
    if (p1 < p2) {
        master = 'p1';
    } else if (p2 < p1) {
        master = 'p2';
    } else {
        // Tied bid
        if (biddingState.round <= 1) {
            master = biddingState.firstRoundTieWinner || (biddingState.firstDraftPick === 'p1' ? 'p2' : 'p1');
        } else {
            master = roundState.master || biddingState.master || (biddingState.firstDraftPick === 'p1' ? 'p2' : 'p1');
        }
    }
    biddingState.master = master;
    biddingState.turnStep = 0;

    try {
        roundState = CommandTracker.start(roundState, { p1, p2 }, { p1: 6, p2: 6 });
    } catch(err) {
        console.warn('CommandTracker.start note:', err);
    }

    // Spawn command tokens equal to each player's bid
    commandTokens = [];
    for (let i = 0; i < p1; i++) {
        commandTokens.push({
            id: `cmd-p1-${i}`,
            player: 'p1',
            num: i + 1,
            status: 'tray'
        });
    }
    for (let i = 0; i < p2; i++) {
        commandTokens.push({
            id: `cmd-p2-${i}`,
            player: 'p2',
            num: i + 1,
            status: 'tray'
        });
    }

    updateBiddingUI();
    renderAllCommandTokens();
    updateSelectionRanges();
    saveGame();
}

function getActivePlayerKey() {
    if (biddingState.turnStep === 0 || biddingState.turnStep === 2) {
        return biddingState.master;
    }
    return biddingState.master === 'p1' ? 'p2' : 'p1';
}

function updateTurnZoneUI() {
    const masterLabel = document.getElementById('mt-player-label');
    const bidsSummary = document.getElementById('mt-bids-summary');
    const turnTitle = document.getElementById('current-turn-title');
    const passBtn = document.getElementById('pass-turn-btn');

    if (!masterLabel || !bidsSummary || !turnTitle || !passBtn) return;

    const localKey = getLocalBidPlayerKey();
    const isMaster = (biddingState.master === localKey);
    masterLabel.textContent = isMaster ? 'MT: You' : 'MT: Opponent';
    masterLabel.setAttribute('aria-label', isMaster ? 'You are Master Tactician' : 'Your opponent is Master Tactician');
    bidsSummary.textContent = `You: ${biddingState[localKey].value} · Opponent: ${biddingState[getOpponentPlayerKey()].value}`;

    const activeKey = getActivePlayerKey();
    const isLocalActive = (activeKey === localKey);

    turnTitle.textContent = isLocalActive ? 'Your turn' : 'Opponent’s turn';
    const phaseLabel = document.getElementById('turn-phase-label');
    if (phaseLabel) phaseLabel.textContent = `Round ${biddingState.round} · ${['First', 'Second', 'Final'][biddingState.turnStep]} commands`;
    passBtn.textContent = biddingState.turnStep === 2 ? 'End round' : 'Pass turn';
    const turnHelp = document.getElementById('turn-help');
    if (turnHelp) turnHelp.textContent = isLocalActive ? 'Place your commands. Pass when you are finished.' : 'Your opponent is placing commands.';

    passBtn.disabled = !isLocalActive;
}

function handlePassTurn() {
    if (getActivePlayerKey() !== getLocalBidPlayerKey()) {
        return;
    }

    if (biddingState.turnStep === 0) {
        biddingState.turnStep = 1;
        try { roundState = CommandTracker.pass(roundState, biddingState.master); } catch(e) {}
        sendData({ type: 'PASS_TURN', turnStep: 1 });
        updateTurnZoneUI();
        saveGame();
    } else if (biddingState.turnStep === 1) {
        biddingState.turnStep = 2;
        const otherPlayer = biddingState.master === 'p1' ? 'p2' : 'p1';
        try { roundState = CommandTracker.pass(roundState, otherPlayer); } catch(e) {}
        sendData({ type: 'PASS_TURN', turnStep: 2 });
        updateTurnZoneUI();
        saveGame();
    } else if (biddingState.turnStep === 2) {
        // MT passes after their second turn -> Round ends!
        endRoundAndResetBidding(true);
    }
}

function endRoundAndResetBidding(shouldBroadcast = true) {
    try {
        roundState = CommandTracker.pass(roundState);
        roundState = CommandTracker.next(roundState);
    } catch(e) {}

    // When the MT passes after his second turn, the round ends, all command markers go away, and the bidding zone is reset.
    commandTokens = [];
    renderAllCommandTokens();

    biddingState.round = roundState.round || (biddingState.round + 1);
    biddingState.revealed = false;
    biddingState.turnStep = 0;
    biddingState.p1.ready = false;
    biddingState.p2.ready = false;
    biddingState.p1.value = 1;
    biddingState.p2.value = 1;

    updateBiddingUI();

    if (shouldBroadcast) {
        sendData({ type: 'ROUND_RESET' });
    }
    saveGame();
}

function updateBidUI() {
    updateBiddingUI();
}

function updateRoundUI() {
    updateBiddingUI();
    updateTurnZoneUI();
}

function updateRightSidebarUI() {
    const rightSidebar = document.getElementById('right-sidebar');
    const toggleBtn = document.getElementById('right-sidebar-toggle');
    if (!rightSidebar || !toggleBtn) return;

    rightSidebar.classList.toggle('sidebar-hidden', isRightSidebarHidden);

    const toggleSpan = toggleBtn.querySelector('span');
    if (toggleSpan) toggleSpan.innerText = isRightSidebarHidden ? '<' : '>';
    toggleBtn.setAttribute('aria-expanded', String(!isRightSidebarHidden));
    toggleBtn.setAttribute('aria-label', isRightSidebarHidden ? 'Show right sidebar' : 'Hide right sidebar');
    toggleBtn.title = isRightSidebarHidden ? 'Show right sidebar' : 'Hide right sidebar';
    toggleBtn.style.right = isRightSidebarHidden ? '0px' : `${rightSidebar.offsetWidth}px`;

    requestAnimationFrame(() => {
        fitTableToScreen();
    });
}

function toggleRightSidebar() {
    isRightSidebarHidden = !isRightSidebarHidden;
    updateRightSidebarUI();
}

function updateMultiplayerPanelUI() {
    const panel = document.getElementById('multiplayer-panel');
    const toggleBtn = document.getElementById('multiplayer-toggle');
    if (!panel || !toggleBtn) return;

    panel.classList.toggle('is-collapsed', isMultiplayerPanelCollapsed);
    toggleBtn.setAttribute('aria-expanded', String(!isMultiplayerPanelCollapsed));
    toggleBtn.setAttribute('aria-label', isMultiplayerPanelCollapsed ? 'Show game setup section' : 'Hide game setup section');
    toggleBtn.title = isMultiplayerPanelCollapsed ? 'Show game setup section' : 'Hide game setup section';
}

function toggleMultiplayerPanel() {
    isMultiplayerPanelCollapsed = !isMultiplayerPanelCollapsed;
    saveUIState();
    updateMultiplayerPanelUI();
}

function updateMultiplayerControlsUI() {
    const hostBtn = document.getElementById('host-btn');
    const myIdDisplay = document.getElementById('my-id-display');
    const copyBtn = document.getElementById('copy-btn');
    const joinInput = document.getElementById('join-input');
    const joinBtn = document.getElementById('join-btn');
    if (!hostBtn || !myIdDisplay || !copyBtn || !joinInput || !joinBtn) return;

    const isHosting = Boolean(isHost);
    hostBtn.style.display = isHosting ? 'none' : 'block';
    myIdDisplay.style.display = isHosting ? 'block' : 'none';
    copyBtn.style.display = isHosting ? 'block' : 'none';
    joinInput.style.display = isHosting ? 'none' : 'block';
    joinBtn.style.display = isHosting ? 'none' : 'block';
}

function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function updateFullscreenUI() {
    const button = document.getElementById('fullscreen-btn');
    if (!button) return;

    const root = document.documentElement;
    const supported = Boolean(root && (root.requestFullscreen || root.webkitRequestFullscreen));
    const isFullscreen = Boolean(getFullscreenElement());
    button.disabled = !supported;
    button.innerText = isFullscreen ? 'Exit Full Screen' : 'Full Screen';
    button.title = supported
        ? (isFullscreen ? 'Exit full screen' : 'Open game in full screen')
        : 'Full screen is unavailable in this browser';
    const help = document.getElementById('display-help');
    if (help) help.textContent = !supported
        ? 'Full screen is unavailable in this browser. You can still play here.'
        : isFullscreen ? 'Use Exit Full Screen to return to your browser.'
        : 'Full screen gives the battlefield more room.';
    updateLandscapeUI();
}

function updateLandscapeUI() {
    const button = document.getElementById('landscape-btn');
    if (!button) return;
    const root = document.documentElement;
    const orientation = window.screen && window.screen.orientation;
    button.hidden = !(orientation && typeof orientation.lock === 'function'
        && (getFullscreenElement() || (root && root.requestFullscreen)));
    button.textContent = getFullscreenElement() ? 'Use Landscape' : 'Landscape + Full Screen';
}

async function requestLandscape() {
    const help = document.getElementById('landscape-help');
    const button = document.getElementById('landscape-btn');
    if (button) button.disabled = true;
    try {
        const orientation = window.screen && window.screen.orientation;
        if (!orientation || typeof orientation.lock !== 'function') throw new Error('Orientation locking unavailable');
        // Fullscreen is requested only by this explicitly labelled user action.
        if (!getFullscreenElement()) await document.documentElement.requestFullscreen();
        await orientation.lock('landscape');
        if (help) help.textContent = 'Landscape enabled. Exit full screen to return to normal rotation.';
    } catch (err) {
        if (help) help.textContent = 'Rotate your device sideways. If it stays upright, enable auto-rotate or turn off orientation lock. This browser could not switch automatically.';
    } finally {
        if (button) button.disabled = false;
        updateFullscreenUI();
        fitTableToScreen();
    }
}

async function toggleFullscreen() {
    const root = document.documentElement;
    if (!root) return;
    try {
        if (getFullscreenElement()) {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        } else if (root.requestFullscreen) {
            await root.requestFullscreen();
        } else if (root.webkitRequestFullscreen) {
            root.webkitRequestFullscreen();
        }
    } catch (err) {
        console.warn('Unable to toggle full screen:', err);
    }

    updateFullscreenUI();
}

function releaseLandscapeLock() {
    const orientation = window.screen && window.screen.orientation;
    if (orientation && typeof orientation.unlock === 'function') {
        try { orientation.unlock(); } catch (err) { /* Browser already released the lock. */ }
    }
}

function handleFullscreenChange() {
    if (!getFullscreenElement()) releaseLandscapeLock();
    updateFullscreenUI();
    requestAnimationFrame(() => {
        fitTableToScreen();
        requestAnimationFrame(fitTableToScreen);
    });
}

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

const tableWidthPx = inchesToPx(TABLE_WIDTH_FT * 12);
const tableHeightPx = inchesToPx(TABLE_DEPTH_FT * 12);
const defaultUnitSizePx = getUnitSizePx({ Footprint: DEFAULT_UNIT_FOOTPRINT });
const terrainDiameterPx = Math.max(defaultUnitSizePx.width, defaultUnitSizePx.height);

function getUnitFootprint(stats) {
    const footprint = ((stats && stats.Footprint) || DEFAULT_UNIT_FOOTPRINT).trim().toUpperCase();
    return UNIT_FOOTPRINTS_MM[footprint] ? footprint : DEFAULT_UNIT_FOOTPRINT;
}

function getUnitSizePx(stats) {
    const footprint = getUnitFootprint(stats);
    const sizeMm = UNIT_FOOTPRINTS_MM[footprint];
    return {
        footprint,
        width: inchesToPx(mmToInches(sizeMm.width)),
        height: inchesToPx(mmToInches(sizeMm.depth))
    };
}

// --- SETUP TABLE ---
const table = document.getElementById('game-table');
table.style.width = `${tableWidthPx}px`;
table.style.height = `${tableHeightPx}px`;

// --- GAME STATE ---
let activePiece = null;
let ghostPiece = null;
let isMeasuring = false;
let anchorX = 0;
let anchorY = 0;
let hoveredUnit = null;
let hoveredTerrain = null;
let angleIndicatorTimer = null;
let rotationPivotTarget = null;
let rotationPivotStartAngle = 0;
let suppressTooltipUntil = 0;
let selectedPiece = null;
let activePointerId = null;
let pendingDragPiece = null;
let rotatingPiece = null;
let rotationDragStartAngle = 0;
let rotationDragLastPointerAngle = 0;
let rotationDragPointerDelta = 0;
let rotationDragUndoPushed = false;
let rotationDragCenterX = 0;
let rotationDragCenterY = 0;
let pointerStartX = 0;
let pointerStartY = 0;
let isDraggingPiece = false;
let activeTableRect = null;
let activePieceHalfWidth = 0;
let activePieceHalfHeight = 0;
let pendingPointerMove = null;
let pointerMoveFrame = null;
let measurementPointerId = null;
let didLongPressSelect = false;
let unitLongPressTimer = null;
let undoStack = [];
let terrainDeck = [];
let activeTerrainCardDrag = null;
roundState = CommandTracker.create();
let terrainCardRemoveTimer = null;
let terrainCardRevealTimer = null;
let isTerrainCardAnimating = false;
const MAX_UNDO = 20;

const lineElement = document.getElementById('measure-line');
const measureTextElement = document.getElementById('measure-text');

// --- RULEBOOK MODAL ---

function setModalVisibility(modalId, isVisible) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.style.display = isVisible ? 'flex' : 'none';
    modal.setAttribute('aria-hidden', String(!isVisible));

    if (isVisible) {
        const focusTarget = modal.querySelector('.modal-header button');
        if (focusTarget) {
            try {
                focusTarget.focus({ preventScroll: true });
            } catch (err) {
                focusTarget.focus();
            }
        }
    }
}

function openRulebook() {
    closeControlsHelp();
    closeMatchupAnalysis();
    setModalVisibility('rulebook-modal', true);
}

function closeRulebook() {
    setModalVisibility('rulebook-modal', false);
}

function openControlsHelp() {
    closeRulebook();
    closeMatchupAnalysis();
    setModalVisibility('controls-modal', true);
}

function closeControlsHelp() {
    setModalVisibility('controls-modal', false);
}

async function openMatchupAnalysis() {
    closeRulebook();
    closeControlsHelp();
    setModalVisibility('matchup-modal', true);

    const results = document.getElementById('matchup-results');
    if (results) {
        results.replaceChildren();
        const loading = document.createElement('p');
        loading.className = 'matchup-status';
        loading.textContent = 'Loading unit profiles…';
        results.appendChild(loading);
    }

    try {
        await loadStats();
        renderMatchupAnalysis();
    } catch (err) {
        console.error('Unable to load matchup data:', err);
        renderMatchupAnalysisError('Unit profiles could not be loaded. Please try again.');
    }
}

function closeMatchupAnalysis() {
    setModalVisibility('matchup-modal', false);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        clearPieceSelection();
        closeRulebook();
        closeControlsHelp();
        closeMatchupAnalysis();
    }
});

let globalRulesDB = [];

// --- RULES DATA LOADER ---
const RULES_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQXT5eF4DzRhJokOVdTb5g1Lnt6_gFkeh7oEdg2DLYAtY98FxybE-ijwA8uoWDiYtiBb0a3BM-ukWx9/pub?gid=2000929092&single=true&output=csv';

function loadRules() {
    Papa.parse(RULES_CSV_URL, {
        download: true,
        header: false,
        skipEmptyLines: true,
        complete: function (results) {
            globalRulesDB = results.data.map(row => ({
                keyword: row[0] ? row[0].trim() : "",
                effect: row[1] ? row[1].trim() : ""
            })).filter(r => r.keyword); // Remove empty rows

            console.log("Rules loaded:", globalRulesDB.length);
        },
        error: function (err) {
            console.log("No Rules CSV found (or error loading). Only manual 'Special' column will show.");
        }
    });
}

// Ensure this is called at startup
loadRules();

// --- STATS INTEGRATION ---
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1ONrDG-NfkjDlBoJvRlDNbhBSsCUkxlD_tbmZNQom1PU/export?format=csv&gid=663136589';
const STATS_CACHE_KEY = 'seize-the-day-unit-stats-cache-v4';
const DEFAULT_DRAFT_POOL_SIZE = 12;

let unitStatsDB = {};
let availableUnitRows = [];
let statsLoadPromise = null;
let statsLoadedFromSource = false;

function normalizeStatsRow(row) {
    const normalized = {};
    Object.entries(row || {}).forEach(([key, value]) => {
        const cleanKey = typeof key === 'string' ? key.trim() : key;
        normalized[cleanKey] = typeof value === 'string' ? value.trim() : value;
    });
    return normalized;
}

function setStatsData(rows, persistCache = false) {
    const nextStatsDB = {};
    const nextAvailableUnitRows = [];

    rows.forEach(rawRow => {
        const row = normalizeStatsRow(rawRow);
        const unitName = row.Unit ? row.Unit.trim() : "";
        if (!unitName) {
            console.warn("Skipped row (Missing 'Unit' column):", rawRow);
            return;
        }

        row.Unit = unitName;
        nextStatsDB[unitName] = row;
        nextAvailableUnitRows.push(row);
    });

    unitStatsDB = nextStatsDB;
    availableUnitRows = nextAvailableUnitRows;

    if (persistCache) {
        try {
            localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({
                source: SHEET_URL,
                timestamp: Date.now(),
                rows: availableUnitRows
            }));
        } catch (err) {
            console.warn("Unable to cache stats locally:", err);
        }
    }

    console.log("Stats loaded:", availableUnitRows.length, "units found.");
}

function readStatsCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(STATS_CACHE_KEY) || "null");
        if (!cached || cached.source !== SHEET_URL || !Array.isArray(cached.rows)) {
            return null;
        }

        return cached.rows.map(normalizeStatsRow);
    } catch (err) {
        console.warn("Unable to read cached stats:", err);
        return null;
    }
}

const FALLBACK_DEFAULT_UNITS = [
    { Unit: "Heavy Infantry", Speed: "5", Drill: "0", Melee: "6", Ranged: "-", Def: "5", Footprint: "SW", Quantity: "2" },
    { Unit: "Fanatics", Speed: "6", Drill: "1", Melee: "10", Ranged: "-", Def: "3", Footprint: "SW", Quantity: "2" },
    { Unit: "Heavy Cavalry", Speed: "10", Drill: "0", Melee: "4", Ranged: "-", Def: "5", Footprint: "SN", Quantity: "2" },
    { Unit: "Infantry", Speed: "6", Drill: "2", Melee: "3", Ranged: "-", Def: "5", Footprint: "SW", Quantity: "2" },
    { Unit: "Halberds", Speed: "6", Drill: "0", Melee: "3*", Ranged: "-", Def: "4", Footprint: "SW", Quantity: "2" },
    { Unit: "Spears", Speed: "6", Drill: "1", Melee: "2", Ranged: "-", Def: "6", Footprint: "SW", Quantity: "2" },
    { Unit: "Cavalry", Speed: "12", Drill: "1", Melee: "4", Ranged: "-", Def: "4", Footprint: "SN", Quantity: "2" },
    { Unit: "Lancers", Speed: "11", Drill: "2", Melee: "2*", Ranged: "-", Def: "4", Footprint: "SN", Quantity: "2" },
    { Unit: "Light Infantry", Speed: "7", Drill: "4", Melee: "3", Ranged: "1*/4", Def: "4", Footprint: "SW", Quantity: "2" },
    { Unit: "Light Cavalry", Speed: "14", Drill: "3", Melee: "4", Ranged: "-", Def: "3", Footprint: "SN", Quantity: "2" },
    { Unit: "Archers", Speed: "6", Drill: "1", Melee: "1", Ranged: "4/24", Def: "3", Footprint: "SW", Quantity: "2" },
    { Unit: "Crossbows", Speed: "6", Drill: "0", Melee: "1", Ranged: "3*/18", Def: "3", Footprint: "SW", Quantity: "2" },
    { Unit: "Mounted Archers", Speed: "12", Drill: "3", Melee: "1", Ranged: "3/12", Def: "3", Footprint: "SN", Quantity: "2" }
];

// Initialize with cached stats if present, or fallback default units immediately
const initialCachedStats = readStatsCache();
if (initialCachedStats && initialCachedStats.length > 0) {
    setStatsData(initialCachedStats, false);
} else {
    setStatsData(FALLBACK_DEFAULT_UNITS, false);
}

function getFreshStatsUrl() {
    const url = new URL(SHEET_URL);
    url.searchParams.set('refresh', Date.now());
    return url.toString();
}

function loadStats(forceRefresh = false) {
    if (!forceRefresh && statsLoadedFromSource && availableUnitRows.length > 0) {
        return Promise.resolve(availableUnitRows);
    }

    if (statsLoadPromise) {
        return statsLoadPromise;
    }

    statsLoadPromise = new Promise((resolve, reject) => {
        Papa.parse(getFreshStatsUrl(), {
            download: true,
            header: true,
            skipEmptyLines: true,
            transformHeader: function (header) {
                return header.trim();
            },
            complete: function (results) {
                if (results.data.length > 0) {
                    console.log("CSV Headers Detected:", Object.keys(results.data[0]));
                }
                const rows = results.data.filter(row => row.Unit && row.Unit.trim());
                if (!rows.length) {
                    console.warn('Stats source returned no unit profiles; keeping cached or fallback stats.');
                    resolve(availableUnitRows);
                    return;
                }
                setStatsData(rows, true);
                statsLoadedFromSource = true;
                resolve(availableUnitRows);
            },
            error: function (err) {
                const cachedRows = readStatsCache();
                if (cachedRows) {
                    console.warn("Using locally cached stats after load error:", err);
                    setStatsData(cachedRows, false);
                    resolve(availableUnitRows);
                    return;
                }

                console.warn("Using fallback stats after load error:", err);
                resolve(availableUnitRows);
            }
        });
    }).finally(() => {
        statsLoadPromise = null;
    });

    return statsLoadPromise;
}

// --- STATS MARKUP & UNIT TOOLTIP ---
function getUnitStats(unitSource) {
    if (!unitSource) {
        return { unitName: "", stats: null };
    }

    const unitName = typeof unitSource === 'string'
        ? unitSource.trim()
        : ((unitSource.dataset && unitSource.dataset.name) || unitSource.name || unitSource.Unit || "").trim();

    const storedStats = (typeof unitSource === 'object' && unitSource !== null)
        ? (unitSource._unitStats || unitSource.stats || (unitSource.Unit ? unitSource : null))
        : null;

    return {
        unitName,
        stats: storedStats ? normalizeStatsRow(storedStats) : (unitStatsDB[unitName] || null)
    };
}

function getStatValue(stats, ...keys) {
    for (const key of keys) {
        const value = stats ? stats[key] : undefined;
        if (value !== undefined && value !== null && `${value}`.trim() !== "") {
            return value;
        }
    }
    return '-';
}

function getUnitStatsView() {
    try { return localStorage.getItem('unit-profile-view') === 'artwork' ? 'artwork' : 'card'; }
    catch { return 'card'; }
}

function buildStatsMarkup(unitSource) {
    if (!unitSource) {
        return '<span class="stats-empty">Select a unit to inspect its profile.</span>';
    }

    const { unitName, stats } = getUnitStats(unitSource);
    const cleanName = ((stats && stats.Unit) || unitName || "").trim();

    if (!cleanName) {
        return '<span class="stats-empty">Select a unit to inspect its profile.</span>';
    }

    let activeRules = [];

    // Check Global Rules DB (Safety check added so it doesn't crash if empty)
    if (globalRulesDB.length > 0) {
        const cleanNameLower = cleanName.toLowerCase();
        globalRulesDB.forEach(rule => {
            const keyword = rule.keyword ? rule.keyword.toLowerCase() : "";
            if (keyword && cleanNameLower.includes(keyword)) {
                activeRules.push(rule.effect);
            }
        });
    }

    // Include "Special" column from main stats
    if (stats && stats.Special) {
        activeRules.push(stats.Special);
    }

    if (stats) {
        const colour = unitSource.dataset && unitSource.dataset.owner === 'p2' ? 'orange' : 'blue';
        const cardPath = typeof UnitArtwork !== 'undefined' ? UnitArtwork.cardFor({ ...stats, Unit: cleanName }, colour) : '';
        const safeCardName = cleanName.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
        const cardHtml = cardPath ? `<a class="stats-unit-card-link" href="${cardPath}" target="_blank" rel="noopener" aria-label="Open ${safeCardName} card at full size"><img class="stats-unit-card-image" src="${cardPath}" alt="${safeCardName} unit card" onerror="this.parentElement.hidden=true"></a>` : '';
        const artworkFile = typeof UnitArtwork !== 'undefined' ? UnitArtwork.fileFor({ ...stats, Unit: cleanName }) : '';
        const artworkHtml = artworkFile ? `<div class="stats-artwork-emblem army-${colour}"><img class="stats-unit-artwork" src="images/${encodeURIComponent(artworkFile)}" alt="${safeCardName} artwork" onerror="this.parentElement.hidden=true"></div>` : '';
        const view = cardPath ? getUnitStatsView() : 'artwork';
        const viewButtons = cardPath && artworkFile ? `<div class="stats-view-switch" role="group" aria-label="Profile display"><button type="button" data-stats-view="card" aria-pressed="${view === 'card'}" onclick="setUnitStatsView('card')">Full card</button><button type="button" data-stats-view="artwork" aria-pressed="${view === 'artwork'}" onclick="setUnitStatsView('artwork')">Artwork + stats</button></div>` : '';
        const filteredRules = [...new Set(activeRules.filter(r => r && r.trim() !== ""))];
        const rulesHtml = filteredRules.length > 0
            ? `<div class="rules-block">
                     <div class="rules-title">Special Rules</div>
                     ${filteredRules.map(r => `<div class="rule-line">${r}</div>`).join('')}
                   </div>`
            : "";

        return `
                <div class="stats-card" data-profile-view="${view}">
                    <div class="stats-unit-name">${safeCardName}</div>
                    ${viewButtons}
                    ${cardHtml}
                    <div class="stats-live-profile">
                    ${artworkHtml}
                    <div class="stats-grid">
                        <div class="stat-chip">
                            <img class="stat-icon" src="icons/move.svg" alt="Move">
                            <span class="stat-label">Speed / Drill</span>
                            <span class="stat-value">${getStatValue(stats, 'Speed', 'Move')}/${getStatValue(stats, 'Drill')}</span>
                        </div>
                        <div class="stat-chip">
                            <img class="stat-icon" src="icons/shoot.svg" alt="Shoot">
                            <span class="stat-label">Ranged</span>
                            <span class="stat-value">${getStatValue(stats, 'Ranged', 'Shoot')}</span>
                        </div>
                        <div class="stat-chip">
                            <img class="stat-icon" src="icons/strike.svg" alt="Melee">
                            <span class="stat-label">Melee</span>
                            <span class="stat-value">${getStatValue(stats, 'Melee', 'Strike')}</span>
                        </div>
                        <div class="stat-chip">
                            <img class="stat-icon" src="icons/defence.svg" alt="Defence">
                            <span class="stat-label">Defence</span>
                            <span class="stat-value">${getStatValue(stats, 'Def', 'Defence')}</span>
                        </div>
                    </div>
                    </div>
                    ${rulesHtml}
                </div>
            `;
    }

    return '<span class="stats-missing">Stats not found for this unit.</span>';
}

function updateStatsPanel(unitSource) {
    const panel = document.getElementById('stats-content');
    panel.innerHTML = buildStatsMarkup(unitSource);
    if (unitSource) {
        const profileDetails = document.getElementById('unit-profile-details');
        if (profileDetails) profileDetails.open = true;
    }
}

function setUnitStatsView(view) {
    if (view !== 'card' && view !== 'artwork') return;
    try { localStorage.setItem('unit-profile-view', view); } catch {}
    document.querySelectorAll('#stats-content .stats-card').forEach(card => {
        card.dataset.profileView = view;
        card.querySelectorAll('[data-stats-view]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.statsView === view));
        });
    });
}

function buildUnitControlsMarkup() {
    return `
        <div class="unit-popup-controls" role="toolbar" aria-label="Selected unit controls">
            <div id="unit-popup-wounds" class="piece-control-row">
                <button type="button" class="btn-grey" data-wound-step="-1" aria-label="Remove one strain">−</button>
                <button type="button" class="btn-grey" data-wound-step="1" aria-label="Add one strain">+</button>
            </div>
        </div>
    `;
}

function hideUnitTooltip() {
    if (statsTooltipTimer) {
        clearTimeout(statsTooltipTimer);
        statsTooltipTimer = null;
    }

    const tooltip = document.getElementById('unit-tooltip');
    tooltip.classList.remove('visible');
    tooltip.classList.remove('interactive');
    tooltip.setAttribute('aria-hidden', 'true');
}

function suppressUnitTooltip(durationMs = TOOLTIP_SUPPRESS_AFTER_MANIPULATION_MS) {
    suppressTooltipUntil = Date.now() + durationMs;
    hideUnitTooltip();
}

function positionUnitTooltip(unitEl) {
    const tooltip = document.getElementById('unit-tooltip');
    if (!tooltip || !unitEl) return;
    const unitRect = {
        left: parseFloat(unitEl.style.left) || 0,
        top: parseFloat(unitEl.style.top) || 0,
        width: unitEl.offsetWidth,
        height: unitEl.offsetHeight
    };

    const tooltipWidth = tooltip.offsetWidth || 100;
    const tooltipHeight = tooltip.offsetHeight || 50;

    const centerX = unitRect.left + (unitRect.width / 2);
    let left = centerX - (tooltipWidth / 2);
    left = Math.min(Math.max(12, left), tableWidthPx - tooltipWidth - 12);

    let top = unitRect.top - tooltipHeight - 12;
    if (top < 12) {
        top = unitRect.top + unitRect.height + 12;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

function showUnitTooltip(unitEl, interactive = false) {
    if (!interactive || !unitEl) return;

    const tooltip = document.getElementById('unit-tooltip');
    tooltip.innerHTML = buildUnitControlsMarkup();
    tooltip.classList.toggle('interactive', true);
    tooltip.setAttribute('aria-hidden', 'false');
    positionUnitTooltip(unitEl);
    tooltip.classList.add('visible');
}

function queueUnitTooltip(unitEl) {
    // Hover tooltip over battlefield removed per user request
    return;
}

// --- SELECTION & PIECE CONTROLS ---
function isTouchPointer(event) {
    return event.pointerType === 'touch' || event.pointerType === 'pen';
}

function clearPieceSelection() {
    cancelUnitLongPress();
    clearRangeInspections();
    clearSelectionRanges();
    if (selectedPiece) {
        selectedPiece.classList.remove('is-selected');
    }

    selectedPiece = null;
    const controls = document.getElementById('piece-controls');
    controls.classList.remove('visible');
    controls.setAttribute('aria-hidden', 'true');
    hideUnitTooltip();
}

function positionPieceControls() {
    updateSelectionRanges();
    const controls = document.getElementById('piece-controls');
    if (!selectedPiece || !selectedPiece.isConnected || isDraggingPiece || rotatingPiece) {
        controls.classList.remove('visible');
        controls.setAttribute('aria-hidden', 'true');
        hideUnitTooltip();
        return;
    }

    const isUnitSelected = selectedPiece.classList.contains('unit');
    if (isUnitSelected) {
        controls.classList.remove('visible');
        controls.setAttribute('aria-hidden', 'true');
        showUnitTooltip(selectedPiece, true);
        return;
    }

    hideUnitTooltip();
    controls.style.visibility = 'hidden';
    controls.classList.add('visible');
    controls.setAttribute('aria-hidden', 'false');

    const pieceLeft = parseFloat(selectedPiece.style.left) || 0;
    const pieceTop = parseFloat(selectedPiece.style.top) || 0;
    const centerX = pieceLeft + (selectedPiece.offsetWidth / 2);
    const edgePadding = 10;
    const halfControlsWidth = controls.offsetWidth / 2;
    const clampedX = Math.min(
        tableWidthPx - halfControlsWidth - edgePadding,
        Math.max(halfControlsWidth + edgePadding, centerX)
    );
    let top = pieceTop + selectedPiece.offsetHeight + 16;
    if (top + controls.offsetHeight > tableHeightPx - edgePadding) {
        top = Math.max(edgePadding, pieceTop - controls.offsetHeight - 16);
    }

    document.getElementById('piece-angle').innerText = `${normalizeAngle(parseFloat(selectedPiece.dataset.angle) || 0).toFixed(0)} deg`;
    controls.style.left = `${clampedX}px`;
    controls.style.top = `${top}px`;
    controls.style.visibility = 'visible';
}

function selectPiece(piece, preserveRanges = false) {
    if (!piece || !piece.classList.contains('piece')) {
        clearPieceSelection();
        return;
    }

    if (!preserveRanges) clearRangeInspections();
    if (piece.classList.contains('unit')) inspectUnitRange(piece);
    if (selectedPiece && selectedPiece !== piece) {
        selectedPiece.classList.remove('is-selected');
    }

    selectedPiece = piece;
    selectedPiece.classList.add('is-selected');
    if (piece.classList.contains('unit')) {
        updateStatsPanel(piece);
    } else {
        updateStatsPanel(null);
    }
    positionPieceControls();
}

function setPieceAngle(piece, nextAngle, angleDelta = null) {
    if (!piece) return;
    const previousAngle = parseFloat(piece.dataset.angle) || 0;
    piece.dataset.angle = nextAngle;
    piece.style.transform = `rotate(${nextAngle}deg)`;
    showAngleIndicator(piece, angleDelta ?? getRotationDelta(piece, previousAngle, nextAngle));
    positionPieceControls();
}

function rotatePiece(piece, delta) {
    if (!piece) return;
    suppressUnitTooltip();
    pushUndo();
    const previousAngle = parseFloat(piece.dataset.angle) || 0;
    const nextAngle = previousAngle + delta;
    setPieceAngle(piece, nextAngle);
    const pieceId = getPieceId(piece);
    if (pieceId) {
        sendData({
            type: 'PIECE_ROTATE',
            pieceId: pieceId,
            angle: nextAngle,
            delta: delta
        });
    }
    saveGame();
}

function adjustUnitWounds(unit, delta) {
    if (!unit || !unit.classList.contains('unit')) return;
    const wounds = parseInt(unit.dataset.wounds, 10) || 0;
    const nextWounds = Math.max(0, wounds + delta);
    if (nextWounds === wounds) return;

    pushUndo();
    unit.dataset.wounds = nextWounds;
    const marker = unit.querySelector('.wound-marker');
    marker.innerText = nextWounds;
    marker.style.display = nextWounds > 0 ? 'flex' : 'none';
    positionPieceControls();
    saveGame();
}

function handlePieceTap(piece, event) {
    const additive = Boolean(event && event.shiftKey) || (isTouchPointer(event || {}) && isTouchMultiSelectActive);
    if (additive && inspectedUnits.has(piece)) {
        inspectedUnits.delete(piece);
        piece.classList.remove('is-range-inspected', 'is-selected');
        if (selectedPiece === piece) selectedPiece = null;
        if (!inspectedUnits.size) isTouchMultiSelectActive = false;
        positionPieceControls();
        return;
    }
    selectPiece(piece, additive);
}

const pieceControls = document.getElementById('piece-controls');
pieceControls.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
});
const unitTooltip = document.getElementById('unit-tooltip');
unitTooltip.addEventListener('pointerdown', (event) => {
    if (unitTooltip.classList.contains('interactive')) {
        event.stopPropagation();
    }
});

function handleSelectedPieceControlClick(event) {
    if (!selectedPiece) return;
    const rotationButton = event.target.closest('[data-rotate-step]');
    if (rotationButton) {
        const step = parseFloat(rotationButton.dataset.rotateStep) || TOUCH_ROTATION_STEP_DEG;
        rotatePiece(selectedPiece, step);
        return;
    }

    const woundButton = event.target.closest('[data-wound-step]');
    if (woundButton && selectedPiece.classList.contains('unit')) {
        adjustUnitWounds(selectedPiece, parseInt(woundButton.dataset.woundStep, 10));
    }
}

pieceControls.addEventListener('click', handleSelectedPieceControlClick);
unitTooltip.addEventListener('click', handleSelectedPieceControlClick);

// --- NETWORKING & REMOTE SANDBOX FLOW ---
function generateShortId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function hostGameFromLanding() {
    const activeList = loadActiveGamesList();
    let shortId = generateShortId();
    let tries = 0;
    while (activeList.some(g => g.roomCode === shortId) && tries < 30) {
        shortId = generateShortId();
        tries++;
    }

    currentRoomCode = shortId;
    isHost = true;
    isRoomCodeHidden = false;

    // Immediately switch the view so the UI responds instantly
    const landing = document.getElementById('landing-screen');
    const container = document.getElementById('container');
    if (landing) landing.style.display = 'none';
    if (container) container.style.display = 'flex';

    if (conn) {
        try { conn.close(); } catch(e) {}
        conn = null;
    }
    if (peer) {
        try { peer.destroy(); } catch(e) {}
        peer = null;
    }

    // Reset battlefield board
    table.querySelectorAll('.unit, .terrain, .ghost, .range-ring, .command-token-table').forEach(p => p.remove());
    undoStack.length = 0;
    hoveredUnit = null;
    hoveredTerrain = null;
    activePiece = null;
    ghostPiece = null;
    activePointerId = null;
    pendingDragPiece = null;
    isDraggingPiece = false;
    clearPieceSelection();
    removeRangeRing();
    hideUnitTooltip();

    // Spawn 12 random units from spreadsheet (or fallback) in central draft grid
    createDefaultUnits();

    // Shuffled terrain deck
    cancelTerrainCardAnimation();
    terrainDeck = createShuffledTerrainDeck();
    renderTerrainCard();

    // Random first draft pick: player who drafts first loses ties in round 1
    const firstPick = Math.random() < 0.5 ? 'p1' : 'p2';
    const firstTie = (firstPick === 'p1') ? 'p2' : 'p1';

    biddingState = {
        p1: { value: 1, ready: false },
        p2: { value: 1, ready: false },
        revealed: false,
        master: null,
        round: 1,
        turnStep: 0,
        firstDraftPick: firstPick,
        firstRoundTieWinner: firstTie
    };
    roundState = CommandTracker.create({ firstDraftPick: firstPick, firstTie });
    commandTokens = [];
    renderAllCommandTokens();

    addOrUpdateActiveGame({
        roomCode: shortId,
        role: 'p1',
        isHost: true,
        round: 1,
        firstDraftPick: firstPick,
        firstRoundTieWinner: firstTie,
        lastPlayed: Date.now()
    });

    saveGame(true);

    updatePlayerBanner();
    updateRoomCodeVisibility();
    updateBiddingUI();
    updateDraftNoticeUI();
    fitTableToScreen();
    fitAllUnitLabels();

    hostGame(shortId);

    // Refresh unit stats in background if online
    loadStats().catch(err => console.warn('Background stats refresh:', err));
}

function joinGameFromLanding() {
    const input = document.getElementById('landing-join-code');
    const code = (input ? input.value : '').trim().toUpperCase();
    if (!code || code.length < 3) {
        alert('Please enter a valid room code.');
        if (input) input.focus();
        return;
    }

    if (conn) {
        try { conn.close(); } catch(e) {}
        conn = null;
    }
    if (peer) {
        try { peer.destroy(); } catch(e) {}
        peer = null;
    }

    currentRoomCode = code;
    isHost = false;
    isRoomCodeHidden = false;

    // Immediately switch the view so the UI responds instantly
    const landing = document.getElementById('landing-screen');
    const container = document.getElementById('container');
    if (landing) landing.style.display = 'none';
    if (container) container.style.display = 'flex';

    const saved = localStorage.getItem(getGameSaveKey(code));
    if (saved) {
        restoreBoardState(saved, true);
    } else {
        table.querySelectorAll('.unit, .terrain, .ghost, .range-ring, .command-token-table').forEach(p => p.remove());
        commandTokens = [];
        renderAllCommandTokens();
    }

    addOrUpdateActiveGame({
        roomCode: code,
        role: 'p2',
        isHost: false,
        round: biddingState.round || 1,
        firstDraftPick: biddingState.firstDraftPick || 'p1',
        firstRoundTieWinner: biddingState.firstRoundTieWinner || 'p2',
        lastPlayed: Date.now()
    });

    updatePlayerBanner();
    updateRoomCodeVisibility();
    updateBiddingUI();
    updateDraftNoticeUI();
    fitTableToScreen();
    fitAllUnitLabels();

    joinGameWithCode(code);

    // Refresh unit stats in background if online
    loadStats().catch(err => console.warn('Background stats refresh:', err));
}

function resumeGame(roomCode) {
    if (!roomCode) return;
    const cleanCode = roomCode.toUpperCase();
    const list = loadActiveGamesList();
    const entry = list.find(g => g.roomCode === cleanCode);
    if (!entry) return;

    if (conn) {
        try { conn.close(); } catch(e) {}
        conn = null;
    }
    if (peer) {
        try { peer.destroy(); } catch(e) {}
        peer = null;
    }

    currentRoomCode = cleanCode;
    isHost = Boolean(entry.isHost);

    // Immediately switch the view so the UI responds instantly
    const landing = document.getElementById('landing-screen');
    const container = document.getElementById('container');
    if (landing) landing.style.display = 'none';
    if (container) container.style.display = 'flex';

    const saved = localStorage.getItem(getGameSaveKey(cleanCode));
    if (saved) {
        restoreBoardState(saved, true);
    }

    entry.lastPlayed = Date.now();
    saveActiveGamesList(list);

    updatePlayerBanner();
    updateRoomCodeVisibility();
    updateBiddingUI();
    updateDraftNoticeUI();
    fitTableToScreen();
    fitAllUnitLabels();

    if (isHost) {
        hostGame(cleanCode);
    } else {
        joinGameWithCode(cleanCode);
    }

    // Refresh unit stats in background if online
    loadStats().catch(err => console.warn('Background stats refresh:', err));
}

function deleteActiveGame(roomCode, event) {
    if (event) event.stopPropagation();
    if (!confirm(`Are you sure you want to remove Battle ${roomCode}?`)) {
        return;
    }
    removeActiveGame(roomCode);
}

function exitToLanding() {
    saveGame(true);

    if (conn) {
        try { conn.close(); } catch(e) {}
        conn = null;
    }
    if (peer) {
        try { peer.destroy(); } catch(e) {}
        peer = null;
    }

    isHost = false;
    currentRoomCode = '';

    document.getElementById('container').style.display = 'none';
    releaseLandscapeLock();
    document.getElementById('landing-screen').style.display = 'flex';
    renderActiveGamesUI();
}

function copyRoomLink() {
    const code = currentRoomCode || (document.getElementById('landing-join-code') ? document.getElementById('landing-join-code').value : '');
    if (!code) return;
    const url = window.location.origin + window.location.pathname + '?join=' + encodeURIComponent(code);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            const btn = document.getElementById('copy-room-link-btn');
            if (btn) {
                const original = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = original; }, 1500);
            }
        }).catch(() => {
            prompt('Copy room link:', url);
        });
    } else {
        prompt('Copy room link:', url);
    }
}

function updatePlayerBanner() {
    const badge = document.getElementById('player-role-badge');
    const roomText = document.getElementById('room-code-text');
    const statusText = document.getElementById('network-status');

    if (!badge || !roomText || !statusText) return;

    if (isHost) {
        badge.textContent = 'Player 1 (Host)';
        badge.className = 'player-role-badge badge-p1';
        roomText.textContent = `Code: ${currentRoomCode || '----'}`;
        if (conn && conn.open) {
            statusText.textContent = 'Opponent Connected ✓';
            statusText.className = 'network-status is-connected';
        } else {
            statusText.textContent = 'Waiting for Player 2...';
            statusText.className = 'network-status';
        }
    } else {
        badge.textContent = 'Player 2 (Challenger)';
        badge.className = 'player-role-badge badge-p2';
        roomText.textContent = `Room: ${currentRoomCode || '----'}`;
        if (conn && conn.open) {
            statusText.textContent = 'Connected to Host ✓';
            statusText.className = 'network-status is-connected';
        } else {
            statusText.textContent = 'Connecting...';
            statusText.className = 'network-status';
        }
    }
}

function hostGame(specificRoomCode = null) {
    if (peer) {
        try { peer.destroy(); } catch(e) {}
        peer = null;
    }
    const shortId = (specificRoomCode || currentRoomCode || generateShortId()).toUpperCase();
    currentRoomCode = shortId;
    isHost = true;
    updatePlayerBanner();

    if (typeof Peer === 'undefined') {
        console.warn('PeerJS library is not available.');
        const statusText = document.getElementById('network-status');
        if (statusText) statusText.textContent = 'PeerJS offline/unavailable';
        return;
    }

    try {
        peer = new Peer(shortId);
    } catch (err) {
        console.error('Failed to instantiate Peer:', err);
        return;
    }

    peer.on('open', (id) => {
        currentRoomCode = id;
        updatePlayerBanner();
        addOrUpdateActiveGame({
            roomCode: id,
            role: 'p1',
            isHost: true,
            round: biddingState.round || 1,
            firstDraftPick: biddingState.firstDraftPick,
            firstRoundTieWinner: biddingState.firstRoundTieWinner,
            lastPlayed: Date.now()
        });
    });

    peer.on('connection', (c) => {
        conn = c;
        setupConnection();
        setTimeout(() => sendData({ type: 'SYNC_BOARD', payload: getBoardState({ forNetwork: true }) }), 500);
    });

    peer.on('error', (err) => {
        console.error(err);
        if (err.type === 'unavailable-id') {
            peer = null;
            if (!specificRoomCode) {
                hostGame();
            } else {
                alert(`Room ${specificRoomCode} is currently in use or unavailable.`);
            }
        }
    });
}

function joinGameWithCode(hostId) {
    if (peer) {
        try { peer.destroy(); } catch(e) {}
        peer = null;
    }
    const cleanId = (hostId || '').toUpperCase();
    currentRoomCode = cleanId;
    isHost = false;
    updatePlayerBanner();

    if (typeof Peer === 'undefined') {
        console.warn('PeerJS library is not available.');
        const statusText = document.getElementById('network-status');
        if (statusText) statusText.textContent = 'PeerJS offline/unavailable';
        return;
    }

    try {
        peer = new Peer();
    } catch (err) {
        console.error('Failed to instantiate Peer:', err);
        return;
    }

    peer.on('open', () => {
        conn = peer.connect(cleanId);
        setupConnection();
    });
    peer.on('error', (err) => {
        console.error(err);
        alert('Could not connect to room: ' + cleanId + '. Please check the code.');
        exitToLanding();
    });
}

function setupConnection() {
    if (!conn) return;
    conn.on('open', () => {
        updatePlayerBanner();
        if (isHost) {
            sendData({ type: 'SYNC_BOARD', payload: getBoardState({ forNetwork: true }) });
        }
    });
    conn.on('data', (data) => {
        handleIncomingData(data);
    });
    conn.on('close', () => {
        conn = null;
        updatePlayerBanner();
    });
}

function getPieceId(piece) {
    if (!piece) return null;
    if (piece.dataset && piece.dataset.unitId) return piece.dataset.unitId;
    if (piece.dataset && piece.dataset.pieceId) return piece.dataset.pieceId;
    if (piece.dataset) {
        piece.dataset.pieceId = 'p_' + Math.random().toString(36).slice(2, 9);
        return piece.dataset.pieceId;
    }
    return null;
}

function findPieceById(pieceId) {
    if (!pieceId || !table) return null;
    const pieces = table.querySelectorAll ? table.querySelectorAll('.piece') : [];
    for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        if (p.classList && p.classList.contains('ghost')) continue;
        if (p.dataset && (p.dataset.unitId === pieceId || p.dataset.pieceId === pieceId)) {
            return p;
        }
    }
    return null;
}

let lastPieceMoveSendTime = 0;
let pendingPieceMoveData = null;
let pieceMoveBroadcastTimer = null;
let remoteGhostPiece = null;
let remoteAngleIndicatorTimer = null;

function showRemoteLine(x1, y1, x2, y2) {
    const line = document.getElementById('remote-measure-line') || lineElement;
    const text = document.getElementById('remote-measure-text') || measureTextElement;
    if (!line || !text) return;

    line.style.opacity = 1;
    text.style.opacity = 1;
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);

    const dx = x2 - x1;
    const dy = y2 - y1;
    const distancePx = Math.sqrt(dx * dx + dy * dy);
    text.textContent = `${pxToInches(distancePx)}"`;

    const textX = x1 + (dx / 2) + 10;
    const textY = y1 + (dy / 2) - 10;
    text.setAttribute('x', textX);
    text.setAttribute('y', textY);

    if (!isHost) {
        text.setAttribute('transform', `rotate(180, ${textX}, ${textY})`);
    } else if (text.removeAttribute) {
        text.removeAttribute('transform');
    }
}

function hideRemoteLine() {
    const line = document.getElementById('remote-measure-line');
    const text = document.getElementById('remote-measure-text');
    if (line) line.style.opacity = 0;
    if (text) text.style.opacity = 0;
    if (remoteGhostPiece) {
        remoteGhostPiece.remove();
        remoteGhostPiece = null;
    }
}

function showRemoteAngleIndicator(piece, angleDelta) {
    const indicator = document.getElementById('remote-angle-indicator') || document.getElementById('angle-indicator');
    if (!indicator || !piece) return;

    const normalizedAngle = normalizeAngle(angleDelta);
    const left = (parseFloat(piece.style.left) || 0) + (piece.offsetWidth / 2);
    const top = (parseFloat(piece.style.top) || 0) - 18;

    indicator.innerText = `${normalizedAngle > 0 ? '+' : ''}${normalizedAngle.toFixed(0)}°`;
    indicator.style.left = `${left}px`;
    indicator.style.top = `${Math.max(20, top)}px`;
    indicator.setAttribute('aria-hidden', 'false');
    indicator.classList.add('visible');

    if (remoteAngleIndicatorTimer) {
        clearTimeout(remoteAngleIndicatorTimer);
    }

    remoteAngleIndicatorTimer = setTimeout(() => {
        indicator.classList.remove('visible');
        indicator.setAttribute('aria-hidden', 'true');
    }, 700);
}

function broadcastPieceMoveThrottled(piece, x, y, anchorX, anchorY, targetX, targetY) {
    const pieceId = getPieceId(piece);
    if (!pieceId) return;

    pendingPieceMoveData = {
        type: 'PIECE_DRAG_MOVE',
        pieceId: pieceId,
        x: Math.round(x),
        y: Math.round(y),
        anchorX: Math.round(anchorX ?? x),
        anchorY: Math.round(anchorY ?? y),
        targetX: Math.round(targetX ?? x),
        targetY: Math.round(targetY ?? y)
    };

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = now - lastPieceMoveSendTime;
    if (elapsed >= 25) {
        lastPieceMoveSendTime = now;
        sendData(pendingPieceMoveData);
        pendingPieceMoveData = null;
    } else if (!pieceMoveBroadcastTimer) {
        pieceMoveBroadcastTimer = setTimeout(() => {
            pieceMoveBroadcastTimer = null;
            if (pendingPieceMoveData) {
                lastPieceMoveSendTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
                sendData(pendingPieceMoveData);
                pendingPieceMoveData = null;
            }
        }, 25 - elapsed);
    }
}

let lastPieceRotateSendTime = 0;
let pendingPieceRotateData = null;
let pieceRotateBroadcastTimer = null;

function broadcastPieceRotateThrottled(piece, angle, delta = 0) {
    const pieceId = getPieceId(piece);
    if (!pieceId) return;

    pendingPieceRotateData = {
        type: 'PIECE_ROTATE',
        pieceId: pieceId,
        angle: Math.round(angle * 10) / 10,
        delta: Math.round(delta * 10) / 10
    };

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = now - lastPieceRotateSendTime;
    if (elapsed >= 25) {
        lastPieceRotateSendTime = now;
        sendData(pendingPieceRotateData);
        pendingPieceRotateData = null;
    } else if (!pieceRotateBroadcastTimer) {
        pieceRotateBroadcastTimer = setTimeout(() => {
            pieceRotateBroadcastTimer = null;
            if (pendingPieceRotateData) {
                lastPieceRotateSendTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
                sendData(pendingPieceRotateData);
                pendingPieceRotateData = null;
            }
        }, 25 - elapsed);
    }
}

function handleIncomingData(data) {
    if (!data) return;
    if (data.type === 'SYNC_BOARD') {
        restoreBoardState(data.payload, true);
    } else if (data.type === 'PIECE_DRAG_START') {
        const piece = findPieceById(data.pieceId);
        if (piece) {
            piece.classList.add('is-remote-moving');
            if (data.x !== undefined && data.y !== undefined) {
                piece.style.left = `${data.x}px`;
                piece.style.top = `${data.y}px`;
            }
            if (data.anchorX !== undefined && data.anchorY !== undefined) {
                showRemoteLine(data.anchorX, data.anchorY, data.anchorX, data.anchorY);
                if (remoteGhostPiece) { remoteGhostPiece.remove(); remoteGhostPiece = null; }
                if (piece.cloneNode && table && table.insertBefore) {
                    remoteGhostPiece = piece.cloneNode(true);
                    remoteGhostPiece.classList.add('ghost');
                    remoteGhostPiece.classList.remove('is-selected', 'is-remote-moving');
                    if (remoteGhostPiece.removeAttribute) remoteGhostPiece.removeAttribute('id');
                    remoteGhostPiece.style.transform = piece.style.transform;
                    table.insertBefore(remoteGhostPiece, piece);
                }
            }
            if (selectedPiece === piece) positionPieceControls();
        }
    } else if (data.type === 'PIECE_DRAG_MOVE') {
        const piece = findPieceById(data.pieceId);
        if (piece) {
            piece.classList.add('is-remote-moving');
            piece.style.left = `${data.x}px`;
            piece.style.top = `${data.y}px`;
            if (data.anchorX !== undefined && data.anchorY !== undefined && data.targetX !== undefined && data.targetY !== undefined) {
                showRemoteLine(data.anchorX, data.anchorY, data.targetX, data.targetY);
            }
            if (selectedPiece === piece) positionPieceControls();
        }
    } else if (data.type === 'PIECE_DRAG_END') {
        const piece = findPieceById(data.pieceId);
        if (piece) {
            piece.classList.remove('is-remote-moving');
            if (data.x !== undefined && data.y !== undefined) {
                piece.style.left = `${data.x}px`;
                piece.style.top = `${data.y}px`;
            }
            hideRemoteLine();
            if (selectedPiece === piece) positionPieceControls();
        }
    } else if (data.type === 'PIECE_ROTATE_START' || data.type === 'PIECE_ROTATE') {
        const piece = findPieceById(data.pieceId);
        if (piece) {
            piece.classList.add('is-remote-rotating');
            piece.dataset.angle = data.angle;
            piece.style.transform = `rotate(${data.angle}deg)`;
            showRemoteAngleIndicator(piece, data.delta !== undefined ? data.delta : data.angle);
            if (selectedPiece === piece) positionPieceControls();
        }
    } else if (data.type === 'PIECE_ROTATE_END') {
        const piece = findPieceById(data.pieceId);
        if (piece) {
            piece.classList.remove('is-remote-rotating');
            piece.dataset.angle = data.angle;
            piece.style.transform = `rotate(${data.angle}deg)`;
            if (selectedPiece === piece) positionPieceControls();
        }
    } else if (data.type === 'ROLL_DICE') {
        const incomingRolls = Array.isArray(data.rolls) ? data.rolls : [];
        renderDiceRoll(incomingRolls.length ? incomingRolls : createPlaceholderRoll(data.count || 2));
    } else if (data.type === 'BID_READY') {
        const oppKey = isHost ? 'p2' : 'p1';
        if (data.player === oppKey) {
            biddingState[oppKey].ready = Boolean(data.ready);
            updateOpponentBidStatusUI();
            checkRevealReadiness();
        }
    } else if (data.type === 'REVEAL_BIDS') {
        const oppKey = isHost ? 'p2' : 'p1';
        biddingState[oppKey].value = normalizeCommandBid(data.bid);
        biddingState[oppKey].ready = true;
        const localKey = isHost ? 'p1' : 'p2';
        if (biddingState[localKey].ready) {
            executeRevealBids();
        }
    } else if (data.type === 'PASS_TURN') {
        biddingState.turnStep = data.turnStep;
        try { roundState = CommandTracker.pass(roundState); } catch(e) {}
        updateTurnZoneUI();
        saveGame(true);
    } else if (data.type === 'ROUND_RESET') {
        endRoundAndResetBidding(false);
    }
    if (data.type.startsWith('PIECE_')) updateSelectionRanges();
}

function sendData(dataObj) {
    if (conn && conn.open) {
        conn.send(dataObj);
    }
}

function updateStatus(msg) {
    const statusText = document.getElementById('network-status');
    if (statusText) statusText.textContent = msg;
}

// --- COMMAND TOKENS (DRAGGABLE CIRCLES) ---
let activeDraggedToken = null;
let floatingTokenEl = null;
let hoveredUnitTarget = null;

function onCommandTokenPointerDown(e, token) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    activeDraggedToken = token;

    floatingTokenEl = document.createElement('div');
    floatingTokenEl.className = `command-token token-${token.player} is-floating`;
    floatingTokenEl.textContent = '';
    floatingTokenEl.style.left = `${e.clientX}px`;
    floatingTokenEl.style.top = `${e.clientY}px`;
    document.body.appendChild(floatingTokenEl);

    const onMove = (moveEv) => {
        if (!activeDraggedToken || !floatingTokenEl) return;
        floatingTokenEl.style.left = `${moveEv.clientX}px`;
        floatingTokenEl.style.top = `${moveEv.clientY}px`;

        const elements = document.elementsFromPoint(moveEv.clientX, moveEv.clientY);
        const unitEl = elements.find(el => el.classList && el.classList.contains('unit') && !el.classList.contains('ghost'));

        if (unitEl !== hoveredUnitTarget) {
            if (hoveredUnitTarget) hoveredUnitTarget.classList.remove('unit-drop-target');
            hoveredUnitTarget = unitEl || null;
            if (hoveredUnitTarget) hoveredUnitTarget.classList.add('unit-drop-target');
        }
    };

    const onUp = (upEv) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);

        if (hoveredUnitTarget) {
            hoveredUnitTarget.classList.remove('unit-drop-target');
        }

        if (floatingTokenEl) {
            floatingTokenEl.remove();
            floatingTokenEl = null;
        }

        if (!activeDraggedToken) return;

        const elements = document.elementsFromPoint(upEv.clientX, upEv.clientY);
        const unitEl = elements.find(el => el.classList && el.classList.contains('unit') && !el.classList.contains('ghost'));
        const tableEl = elements.find(el => el.id === 'game-table' || el.id === 'ui-layer');

        if (unitEl) {
            activeDraggedToken.status = 'unit';
            activeDraggedToken.unitId = unitEl.dataset.unitId;
            delete activeDraggedToken.x;
            delete activeDraggedToken.y;
        } else if (tableEl) {
            const pointer = getTablePointerPosition(upEv);
            activeDraggedToken.status = 'table';
            activeDraggedToken.x = Math.round(pointer.x);
            activeDraggedToken.y = Math.round(pointer.y);
            delete activeDraggedToken.unitId;
        } else {
            activeDraggedToken.status = 'tray';
            delete activeDraggedToken.unitId;
            delete activeDraggedToken.x;
            delete activeDraggedToken.y;
        }

        activeDraggedToken = null;
        hoveredUnitTarget = null;
        renderAllCommandTokens();
        saveGame();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
}

function renderAllCommandTokens() {
    const yourTray = document.getElementById('your-command-tray');
    const oppTray = document.getElementById('opp-command-tray');
    const legacyTray = document.getElementById('command-tray');
    const localKey = getLocalBidPlayerKey();

    if (yourTray) yourTray.querySelectorAll('.command-token').forEach(el => el.remove());
    if (oppTray) oppTray.querySelectorAll('.command-token').forEach(el => el.remove());
    if (legacyTray) legacyTray.querySelectorAll('.command-token').forEach(el => el.remove());
    table.querySelectorAll('.unit-command-dock').forEach(dock => dock.replaceChildren());
    table.querySelectorAll('.command-token-table').forEach(el => el.remove());

    let yourTrayTokensCount = 0;
    let oppTrayTokensCount = 0;

    commandTokens.forEach(token => {
        const tokenEl = document.createElement('div');
        tokenEl.className = `command-token token-${token.player}`;
        tokenEl.dataset.tokenId = token.id;
        tokenEl.textContent = '';
        tokenEl.setAttribute('role', 'button');
        const isMine = token.player === localKey;
        tokenEl.setAttribute('aria-label', `${isMine ? 'Your' : "Opponent's"} command marker`);
        tokenEl.title = 'Drag command marker to attach or move';
        tokenEl.addEventListener('pointerdown', (e) => onCommandTokenPointerDown(e, token));

        if (token.status === 'unit' && token.unitId) {
            const unit = table.querySelector(`.unit[data-unit-id="${token.unitId}"]`);
            if (unit) {
                let dock = unit.querySelector('.unit-command-dock');
                if (!dock) {
                    dock = document.createElement('div');
                    dock.className = 'unit-command-dock';
                    unit.appendChild(dock);
                }
                dock.appendChild(tokenEl);
                return;
            }
        }

        if (token.status === 'table' && token.x !== undefined && token.y !== undefined) {
            tokenEl.classList.add('piece', 'command-token-table');
            tokenEl.style.left = `${token.x - 16}px`;
            tokenEl.style.top = `${token.y - 16}px`;
            table.appendChild(tokenEl);
            return;
        }

        if (isMine) {
            yourTrayTokensCount++;
            if (yourTray) yourTray.appendChild(tokenEl);
        } else {
            oppTrayTokensCount++;
            if (oppTray) oppTray.appendChild(tokenEl);
        }
    });

    if (yourTray) {
        const placeholder = yourTray.querySelector('.tray-placeholder');
        if (placeholder) {
            if (!biddingState.revealed) {
                placeholder.textContent = 'Set your bid above and reveal to show commands.';
                placeholder.style.display = 'block';
                placeholder.classList.add('clickable');
                placeholder.title = 'Click to jump to Bidding Area';
                placeholder.onclick = () => {
                    const panel = document.getElementById('bidding-turn-panel');
                    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                };
            } else {
                placeholder.textContent = 'All commands assigned.';
                placeholder.style.display = yourTrayTokensCount === 0 ? 'block' : 'none';
                placeholder.classList.remove('clickable');
                placeholder.title = '';
                placeholder.onclick = null;
            }
        }
    }

    if (oppTray) {
        const placeholder = oppTray.querySelector('.tray-placeholder');
        if (placeholder) {
            if (!biddingState.revealed) {
                placeholder.textContent = 'Awaiting bids reveal to show commands.';
                placeholder.style.display = 'block';
                placeholder.classList.remove('clickable');
            } else {
                placeholder.textContent = 'All commands assigned.';
                placeholder.style.display = oppTrayTokensCount === 0 ? 'block' : 'none';
                placeholder.classList.remove('clickable');
            }
        }
    }
}

function getAssignedPlayer(unit) {
    if (unit.dataset.owner) return unit.dataset.owner;
    const centerY = parseFloat(unit.style.top) + parseFloat(unit.style.height) / 2;
    return centerY >= tableHeightPx / 2 ? 'p1' : 'p2';
}

// --- SERIALIZATION ---
function getBoardState(options = {}) {
    const isNetworkPayload = options.forNetwork === true;
    const localPlayerKey = getLocalBidPlayerKey();
    const diceInput = document.getElementById('dice-count');

    const state = {
        pieces: [],
        diceCount: diceInput ? diceInput.value : 2,
        terrainDeck: [...terrainDeck],
        roundState,
        biddingState: {
            battleStarted: hasBattleStarted(),
            round: biddingState.round,
            revealed: biddingState.revealed,
            master: biddingState.master,
            turnStep: biddingState.turnStep,
            firstDraftPick: biddingState.firstDraftPick,
            firstRoundTieWinner: biddingState.firstRoundTieWinner,
            p1: { ready: biddingState.p1.ready, value: biddingState.p1.value },
            p2: { ready: biddingState.p2.ready, value: biddingState.p2.value }
        },
        commandTokens: commandTokens.map(t => ({ ...t }))
    };

    // If unrevealed network payload, conceal opponent's secret bid value
    if (isNetworkPayload && !biddingState.revealed) {
        const oppKey = localPlayerKey === 'p1' ? 'p2' : 'p1';
        delete state.biddingState[oppKey].value;
    }

    document.querySelectorAll('.unit').forEach(el => {
        if (el.classList.contains('ghost')) return;
        state.pieces.push({
            type: 'unit',
            unitId: el.dataset.unitId,
            name: el.dataset.name,
            x: parseFloat(el.style.left),
            y: parseFloat(el.style.top),
            angle: el.dataset.angle,
            wounds: el.dataset.wounds,
            owner: el.dataset.owner || null,
            color: el.style.backgroundColor,
            stats: el._unitStats || null
        });
    });

    document.querySelectorAll('.terrain').forEach(el => {
        state.pieces.push({
            type: 'terrain',
            pieceId: el.dataset.pieceId || getPieceId(el),
            subType: el.dataset.subType,
            x: parseFloat(el.style.left),
            y: parseFloat(el.style.top),
            w: parseFloat(el.style.width),
            h: parseFloat(el.style.height),
            angle: el.dataset.angle
        });
    });

    return JSON.stringify(state);
}

function restoreBoardState(jsonString, suppressBroadcast = false) {
    if (!jsonString) return;
    clearPieceSelection();
    table.querySelectorAll('.unit, .terrain, .ghost, .range-ring, .command-token-table').forEach(p => p.remove());

    const state = JSON.parse(jsonString);
    const data = Array.isArray(state) ? state : state.pieces;
    roundState = state.roundState || CommandTracker.create();

    cancelTerrainCardAnimation();
    terrainDeck = !Array.isArray(state) && Array.isArray(state.terrainDeck)
        ? state.terrainDeck.filter(card => TERRAIN_TYPES.includes(card) || card === TERRAIN_NO_FEATURE_CARD)
        : [];
    renderTerrainCard();

    if (!Array.isArray(state)) {
        if (state.diceCount !== undefined && document.getElementById('dice-count')) {
            document.getElementById('dice-count').value = state.diceCount;
            normalizeDiceCount(false);
        }

        if (state.biddingState) {
            const localKey = isHost ? 'p1' : 'p2';
            const oppKey = isHost ? 'p2' : 'p1';

            // Preserve local player's private bid if not revealed
            const myPrevVal = biddingState[localKey].value;
            const myPrevReady = biddingState[localKey].ready;

            biddingState.round = state.biddingState.round || 1;
            biddingState.revealed = Boolean(state.biddingState.revealed);
            biddingState.battleStarted = Boolean(state.biddingState.battleStarted || biddingState.revealed || biddingState.round > 1);
            biddingState.master = state.biddingState.master || null;
            biddingState.turnStep = state.biddingState.turnStep || 0;
            if (state.biddingState.firstDraftPick) {
                biddingState.firstDraftPick = state.biddingState.firstDraftPick;
            }
            if (state.biddingState.firstRoundTieWinner) {
                biddingState.firstRoundTieWinner = state.biddingState.firstRoundTieWinner;
            }

            if (state.biddingState[oppKey]) {
                biddingState[oppKey].ready = Boolean(state.biddingState[oppKey].ready);
                if (state.biddingState[oppKey].value !== undefined) {
                    biddingState[oppKey].value = normalizeCommandBid(state.biddingState[oppKey].value);
                }
            }

            if (!biddingState.revealed) {
                biddingState[localKey].value = myPrevVal;
                biddingState[localKey].ready = myPrevReady;
            } else {
                if (state.biddingState[localKey]) {
                    biddingState[localKey].value = normalizeCommandBid(state.biddingState[localKey].value);
                    biddingState[localKey].ready = state.biddingState[localKey].ready;
                }
            }

            updateBiddingUI();
            updateDraftNoticeUI();
        }

        if (Array.isArray(state.commandTokens)) {
            commandTokens = state.commandTokens;
        } else {
            commandTokens = [];
        }
    }

    data.forEach(obj => {
        if (obj.type === 'unit') {
            const unit = createUnitDOM(obj.name, obj.color, obj.x, obj.y, obj.angle, obj.wounds, obj.stats, false, obj.owner);
            if (obj.unitId) unit.dataset.unitId = obj.unitId;
        } else if (obj.type === 'terrain') {
            const piece = createTerrainDOM(obj.subType, obj.x, obj.y, obj.w, obj.h, obj.angle, obj.pieceId);
            if (obj.pieceId) piece.dataset.pieceId = obj.pieceId;
        }
    });

    renderAllCommandTokens();
    saveGame(suppressBroadcast);
}

function saveGame(suppressBroadcast = false) {
    const state = getBoardState();
    if (currentRoomCode) {
        localStorage.setItem(getGameSaveKey(currentRoomCode), state);
        addOrUpdateActiveGame({
            roomCode: currentRoomCode,
            role: isHost ? 'p1' : 'p2',
            isHost: isHost,
            round: biddingState.round || 1,
            firstDraftPick: biddingState.firstDraftPick,
            firstRoundTieWinner: biddingState.firstRoundTieWinner,
            lastPlayed: Date.now()
        });
    }
    localStorage.setItem(SAVE_KEY, state);
    updateBiddingUI();
    if (!suppressBroadcast) {
        sendData({ type: 'SYNC_BOARD', payload: getBoardState({ forNetwork: true }) });
    }
}

// --- DOM FACTORIES ---
function applyUnitTheme(unitEl, name) {
    unitEl.classList.remove('faction-elf', 'faction-human', 'faction-orc', 'faction-dwarf', 'faction-undead');
    const unitName = (name || "").toLowerCase();

    if (unitName.includes('elf') || unitName.includes('elven')) unitEl.classList.add('faction-elf');
    else if (unitName.includes('human')) unitEl.classList.add('faction-human');
    else if (unitName.includes('orc')) unitEl.classList.add('faction-orc');
    else if (unitName.includes('dwarf')) unitEl.classList.add('faction-dwarf');
    else if (unitName.includes('undead')) unitEl.classList.add('faction-undead');
}

function updateRotationHandleSize(piece) {
    if (!piece) return;
    const handle = piece.querySelector('.rotation-handle');
    if (!handle) return;
    const w = parseFloat(piece.style.width) || piece.offsetWidth || 70;
    const h = parseFloat(piece.style.height) || piece.offsetHeight || 50;
    const diameter = Math.round(Math.hypot(w, h) + 64);
    handle.style.width = `${diameter}px`;
    handle.style.height = `${diameter}px`;
}

function appendRotationHandle(piece) {
    let handle = piece.querySelector('.rotation-handle');
    if (!handle) {
        handle = document.createElement('div');
        handle.classList.add('rotation-handle');
        handle.setAttribute('role', 'button');
        handle.setAttribute('aria-label', 'Drag ring to rotate');
        handle.title = 'Drag ring to rotate';
        handle.innerHTML = `
            <svg class="rotation-ring-svg" viewBox="0 0 100 100">
                <circle class="ring-hit" cx="50" cy="50" r="44" fill="none" stroke="transparent" stroke-width="16" />
                <circle class="ring-glow" cx="50" cy="50" r="44" fill="none" stroke="rgba(216, 179, 109, 0.3)" stroke-width="4" />
                <circle class="ring-track" cx="50" cy="50" r="44" fill="none" stroke="rgba(255, 236, 183, 0.85)" stroke-width="2" stroke-dasharray="4 2" />
                <circle class="ring-node" cx="50" cy="6" r="3.5" fill="#ffd77a" stroke="#2c1c0d" stroke-width="1" />
                <circle class="ring-node" cx="50" cy="94" r="3.5" fill="#ffd77a" stroke="#2c1c0d" stroke-width="1" />
                <circle class="ring-node" cx="6" cy="50" r="3.5" fill="#ffd77a" stroke="#2c1c0d" stroke-width="1" />
                <circle class="ring-node" cx="94" cy="50" r="3.5" fill="#ffd77a" stroke="#2c1c0d" stroke-width="1" />
            </svg>
        `;
        handle.addEventListener('pointerdown', onRotationHandlePointerDown);

        const setRingHover = (hovered) => {
            handle.classList.toggle('is-ring-hovered', hovered);
        };
        const ringHit = handle.querySelector('.ring-hit');
        if (ringHit) {
            ringHit.addEventListener('pointerenter', () => setRingHover(true));
            ringHit.addEventListener('pointerleave', () => setRingHover(false));
        }
        handle.querySelectorAll('.ring-node').forEach(node => {
            node.addEventListener('pointerenter', () => setRingHover(true));
            node.addEventListener('pointerleave', () => setRingHover(false));
        });

        piece.appendChild(handle);
    }
    updateRotationHandleSize(piece);
}

function unitLabelFits(label) {
    return label.scrollWidth <= label.clientWidth + 1 && label.scrollHeight <= label.clientHeight + 1;
}

function fitAllUnitLabels() {
    const labels = Array.from(document.querySelectorAll('.unit-label'));
    if (!labels.length) return;

    let sharedFontSize = UNIT_LABEL_MIN_FONT_PX;

    for (
        let fontSize = UNIT_LABEL_MAX_FONT_PX;
        fontSize >= UNIT_LABEL_MIN_FONT_PX;
        fontSize -= UNIT_LABEL_FONT_STEP_PX
    ) {
        labels.forEach(label => {
            label.style.fontSize = `${fontSize}px`;
        });

        if (labels.every(unitLabelFits)) {
            sharedFontSize = fontSize;
            break;
        }
    }

    labels.forEach(label => {
        label.style.fontSize = `${sharedFontSize}px`;
    });
}

function fitUnitLabelText(unitEl) {
    if (!unitEl || !unitEl.querySelector('.unit-label')) return;
    fitAllUnitLabels();
}

function createUnitDOM(name, color, x, y, angle, wounds, stats = null, activated = false, owner = null) {
    const div = document.createElement('div');
    const unitStats = stats
        ? { ...(unitStatsDB[name] || {}), ...normalizeStatsRow(stats) }
        : (unitStatsDB[name] ? { ...unitStatsDB[name] } : null);
    const unitSize = getUnitSizePx(unitStats);
    div.classList.add('piece', 'unit');
    div.style.backgroundColor = color;
    div.style.width = `${unitSize.width}px`;
    div.style.height = `${unitSize.height}px`;
    div.style.left = `${x}px`;
    div.style.top = `${y}px`;
    const label = document.createElement('span');
    label.classList.add('unit-label');
    label.textContent = name;
    div.appendChild(label);
    div.dataset.name = name;
    if (owner === 'p1' || owner === 'p2') div.dataset.owner = owner;
    div.dataset.angle = angle || 0;
    div.dataset.footprint = unitSize.footprint;
    div.style.transform = `rotate(${angle}deg)`;
    div.dataset.wounds = wounds || 0;
    div.dataset.activated = activated ? 'true' : 'false';
    div.dataset.unitId = div.dataset.unitId || ('u_' + Math.random().toString(36).slice(2, 9));
    div._unitStats = unitStats;
    applyUnitTheme(div, name);

    const appendCommandDock = () => {
        let dock = div.querySelector('.unit-command-dock');
        if (!dock) {
            dock = document.createElement('div');
            dock.className = 'unit-command-dock';
            div.appendChild(dock);
        }
    };

    const appendMarker = () => {
        let marker = div.querySelector('.wound-marker');
        if (!marker) {
            marker = document.createElement('div');
            marker.classList.add('wound-marker');
            div.appendChild(marker);
        }
        const w = div.dataset.wounds;
        marker.innerText = w;
        marker.style.display = (parseInt(w) > 0) ? 'flex' : 'none';
    };

    div.addEventListener('mouseenter', () => {
        hoveredUnit = div;
        updateStatsPanel(div);
    });

    div.addEventListener('mouseleave', () => {
        hoveredUnit = null;
        removeRangeRing();
        if (selectedPiece !== div) {
            updateStatsPanel(selectedPiece && selectedPiece.classList.contains('unit') ? selectedPiece : null);
            if (!selectedPiece) {
                hideUnitTooltip();
            }
        }
    });

    appendCommandDock();
    appendMarker();
    appendRotationHandle(div);
    attachListeners(div);

    table.appendChild(div);
    fitUnitLabelText(div);
    return div;
}

function createTerrainDOM(subType, x, y, _w, _h, angle, pieceId = null) {
    if (!subType || subType === "undefined" || subType === "rough") subType = "field";
    const finalW = terrainDiameterPx;
    const finalH = terrainDiameterPx;

    const div = document.createElement('div');
    div.classList.add('piece', 'terrain', subType);
    div.innerText = subType.charAt(0).toUpperCase() + subType.slice(1);
    div.style.left = `${x}px`;
    div.style.top = `${y}px`;
    div.style.width = `${finalW}px`;
    div.style.height = `${finalH}px`;
    div.dataset.subType = subType;
    div.dataset.angle = angle || 0;
    div.dataset.pieceId = pieceId || ('t_' + Math.random().toString(36).slice(2, 9));
    div.style.transform = `rotate(${angle}deg)`;

    appendRotationHandle(div);
    attachListeners(div);
    div.addEventListener('mouseenter', () => hoveredTerrain = div);
    div.addEventListener('mouseleave', () => hoveredTerrain = null);

    table.appendChild(div);
    return div;
}

// --- UNDO & BOARD RESET ---
function pushUndo() {
    if (undoStack.length >= MAX_UNDO) undoStack.shift();
    undoStack.push(getBoardState());
}

window.undo = function () {
    if (undoStack.length === 0) return;
    const previousState = undoStack.pop();
    restoreBoardState(previousState);
};

async function resetBoard(createUnits, shouldCreateTerrain = true) {
    localStorage.removeItem(SAVE_KEY);

    table.querySelectorAll('.unit, .terrain, .ghost, .range-ring, .command-token-table').forEach(p => p.remove());
    undoStack.length = 0;
    roundState = CommandTracker.create();
    commandTokens = [];
    renderAllCommandTokens();
    hoveredUnit = null;
    hoveredTerrain = null;
    activePiece = null;
    ghostPiece = null;
    activePointerId = null;
    pendingDragPiece = null;
    isDraggingPiece = false;
    measurementPointerId = null;
    clearPieceSelection();

    const cp1 = document.getElementById('cp1');
    if (cp1) cp1.value = 1;
    const cp2 = document.getElementById('cp2');
    if (cp2) cp2.value = 1;
    const diceInput = document.getElementById('dice-count');
    if (diceInput) {
        diceInput.value = 2;
        normalizeDiceCount(false);
    }
    updateBiddingUI();
    updateStatsPanel(null);
    hideUnitTooltip();
    removeRangeRing();

    try {
        await loadStats(true);
    } catch (err) {
        console.error("Unable to refresh unit stats during board reset:", err);
    }

    createUnits();
    if (shouldCreateTerrain) {
        createDefaultTerrain();
    }
    saveGame();
}

window.resetGame = async function () {
    cancelTerrainCardAnimation();
    terrainDeck = createShuffledTerrainDeck();
    renderTerrainCard();
    await resetBoard(createDefaultUnits, false);
};

window.resetLongSideDeployment = async function () {
    cancelTerrainCardAnimation();
    terrainDeck = [];
    renderTerrainCard();
    await resetBoard(createLongSideDeploymentUnits);
};

// --- DICE ---
let diceAnimationTimer = null;

function normalizeDiceCount(shouldSave = true) {
    const input = document.getElementById('dice-count');
    if (!input) return 2;
    const parsed = parseInt(input.value, 10);
    const safeValue = Number.isFinite(parsed) ? Math.min(20, Math.max(1, parsed)) : 2;
    input.value = safeValue;
    if (shouldSave) saveGame();
    return safeValue;
}

function adjustDiceCount(delta) {
    const currentCount = normalizeDiceCount(false);
    const input = document.getElementById('dice-count');
    if (input) {
        input.value = currentCount + delta;
        normalizeDiceCount();
    }
}

function normalizeStartingPoolCount(shouldSave = true) {
    const input = document.getElementById('starting-pool-count');
    if (!input) return DEFAULT_DRAFT_POOL_SIZE;
    const parsed = parseInt(input.value, 10);
    let safeValue = Number.isFinite(parsed) ? Math.max(2, parsed) : DEFAULT_DRAFT_POOL_SIZE;
    if (safeValue % 2 !== 0) safeValue += 1;
    input.value = safeValue;
    if (shouldSave) saveGame();
    return safeValue;
}

function setDiceFaces(rolls, rolling = false) {
    const container = document.getElementById('dice-values');
    container.replaceChildren();

    if (!rolls.length) {
        const emptyDie = document.createElement('span');
        emptyDie.className = 'die-face empty';
        emptyDie.innerText = '-';
        container.appendChild(emptyDie);
        return;
    }

    rolls.forEach(value => {
        const die = document.createElement('span');
        die.className = rolling ? 'die-face rolling' : 'die-face';
        die.innerText = value;
        container.appendChild(die);
    });
}

function createPlaceholderRoll(count) {
    return Array.from({ length: count }, () => '?');
}

function sortDiceHighestFirst(rolls) {
    if (!rolls.every(value => Number.isFinite(value))) {
        return [...rolls];
    }

    return [...rolls].sort((first, second) => second - first);
}

function renderDiceRoll(rolls) {
    const displayedRolls = sortDiceHighestFirst(rolls);
    const card = document.getElementById('dice-roll-card');
    const placeholderRoll = createPlaceholderRoll(displayedRolls.length || 1);

    if (diceAnimationTimer) {
        clearTimeout(diceAnimationTimer);
    }

    card.classList.remove('is-rolling');
    void card.offsetWidth;
    card.classList.add('is-rolling');
    setDiceFaces(placeholderRoll, true);

    diceAnimationTimer = setTimeout(() => {
        setDiceFaces(displayedRolls);
    }, 320);
}

function rollDice() {
    const count = normalizeDiceCount(false);
    const rolls = sortDiceHighestFirst(Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1));

    renderDiceRoll(rolls);
    sendData({ type: 'ROLL_DICE', rolls: rolls, count: count });
}

// --- STARTUP BOARD STATE ---
async function initGame() {
    try {
        await loadStats();
    } catch (err) {
        console.error("Unable to load unit stats:", err);
    }

    const saved = localStorage.getItem(SAVE_KEY);
    if (saved) {
        restoreBoardState(saved, true);
    } else {
        createDefaultUnits();
        createDefaultTerrain();
        saveGame(true);
    }
}

// --- UNIT DEPLOYMENT GENERATION ---
function getStatsColumnValue(stats, columnName) {
    if (!stats) return undefined;
    const normalizedColumnName = columnName.trim().toLowerCase();
    const matchingEntry = Object.entries(stats).find(([key]) =>
        typeof key === 'string' && key.trim().toLowerCase() === normalizedColumnName
    );

    return matchingEntry ? matchingEntry[1] : undefined;
}

function getFirstStatsColumnValue(stats, columnNames) {
    for (const columnName of columnNames) {
        const value = getStatsColumnValue(stats, columnName);
        if (value !== undefined) return value;
    }
    return undefined;
}

function parseCombatStat(stats, columnNames) {
    const rawValue = getFirstStatsColumnValue(stats, columnNames);
    if (rawValue === undefined || rawValue === null || `${rawValue}`.trim() === '') return null;

    const parsedValue = Number(`${rawValue}`.trim().replace(/,/g, ''));
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : null;
}

function getMatchupProfiles() {
    const profilesByName = new Map();
    let invalidProfileCount = 0;

    availableUnitRows.forEach(stats => {
        if (getUnitQuantity(stats) === 0) return;

        const name = stats && stats.Unit ? `${stats.Unit}`.trim() : '';
        const melee = parseCombatStat(stats, ['Melee']);
        const defence = parseCombatStat(stats, ['Def', 'Def.', 'Defence', 'Defense']);

        if (!name || melee === null || defence === null) {
            invalidProfileCount += 1;
            return;
        }

        if (!profilesByName.has(name)) {
            profilesByName.set(name, { name, melee, defence });
        }
    });

    return {
        profiles: Array.from(profilesByName.values()).sort((a, b) => a.name.localeCompare(b.name)),
        invalidProfileCount
    };
}

function getExpectedExplodingDamage(melee, targetDefence) {
    const minimumSuccessfulRoll = Math.ceil(targetDefence);
    const successfulFaces = Math.max(0, Math.min(6, 7 - minimumSuccessfulRoll));

    // Each six adds another identical roll, so expected hits per starting die
    // are p(hit) / (1 - p(six)), which simplifies to successfulFaces / 5.
    return melee * (successfulFaces / 5);
}

function getRoundsToDefeat(expectedDamage) {
    if (expectedDamage <= 0) return Infinity;
    return Math.ceil((UNIT_HIT_POINTS / expectedDamage) - 1e-10);
}

function analyseMatchup(unit, opponent) {
    const unitDamage = getExpectedExplodingDamage(unit.melee, opponent.defence);
    const opponentDamage = getExpectedExplodingDamage(opponent.melee, unit.defence);
    const unitVictoryRound = getRoundsToDefeat(unitDamage);
    const opponentVictoryRound = getRoundsToDefeat(opponentDamage);

    if (!Number.isFinite(unitVictoryRound) && !Number.isFinite(opponentVictoryRound)) {
        return {
            unitDamage,
            opponentDamage,
            outcome: 'stalemate',
            victor: 'Stalemate',
            rounds: Infinity,
            remainingHp: `${UNIT_HIT_POINTS.toFixed(2)} each`
        };
    }

    if (unitVictoryRound === opponentVictoryRound) {
        return {
            unitDamage,
            opponentDamage,
            outcome: 'draw',
            victor: 'Draw',
            rounds: unitVictoryRound,
            remainingHp: '0.00 each'
        };
    }

    const unitWins = unitVictoryRound < opponentVictoryRound;
    const rounds = unitWins ? unitVictoryRound : opponentVictoryRound;
    const incomingDamage = unitWins ? opponentDamage : unitDamage;
    const remainingHp = Math.max(0, UNIT_HIT_POINTS - (incomingDamage * rounds));

    return {
        unitDamage,
        opponentDamage,
        outcome: unitWins ? 'unit-win' : 'opponent-win',
        victor: unitWins ? unit.name : opponent.name,
        rounds,
        remainingHp: remainingHp.toFixed(2)
    };
}

function analyseArcherKillTurns(target, shooting) {
    const expectedDamage = getExpectedExplodingDamage(shooting, target.defence);
    return {
        expectedDamage,
        turns: getRoundsToDefeat(expectedDamage)
    };
}

function formatExpectedDamage(value) {
    return value.toFixed(2);
}

function formatTurns(value) {
    return Number.isFinite(value) ? `${value}` : '∞';
}

function appendMatchupCell(row, text, className = '') {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    cell.textContent = text;
    row.appendChild(cell);
    return cell;
}

function renderMatchupAnalysisError(message) {
    const results = document.getElementById('matchup-results');
    if (!results) return;

    const status = document.createElement('p');
    status.className = 'matchup-status matchup-error';
    status.textContent = message;
    results.replaceChildren(status);
}

function renderMatchupAnalysis() {
    const results = document.getElementById('matchup-results');
    if (!results) return;

    const { profiles, invalidProfileCount } = getMatchupProfiles();
    if (!profiles.length) {
        renderMatchupAnalysisError('No unit profiles with valid Melee and Def values were found.');
        return;
    }

    const fragment = document.createDocumentFragment();
    const summary = document.createElement('div');
    summary.className = 'matchup-summary';

    const summaryTitle = document.createElement('strong');
    summaryTitle.textContent = `${profiles.length} units · ${profiles.length * profiles.length} ordered matchups`;
    summary.appendChild(summaryTitle);

    const summaryText = document.createElement('p');
    summaryText.textContent = 'EV is expected damage per round. Each unit has 5 HP, attacks are simultaneous, archer kill times use Shooting 2/3/4 against each unit’s Def, and every recursively exploding six is included; no random simulation is used.';
    summary.appendChild(summaryText);
    fragment.appendChild(summary);

    if (invalidProfileCount > 0) {
        const warning = document.createElement('p');
        warning.className = 'matchup-warning';
        warning.textContent = `${invalidProfileCount} sheet row${invalidProfileCount === 1 ? '' : 's'} omitted because Melee or Def was missing or invalid.`;
        fragment.appendChild(warning);
    }

    const archerSection = document.createElement('section');
    archerSection.className = 'matchup-unit-group matchup-archer-section';

    const archerHeader = document.createElement('div');
    archerHeader.className = 'matchup-group-header';
    const archerHeading = document.createElement('h3');
    archerHeading.textContent = 'Archer kill times';
    const archerStats = document.createElement('span');
    archerStats.textContent = `Turns to deal ${UNIT_HIT_POINTS} expected damage`;
    archerHeader.append(archerHeading, archerStats);
    archerSection.appendChild(archerHeader);

    const archerScroll = document.createElement('div');
    archerScroll.className = 'matchup-table-scroll';
    const archerTable = document.createElement('table');
    archerTable.className = 'matchup-table matchup-archer-table';
    const archerTableHead = document.createElement('thead');
    const archerHeaderRow = document.createElement('tr');
    ['Target', 'Def', ...ARCHER_SHOOTING_VALUES.map(shooting => `Shooting ${shooting}`)].forEach(label => {
        const header = document.createElement('th');
        header.scope = 'col';
        header.textContent = label;
        archerHeaderRow.appendChild(header);
    });
    archerTableHead.appendChild(archerHeaderRow);
    archerTable.appendChild(archerTableHead);

    const archerTableBody = document.createElement('tbody');
    profiles.forEach(target => {
        const row = document.createElement('tr');
        appendMatchupCell(row, target.name, 'matchup-opponent');
        appendMatchupCell(row, `${target.defence}`, 'matchup-number');
        ARCHER_SHOOTING_VALUES.forEach(shooting => {
            const analysis = analyseArcherKillTurns(target, shooting);
            appendMatchupCell(row, formatTurns(analysis.turns), 'matchup-number');
        });
        archerTableBody.appendChild(row);
    });
    archerTable.appendChild(archerTableBody);
    archerScroll.appendChild(archerTable);
    archerSection.appendChild(archerScroll);
    fragment.appendChild(archerSection);

    profiles.forEach(unit => {
        const group = document.createElement('section');
        group.className = 'matchup-unit-group';

        const groupHeader = document.createElement('div');
        groupHeader.className = 'matchup-group-header';
        const heading = document.createElement('h3');
        heading.textContent = unit.name;
        const stats = document.createElement('span');
        stats.textContent = `Melee ${unit.melee} · Def ${unit.defence} · ${UNIT_HIT_POINTS} HP`;
        groupHeader.append(heading, stats);
        group.appendChild(groupHeader);

        const tableScroll = document.createElement('div');
        tableScroll.className = 'matchup-table-scroll';
        const table = document.createElement('table');
        table.className = 'matchup-table';
        const tableHead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['Opponent', `${unit.name} EV`, 'Opponent EV', 'Victor', 'Rounds', 'Victor HP'].forEach(label => {
            const header = document.createElement('th');
            header.scope = 'col';
            header.textContent = label;
            headerRow.appendChild(header);
        });
        tableHead.appendChild(headerRow);
        table.appendChild(tableHead);

        const tableBody = document.createElement('tbody');
        profiles.forEach(opponent => {
            const analysis = analyseMatchup(unit, opponent);
            const row = document.createElement('tr');
            row.className = `matchup-${analysis.outcome}`;
            appendMatchupCell(row, opponent.name, 'matchup-opponent');
            appendMatchupCell(row, formatExpectedDamage(analysis.unitDamage), 'matchup-number');
            appendMatchupCell(row, formatExpectedDamage(analysis.opponentDamage), 'matchup-number');
            appendMatchupCell(row, analysis.victor, 'matchup-victor');
            appendMatchupCell(row, formatTurns(analysis.rounds), 'matchup-number');
            appendMatchupCell(row, analysis.remainingHp, 'matchup-number');
            tableBody.appendChild(row);
        });
        table.appendChild(tableBody);
        tableScroll.appendChild(table);
        group.appendChild(tableScroll);
        fragment.appendChild(group);
    });

    results.replaceChildren(fragment);
}

function getUnitQuantity(unitStats) {
    const rawQuantity = getStatsColumnValue(unitStats, 'Quantity');
    if (rawQuantity === undefined || rawQuantity === null || `${rawQuantity}`.trim() === "") {
        return 1;
    }

    const quantity = Number(`${rawQuantity}`.trim().replace(/,/g, ''));
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
        console.warn(`Invalid Quantity for "${unitStats.Unit || 'unknown unit'}"; using 1 copy instead:`, rawQuantity);
        return 1;
    }

    return quantity;
}

function createRandomUnitPool(count) {
    const remainingUnits = availableUnitRows.map(unitStats => ({
        unitStats,
        copies: getUnitQuantity(unitStats)
    })).filter(entry => entry.copies > 0);
    let remainingCopies = remainingUnits.reduce((total, entry) => total + entry.copies, 0);
    const drawCount = Math.min(count, remainingCopies);
    const unitPool = [];

    for (let draw = 0; draw < drawCount; draw++) {
        let copyIndex = Math.floor(Math.random() * remainingCopies);

        for (const entry of remainingUnits) {
            if (copyIndex < entry.copies) {
                unitPool.push(entry.unitStats);
                entry.copies -= 1;
                remainingCopies -= 1;
                break;
            }

            copyIndex -= entry.copies;
        }
    }

    return unitPool;
}

function createDefaultUnits() {
    const draftPool = createRandomUnitPool(normalizeStartingPoolCount(false));
    if (draftPool.length === 0) {
        console.warn("No units were available in the spreadsheet, so no draft pool was created.");
        return;
    }

    const cols = Math.ceil(Math.sqrt(draftPool.length));
    const rows = Math.ceil(draftPool.length / cols);
    const unitSizes = draftPool.map(getUnitSizePx);
    const shortEdgeClearance = inchesToPx(2);
    const longEdgeClearance = inchesToPx(DEPLOY_INCHES);
    const rowHeights = Array.from({ length: rows }, (_, row) => {
        const rowStart = row * cols;
        return Math.max(...unitSizes.slice(rowStart, rowStart + cols).map(size => size.height));
    });
    const firstRowCenterY = longEdgeClearance + (rowHeights[0] / 2);
    const lastRowCenterY = tableHeightPx - longEdgeClearance - (rowHeights[rows - 1] / 2);

    draftPool.forEach((unitStats, i) => {
        const name = unitStats.Unit;
        const row = Math.floor(i / cols);
        const rowStart = row * cols;
        const unitsInRow = Math.min(cols, draftPool.length - rowStart);
        const col = i - rowStart;
        const unitSize = unitSizes[i];
        const firstUnitCenterX = shortEdgeClearance + (unitSizes[rowStart].width / 2);
        const lastUnitCenterX = tableWidthPx - shortEdgeClearance
            - (unitSizes[rowStart + unitsInRow - 1].width / 2);
        const centerX = unitsInRow === 1
            ? tableWidthPx / 2
            : firstUnitCenterX + ((lastUnitCenterX - firstUnitCenterX) * col / (unitsInRow - 1));
        const centerY = rows === 1
            ? tableHeightPx / 2
            : firstRowCenterY + ((lastRowCenterY - firstRowCenterY) * row / (rows - 1));
        const x = centerX - (unitSize.width / 2);
        const y = centerY - (unitSize.height / 2);

        createUnitDOM(name, "#666", x, y, 0, 0, unitStats);
    });
}

function createLongSideDeploymentUnits() {
    const deploymentPool = createRandomUnitPool(normalizeStartingPoolCount(false));
    if (deploymentPool.length === 0) {
        console.warn("No units were available in the spreadsheet, so no long-side deployment was created.");
        return;
    }

    const perSide = Math.floor(deploymentPool.length / 2);
    const topSide = deploymentPool.slice(0, perSide);
    const bottomSide = deploymentPool.slice(perSide, perSide * 2);
    const sidePadding = Math.max(inchesToPx(1), defaultUnitSizePx.width / 2);
    const rankGap = 10;
    const unitGap = 10;
    const topDeploymentLineY = inchesToPx(DEPLOY_INCHES);
    const bottomDeploymentLineY = tableHeightPx - inchesToPx(DEPLOY_INCHES);

    const buildDeploymentRanks = (units) => {
        const availableWidth = Math.max(1, tableWidthPx - (sidePadding * 2));
        const ranks = [];
        let currentRank = null;

        units.forEach(unitStats => {
            const unitSize = getUnitSizePx(unitStats);
            const candidateWidth = currentRank
                ? currentRank.width + unitGap + unitSize.width
                : unitSize.width;

            if (currentRank && candidateWidth > availableWidth) {
                ranks.push(currentRank);
                currentRank = null;
            }

            if (!currentRank) {
                currentRank = {
                    items: [],
                    width: 0,
                    height: 0
                };
            }

            currentRank.items.push({ unitStats, unitSize });
            currentRank.width += (currentRank.items.length > 1 ? unitGap : 0) + unitSize.width;
            currentRank.height = Math.max(currentRank.height, unitSize.height);
        });

        if (currentRank) {
            ranks.push(currentRank);
        }

        return ranks;
    };

    const placeSide = (units, angle) => {
        const availableWidth = tableWidthPx - (sidePadding * 2);
        const ranks = buildDeploymentRanks(units);
        let rankOffset = 0;

        ranks.forEach(rank => {
            const totalUnitWidth = rank.items.reduce((total, item) => total + item.unitSize.width, 0);
            const gap = rank.items.length > 1
                ? Math.max(unitGap, (availableWidth - totalUnitWidth) / (rank.items.length - 1))
                : 0;
            let nextX = rank.items.length > 1
                ? sidePadding
                : (tableWidthPx - rank.items[0].unitSize.width) / 2;

            rank.items.forEach(({ unitStats, unitSize }) => {
                const unitY = angle === 180
                    ? Math.max(0, topDeploymentLineY - rankOffset - unitSize.height)
                    : Math.min(tableHeightPx - unitSize.height, bottomDeploymentLineY + rankOffset);
                const unitX = Math.max(0, Math.min(tableWidthPx - unitSize.width, nextX));
                createUnitDOM(unitStats.Unit, "#666", unitX, unitY, angle, 0, unitStats);
                nextX += unitSize.width + gap;
            });

            rankOffset += rank.height + rankGap;
        });
    };

    placeSide(topSide, 180);
    placeSide(bottomSide, 0);
}

// --- TERRAIN GENERATION ---
function createShuffledTerrainDeck() {
    const deck = [
        ...TERRAIN_TYPES.flatMap(type => [type, type]),
        ...Array(10).fill(TERRAIN_NO_FEATURE_CARD)
    ];

    for (let i = deck.length - 1; i > 0; i--) {
        const swapIndex = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[swapIndex]] = [deck[swapIndex], deck[i]];
    }

    return deck;
}

function getTerrainCardLabel(cardType) {
    if (cardType === TERRAIN_NO_FEATURE_CARD) return 'X';
    return cardType.charAt(0).toUpperCase() + cardType.slice(1);
}

function getTerrainCardAnimationDuration() {
    const prefersReducedMotion = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return prefersReducedMotion ? 0 : TERRAIN_CARD_ANIMATION_MS;
}

function cancelTerrainCardAnimation() {
    clearTimeout(terrainCardRemoveTimer);
    clearTimeout(terrainCardRevealTimer);
    terrainCardRemoveTimer = null;
    terrainCardRevealTimer = null;
    isTerrainCardAnimating = false;
    const status = document.getElementById('terrain-draw-status');
    if (status) status.textContent = '';

    const card = document.getElementById('terrain-card');
    if (card) {
        card.classList.remove('is-removing', 'is-revealing');
    }
}

function animateTerrainCardAdvance() {
    const card = document.getElementById('terrain-card');
    if (!card) {
        renderTerrainCard();
        return;
    }

    const animationDuration = getTerrainCardAnimationDuration();
    isTerrainCardAnimating = true;
    card.classList.remove('is-revealing');
    void card.offsetWidth;
    card.classList.add('is-removing');

    terrainCardRemoveTimer = setTimeout(() => {
        terrainCardRemoveTimer = null;
        card.classList.remove('is-removing');
        renderTerrainCard();

        if (animationDuration === 0) {
            isTerrainCardAnimating = false;
            return;
        }

        void card.offsetWidth;
        card.classList.add('is-revealing');
        terrainCardRevealTimer = setTimeout(() => {
            terrainCardRevealTimer = null;
            card.classList.remove('is-revealing');
            isTerrainCardAnimating = false;
        }, animationDuration);
    }, animationDuration);
}

function renderTerrainCard() {
    const card = document.getElementById('terrain-card');
    const title = document.getElementById('terrain-card-title');
    const note = document.getElementById('terrain-card-note');
    const count = document.getElementById('terrain-deck-count');
    if (count) count.textContent = `${terrainDeck.length} cards remaining`;
    if (!card || !title || !note) return;

    card.classList.remove(
        ...TERRAIN_TYPES.map(type => `terrain-card-${type}`),
        'terrain-card-x',
        'is-empty'
    );

    const revealedCard = terrainDeck[0];
    if (!revealedCard) {
        card.classList.add('is-empty');
        card.dataset.cardType = '';
        card.setAttribute('aria-disabled', 'true');
        card.setAttribute('aria-label', 'All terrain drawn. Start a new battle to create a terrain deck.');
        title.textContent = 'Deck Empty';
        note.textContent = 'All terrain drawn';
        return;
    }

    const label = getTerrainCardLabel(revealedCard);
    card.classList.add(`terrain-card-${revealedCard}`);
    card.dataset.cardType = revealedCard;
    card.setAttribute('aria-disabled', 'false');
    card.setAttribute('aria-label', revealedCard === TERRAIN_NO_FEATURE_CARD
        ? 'Revealed X card. Drag onto the battlefield to discard it and reveal the next card.'
        : `Revealed ${label} card. Drag it onto the battlefield.`);
    title.textContent = label;
    note.textContent = revealedCard === TERRAIN_NO_FEATURE_CARD
        ? 'Drag onto battlefield — no terrain'
        : 'Drag onto battlefield';
}

function createDefaultTerrain() {
    const terrainTypes = ['forest', 'forest', 'hills', 'hills', 'field', 'field'];
    terrainTypes.forEach((type) => {
        const w = terrainDiameterPx;
        const h = terrainDiameterPx;
        const x = Math.random() * (tableWidthPx - w - 100) + 50;
        const y = Math.random() * (inchesToPx(26) - inchesToPx(10)) + inchesToPx(10);
        const angle = Math.floor(Math.random() * 360);
        createTerrainDOM(type, x, y, w, h, angle);
    });
}

function beginTerrainDrag(type, event, shouldPushUndo = true) {
    if (hasBattleStarted()) return;
    if (event && event.button !== 0) return;
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    clearPieceSelection();
    if (shouldPushUndo) pushUndo();
    const w = terrainDiameterPx;
    const h = terrainDiameterPx;
    const div = createTerrainDOM(type, (tableWidthPx - w) / 2, (tableHeightPx - h) / 2, w, h, 0);
    activePiece = div;
    pendingDragPiece = null;
    ghostPiece = null;
    anchorX = -1;
    div.dataset.offsetX = w / 2;
    div.dataset.offsetY = h / 2;
    isDraggingPiece = true;
    activePointerId = event ? event.pointerId : null;
    activePieceHalfWidth = w / 2;
    activePieceHalfHeight = h / 2;
    activeTableRect = table.getBoundingClientRect();
    if (event) {
        const pointer = getTablePointerPosition(event);
        div.style.left = `${pointer.x - w / 2}px`;
        div.style.top = `${pointer.y - h / 2}px`;
    }
    suppressUnitTooltip(Number.MAX_SAFE_INTEGER);
    if (event && event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    saveGame();
}

window.spawnTerrain = function (type, event) {
    beginTerrainDrag(type, event);
};

window.playTerrainCard = function (event) {
    if (hasBattleStarted()) return;
    if (!event || activePointerId !== null || isTerrainCardAnimating || !terrainDeck.length) return;
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    event.stopPropagation();
    clearPieceSelection();
    activePointerId = event.pointerId;
    activeTableRect = table.getBoundingClientRect();
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    const preview = document.createElement('div');
    preview.classList.add('terrain-drag-preview', `terrain-card-${terrainDeck[0]}`);
    preview.textContent = getTerrainCardLabel(terrainDeck[0]);
    preview.setAttribute('aria-hidden', 'true');
    document.body.appendChild(preview);
    activeTerrainCardDrag = { type: terrainDeck[0], preview, moved: false };
    updateTerrainCardDrag(event);
    if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId);
};

function updateTerrainCardDrag(event) {
    if (!activeTerrainCardDrag) return;
    const drag = activeTerrainCardDrag;
    drag.moved = drag.moved || Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY) >= DRAG_THRESHOLD_PX;
    drag.preview.style.display = drag.moved ? 'flex' : 'none';
    drag.preview.style.left = `${event.clientX}px`;
    drag.preview.style.top = `${event.clientY}px`;
}

function finishTerrainCardDrag(event) {
    const drag = activeTerrainCardDrag;
    if (!drag) return;
    updateTerrainCardDrag(event);
    const pointer = getTablePointerPosition(event);
    const validDrop = event.type !== 'pointercancel' && drag.moved && !hasBattleStarted()
        && pointer.x >= 0 && pointer.x <= tableWidthPx && pointer.y >= 0 && pointer.y <= tableHeightPx;
    drag.preview.remove();
    activeTerrainCardDrag = null;
    activePointerId = null;
    activeTableRect = null;
    if (!validDrop || terrainDeck[0] !== drag.type) return;
    pushUndo();
    terrainDeck.shift();
    if (drag.type !== TERRAIN_NO_FEATURE_CARD) {
        const diameter = terrainDiameterPx;
        createTerrainDOM(drag.type,
            Math.max(0, Math.min(tableWidthPx - diameter, pointer.x - diameter / 2)),
            Math.max(0, Math.min(tableHeightPx - diameter, pointer.y - diameter / 2)), diameter, diameter, 0);
    }
    const status = document.getElementById('terrain-draw-status');
    if (status) status.textContent = `${drag.type === TERRAIN_NO_FEATURE_CARD ? 'X discarded — no terrain' : `${getTerrainCardLabel(drag.type)} placed`}. ${terrainDeck.length} cards remaining.`;
    animateTerrainCardAdvance();
    saveGame();
}

function attachListeners(element) {
    element.addEventListener('pointerdown', onPiecePointerDown);
    element.addEventListener('wheel', onWheel);
    element.addEventListener('contextmenu', event => {
        if (element.classList.contains('unit')) event.preventDefault();
    });
}

// --- KEYBOARD INPUT ---
function isEditableShortcutTarget(target) {
    if (!target) return false;
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

window.addEventListener('keydown', (e) => {
    if (isEditableShortcutTarget(e.target)) return;
    if (!e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'f' && !isEditableShortcutTarget(e.target)) {
        e.preventDefault();
        toggleFullscreen();
        return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
    if (e.key === 'z') { undo(); return; }
    if (e.key.toLowerCase() === 'r' && hoveredUnit) showRangeRing(hoveredUnit);

    const isPlus = (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd');
    const isMinus = (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract');

    // Rotation Keys
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const target = activePiece || hoveredUnit || hoveredTerrain;
        if (target) {
            e.preventDefault();
            const step = e.shiftKey ? 1 : 2;
            rotatePiece(target, e.key === 'ArrowRight' ? step : -step);
            return;
        }
    }

    if (!isPlus && !isMinus) return;

    if (hoveredUnit) {
        adjustUnitWounds(hoveredUnit, isPlus ? 1 : -1);
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'r') removeRangeRing();
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') resetRotationPivot();
});

function showRangeRing(unit) {
    if (!hasBattleStarted()) return;
    if (unit.querySelector('.range-ring')) return;
    const ring = document.createElement('div');
    ring.classList.add('range-ring');
    const diameterPx = inchesToPx(THREAT_RANGE_INCHES * 2);
    ring.style.width = `${diameterPx}px`;
    ring.style.height = `${diameterPx}px`;
    ring.style.left = '50%';
    ring.style.top = '50%';
    unit.appendChild(ring);
}
function removeRangeRing() {
    document.querySelectorAll('.range-ring').forEach(r => r.remove());
}

// --- ROTATION HELPERS ---
// Unit fronts point up at zero degrees, in board coordinates for both players.
function getUnitGeometry(unit) {
    const angle = (parseFloat(unit.dataset.angle) || 0) * Math.PI / 180;
    const halfWidth = (parseFloat(unit.style.width) || unit.offsetWidth) / 2;
    const halfHeight = (parseFloat(unit.style.height) || unit.offsetHeight) / 2;
    return {
        x: (parseFloat(unit.style.left) || 0) + halfWidth,
        y: (parseFloat(unit.style.top) || 0) + halfHeight,
        right: { x: Math.cos(angle), y: Math.sin(angle) },
        forward: { x: Math.sin(angle), y: -Math.cos(angle) },
        halfWidth, halfHeight
    };
}

// Swept separating-axis test: find first contact of the full moving footprint.
function getForwardMovement(unit, maxDistance) {
    const moving = getUnitGeometry(unit);
    let distance = maxDistance;
    let blocker = null;
    const dot = (a, b) => a.x * b.x + a.y * b.y;
    const radius = (shape, axis) => shape.halfWidth * Math.abs(dot(shape.right, axis))
        + shape.halfHeight * Math.abs(dot(shape.forward, axis));
    table.querySelectorAll('.unit').forEach(other => {
        if (other === unit || other.classList.contains('ghost')) return;
        const target = getUnitGeometry(other);
        const delta = { x: target.x - moving.x, y: target.y - moving.y };
        let entry = -Infinity;
        let exit = Infinity;
        for (const axis of [moving.right, moving.forward, target.right, target.forward]) {
            const separation = dot(delta, axis);
            const extent = radius(moving, axis) + radius(target, axis);
            const velocity = dot(moving.forward, axis);
            if (Math.abs(velocity) < 1e-8) {
                // A tangential edge does not block movement alongside a unit.
                if (Math.abs(separation) >= extent - 1e-8) return;
            } else {
                const a = (separation - extent) / velocity;
                const b = (separation + extent) / velocity;
                entry = Math.max(entry, Math.min(a, b));
                exit = Math.min(exit, Math.max(a, b));
            }
        }
        if (entry <= exit && exit > 1e-8 && Math.max(0, entry) <= distance) {
            distance = Math.max(0, entry);
            blocker = other;
        }
    });
    return { distance, blocker };
}

let selectionRangeElements = [];
let movementRangeBlockers = new Set();
const inspectedUnits = new Set();
let isTouchMultiSelectActive = false;

function inspectUnitRange(unit) {
    if (!unit || !unit.classList.contains('unit')) return;
    inspectedUnits.add(unit);
    unit.classList.add('is-range-inspected');
}

function clearRangeInspections() {
    inspectedUnits.forEach(unit => unit.classList.remove('is-range-inspected'));
    inspectedUnits.clear();
    isTouchMultiSelectActive = false;
}

function clearSelectionRanges() {
    selectionRangeElements.forEach(element => element.remove());
    selectionRangeElements = [];
    movementRangeBlockers.forEach(unit => unit.classList.remove('is-movement-blocker'));
    movementRangeBlockers.clear();
}

function updateSelectionRanges() {
    clearSelectionRanges();
    if (!hasBattleStarted()) return;
    const units = new Set(inspectedUnits);
    if (selectedPiece && selectedPiece.classList.contains('unit')) units.add(selectedPiece);
    units.forEach(unit => {
        if (unit.isConnected === false) {
            inspectedUnits.delete(unit);
            unit.classList.remove('is-range-inspected');
            return;
        }
        renderUnitSelectionRanges(unit);
    });
}

function renderUnitSelectionRanges(unit) {
    const geometry = getUnitGeometry(unit);
    const { stats } = getUnitStats(unit);
    const speed = parseFloat(getStatValue(stats, 'Speed', 'Move'));
    const ranged = String(getStatValue(stats, 'Ranged', 'Shoot')).split('/');
    const shootingRange = ranged.length > 1 ? parseFloat(ranged[1]) : 0;
    const frontX = geometry.x + geometry.forward.x * geometry.halfHeight;
    const frontY = geometry.y + geometry.forward.y * geometry.halfHeight;
    const angle = parseFloat(unit.dataset.angle) || 0;
    const addOverlay = (className) => {
        const element = document.createElement('div');
        element.classList.add('selection-range', className);
        element.dataset.rangeUnitId = unit.dataset.unitId || '';
        if (unit.dataset.owner === 'p2') element.classList.add('opponent-range');
        element.setAttribute('aria-hidden', 'true');
        element.style.left = `${frontX}px`;
        element.style.top = `${frontY}px`;
        table.appendChild(element);
        selectionRangeElements.push(element);
        return element;
    };
    if (shootingRange > 0) {
        const arc = addOverlay('shooting-range');
        const radius = inchesToPx(shootingRange);
        arc.style.width = `${radius * 2}px`;
        arc.style.height = `${radius}px`;
        arc.style.marginLeft = `${-radius}px`;
        arc.style.marginTop = `${-radius}px`;
        arc.style.transform = `rotate(${angle}deg)`;
    }
    if (speed >= 0) {
        const movement = getForwardMovement(unit, inchesToPx(speed));
        const line = addOverlay('movement-range');
        line.style.width = `${movement.distance}px`;
        line.style.transform = `rotate(${angle - 90}deg)`;
        if (movement.blocker) {
            movementRangeBlockers.add(movement.blocker);
            movement.blocker.classList.add('is-movement-blocker');
        }
    }
}

function normalizeAngle(angle) {
    let normalized = angle % 360;
    if (normalized > 180) normalized -= 360;
    if (normalized <= -180) normalized += 360;
    return normalized;
}

function getRotationDelta(piece, previousAngle, nextAngle) {
    if (rotationPivotTarget !== piece) {
        rotationPivotTarget = piece;
        rotationPivotStartAngle = previousAngle;
    }

    return nextAngle - rotationPivotStartAngle;
}

function resetRotationPivot() {
    rotationPivotTarget = null;
    rotationPivotStartAngle = 0;
}

function showAngleIndicator(piece, angleDelta) {
    const indicator = document.getElementById('angle-indicator');
    if (!indicator || !piece) return;

    const normalizedAngle = normalizeAngle(angleDelta);
    const left = (parseFloat(piece.style.left) || 0) + (piece.offsetWidth / 2);
    const top = (parseFloat(piece.style.top) || 0) - 18;

    indicator.innerText = `${normalizedAngle > 0 ? '+' : ''}${normalizedAngle.toFixed(0)}°`;
    indicator.style.left = `${left}px`;
    indicator.style.top = `${Math.max(20, top)}px`;
    indicator.setAttribute('aria-hidden', 'false');
    indicator.classList.add('visible');

    if (angleIndicatorTimer) {
        clearTimeout(angleIndicatorTimer);
    }

    angleIndicatorTimer = setTimeout(() => {
        indicator.classList.remove('visible');
        indicator.setAttribute('aria-hidden', 'true');
        resetRotationPivot();
    }, 700);
}

// --- POINTER GEOMETRY ---
function getActiveTableRect() {
    if (!activeTableRect) {
        activeTableRect = table.getBoundingClientRect();
    }

    return activeTableRect;
}

function getTablePointerPosition(event) {
    const tableRect = getActiveTableRect();
    if (!isHost) {
        return {
            x: (tableRect.right - event.clientX) / currentScale,
            y: (tableRect.bottom - event.clientY) / currentScale
        };
    }
    return {
        x: (event.clientX - tableRect.left) / currentScale,
        y: (event.clientY - tableRect.top) / currentScale
    };
}

function getPointerAngleFromPieceCenter(piece, event) {
    const pointer = getTablePointerPosition(event);
    const centerX = rotatingPiece === piece
        ? rotationDragCenterX
        : (parseFloat(piece.style.left) || 0) + (piece.offsetWidth / 2);
    const centerY = rotatingPiece === piece
        ? rotationDragCenterY
        : (parseFloat(piece.style.top) || 0) + (piece.offsetHeight / 2);

    return Math.atan2(pointer.y - centerY, pointer.x - centerX) * (180 / Math.PI);
}

function onRotationHandlePointerDown(e) {
    if (!e.isPrimary || e.button !== 0 || activePointerId !== null) return;
    e.preventDefault();
    e.stopPropagation();

    const piece = e.currentTarget.closest('.piece');
    if (!piece) return;

    selectPiece(piece);
    activeTableRect = table.getBoundingClientRect();
    activePointerId = e.pointerId;
    rotatingPiece = piece;
    rotationDragStartAngle = parseFloat(piece.dataset.angle) || 0;
    rotationDragCenterX = (parseFloat(piece.style.left) || 0) + (piece.offsetWidth / 2);
    rotationDragCenterY = (parseFloat(piece.style.top) || 0) + (piece.offsetHeight / 2);
    rotationDragLastPointerAngle = getPointerAngleFromPieceCenter(piece, e);
    rotationDragPointerDelta = 0;
    rotationDragUndoPushed = false;
    pendingDragPiece = null;
    isDraggingPiece = false;
    piece.classList.add('is-rotating');
    suppressUnitTooltip(Number.MAX_SAFE_INTEGER);
    hideUnitTooltip();
    positionPieceControls();

    const pieceId = getPieceId(piece);
    if (pieceId) {
        sendData({
            type: 'PIECE_ROTATE_START',
            pieceId: pieceId,
            angle: rotationDragStartAngle,
            delta: 0
        });
    }

    if (e.currentTarget.setPointerCapture) {
        e.currentTarget.setPointerCapture(e.pointerId);
    }
}

function updateRotationFromPointer(e) {
    if (!rotatingPiece) return;

    const pointerAngle = getPointerAngleFromPieceCenter(rotatingPiece, e);
    rotationDragPointerDelta += normalizeAngle(pointerAngle - rotationDragLastPointerAngle);
    rotationDragLastPointerAngle = pointerAngle;

    const currentAngle = parseFloat(rotatingPiece.dataset.angle) || 0;
    const nextAngle = rotationDragStartAngle + rotationDragPointerDelta;
    if (Math.abs(normalizeAngle(nextAngle - currentAngle)) < 0.15) return;

    if (!rotationDragUndoPushed) {
        pushUndo();
        rotationDragUndoPushed = true;
    }

    const delta = nextAngle - rotationDragStartAngle;
    setPieceAngle(rotatingPiece, nextAngle, delta);
    broadcastPieceRotateThrottled(rotatingPiece, nextAngle, delta);
}

function finishRotationDrag() {
    if (!rotatingPiece) return false;

    suppressUnitTooltip();
    const pieceId = getPieceId(rotatingPiece);
    const finalAngle = parseFloat(rotatingPiece.dataset.angle) || 0;
    if (pieceId) {
        sendData({
            type: 'PIECE_ROTATE_END',
            pieceId: pieceId,
            angle: finalAngle
        });
    }
    if (rotationDragUndoPushed) {
        saveGame();
    }

    rotatingPiece.classList.remove('is-rotating');
    rotatingPiece = null;
    rotationDragStartAngle = 0;
    rotationDragLastPointerAngle = 0;
    rotationDragPointerDelta = 0;
    rotationDragUndoPushed = false;
    rotationDragCenterX = 0;
    rotationDragCenterY = 0;
    activePointerId = null;
    activeTableRect = null;
    resetRotationPivot();
    positionPieceControls();

    return true;
}

// --- DRAG LOGIC ---
function cancelUnitLongPress() {
    if (unitLongPressTimer !== null) clearTimeout(unitLongPressTimer);
    unitLongPressTimer = null;
}

function beginUnitLongPress(unit, pointerId) {
    cancelUnitLongPress();
    unitLongPressTimer = setTimeout(() => {
        unitLongPressTimer = null;
        if (activePointerId !== pointerId || pendingDragPiece !== unit || isDraggingPiece) return;
        isTouchMultiSelectActive = true;
        didLongPressSelect = true;
        selectPiece(unit, true);
    }, UNIT_LONG_PRESS_MS);
}

function onPiecePointerDown(e) {
    if (!e.isPrimary || e.button !== 0 || activePointerId !== null) return;
    e.preventDefault();
    e.stopPropagation();

    activePointerId = e.pointerId;
    activeTableRect = table.getBoundingClientRect();
    pendingDragPiece = e.currentTarget;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    isDraggingPiece = false;
    didLongPressSelect = false;
    const pointer = getTablePointerPosition(e);
    const pieceLeft = parseFloat(pendingDragPiece.style.left) || 0;
    const pieceTop = parseFloat(pendingDragPiece.style.top) || 0;
    pendingDragPiece.dataset.offsetX = pointer.x - pieceLeft;
    pendingDragPiece.dataset.offsetY = pointer.y - pieceTop;

    if (pendingDragPiece.setPointerCapture) {
        pendingDragPiece.setPointerCapture(e.pointerId);
    }

    if (isTouchPointer(e)) {
        hideUnitTooltip();
        if (pendingDragPiece.classList.contains('unit')) beginUnitLongPress(pendingDragPiece, e.pointerId);
    }
}

function startPieceDrag() {
    if (!pendingDragPiece) return;
    cancelUnitLongPress();

    suppressUnitTooltip(Number.MAX_SAFE_INTEGER);
    pushUndo();
    activePiece = pendingDragPiece;
    pendingDragPiece = null;
    isDraggingPiece = true;
    activePiece.classList.add('is-dragging');
    activePieceHalfWidth = activePiece.offsetWidth / 2;
    activePieceHalfHeight = activePiece.offsetHeight / 2;
    clearSelectionRanges();
    ghostPiece = activePiece.cloneNode(true);
    ghostPiece.classList.add('ghost');
    ghostPiece.classList.remove('is-selected');
    ghostPiece.classList.remove('is-range-inspected', 'is-movement-blocker');
    ghostPiece.removeAttribute('id');
    ghostPiece.style.transform = activePiece.style.transform;
    table.insertBefore(ghostPiece, activePiece);
    anchorX = (parseFloat(activePiece.style.left) || 0) + activePieceHalfWidth;
    anchorY = (parseFloat(activePiece.style.top) || 0) + activePieceHalfHeight;
    showLine(anchorX, anchorY, anchorX, anchorY);
    selectPiece(activePiece, true);

    const pieceId = getPieceId(activePiece);
    if (pieceId) {
        sendData({
            type: 'PIECE_DRAG_START',
            pieceId: pieceId,
            x: Math.round(parseFloat(activePiece.style.left) || 0),
            y: Math.round(parseFloat(activePiece.style.top) || 0),
            anchorX: Math.round(anchorX),
            anchorY: Math.round(anchorY)
        });
    }
}

document.getElementById('table-container').addEventListener('pointerdown', (e) => {
    if (e.target === e.currentTarget && e.isPrimary && e.button === 0 && activePointerId === null) {
        clearPieceSelection();
    }
});

table.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0 || activePointerId !== null) return;
    if (e.target !== table && e.target !== document.getElementById('ui-layer')) return;
    e.preventDefault();
    clearPieceSelection();
    activePointerId = e.pointerId;
    activeTableRect = table.getBoundingClientRect();
    measurementPointerId = e.pointerId;
    isMeasuring = true;
    const pointer = getTablePointerPosition(e);
    anchorX = pointer.x;
    anchorY = pointer.y;
    showLine(anchorX, anchorY, anchorX, anchorY);

    if (table.setPointerCapture) {
        table.setPointerCapture(e.pointerId);
    }
});

function showLine(x1, y1, x2, y2) {
    lineElement.style.opacity = 1;
    measureTextElement.style.opacity = 1;
    lineElement.setAttribute('x1', x1);
    lineElement.setAttribute('y1', y1);
    lineElement.setAttribute('x2', x2);
    lineElement.setAttribute('y2', y2);
    measureTextElement.textContent = '0"';
}

function flushPendingPointerMove() {
    if (!pendingPointerMove) return;
    const event = pendingPointerMove;
    pendingPointerMove = null;
    if (pointerMoveFrame) {
        cancelAnimationFrame(pointerMoveFrame);
        pointerMoveFrame = null;
    }
    handlePointerMove(event);
}

function queuePointerMove(e) {
    if (e.pointerId !== activePointerId) return;
    if (Math.hypot(e.clientX - pointerStartX, e.clientY - pointerStartY) >= DRAG_THRESHOLD_PX) cancelUnitLongPress();
    pendingPointerMove = {
        pointerId: e.pointerId,
        clientX: e.clientX,
        clientY: e.clientY
    };

    if (pointerMoveFrame) return;
    pointerMoveFrame = requestAnimationFrame(() => {
        pointerMoveFrame = null;
        flushPendingPointerMove();
    });
}

function handlePointerMove(e) {
    if (e.pointerId !== activePointerId) return;
    if (activeTerrainCardDrag) {
        updateTerrainCardDrag(e);
        return;
    }

    if (rotatingPiece) {
        updateRotationFromPointer(e);
        return;
    }

    if (pendingDragPiece && !isDraggingPiece) {
        const movement = Math.hypot(e.clientX - pointerStartX, e.clientY - pointerStartY);
        if (movement < DRAG_THRESHOLD_PX) return;
        startPieceDrag();
    }

    if (!activePiece && !isMeasuring) return;
    const pointer = getTablePointerPosition(e);
    let targetX = pointer.x;
    let targetY = pointer.y;

    if (activePiece) {
        const offX = parseFloat(activePiece.dataset.offsetX);
        const offY = parseFloat(activePiece.dataset.offsetY);
        let newLeft = pointer.x - offX;
        let newTop = pointer.y - offY;
        if (activePiece.classList.contains('unit') && hasBattleStarted()) {
            const { forward } = getUnitGeometry(ghostPiece || activePiece);
            const displacement = (newLeft + activePieceHalfWidth - anchorX) * forward.x
                + (newTop + activePieceHalfHeight - anchorY) * forward.y;
            newLeft = anchorX + forward.x * displacement - activePieceHalfWidth;
            newTop = anchorY + forward.y * displacement - activePieceHalfHeight;
        }
        activePiece.style.left = `${newLeft}px`;
        activePiece.style.top = `${newTop}px`;
        targetX = newLeft + activePieceHalfWidth;
        targetY = newTop + activePieceHalfHeight;
        broadcastPieceMoveThrottled(activePiece, newLeft, newTop, anchorX, anchorY, targetX, targetY);
        updateSelectionRanges();
    }

    if (anchorX > -1) {
        lineElement.setAttribute('x2', targetX);
        lineElement.setAttribute('y2', targetY);
        const dx = targetX - anchorX;
        const dy = targetY - anchorY;
        const distancePx = Math.sqrt(dx * dx + dy * dy);
        measureTextElement.textContent = `${pxToInches(distancePx)}"`;
        const textX = anchorX + (dx / 2) + 10;
        const textY = anchorY + (dy / 2) - 10;
        measureTextElement.setAttribute('x', textX);
        measureTextElement.setAttribute('y', textY);
        if (!isHost) {
            measureTextElement.setAttribute('transform', `rotate(180, ${textX}, ${textY})`);
        } else {
            measureTextElement.removeAttribute('transform');
        }
    }
}

function onPointerUp(e) {
    if (e.pointerId !== activePointerId) return;
    cancelUnitLongPress();
    flushPendingPointerMove();
    if (activeTerrainCardDrag) {
        finishTerrainCardDrag(e);
        return;
    }

    if (rotatingPiece) {
        finishRotationDrag();
        return;
    }

    if (pendingDragPiece && !isDraggingPiece && !didLongPressSelect && e.type !== 'pointercancel') {
        handlePieceTap(pendingDragPiece, e);
    }

    if (activePiece) {
        activePiece.classList.remove('is-dragging');
        const pieceId = getPieceId(activePiece);
        const finalLeft = parseFloat(activePiece.style.left) || 0;
        const finalTop = parseFloat(activePiece.style.top) || 0;
        if (pieceId) {
            sendData({
                type: 'PIECE_DRAG_END',
                pieceId: pieceId,
                x: Math.round(finalLeft),
                y: Math.round(finalTop)
            });
        }
        saveGame();
    }
    activePiece = null;
    pendingDragPiece = null;
    activePointerId = null;
    didLongPressSelect = false;
    activeTableRect = null;
    activePieceHalfWidth = 0;
    activePieceHalfHeight = 0;
    measurementPointerId = null;
    const completedManipulation = isDraggingPiece || isMeasuring;
    isDraggingPiece = false;
    isMeasuring = false;
    if (ghostPiece) { ghostPiece.remove(); ghostPiece = null; }
    lineElement.style.opacity = 0;
    measureTextElement.style.opacity = 0;
    if (completedManipulation) {
        suppressUnitTooltip();
    }
    positionPieceControls();
}

function onWheel(e) {
    e.preventDefault(); e.stopPropagation();
    const piece = e.currentTarget;
    rotatePiece(piece, e.deltaY > 0 ? 2 : -2);
}

window.addEventListener('pointermove', queuePointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

// --- RESPONSIVE TABLE SCALE & BOOTSTRAP ---
let currentScale = 1;
// Use spare horizontal space for two control columns while retaining the largest board.
function calculatePanelLayout(width, height) {
    const fullHeightBoardWidth = tableWidthPx * Math.max(1, height - 4) / tableHeightPx;
    const spareWidth = Math.floor(width - fullHeightBoardWidth - 12);
    const twoColumns = spareWidth >= 420 || (width >= 1400 && height >= 760);
    const left = twoColumns ? Math.min(720, Math.max(420, spareWidth)) : Math.min(280, Math.max(208, spareWidth));
    const boardScale = Math.max(0.01, Math.min(
        Math.max(1, height - 4) / tableHeightPx,
        Math.max(1, width - left - 8 - 4) / tableWidthPx
    ));
    return { left, boardScale, twoColumns };
}

function fitTableToScreen() {
    const appContainer = document.getElementById('container');
    const container = document.getElementById('table-container');
    const table = document.getElementById('game-table');
    const leftSidebar = document.getElementById('left-sidebar');
    if (!container || !table) return;

    const fullscreen = Boolean(getFullscreenElement());
    const stackedPanels = !fullscreen && window.matchMedia && window.matchMedia('(max-width: 1100px) and (orientation: portrait)').matches;
    if (stackedPanels) {
        container.style.minWidth = "";
        if (leftSidebar) {
            leftSidebar.style.width = '100%';
            leftSidebar.classList.toggle('is-two-column', false);
        }
    } else if (appContainer && leftSidebar && appContainer.clientWidth > 400 && appContainer.clientHeight > 300) {
        const layout = calculatePanelLayout(appContainer.clientWidth, appContainer.clientHeight);
        container.style.minWidth = '';
        leftSidebar.style.width = layout.left + 'px';
        leftSidebar.classList.toggle('is-two-column', layout.twoColumns);
    }

    const availableWidth = Math.max(container.clientWidth - 4, 1);
    const availableHeight = Math.max(container.clientHeight - 4, 1);
    const tableWidth = tableWidthPx;
    const tableHeight = tableHeightPx;

    const scaleX = availableWidth / tableWidth;
    const scaleY = availableHeight / tableHeight;

    // Use a unified scale so the battlefield fills the screen as tall as possible
    // without distorting unit or terrain proportions.
    currentScale = Math.max(Math.min(scaleX, scaleY), 0.01);

    table.classList.toggle('is-flipped', !isHost);
    const rotateTransform = !isHost ? ' rotate(180deg)' : '';
    table.style.transform = `scale(${currentScale})${rotateTransform}`;
}

window.addEventListener('resize', fitTableToScreen);
// Fullscreen and panel changes can settle after the window resize event.
if (typeof ResizeObserver !== 'undefined') {
    const layoutObserver = new ResizeObserver(fitTableToScreen);
    ['container', 'table-container'].forEach(id => {
        const element = document.getElementById(id);
        if (element) layoutObserver.observe(element);
    });
}

if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitAllUnitLabels).catch(err => {
        console.warn('Unable to refit unit labels after font load:', err);
    });
}

function checkUrlAutoJoin() {
    try {
        const params = new URLSearchParams(window.location.search);
        const joinCode = params.get('join') || params.get('room');
        if (joinCode) {
            const input = document.getElementById('landing-join-code');
            if (input) {
                input.value = joinCode.toUpperCase().slice(0, 4);
            }
        }
    } catch(e) {}
}

const originalRestoreBoardState = restoreBoardState;
restoreBoardState = function (jsonString, suppressBroadcast = false) {
    originalRestoreBoardState(jsonString, suppressBroadcast);
    fitTableToScreen();
    fitAllUnitLabels();
};

loadUIState();
checkUrlAutoJoin();
renderActiveGamesUI();
updatePlayerBanner();
updateRoomCodeVisibility();
updateDraftNoticeUI();
updateFullscreenUI();
updateRightSidebarUI();
updateBiddingUI();
renderTerrainCard();

const originalInitGame = initGame;
initGame = async function () {
    await originalInitGame();
    renderActiveGamesUI();
    updateRoomCodeVisibility();
    updateDraftNoticeUI();
    updateBiddingUI();
    renderAllCommandTokens();
    fitTableToScreen();
    fitAllUnitLabels();
    setTimeout(() => {
        fitTableToScreen();
        fitAllUnitLabels();
    }, 100);
};

window.hostGameFromLanding = hostGameFromLanding;
window.joinGameFromLanding = joinGameFromLanding;
window.resumeGame = resumeGame;
window.deleteActiveGame = deleteActiveGame;
window.exitToLanding = exitToLanding;
window.toggleRoomCodeArea = toggleRoomCodeArea;
window.copyRoomLink = copyRoomLink;
window.lockLocalBid = lockLocalBid;
window.adjustLocalBid = adjustLocalBid;
window.unlockLocalBid = unlockLocalBid;
window.triggerRevealBids = triggerRevealBids;
window.handlePassTurn = handlePassTurn;
window.toggleFullscreen = toggleFullscreen;
window.requestLandscape = requestLandscape;
window.fitTableToScreen = fitTableToScreen;
window.getBiddingState = () => biddingState;
window.handlePeerData = handleIncomingData;
window.getPieceId = getPieceId;
window.findPieceById = findPieceById;

initGame();
