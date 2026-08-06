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
const UNIT_HIT_POINTS = 7;
const ARCHER_SHOOTING_VALUES = [2, 3, 4];
const SAVE_KEY = 'wargameSave_v6';
const REMOTE_CACHE_KEY = 'wargameRemoteView_v1';
const UI_STATE_KEY = 'wargameUiState_v1';
const TOOLTIP_HOVER_DELAY_MS = 350;
const TOOLTIP_SUPPRESS_AFTER_MANIPULATION_MS = 300;
const DRAG_THRESHOLD_PX = 8;
const TOUCH_ROTATION_STEP_DEG = 5;
const UNIT_LABEL_MAX_FONT_PX = 10.5;
const UNIT_LABEL_MIN_FONT_PX = 4.5;
const UNIT_LABEL_FONT_STEP_PX = 0.25;
const RULES_SAVE_SCHEMA_VERSION = 1;
const PLAYER_COLORS = {
    p1: '#594632',
    p2: '#5d728e'
};

// --- CONVERSIONS ---
const mmToInches = (mm) => mm / 25.4;
const inchesToPx = (inch) => inch * SCALE;
const pxToInches = (px) => (px / SCALE).toFixed(1);

// --- UI STATE & SHELL CONTROLS ---
let bidVisibility = {
    p1: true,
    p2: true
};
let lastKnownCpValues = {
    p1: '1',
    p2: '1'
};
let statsTooltipTimer = null;
let isRightSidebarHidden = false;
let isMultiplayerPanelCollapsed = false;

function loadUIState() {
    try {
        const savedState = JSON.parse(localStorage.getItem(UI_STATE_KEY) || '{}');
        isMultiplayerPanelCollapsed = Boolean(savedState.isMultiplayerPanelCollapsed);
    } catch (err) {
        console.warn("Unable to load UI state:", err);
    }
}

function saveUIState() {
    try {
        localStorage.setItem(UI_STATE_KEY, JSON.stringify({
            isMultiplayerPanelCollapsed
        }));
    } catch (err) {
        console.warn("Unable to save UI state:", err);
    }
}

function getLocalBidPlayerKey() {
    if (!conn) return null;
    return isHost ? 'p1' : 'p2';
}

function getBidInput(playerKey) {
    return document.getElementById(playerKey === 'p1' ? 'cp1' : 'cp2');
}

function rememberCpValue(playerKey) {
    const input = getBidInput(playerKey);
    if (input) {
        lastKnownCpValues[playerKey] = input.value;
    }
}

function rememberCpValues() {
    rememberCpValue('p1');
    rememberCpValue('p2');
}

function getNormalizedBidVisibility(nextVisibility = bidVisibility) {
    return {
        p1: nextVisibility && nextVisibility.p1 === false ? false : true,
        p2: nextVisibility && nextVisibility.p2 === false ? false : true
    };
}

function updateBidUI() {
    bidVisibility = getNormalizedBidVisibility();

    const btn = document.getElementById('toggle-bids-btn');
    const localPlayerKey = getLocalBidPlayerKey();
    const isMultiplayer = Boolean(localPlayerKey);

    ['p1', 'p2'].forEach(playerKey => {
        const input = getBidInput(playerKey);
        const field = document.querySelector(`[data-bid-player="${playerKey}"]`);
        if (!input || !field) return;

        const isOwnBid = playerKey === localPlayerKey;
        const isVisible = bidVisibility[playerKey];
        const isHiddenFromViewer = !isVisible && (!isMultiplayer || !isOwnBid);
        const isPrivateToViewer = isMultiplayer && isOwnBid && !isVisible;

        field.classList.toggle('bid-hidden', isHiddenFromViewer);
        field.classList.toggle('bid-private', isPrivateToViewer);
        input.readOnly = isMultiplayer && !isOwnBid;
        input.setAttribute('aria-label', `${playerKey === 'p1' ? 'Player 1' : 'Player 2'} command point bid${isHiddenFromViewer ? ' hidden' : ''}`);
    });

    if (!btn) return;

    if (isMultiplayer) {
        const isOwnBidVisible = bidVisibility[localPlayerKey];
        btn.innerText = isOwnBidVisible ? 'Hide My Bid' : 'Reveal My Bid';
        btn.title = isOwnBidVisible
            ? 'Hide your command point bid from your opponent'
            : 'Reveal your command point bid to your opponent';
        btn.setAttribute('aria-pressed', String(!isOwnBidVisible));
        return;
    }

    const areBidsVisible = bidVisibility.p1 && bidVisibility.p2;
    btn.innerText = areBidsVisible ? 'Hide Bids' : 'Reveal Bids';
    btn.title = areBidsVisible ? 'Hide both command point bids' : 'Reveal both command point bids';
    btn.setAttribute('aria-pressed', String(!areBidsVisible));
}

function toggleBidVisibility() {
    if (rulesGame) {
        showRulesToast('Bids reveal automatically after both players lock them in.', 'info');
        return;
    }
    const localPlayerKey = getLocalBidPlayerKey();

    if (localPlayerKey) {
        bidVisibility[localPlayerKey] = !bidVisibility[localPlayerKey];
    } else {
        const nextVisibility = !(bidVisibility.p1 && bidVisibility.p2);
        bidVisibility.p1 = nextVisibility;
        bidVisibility.p2 = nextVisibility;
    }

    updateBidUI();
    saveGame();
}

function handleCpBidChange(playerKey) {
    if (rulesGame) {
        renderRulesGuide();
        return;
    }
    const localPlayerKey = getLocalBidPlayerKey();
    if (localPlayerKey && playerKey !== localPlayerKey) {
        const input = getBidInput(playerKey);
        if (input) {
            const previousValue = playerKey === 'p1'
                ? (lastKnownCpValues.p1 || '1')
                : (lastKnownCpValues.p2 || '1');
            input.value = previousValue;
        }
        return;
    }

    rememberCpValue(playerKey);
    saveGame();
}

function updateRightSidebarUI() {
    const rightSidebar = document.getElementById('right-sidebar');
    const toggleBtn = document.getElementById('right-sidebar-toggle');
    if (!rightSidebar || !toggleBtn) return;

    rightSidebar.classList.toggle('sidebar-hidden', isRightSidebarHidden);
    toggleBtn.querySelector('span').innerText = isRightSidebarHidden ? '<' : '>';
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
    const supported = Boolean(root.requestFullscreen || root.webkitRequestFullscreen);
    const isFullscreen = Boolean(getFullscreenElement());
    button.disabled = !supported;
    button.innerText = isFullscreen ? 'Exit Full Screen' : 'Full Screen';
    button.title = supported
        ? (isFullscreen ? 'Exit full screen' : 'Open game in full screen')
        : 'Full screen is unavailable in this browser';
}

async function toggleFullscreen() {
    const root = document.documentElement;
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

function handleFullscreenChange() {
    updateFullscreenUI();
    requestAnimationFrame(() => fitTableToScreen());
}

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

const tableWidthPx = inchesToPx(TABLE_WIDTH_FT * 12);
const tableHeightPx = inchesToPx(TABLE_DEPTH_FT * 12);
const defaultUnitSizePx = getUnitSizePx({ Footprint: DEFAULT_UNIT_FOOTPRINT });

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

// --- PEERJS / NETWORK STATE ---
let peer = null;
let conn = null;
let isHost = false;
let connectionSerial = 0;

// --- GAME STATE ---
let rulesGame = null;
let isResettingBoard = false;
let rulesTransientTerrain = null;
let latestRulesEventRevision = 0;
let rulesToastTimer = null;
let rulesGuideCollapsed = false;
let rulesAutomationBusy = false;
let rulesActionSequence = 0;
let rulesMoveDirection = null;
let rulesRequestPending = false;
let rulesRequestTimer = null;
let rulesSessionGeneration = 0;
let networkBidProtocol = {
    roundKey: null,
    secrets: {},
    commitments: {},
    pending: {},
    revealStarted: false,
    revealSent: false,
    resolving: false,
    resolved: false
};
let rulesEventPresentationQueue = Promise.resolve();
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
let undoStack = [];
let terrainDeck = [];
let terrainCardRemoveTimer = null;
let terrainCardRevealTimer = null;
let isTerrainCardAnimating = false;
const MAX_UNDO = 20;

const lineElement = document.getElementById('measure-line');
const measureTextElement = document.getElementById('measure-text');

function showRulesToast(message, tone = 'info', duration = 2300) {
    const toast = document.getElementById('game-toast');
    if (!toast || !message) return;
    if (rulesToastTimer) clearTimeout(rulesToastTimer);
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    rulesToastTimer = setTimeout(() => {
        toast.hidden = true;
        rulesToastTimer = null;
    }, duration);
}

function formatRulesEvent(event) {
    if (!event) return '';
    if (typeof event === 'string') return event;
    if (event.message) return event.message;
    if (event.text) return event.text;
    const type = String(event.type || '').replace(/[._-]+/g, ' ').trim();
    return type ? type.charAt(0).toUpperCase() + type.slice(1) : '';
}

function getRulesEventKey(event, fallbackIndex = 0) {
    return String((event && (event.seq ?? event.id ?? event.eventId))
        ?? `${rulesGame ? rulesGame.revision : 0}-${fallbackIndex}`);
}

function cancelActiveInteraction(options = {}) {
    if (pointerMoveFrame) cancelAnimationFrame(pointerMoveFrame);
    pointerMoveFrame = null;
    pendingPointerMove = null;
    if (activePiece) activePiece.classList.remove('is-dragging');
    if (rotatingPiece) rotatingPiece.classList.remove('is-rotating');
    if (ghostPiece) ghostPiece.remove();
    if (rulesTransientTerrain && rulesTransientTerrain.isConnected) rulesTransientTerrain.remove();
    activePiece = null;
    ghostPiece = null;
    pendingDragPiece = null;
    rotatingPiece = null;
    rulesTransientTerrain = null;
    activePointerId = null;
    activeTableRect = null;
    measurementPointerId = null;
    isDraggingPiece = false;
    isMeasuring = false;
    rotationDragUndoPushed = false;
    rotationDragPointerDelta = 0;
    rotationDragStartAngle = 0;
    rotationDragLastPointerAngle = 0;
    rotationDragCenterX = 0;
    rotationDragCenterY = 0;
    activePieceHalfWidth = 0;
    activePieceHalfHeight = 0;
    suppressTooltipUntil = Date.now() + TOOLTIP_SUPPRESS_AFTER_MANIPULATION_MS;
    resetRotationPivot();
    const indicator = document.getElementById('angle-indicator');
    if (indicator) {
        indicator.classList.remove('visible');
        indicator.setAttribute('aria-hidden', 'true');
    }
    lineElement.style.opacity = 0;
    measureTextElement.style.opacity = 0;
    if (options.revert && rulesGame) renderRulesBoard();
    positionPieceControls();
}

function appendRulesLogEvent(event, fallbackIndex = 0) {
    const log = document.getElementById('game-log');
    const message = formatRulesEvent(event);
    if (!log || !message) return;
    const key = getRulesEventKey(event, fallbackIndex);
    if (Array.from(log.children).some(item => item.dataset.eventKey === key)) return;
    const item = document.createElement('li');
    item.dataset.eventKey = key;
    item.textContent = message;
    log.appendChild(item);
    while (log.children.length > 40) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
}

function presentRulesEvents(events = [], options = {}) {
    const newEvents = Array.isArray(events) ? events : [];
    newEvents.forEach((event, index) => {
        appendRulesLogEvent(event, index);
    });
    const reduceMotion = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    newEvents.forEach((event, index) => {
        rulesEventPresentationQueue = rulesEventPresentationQueue.then(() => {
            const rolls = event && (event.rolls || event.dice || event.results);
            const message = formatRulesEvent(event);
            if (Array.isArray(rolls) && rolls.length) renderDiceRoll(rolls);
            if (message && options.toast !== false && (rolls || index === newEvents.length - 1)) {
                showRulesToast(message, 'info', rolls ? 1700 : 2300);
            }
            if (!rolls) return undefined;
            return new Promise(resolve => setTimeout(resolve, reduceMotion ? 20 : 430));
        });
    });
    return rulesEventPresentationQueue;
}

function populateRulesLog() {
    const log = document.getElementById('game-log');
    if (!log) return;
    log.replaceChildren();
    const events = rulesGame && Array.isArray(rulesGame.eventLog)
        ? rulesGame.eventLog.slice(-40)
        : [];
    events.forEach(appendRulesLogEvent);
}

const gameLogToggle = document.getElementById('game-log-toggle');
if (gameLogToggle) {
    gameLogToggle.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const log = document.getElementById('game-log');
        if (!log) return;
        log.hidden = !log.hidden;
        gameLogToggle.setAttribute('aria-expanded', String(!log.hidden));
        gameLogToggle.textContent = log.hidden ? 'Battle Log' : 'Hide Log';
        requestAnimationFrame(fitTableToScreen);
    });
}

const gameGuide = document.getElementById('game-guide');
if (gameGuide) {
    gameGuide.addEventListener('toggle', () => requestAnimationFrame(fitTableToScreen));
}

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
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQXT5eF4DzRhJokOVdTb5g1Lnt6_gFkeh7oEdg2DLYAtY98FxybE-ijwA8uoWDiYtiBb0a3BM-ukWx9/pub?gid=663136589&single=true&output=csv';
const STATS_CACHE_KEY = 'seize-the-day-unit-stats-cache-v2';
const DEFAULT_DRAFT_POOL_SIZE = 12;

let unitStatsDB = {};
let availableUnitRows = [];
let statsLoadPromise = null;

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

function getFreshStatsUrl() {
    const url = new URL(SHEET_URL);
    url.searchParams.set('refresh', Date.now());
    return url.toString();
}

function loadStats(forceRefresh = false) {
    if (!forceRefresh && availableUnitRows.length > 0) {
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
                setStatsData(results.data, true);
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

                console.error("Error loading stats:", err);
                reject(err);
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
        const filteredRules = [...new Set(activeRules.filter(r => r && r.trim() !== ""))];
        const rulesHtml = filteredRules.length > 0
            ? `<div class="rules-block">
                     <div class="rules-title">Special Rules</div>
                     ${filteredRules.map(r => `<div class="rule-line">${r}</div>`).join('')}
                   </div>`
            : "";

        return `
                <div class="stats-card">
                    <div class="stats-unit-name">${stats.Unit || unitName}</div>
                    <div class="stats-grid">
                        <div class="stat-chip">
                            <img class="stat-icon" src="icons/move.svg" alt="Move">
                            <span class="stat-value">${getStatValue(stats, 'Speed', 'Move')}/${getStatValue(stats, 'Drill')}</span>
                        </div>
                        <div class="stat-chip">
                            <img class="stat-icon" src="icons/shoot.svg" alt="Shoot">
                            <span class="stat-value">${getStatValue(stats, 'Ranged', 'Shoot')}</span>
                        </div>
                        <div class="stat-chip">
                            <img class="stat-icon" src="icons/strike.svg" alt="Melee">
                            <span class="stat-value">${getStatValue(stats, 'Melee', 'Strike')}</span>
                        </div>
                        <div class="stat-chip">
                            <img class="stat-icon" src="icons/defence.svg" alt="Defence">
                            <span class="stat-value">${getStatValue(stats, 'Def', 'Defence')}</span>
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
}

function buildUnitControlsMarkup() {
    return `
        <div class="unit-popup-controls" role="toolbar" aria-label="Selected unit controls">
            <div id="unit-popup-wounds" class="piece-control-row">
                <button type="button" class="btn-red" data-wound-step="-1" aria-label="Remove one wound">-</button>
                <button type="button" class="btn-red" data-wound-step="1" aria-label="Add one wound">+</button>
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
    const unitRect = {
        left: parseFloat(unitEl.style.left) || 0,
        top: parseFloat(unitEl.style.top) || 0,
        width: unitEl.offsetWidth,
        height: unitEl.offsetHeight
    };

    const offsetX = 18;
    const offsetY = 14;
    const maxLeft = Math.max(12, table.clientWidth - tooltip.offsetWidth - 12);
    const preferredLeft = unitRect.left + unitRect.width + offsetX;
    const clampedLeft = Math.min(Math.max(12, preferredLeft), maxLeft);

    let top = unitRect.top - tooltip.offsetHeight - offsetY;
    if (top < 12) {
        top = Math.min(table.clientHeight - tooltip.offsetHeight - 18, unitRect.top + unitRect.height + 12);
    }

    tooltip.style.left = `${clampedLeft}px`;
    tooltip.style.top = `${Math.max(12, top)}px`;
}

function showUnitTooltip(unitEl, interactive = false) {
    if (!unitEl || (!interactive && (activePiece || Date.now() < suppressTooltipUntil))) return;

    const tooltip = document.getElementById('unit-tooltip');
    tooltip.innerHTML = buildStatsMarkup(unitEl) + (interactive ? buildUnitControlsMarkup() : '');
    tooltip.classList.toggle('interactive', interactive);
    tooltip.setAttribute('aria-hidden', 'false');
    positionUnitTooltip(unitEl);
    tooltip.classList.add('visible');
}

function queueUnitTooltip(unitEl) {
    if (!unitEl || selectedPiece || activePiece || Date.now() < suppressTooltipUntil) return;
    hideUnitTooltip();
    statsTooltipTimer = setTimeout(() => {
        statsTooltipTimer = null;
        if (!selectedPiece && hoveredUnit === unitEl && !activePiece && Date.now() >= suppressTooltipUntil) {
            showUnitTooltip(unitEl);
        }
    }, TOOLTIP_HOVER_DELAY_MS);
}

// --- SELECTION & PIECE CONTROLS ---
function isTouchPointer(event) {
    return event.pointerType === 'touch' || event.pointerType === 'pen';
}

function clearPieceSelection() {
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

function selectPiece(piece) {
    if (!piece || !piece.classList.contains('piece')) {
        clearPieceSelection();
        return;
    }

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
    if (rulesGame) {
        if (!canRulesRotatePiece(piece)) {
            showRulesToast('That piece cannot pivot during this step.', 'warning');
            return;
        }
        const previousAngle = parseFloat(piece.dataset.angle) || 0;
        const nextAngle = previousAngle + delta;
        const pivotAction = getVisibleRulesActions().find(action => getActionType(action) === 'activation.pivot');
        if (!pivotAction) {
            // Deployment facing is committed together with the deployment move.
            setPieceAngle(piece, nextAngle, delta);
            return;
        }
        dispatchRulesAction({
            ...pivotAction,
            unitId: piece.dataset.pieceId,
            angle: nextAngle,
            delta,
            degrees: delta,
            payload: {
                ...(pivotAction.payload || {}),
                unitId: piece.dataset.pieceId,
                angle: nextAngle,
                delta,
                degrees: delta
            }
        });
        return;
    }
    suppressUnitTooltip();
    pushUndo();
    const previousAngle = parseFloat(piece.dataset.angle) || 0;
    setPieceAngle(piece, previousAngle + delta);
    saveGame();
}

function adjustUnitWounds(unit, delta) {
    if (!unit || !unit.classList.contains('unit')) return;
    if (rulesGame) {
        showRulesToast('Wounds are applied automatically after an attack.', 'info');
        return;
    }
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
    if (rulesGame && piece.classList.contains('unit')) {
        const pieceId = piece.dataset.pieceId;
        const actions = getVisibleRulesActions();
        const directAction = actions.find(action => {
            const type = getActionType(action);
            if (type === 'activation.shoot' || type === 'activation.strike') {
                return getRulesActionEntityId(action, 'targetId') === pieceId;
            }
            if (type === 'draft.chooseUnit' || type === 'activation.selectUnit') {
                return getRulesActionEntityId(action, 'unitId') === pieceId;
            }
            return false;
        });
        if (directAction) {
            dispatchRulesAction(directAction);
            return;
        }
    }
    selectPiece(piece);
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

// --- NETWORKING FUNCTIONS ---

function generateShortId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const randomValues = new Uint8Array(8);
    if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(randomValues);
    } else {
        randomValues.forEach((_, index) => { randomValues[index] = Math.floor(Math.random() * 256); });
    }
    let result = '';
    for (let i = 0; i < randomValues.length; i++) {
        result += chars.charAt(randomValues[i] % chars.length);
    }
    return result;
}

function hostGame() {
    if (peer) return;
    if (rulesGame && rulesGame.projection && rulesGame.projection.authoritative === false) {
        showRulesToast('This is a read-only view from another host. Start a new game or Sandbox before hosting.', 'warning', 5000);
        return;
    }
    updateStatus("Initializing...");
    const shortId = generateShortId();
    peer = new Peer(shortId);

    peer.on('open', (id) => {
        updateStatus("Hosting");
        document.getElementById('my-id-display').value = id;
        isHost = true;
        updateMultiplayerControlsUI();
    });

    peer.on('connection', (c) => {
        if (conn) {
            c.on('open', () => c.close());
            c.close();
            return;
        }
        conn = c;
        setupConnection();
    });
    peer.on('error', (err) => {
        console.error(err);
        if (err.type === 'unavailable-id') {
            peer = null;
            hostGame();
        }
    });
}

function joinGame() {
    const hostId = document.getElementById('join-input').value.trim();
    if (!hostId) return alert("Enter a Host ID");
    if (peer && !conn) {
        try { peer.destroy(); } catch (err) { console.warn('Unable to close the previous peer session:', err); }
        peer = null;
    }
    updateStatus("Connecting...");
    peer = new Peer();
    peer.on('open', () => {
        conn = peer.connect(hostId);
        setupConnection();
    });
    peer.on('error', (err) => {
        updateStatus("Error");
        alert("Could not connect. Check ID.");
    });
}

function setupConnection() {
    if (!conn) return;
    const activeConnection = conn;
    const activeConnectionSerial = ++connectionSerial;
    activeConnection.on('open', () => {
        if (conn !== activeConnection || activeConnectionSerial !== connectionSerial) return;
        updateStatus("Connected!");
        networkBidProtocol = {
            roundKey: null,
            secrets: {},
            commitments: {},
            pending: {},
            revealStarted: false,
            revealSent: false,
            resolving: false,
            resolved: false
        };
        document.getElementById('status-indicator').classList.add('status-connected');
        updateBidUI();
        renderRulesGuide();
        if (isHost) {
            sendAuthoritativeState([]);
        } else {
            sendData({ type: 'SESSION_HELLO', supportedSchema: RULES_SAVE_SCHEMA_VERSION });
        }
    });
    activeConnection.on('data', (data) => {
        if (conn !== activeConnection || activeConnectionSerial !== connectionSerial) return;
        handleIncomingData(data);
    });
    activeConnection.on('close', () => {
        if (conn !== activeConnection || activeConnectionSerial !== connectionSerial) return;
        updateStatus("Disconnected");
        document.getElementById('status-indicator').classList.remove('status-connected');
        conn = null;
        rulesRequestPending = false;
        if (rulesRequestTimer) clearTimeout(rulesRequestTimer);
        rulesRequestTimer = null;
        updateMultiplayerControlsUI();
        updateBidUI();
        renderRulesGuide();
    });
}

function handleIncomingData(data) {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'SESSION_HELLO' && isHost) {
        sendAuthoritativeState([]);
        return;
    }
    if (data.type === 'RULES_RESYNC_REQUEST' && isHost) {
        sendAuthoritativeState([]);
        return;
    }
    if (data.type === 'RULES_BID_COMMIT') {
        handleNetworkBidCommit(data).catch(err => {
            console.error('Unable to record bid commitment:', err);
            showRulesToast(err.message, 'warning');
        });
        return;
    }
    if (data.type === 'RULES_BID_REVEAL_REQUEST') {
        handleNetworkBidRevealRequest(data).catch(err => {
            console.error('Unable to reveal committed bid:', err);
            showRulesToast(err.message, 'warning');
        });
        return;
    }
    if (data.type === 'RULES_BID_REVEAL' && isHost) {
        resolveCommittedNetworkBids(data).catch(err => console.error('Unable to resolve bids:', err));
        return;
    }
    if (data.type === 'RULES_ACTION' && isHost) {
        if (!rulesGame || (rulesGame.projection && rulesGame.projection.authoritative === false)) {
            sendData({
                type: 'RULES_REJECT',
                message: 'The host does not currently have an authoritative rules game.'
            });
            if (!rulesGame) sendData({ type: 'SYNC_BOARD', payload: getBoardState({ forNetwork: true }) });
            return;
        }
        if (!data.action || data.action.type === 'bid.submit'
            || data.matchId !== rulesGame.matchId
            || !Number.isFinite(Number(data.expectedRevision))) {
            sendData({
                type: 'RULES_REJECT',
                message: data.action && data.action.type === 'bid.submit'
                    ? 'Network bids must use the secure commit-and-reveal flow.'
                    : 'That action does not belong to the current game.',
                payload: buildPlayerBoardState('p2')
            });
            return;
        }
        if (rulesAutomationBusy) {
            sendData({
                type: 'RULES_REJECT',
                message: 'The host is resolving an automatic step. Try again now.',
                payload: buildPlayerBoardState('p2')
            });
            return;
        }
        dispatchRulesAction({ ...data.action, actorId: 'p2' }, {
            source: 'remote',
            expectedRevision: data.expectedRevision
        });
        return;
    }
    if (data.type === 'RULES_STATE' && !isHost) {
        receiveAuthoritativeState(data.payload, data.events || [], {
            matchId: data.matchId,
            revision: data.revision
        });
        return;
    }
    if (data.type === 'RULES_REJECT' && !isHost) {
        rulesRequestPending = false;
        if (rulesRequestTimer) clearTimeout(rulesRequestTimer);
        rulesRequestTimer = null;
        showRulesToast(data.message || 'That action is no longer legal.', 'warning');
        if (data.payload) receiveAuthoritativeState(data.payload, []);
        return;
    }
    if (data.type === 'SYNC_BOARD') {
        if (isHost) {
            if (rulesGame || isResettingBoard || incomingPayloadUsesRulesMode(data.payload)) return;
        }
        try {
            restoreBoardState(data.payload, true);
        } catch (err) {
            console.warn('Ignored an unreadable shared sandbox state:', err);
            if (isHost) sendData({ type: 'SYNC_BOARD', payload: getBoardState({ forNetwork: true }) });
        }
    }
    else if (data.type === 'ROLL_DICE') {
        if (rulesGame) return;
        const incomingRolls = Array.isArray(data.rolls) ? data.rolls : [];
        renderDiceRoll(incomingRolls.length ? incomingRolls : createPlaceholderRoll(data.count || 2));
    }
    else if (data.type === 'BID_VISIBILITY') {
        if (rulesGame) return;
        bidVisibility = getNormalizedBidVisibility({
            ...bidVisibility,
            [data.player]: data.visible !== false
        });
        updateBidUI();
    }
    else if (data.type === 'TOGGLE_BIDS') {
        if (rulesGame) return;
        const legacyVisible = data.payload !== true;
        bidVisibility = { p1: legacyVisible, p2: legacyVisible };
        updateBidUI();
    }
}

function buildPlayerBoardState(playerId = null) {
    const state = JSON.parse(getBoardState());
    if (state.rulesGame) {
        if (!window.SeizeTheDayRules || typeof SeizeTheDayRules.projectState !== 'function') {
            throw new Error('Cannot safely prepare a private player view without the rules projector.');
        }
        state.rulesGame = SeizeTheDayRules.projectState(state.rulesGame, playerId);
        delete state.cp1;
        delete state.cp2;
        delete state.bidVisibility;
    }
    return JSON.stringify(state);
}

function sendAuthoritativeState(events = []) {
    if (!isHost || !conn || !conn.open) return;
    if (!rulesGame) {
        sendData({ type: 'SYNC_BOARD', payload: getBoardState({ forNetwork: true }) });
        return;
    }
    if (rulesGame.projection && rulesGame.projection.authoritative === false) {
        console.error('Refused to broadcast a projected rules state as authoritative.');
        return;
    }
    try {
        sendData({
            type: 'RULES_STATE',
            payload: buildPlayerBoardState('p2'),
            matchId: rulesGame.matchId,
            revision: rulesGame.revision,
            events: projectRulesEvents(events, 'p2')
        });
    } catch (err) {
        console.error('Unable to prepare the private remote game state:', err);
    }
}

function projectRulesEvents(events = [], viewerId = null) {
    return (Array.isArray(events) ? events : []).map(event => {
        if (!event || typeof event !== 'object') return event;
        const type = String(event.type || '').toLowerCase();
        if (!type.includes('bid') || type.includes('reveal')) return { ...event };
        const actorId = event.actorId || event.playerId || (event.data && event.data.playerId);
        return {
            type: event.type,
            seq: event.seq,
            actorId,
            message: `${actorId === 'p2' ? 'Player 2' : 'Player 1'} locked a secret bid.`
        };
    });
}

function getConnectedRulesPlayer() {
    if (!conn) return null;
    return isHost ? 'p1' : 'p2';
}

function getNetworkBidRoundKey() {
    return rulesGame ? `${rulesGame.matchId || 'match'}:${rulesGame.round && rulesGame.round.number || 0}` : null;
}

function incomingPayloadUsesRulesMode(payload) {
    try {
        const state = typeof payload === 'string' ? JSON.parse(payload) : payload;
        return Boolean(state && !Array.isArray(state)
            && (state.mode === 'rules' || state.rulesGame));
    } catch (err) {
        return true;
    }
}

function isValidBidCommitment(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function syncNetworkBidProtocol() {
    const roundKey = getNetworkBidRoundKey();
    if (networkBidProtocol.roundKey === roundKey) return;
    networkBidProtocol = {
        roundKey,
        secrets: {},
        commitments: {},
        pending: {},
        revealStarted: false,
        revealSent: false,
        resolving: false,
        resolved: false
    };
}

function randomBidNonce() {
    const values = new Uint32Array(4);
    window.crypto.getRandomValues(values);
    return Array.from(values, value => value.toString(36)).join('-');
}

async function hashBidCommitment(playerId, bid, nonce, roundKey = getNetworkBidRoundKey()) {
    if (!window.crypto || !window.crypto.subtle || typeof TextEncoder === 'undefined') {
        throw new Error('Secure bid commitments are unavailable in this browser.');
    }
    const bytes = new TextEncoder().encode(`${roundKey}|${playerId}|${bid}|${nonce}`);
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function commitNetworkBid(action) {
    syncNetworkBidProtocol();
    const playerId = getConnectedRulesPlayer();
    if (!playerId) return false;
    if (!rulesGame || rulesGame.phase !== 'bid' || rulesGame.round.bidStage !== 'commit') {
        showRulesToast('Bidding is not open right now.', 'warning');
        return false;
    }
    if (!conn || !conn.open) {
        showRulesToast('The opponent connection is not ready yet.', 'warning');
        return false;
    }
    if (networkBidProtocol.secrets[playerId] || networkBidProtocol.pending[playerId]) {
        showRulesToast('Your bid is already committed for this round.', 'info');
        return false;
    }
    const bid = Math.floor(Number(action.bid ?? action.value));
    const maximum = getLivingRulesUnitCount(playerId);
    if (!Number.isFinite(bid) || bid < 1 || bid > maximum) {
        showRulesToast(`Choose a bid from 1 to ${maximum}.`, 'warning');
        return false;
    }
    const protocol = networkBidProtocol;
    const roundKey = protocol.roundKey;
    const activeConnection = conn;
    const activeConnectionSerial = connectionSerial;
    const activeSessionGeneration = rulesSessionGeneration;
    const matchId = rulesGame.matchId;
    const revision = rulesGame.revision;
    const nonce = randomBidNonce();
    protocol.pending[playerId] = true;
    renderRulesGuide();
    try {
        const commitment = await hashBidCommitment(playerId, bid, nonce, roundKey);
        if (networkBidProtocol !== protocol
            || protocol.roundKey !== roundKey
            || conn !== activeConnection
            || !activeConnection.open
            || connectionSerial !== activeConnectionSerial
            || rulesSessionGeneration !== activeSessionGeneration
            || !rulesGame
            || rulesGame.matchId !== matchId
            || rulesGame.revision !== revision
            || rulesGame.phase !== 'bid'
            || rulesGame.round.bidStage !== 'commit') {
            throw new Error('The game changed while the bid was being secured. Please bid again.');
        }
        protocol.secrets[playerId] = { bid, nonce };
        protocol.commitments[playerId] = commitment;
        sendData({
            type: 'RULES_BID_COMMIT',
            playerId,
            roundKey,
            commitment
        });
        showRulesToast('Secret bid committed. Waiting for the other player.', 'info');
        if (isHost) maybeBeginNetworkBidReveal();
        return true;
    } finally {
        if (networkBidProtocol === protocol) protocol.pending[playerId] = false;
        renderRulesGuide();
    }
}

function maybeBeginNetworkBidReveal() {
    if (!isHost || networkBidProtocol.revealStarted || networkBidProtocol.resolved) return;
    if (!networkBidProtocol.commitments.p1 || !networkBidProtocol.commitments.p2) return;
    const hostSecret = networkBidProtocol.secrets.p1;
    if (!hostSecret) return;
    networkBidProtocol.revealStarted = true;
    sendData({
        type: 'RULES_BID_REVEAL_REQUEST',
        roundKey: networkBidProtocol.roundKey,
        commitments: { ...networkBidProtocol.commitments },
        hostReveal: { bid: hostSecret.bid, nonce: hostSecret.nonce }
    });
}

async function handleNetworkBidCommit(data) {
    syncNetworkBidProtocol();
    if (data.roundKey !== networkBidProtocol.roundKey) return;
    if (isHost) {
        if (data.playerId !== 'p2' || !isValidBidCommitment(data.commitment)) return;
        if (networkBidProtocol.revealStarted) return;
        if (networkBidProtocol.commitments.p2 && networkBidProtocol.commitments.p2 !== data.commitment) {
            sendData({ type: 'RULES_REJECT', message: 'A secret bid commitment cannot be changed.', payload: buildPlayerBoardState('p2') });
            return;
        }
        networkBidProtocol.commitments.p2 = data.commitment;
        if (networkBidProtocol.commitments.p1) {
            sendData({
                type: 'RULES_BID_COMMIT',
                playerId: 'p1',
                roundKey: networkBidProtocol.roundKey,
                commitment: networkBidProtocol.commitments.p1
            });
        }
        maybeBeginNetworkBidReveal();
    } else if (data.playerId === 'p1' && isValidBidCommitment(data.commitment)) {
        if (networkBidProtocol.commitments.p1 && networkBidProtocol.commitments.p1 !== data.commitment) {
            showRulesToast('The host attempted to change its bid commitment.', 'warning', 5000);
            return;
        }
        networkBidProtocol.commitments.p1 = data.commitment;
    }
}

async function handleNetworkBidRevealRequest(data) {
    if (isHost) return;
    syncNetworkBidProtocol();
    if (data.roundKey !== networkBidProtocol.roundKey) return;
    const secret = networkBidProtocol.secrets.p2;
    const protocol = networkBidProtocol;
    if (!secret || !data.hostReveal || !data.commitments
        || protocol.resolved || protocol.revealSent || protocol.resolving) return;
    if (!isValidBidCommitment(data.commitments.p1)
        || !isValidBidCommitment(data.commitments.p2)
        || !isValidBidCommitment(protocol.commitments.p1)
        || !isValidBidCommitment(protocol.commitments.p2)
        || data.commitments.p1 !== protocol.commitments.p1
        || data.commitments.p2 !== protocol.commitments.p2) {
        showRulesToast('The bid commitments changed before reveal.', 'warning', 5000);
        return;
    }
    const activeConnection = conn;
    const activeConnectionSerial = connectionSerial;
    const activeSessionGeneration = rulesSessionGeneration;
    const revision = rulesGame && rulesGame.revision;
    protocol.resolving = true;
    try {
        const hostHash = await hashBidCommitment('p1', data.hostReveal.bid, data.hostReveal.nonce, data.roundKey);
        if (networkBidProtocol !== protocol
            || conn !== activeConnection
            || !activeConnection
            || !activeConnection.open
            || connectionSerial !== activeConnectionSerial
            || rulesSessionGeneration !== activeSessionGeneration
            || !rulesGame
            || rulesGame.revision !== revision
            || data.roundKey !== protocol.roundKey) return;
        if (hostHash !== protocol.commitments.p1) {
            showRulesToast('The host’s bid reveal did not match its commitment.', 'warning', 5000);
            return;
        }
        protocol.revealStarted = true;
        protocol.revealSent = true;
        sendData({
            type: 'RULES_BID_REVEAL',
            playerId: 'p2',
            roundKey: data.roundKey,
            bid: secret.bid,
            nonce: secret.nonce
        });
    } finally {
        if (networkBidProtocol === protocol) protocol.resolving = false;
    }
}

async function resolveCommittedNetworkBids(guestReveal) {
    syncNetworkBidProtocol();
    const protocol = networkBidProtocol;
    if (!isHost || rulesAutomationBusy || protocol.resolved || protocol.resolving
        || !protocol.revealStarted) return;
    const hostSecret = protocol.secrets.p1;
    if (!hostSecret || !guestReveal || guestReveal.playerId !== 'p2'
        || guestReveal.roundKey !== protocol.roundKey
        || !isValidBidCommitment(protocol.commitments.p2)) return;
    const activeConnection = conn;
    const activeConnectionSerial = connectionSerial;
    const activeSessionGeneration = rulesSessionGeneration;
    const revision = rulesGame && rulesGame.revision;
    const matchId = rulesGame && rulesGame.matchId;
    protocol.resolving = true;
    rulesAutomationBusy = true;
    try {
        const guestHash = await hashBidCommitment('p2', guestReveal.bid, guestReveal.nonce, guestReveal.roundKey);
        if (networkBidProtocol !== protocol
            || conn !== activeConnection
            || !activeConnection
            || !activeConnection.open
            || connectionSerial !== activeConnectionSerial
            || rulesSessionGeneration !== activeSessionGeneration
            || !rulesGame
            || rulesGame.matchId !== matchId
            || rulesGame.revision !== revision
            || rulesGame.phase !== 'bid'
            || rulesGame.round.bidStage !== 'commit') return;
        if (guestHash !== protocol.commitments.p2) {
            sendData({ type: 'RULES_REJECT', message: 'The guest bid reveal did not match its commitment.', payload: buildPlayerBoardState('p2') });
            return;
        }
        const first = SeizeTheDayRules.applyAction(rulesGame, {
            type: 'bid.submit', actorId: 'p1', bid: hostSecret.bid,
            expectedRevision: rulesGame.revision, actionId: `bid:${protocol.roundKey}:p1`
        }, { autoAdvance: false });
        const second = SeizeTheDayRules.applyAction(first.state, {
            type: 'bid.submit', actorId: 'p2', bid: Number(guestReveal.bid),
            expectedRevision: first.state.revision, actionId: `bid:${protocol.roundKey}:p2`
        }, { autoAdvance: false });
        rulesGame = second.state;
        protocol.resolved = true;
        commitRulesPresentation([...(first.events || []), ...(second.events || [])]);
        await runVisibleForcedTransitions();
    } catch (err) {
        console.error('Unable to resolve committed bids:', err);
        sendData({ type: 'RULES_REJECT', message: err.message, payload: buildPlayerBoardState('p2') });
    } finally {
        if (networkBidProtocol === protocol) protocol.resolving = false;
        rulesAutomationBusy = false;
        renderRulesGuide();
    }
}

function getRulesDecisionPlayer() {
    if (!rulesGame) return null;
    if (rulesGame.draft && rulesGame.draft.currentPlayerId) return rulesGame.draft.currentPlayerId;
    if (rulesGame.activation && rulesGame.activation.playerId) return rulesGame.activation.playerId;
    if (rulesGame.round && rulesGame.round.activePlayerId) return rulesGame.round.activePlayerId;
    if (rulesGame.round && rulesGame.round.commandPlayerId) return rulesGame.round.commandPlayerId;
    return null;
}

function commitRulesPresentation(events = [], options = {}) {
    renderRulesGame({ rebuildBoard: true, announceEvents: false });
    if (events.length) presentRulesEvents(projectRulesEvents(events, getConnectedRulesPlayer()), { toast: options.toast !== false });
    localStorage.setItem(SAVE_KEY, getBoardState());
    if (isHost) sendAuthoritativeState(events);
}

async function runVisibleForcedTransitions() {
    if (!rulesGame || !window.SeizeTheDayRules || typeof SeizeTheDayRules.advanceForced !== 'function') return;
    const reduceMotion = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const delay = reduceMotion ? 0 : 260;
    const generation = rulesSessionGeneration;

    for (let safety = 0; safety < 80; safety += 1) {
        if (generation !== rulesSessionGeneration || !rulesGame) break;
        const forced = SeizeTheDayRules.advanceForced(rulesGame);
        if (!forced || !forced.advanced) break;
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (generation !== rulesSessionGeneration || !rulesGame) break;
        rulesGame = forced.state;
        const events = forced.events || (forced.event ? [forced.event] : []);
        commitRulesPresentation(events);
    }
}

async function dispatchRulesAction(action, options = {}) {
    if (!rulesGame || !window.SeizeTheDayRules || !action) return false;
    if (rulesAutomationBusy) {
        showRulesToast('Finish watching the current automatic step first.', 'info');
        return false;
    }
    if (options.source !== 'remote' && rulesRequestPending) {
        showRulesToast('Waiting for the host to confirm your previous action.', 'info');
        return false;
    }

    const source = options.source || 'local';
    const connectedPlayer = getConnectedRulesPlayer();
    const actorId = source === 'remote'
        ? 'p2'
        : (connectedPlayer || action.actorId || getRulesDecisionPlayer());
    const expectedRevision = options.expectedRevision ?? action.expectedRevision ?? rulesGame.revision;
    const normalizedAction = {
        ...action,
        actorId,
        expectedRevision,
        actionId: action.actionId || `${actorId || 'local'}-${Date.now()}-${++rulesActionSequence}`
    };

    if (source === 'local' && conn && normalizedAction.type === 'bid.submit') {
        try {
            return await commitNetworkBid(normalizedAction);
        } catch (err) {
            console.error('Unable to commit secret bid:', err);
            showRulesToast(err.message || 'Unable to lock the secret bid.', 'warning');
            return false;
        }
    }

    if (source === 'local' && conn && !isHost) {
        if (!conn.open) {
            showRulesToast('The host connection is not ready yet.', 'warning');
            return false;
        }
        rulesRequestPending = true;
        sendData({
            type: 'RULES_ACTION',
            action: normalizedAction,
            expectedRevision,
            matchId: rulesGame.matchId
        });
        if (rulesRequestTimer) clearTimeout(rulesRequestTimer);
        rulesRequestTimer = setTimeout(() => {
            if (!rulesRequestPending) return;
            rulesRequestPending = false;
            sendData({ type: 'RULES_RESYNC_REQUEST' });
            showRulesToast('The host took too long to confirm. Requesting the latest state…', 'warning');
            renderRulesGuide();
        }, 6000);
        showRulesToast('Action sent to the host…', 'info', 1200);
        renderRulesGame({ rebuildBoard: true, announceEvents: false });
        return true;
    }

    rulesAutomationBusy = true;
    try {
        const result = SeizeTheDayRules.applyAction(rulesGame, normalizedAction, { autoAdvance: false });
        if (!result || result.ok === false || !result.state) {
            throw new Error((result && result.error) || 'The rules engine rejected that action.');
        }
        rulesGame = result.state;
        commitRulesPresentation(result.events || []);
        await runVisibleForcedTransitions();
        renderRulesGuide();
        return true;
    } catch (err) {
        console.warn('Rules action rejected:', normalizedAction, err);
        const message = err && err.message ? err.message : 'That action is not legal right now.';
        showRulesToast(message, 'warning');
        renderRulesGame({ rebuildBoard: true, announceEvents: false });
        if (source === 'remote' && conn && conn.open) {
            sendData({
                type: 'RULES_REJECT',
                message,
                payload: buildPlayerBoardState('p2')
            });
        }
        return false;
    } finally {
        rulesAutomationBusy = false;
        renderRulesGuide();
    }
}

function receiveAuthoritativeState(payload, events = [], envelope = {}) {
    try {
        const { state } = parseBoardStateSnapshot(payload);
        const incomingRules = state && !Array.isArray(state) ? state.rulesGame : null;
        if (!state || Array.isArray(state) || state.mode !== 'rules' || !incomingRules
            || !incomingRules.projection
            || incomingRules.projection.authoritative !== false
            || incomingRules.projection.viewerId !== 'p2') {
            throw new Error('The host did not send a valid private Player 2 rules view.');
        }
        if (envelope.matchId && envelope.matchId !== incomingRules.matchId) {
            throw new Error('The shared-state match identifier does not agree with its envelope.');
        }
        if (envelope.revision !== undefined && Number(envelope.revision) !== incomingRules.revision) {
            throw new Error('The shared-state revision does not agree with its envelope.');
        }
        if (rulesGame && rulesGame.matchId === incomingRules.matchId
            && Number(incomingRules.revision) < Number(rulesGame.revision)) {
            return;
        }
        cancelActiveInteraction();
        rulesSessionGeneration += 1;
        rulesRequestPending = false;
        if (rulesRequestTimer) clearTimeout(rulesRequestTimer);
        rulesRequestTimer = null;
        restoreBoardState(JSON.stringify(state), true);
        presentRulesEvents(events);
        renderRulesGame({ rebuildBoard: true, announceEvents: false });
    } catch (err) {
        console.error('Unable to restore authoritative rules state:', err);
        showRulesToast('The shared game state could not be read. Ask the host to reconnect.', 'warning');
    }
}

function sendData(dataObj) {
    if (conn && conn.open) {
        conn.send(dataObj);
    }
}

function updateStatus(msg) {
    document.getElementById('status-indicator').innerText = msg;
}

function copyId() {
    const copyText = document.getElementById("my-id-display");
    copyText.select();
    navigator.clipboard.writeText(copyText.value);
    alert("ID Copied to Clipboard!");
}

// --- SERIALIZATION ---
function getBoardState(options = {}) {
    const isNetworkPayload = options.forNetwork === true;
    const localPlayerKey = getLocalBidPlayerKey();
    const state = {
        schemaVersion: RULES_SAVE_SCHEMA_VERSION,
        mode: rulesGame ? 'rules' : 'sandbox',
        pieces: [],
        cp1: document.getElementById('cp1').value,
        cp2: document.getElementById('cp2').value,
        diceCount: document.getElementById('dice-count').value,
        startingPoolCount: document.getElementById('starting-pool-count').value,
        terrainDeck: [...terrainDeck],
        bidVisibility: getNormalizedBidVisibility(),
        rulesGame: rulesGame || null
    };

    if (isNetworkPayload && localPlayerKey) {
        state.bidOwner = localPlayerKey;

        if (localPlayerKey === 'p1') {
            delete state.cp2;
            if (!bidVisibility.p1) {
                delete state.cp1;
            }
        } else if (localPlayerKey === 'p2') {
            delete state.cp1;
            if (!bidVisibility.p2) {
                delete state.cp2;
            }
        }
    }
    document.querySelectorAll('.unit').forEach(el => {
        if (el.classList.contains('ghost')) return;
        state.pieces.push({
            type: 'unit',
            id: el.dataset.pieceId || null,
            owner: el.dataset.owner || null,
            name: el.dataset.name,
            x: parseFloat(el.style.left),
            y: parseFloat(el.style.top),
            angle: el.dataset.angle,
            wounds: el.dataset.wounds,
            woundsThisRound: Number(el.dataset.woundsThisRound) || 0,
            distanceMovedThisRound: Number(el.dataset.distanceMovedThisRound) || 0,
            activated: el.dataset.activated === 'true',
            color: el.style.backgroundColor,
            stats: el._unitStats || null
        });
    });
    document.querySelectorAll('.terrain').forEach(el => {
        if (el.classList.contains('ghost') || el.dataset.rulesTransient === 'true') return;
        state.pieces.push({
            type: 'terrain',
            id: el.dataset.pieceId || null,
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

function parseBoardStateSnapshot(snapshot) {
    if (!snapshot) throw new Error('The board state is empty.');
    const state = typeof snapshot === 'string'
        ? JSON.parse(snapshot)
        : JSON.parse(JSON.stringify(snapshot));
    if (!state || (typeof state !== 'object' && !Array.isArray(state))) {
        throw new Error('The board state must be an object or legacy piece array.');
    }
    const pieces = Array.isArray(state) ? state : state.pieces;
    if (!Array.isArray(pieces)) throw new Error('The board state has no piece list.');
    if (pieces.length > 500) throw new Error('The board state contains too many pieces.');
    if (!Array.isArray(state) && state.mode === 'rules') {
        if (!state.rulesGame || !window.SeizeTheDayRules
            || typeof SeizeTheDayRules.assertInvariants !== 'function') {
            throw new Error('The rules state is missing or unsupported.');
        }
        if (!Array.isArray(state.rulesGame.units) || !Array.isArray(state.rulesGame.terrain)) {
            throw new Error('The rules state has invalid collections.');
        }
        SeizeTheDayRules.assertInvariants(state.rulesGame);
        // Canonical rules collections are authoritative; redundant DOM pieces are ignored.
        return { state, pieces: [] };
    }
    const safePieces = pieces.map((piece, index) => {
        if (!piece || typeof piece !== 'object' || !['unit', 'terrain'].includes(piece.type)) {
            throw new Error(`Piece ${index + 1} is not a supported unit or terrain object.`);
        }
        if (!Number.isFinite(Number(piece.x)) || !Number.isFinite(Number(piece.y))
            || !Number.isFinite(Number(piece.angle ?? 0))) {
            throw new Error(`Piece ${index + 1} has an invalid position or angle.`);
        }
        if (piece.type === 'unit' && (!piece.name || typeof piece.name !== 'string')) {
            throw new Error(`Unit ${index + 1} has no valid name.`);
        }
        if (piece.type === 'terrain' && (!piece.subType || typeof piece.subType !== 'string'
            || !Number.isFinite(Number(piece.w)) || Number(piece.w) <= 0
            || !Number.isFinite(Number(piece.h)) || Number(piece.h) <= 0)) {
            throw new Error(`Terrain ${index + 1} has invalid type or dimensions.`);
        }
        return piece;
    });
    return { state, pieces: safePieces };
}

function restoreBoardState(jsonString, suppressBroadcast = false) {
    if (!jsonString) return;
    const { state, pieces: data } = parseBoardStateSnapshot(jsonString);
    cancelActiveInteraction();
    clearPieceSelection();
    table.querySelectorAll('.unit, .terrain, .ghost, .range-ring, .deployment-zone').forEach(p => p.remove());

    rulesGame = !Array.isArray(state) && state.mode === 'rules' && state.rulesGame
        ? state.rulesGame
        : null;

    cancelTerrainCardAnimation();
    terrainDeck = !Array.isArray(state) && Array.isArray(state.terrainDeck)
        ? state.terrainDeck.filter(card => TERRAIN_TYPES.includes(card) || card === TERRAIN_NO_FEATURE_CARD)
        : [];
    renderTerrainCard();

    if (!Array.isArray(state)) {
        const bidOwner = state.bidOwner === 'p1' || state.bidOwner === 'p2'
            ? state.bidOwner
            : null;

        if (state.cp1 !== undefined && (!bidOwner || bidOwner === 'p1')) {
            document.getElementById('cp1').value = state.cp1;
            rememberCpValue('p1');
        }
        if (state.cp2 !== undefined && (!bidOwner || bidOwner === 'p2')) {
            document.getElementById('cp2').value = state.cp2;
            rememberCpValue('p2');
        }
        if (state.diceCount !== undefined) document.getElementById('dice-count').value = state.diceCount;
        normalizeDiceCount(false);
        if (state.startingPoolCount !== undefined) document.getElementById('starting-pool-count').value = state.startingPoolCount;
        normalizeStartingPoolCount(false);
        if (bidOwner && state.bidVisibility) {
            const incomingVisibility = getNormalizedBidVisibility({
                ...bidVisibility,
                ...state.bidVisibility
            });
            bidVisibility = {
                ...bidVisibility,
                [bidOwner]: incomingVisibility[bidOwner]
            };
        } else if (state.bidVisibility) {
            bidVisibility = getNormalizedBidVisibility(state.bidVisibility);
        } else if (state.bidsHidden !== undefined) {
            const legacyVisible = state.bidsHidden !== true;
            bidVisibility = { p1: legacyVisible, p2: legacyVisible };
        } else {
            bidVisibility = { p1: true, p2: true };
        }
        updateBidUI();
    }

    data.forEach(obj => {
        if (obj.type === 'unit') {
            createUnitDOM(obj.name, obj.color, obj.x, obj.y, obj.angle, obj.wounds, obj.stats, obj.activated, {
                id: obj.id,
                owner: obj.owner,
                woundsThisRound: obj.woundsThisRound,
                distanceMovedThisRound: obj.distanceMovedThisRound
            });
        } else if (obj.type === 'terrain') {
            createTerrainDOM(obj.subType, obj.x, obj.y, obj.w, obj.h, obj.angle, { id: obj.id });
        }
    });
    if (rulesGame && typeof renderRulesGame === 'function') {
        renderRulesGame({ rebuildBoard: true, announceEvents: false });
        populateRulesLog();
    } else if (typeof renderRulesGuide === 'function') {
        renderRulesGuide();
    }
    if (rulesGame && rulesGame.projection && rulesGame.projection.authoritative === false && !isHost) {
        localStorage.setItem(REMOTE_CACHE_KEY, getBoardState());
    } else {
        saveGame(suppressBroadcast);
    }
}

function saveGame(suppressBroadcast = false) {
    rememberCpValues();
    const state = getBoardState();
    if (rulesGame && rulesGame.projection && rulesGame.projection.authoritative === false) {
        localStorage.setItem(REMOTE_CACHE_KEY, state);
        return;
    }
    localStorage.setItem(SAVE_KEY, state);
    if (!suppressBroadcast && !isResettingBoard) {
        if (rulesGame) {
            if (isHost) sendAuthoritativeState([]);
        } else {
            sendData({ type: 'SYNC_BOARD', payload: getBoardState({ forNetwork: true }) });
        }
    }
}

// --- RULES ENGINE <-> DOM ADAPTER ---
function rulesCollectionValues(collection) {
    if (Array.isArray(collection)) return collection;
    if (collection && typeof collection === 'object') return Object.values(collection);
    return [];
}

function getRulesUnit(unitId) {
    return rulesCollectionValues(rulesGame && rulesGame.units)
        .find(unit => unit && unit.id === unitId) || null;
}

function getRulesTerrain(terrainId) {
    return rulesCollectionValues(rulesGame && rulesGame.terrain)
        .find(terrain => terrain && terrain.id === terrainId) || null;
}

function getRulesPieceElement(pieceId) {
    return Array.from(table.querySelectorAll('.piece'))
        .find(piece => !piece.classList.contains('ghost')
            && piece.dataset.rulesTransient !== 'true'
            && piece.dataset.pieceId === pieceId) || null;
}

function readRulesPose(item) {
    const pose = (item && item.pose) || {};
    return {
        x: Number(pose.x ?? pose.centerX ?? item.x) || 0,
        y: Number(pose.y ?? pose.centerY ?? item.y) || 0,
        angle: Number(pose.angle ?? item.angle) || 0
    };
}

function readRulesOwner(unit) {
    return (unit && (unit.ownerId || unit.owner)) || '';
}

function isRulesUnitAlive(unit) {
    return unit && unit.destroyed !== true && unit.status !== 'destroyed' && unit.alive !== false;
}

function updateRulesUnitElement(element, unit) {
    const stats = unit.stats || unit.profile || unit.definition || element._unitStats || {};
    const naturalSize = getUnitSizePx(stats);
    const size = unit.size || {};
    const widthPx = inchesToPx(Number(size.width ?? size.w) || (naturalSize.width / SCALE));
    const heightPx = inchesToPx(Number(size.depth ?? size.height ?? size.h) || (naturalSize.height / SCALE));
    const pose = readRulesPose(unit);
    const owner = readRulesOwner(unit);
    const wounds = Number(unit.wounds) || 0;

    element.dataset.pieceId = unit.id;
    element.dataset.name = unit.name || stats.Unit || element.dataset.name || 'Unit';
    element.dataset.owner = owner;
    element.dataset.angle = String(pose.angle);
    element.dataset.wounds = String(wounds);
    element.dataset.woundsThisRound = String(Number(unit.woundsThisRound) || 0);
    element.dataset.distanceMovedThisRound = String(Number(unit.distanceMovedThisRound) || 0);
    element.dataset.activated = unit.activated ? 'true' : 'false';
    element.style.width = `${widthPx}px`;
    element.style.height = `${heightPx}px`;
    element.style.left = `${inchesToPx(pose.x) - (widthPx / 2)}px`;
    element.style.top = `${inchesToPx(pose.y) - (heightPx / 2)}px`;
    element.style.transform = `rotate(${pose.angle}deg)`;
    element.style.backgroundColor = PLAYER_COLORS[owner] || '#666';
    element.classList.toggle('player-one', owner === 'p1');
    element.classList.toggle('player-two', owner === 'p2');
    element.classList.toggle('is-activated', Boolean(unit.activated));
    element._unitStats = stats;

    const label = element.querySelector('.unit-label');
    if (label) label.textContent = element.dataset.name;
    const checkbox = element.querySelector('.activation-checkbox');
    if (checkbox) checkbox.checked = Boolean(unit.activated);
    const marker = element.querySelector('.wound-marker');
    if (marker) {
        marker.textContent = String(wounds);
        marker.style.display = wounds > 0 ? 'flex' : 'none';
    }
}

function updateRulesTerrainElement(element, terrain) {
    const pose = readRulesPose(terrain);
    const size = terrain.size || terrain.featureSize || {};
    const width = Number(size.width ?? size.w ?? terrain.width) || (defaultUnitSizePx.width / SCALE);
    const height = Number(size.height ?? size.depth ?? size.h ?? terrain.height) || (defaultUnitSizePx.height / SCALE);
    const subType = terrain.subType || terrain.type || terrain.kind || 'field';
    element.dataset.pieceId = terrain.id;
    element.dataset.subType = subType;
    element.dataset.angle = String(pose.angle);
    element.className = `piece terrain ${subType}`;
    element.textContent = subType.charAt(0).toUpperCase() + subType.slice(1);
    appendRotationHandle(element);
    element.style.left = `${inchesToPx(pose.x - (width / 2))}px`;
    element.style.top = `${inchesToPx(pose.y - (height / 2))}px`;
    element.style.width = `${inchesToPx(width)}px`;
    element.style.height = `${inchesToPx(height)}px`;
    element.style.transform = `rotate(${pose.angle}deg)`;
}

function renderRulesBoard() {
    if (!rulesGame) return;
    const units = rulesCollectionValues(rulesGame.units).filter(isRulesUnitAlive);
    const terrain = rulesCollectionValues(rulesGame.terrain).filter(item => item && item.status !== 'discarded');
    const validUnitIds = new Set(units.map(unit => unit.id));
    const validTerrainIds = new Set(terrain.map(item => item.id));

    table.querySelectorAll('.unit').forEach(element => {
        if (!validUnitIds.has(element.dataset.pieceId)) {
            if (selectedPiece === element) clearPieceSelection();
            element.remove();
        }
    });
    table.querySelectorAll('.terrain:not([data-rules-transient="true"])').forEach(element => {
        if (!validTerrainIds.has(element.dataset.pieceId)) element.remove();
    });

    units.forEach(unit => {
        let element = getRulesPieceElement(unit.id);
        if (!element) {
            const stats = unit.stats || unit.profile || unit.definition || {};
            const size = unit.size || {};
            const pose = readRulesPose(unit);
            const naturalSize = getUnitSizePx(stats);
            const width = Number(size.width ?? size.w) || (naturalSize.width / SCALE);
            const height = Number(size.depth ?? size.height ?? size.h) || (naturalSize.height / SCALE);
            element = createUnitDOM(
                unit.name || stats.Unit || 'Unit',
                PLAYER_COLORS[readRulesOwner(unit)] || '#666',
                inchesToPx(pose.x - (width / 2)),
                inchesToPx(pose.y - (height / 2)),
                pose.angle,
                unit.wounds,
                stats,
                unit.activated,
                {
                    id: unit.id,
                    owner: readRulesOwner(unit),
                    woundsThisRound: unit.woundsThisRound,
                    distanceMovedThisRound: unit.distanceMovedThisRound
                }
            );
        }
        updateRulesUnitElement(element, unit);
    });

    terrain.forEach(item => {
        let element = getRulesPieceElement(item.id);
        if (!element) {
            const pose = readRulesPose(item);
            element = createTerrainDOM(
                item.subType || item.type || item.kind,
                0,
                0,
                0,
                0,
                pose.angle,
                { id: item.id }
            );
        }
        updateRulesTerrainElement(element, item);
    });

    fitAllUnitLabels();
}

function getRulesActionEntityId(action, key) {
    if (!action) return null;
    const payload = action.payload || {};
    return action[key] || payload[key] || null;
}

function canRulesDragPiece(piece) {
    if (!rulesGame || !piece) return true;
    if (rulesAutomationBusy || rulesRequestPending) return false;
    if (piece.dataset.rulesTransient === 'true') {
        return getVisibleRulesActions().some(action => getActionType(action) === 'draft.placeTerrain');
    }
    if (!piece.classList.contains('unit')) return false;
    const pieceId = piece.dataset.pieceId;
    return getVisibleRulesActions().some(action => {
        const type = getActionType(action);
        const actionUnitId = getRulesActionEntityId(action, 'unitId')
            || (type.startsWith('activation.') && rulesGame.activation && rulesGame.activation.unitId);
        if (actionUnitId !== pieceId) return false;
        if (type === 'draft.deployUnit') return true;
        return type === 'activation.move' && Boolean(rulesMoveDirection);
    });
}

function canRulesRotatePiece(piece) {
    if (!rulesGame || !piece) return true;
    if (rulesAutomationBusy || rulesRequestPending) return false;
    if (piece.dataset.rulesTransient === 'true') {
        return getVisibleRulesActions().some(action => getActionType(action) === 'draft.placeTerrain');
    }
    if (!piece.classList.contains('unit')) return false;
    const pieceId = piece.dataset.pieceId;
    return getVisibleRulesActions().some(action => {
        const type = getActionType(action);
        const actionUnitId = getRulesActionEntityId(action, 'unitId')
            || (type.startsWith('activation.') && rulesGame.activation && rulesGame.activation.unitId);
        return actionUnitId === pieceId
            && (type === 'activation.pivot' || type === 'draft.deployUnit');
    });
}

function getRulesSpeed(unit) {
    if (!unit) return 0;
    const stats = unit.stats || unit.profile || unit.definition || {};
    const raw = unit.speed ?? stats.speed ?? stats.Speed ?? stats.Move ?? 0;
    const parsed = parseFloat(String(raw).replace('*', ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function projectRulesMove(unit, desiredCenterX, desiredCenterY, direction) {
    const pose = readRulesPose(unit);
    const radians = pose.angle * (Math.PI / 180);
    const forward = { x: Math.sin(radians), y: -Math.cos(radians) };
    const vector = direction === 'backward'
        ? { x: -forward.x, y: -forward.y }
        : forward;
    const desiredInches = {
        x: desiredCenterX / SCALE,
        y: desiredCenterY / SCALE
    };
    const projectedDistance = ((desiredInches.x - pose.x) * vector.x)
        + ((desiredInches.y - pose.y) * vector.y);
    const maximum = getRulesSpeed(unit) * (direction === 'backward' ? 0.5 : 1);
    const requestedDistance = Math.max(0, Math.min(maximum, projectedDistance));
    let distance = requestedDistance;
    const moveTemplate = getVisibleRulesActions().find(action => {
        if (getActionType(action) !== 'activation.move') return false;
        const actionDirection = action.direction || (action.payload && action.payload.direction);
        return actionDirection === direction;
    });
    const previewAtDistance = candidateDistance => {
        if (!moveTemplate) return null;
        const candidatePose = {
            x: pose.x + (vector.x * candidateDistance),
            y: pose.y + (vector.y * candidateDistance),
            angle: pose.angle
        };
        return getRulesPreviewResult({
            ...moveTemplate,
            direction,
            pose: candidatePose,
            destination: candidatePose,
            to: candidatePose
        });
    };
    const requestedPreview = previewAtDistance(requestedDistance);
    if (requestedDistance > 0 && requestedPreview && !requestedPreview.ok) {
        let low = 0;
        let high = requestedDistance;
        for (let iteration = 0; iteration < 12; iteration += 1) {
            const middle = (low + high) / 2;
            const preview = previewAtDistance(middle);
            if (preview && preview.ok) low = middle;
            else high = middle;
        }
        distance = low;
    }
    return {
        centerX: inchesToPx(pose.x + (vector.x * distance)),
        centerY: inchesToPx(pose.y + (vector.y * distance)),
        distance,
        clamped: distance < requestedDistance - 0.01
    };
}

function getVisibleRulesActions() {
    if (!rulesGame || !window.SeizeTheDayRules) return [];
    const actor = getConnectedRulesPlayer() || getRulesDecisionPlayer();
    try {
        let actions = SeizeTheDayRules.getLegalActions(rulesGame, actor) || [];
        if (conn) {
            syncNetworkBidProtocol();
            if (networkBidProtocol.secrets[actor]) {
                actions = actions.filter(action => getActionType(action) !== 'bid.submit');
            }
        }
        return actions;
    } catch (err) {
        console.warn('Unable to list legal actions:', err);
        return [];
    }
}

function renderRulesHighlights() {
    table.querySelectorAll('.piece').forEach(piece => {
        piece.classList.remove(
            'rules-current', 'current-unit', 'is-current-unit',
            'rules-legal', 'legal-unit', 'is-legal-unit',
            'rules-target', 'legal-target', 'is-legal-target',
            'rules-illegal', 'illegal-unit', 'illegal-target', 'is-illegal'
        );
    });
    if (!rulesGame) return;

    const actions = getVisibleRulesActions();
    const legalUnitIds = new Set();
    const targetIds = new Set();
    actions.forEach(action => {
        const unitId = getRulesActionEntityId(action, 'unitId');
        const targetId = getRulesActionEntityId(action, 'targetId');
        if (unitId) legalUnitIds.add(unitId);
        if (targetId) targetIds.add(targetId);
    });

    const currentId = (rulesGame.activation && rulesGame.activation.unitId)
        || (rulesGame.draft && rulesGame.draft.selectedUnitId)
        || null;
    if (currentId) {
        const current = getRulesPieceElement(currentId);
        if (current) current.classList.add('rules-current');
    }
    legalUnitIds.forEach(id => {
        const piece = getRulesPieceElement(id);
        if (piece) piece.classList.add('rules-legal');
    });
    targetIds.forEach(id => {
        const piece = getRulesPieceElement(id);
        if (piece) piece.classList.add('rules-target');
    });

    if (legalUnitIds.size || targetIds.size) {
        table.querySelectorAll('.unit').forEach(unit => {
            if (!legalUnitIds.has(unit.dataset.pieceId)
                && !targetIds.has(unit.dataset.pieceId)
                && unit.dataset.pieceId !== currentId) {
                unit.classList.add('rules-illegal');
            }
        });
    }
}

function renderDeploymentZones() {
    table.querySelectorAll('.deployment-zone').forEach(zone => zone.remove());
    if (!rulesGame || !rulesGame.draft || rulesGame.draft.complete) return;

    ['p2', 'p1'].forEach((playerId, index) => {
        const zone = document.createElement('div');
        zone.className = 'deployment-zone';
        zone.dataset.player = playerId;
        zone.dataset.label = `${playerId === 'p1' ? 'Player 1' : 'Player 2'} deployment`;
        zone.style.left = '0';
        zone.style.top = `${index === 0 ? 0 : tableHeightPx - inchesToPx(DEPLOY_INCHES)}px`;
        zone.style.width = `${tableWidthPx}px`;
        zone.style.height = `${inchesToPx(DEPLOY_INCHES)}px`;
        const currentPlayer = rulesGame.draft.currentPlayerId || rulesGame.draft.activePlayerId;
        const step = rulesGame.draft.step || rulesGame.draft.stage;
        if (currentPlayer === playerId && /deploy/i.test(step || '')) zone.classList.add('rules-current');
        table.insertBefore(zone, table.firstChild);
    });
}

function renderRulesGame(options = {}) {
    if (!rulesGame) {
        table.querySelectorAll('.deployment-zone').forEach(zone => zone.remove());
        renderRulesHighlights();
        renderRulesGuide();
        return;
    }
    renderRulesBoard();
    renderDeploymentZones();
    renderRulesHighlights();
    renderTerrainCard();
    stagePendingRulesTerrainIfNeeded();
    renderRulesGuide();
    if (options.announceEvents) populateRulesLog();
}

function humanizeRulesToken(value) {
    return String(value || '')
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function getRulesPhaseLabel() {
    if (!rulesGame) return 'Free Play';
    if (rulesGame.winner || rulesGame.result) return 'Game Over';
    const phase = rulesGame.phase || rulesGame.stage;
    if (phase) return humanizeRulesToken(phase);
    if (rulesGame.draft && !rulesGame.draft.complete) return 'Draft & Deploy';
    if (rulesGame.activation) return 'Unit Activation';
    if (rulesGame.round && rulesGame.round.window) return humanizeRulesToken(rulesGame.round.window);
    return 'Rules Game';
}

function getRulesPromptForViewer() {
    if (!rulesGame || !window.SeizeTheDayRules) return null;
    const viewer = getConnectedRulesPlayer();
    try {
        return SeizeTheDayRules.getPrompt(rulesGame, viewer);
    } catch (err) {
        console.warn('Unable to read rules prompt:', err);
        return null;
    }
}

function promptText(prompt) {
    if (!prompt) return '';
    if (typeof prompt === 'string') return prompt;
    return prompt.message || prompt.prompt || prompt.text || prompt.instruction || '';
}

function promptDetails(prompt) {
    if (!prompt || typeof prompt === 'string') return '';
    return prompt.details || prompt.detail || prompt.hint || '';
}

function getActionType(action) {
    return action && String(action.type || action.action || '');
}

function makeGuideButton(label, onClick, className = 'guide-action-secondary', disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
}

function getLivingRulesUnitCount(playerId) {
    return rulesCollectionValues(rulesGame && rulesGame.units)
        .filter(unit => isRulesUnitAlive(unit) && readRulesOwner(unit) === playerId).length;
}

function renderBidGuideAction(container, action) {
    const actorId = action.actorId || (action.payload && action.payload.actorId) || getRulesDecisionPlayer();
    const wrapper = document.createElement('div');
    wrapper.className = 'guide-bid-control';
    const label = document.createElement('label');
    label.htmlFor = 'guide-bid-input';
    label.textContent = 'Secret bid';
    const input = document.createElement('input');
    input.id = 'guide-bid-input';
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = String(action.min ?? (action.payload && action.payload.min) ?? 1);
    input.max = String(action.max ?? (action.payload && action.payload.max) ?? Math.max(1, getLivingRulesUnitCount(actorId)));
    input.value = input.min;
    input.setAttribute('aria-label', `${actorId === 'p2' ? 'Player 2' : 'Player 1'} secret bid`);
    const submit = makeGuideButton('Lock Bid', () => {
        const value = Math.max(Number(input.min), Math.min(Number(input.max), Number(input.value) || 1));
        input.value = String(value);
        dispatchRulesAction({
            ...action,
            type: 'bid.submit',
            actorId,
            value,
            bid: value,
            payload: { ...(action.payload || {}), value, bid: value }
        });
    }, 'guide-action-primary');
    wrapper.append(label, input, submit);
    container.appendChild(wrapper);
}

function renderRulesGuideActions(container, actions) {
    container.replaceChildren();
    if (rulesAutomationBusy || rulesRequestPending) {
        container.appendChild(makeGuideButton(rulesRequestPending ? 'Awaiting Host…' : 'Resolving…', () => {}, 'guide-action-secondary', true));
        return;
    }

    const actionTypes = new Set(actions.map(getActionType));
    const terrainAction = actions.find(action => getActionType(action) === 'draft.placeTerrain');
    if (terrainAction) {
        if (rulesTransientTerrain && rulesTransientTerrain.isConnected) {
            container.appendChild(makeGuideButton('Place Terrain', confirmRulesTerrainPlacement, 'guide-action-primary'));
            container.appendChild(makeGuideButton('↺ 45°', () => rotateStagedRulesPiece(rulesTransientTerrain, -45), 'guide-action-secondary'));
            container.appendChild(makeGuideButton('↻ 45°', () => rotateStagedRulesPiece(rulesTransientTerrain, 45), 'guide-action-secondary'));
            container.appendChild(makeGuideButton('Snap', () => snapRulesTerrainPiece(rulesTransientTerrain, true), 'guide-action-secondary'));
            container.appendChild(makeGuideButton('Cancel', cancelStagedRulesTerrain, 'guide-action-secondary'));
        } else {
            container.appendChild(makeGuideButton('Pick Up Terrain', () => stageRulesTerrainFromGuide(terrainAction), 'guide-action-primary'));
        }
    }

    const bidAction = actions.find(action => getActionType(action) === 'bid.submit');
    if (bidAction) renderBidGuideAction(container, bidAction);

    const yieldAction = actions.find(action => getActionType(action) === 'command.yield');
    if (yieldAction) {
        container.appendChild(makeGuideButton('Yield Command', () => dispatchRulesAction(yieldAction), 'guide-action-primary'));
    }

    const moveActions = actions.filter(action => getActionType(action) === 'activation.move');
    if (moveActions.length) {
        const hasForward = moveActions.some(action => {
            const direction = action.direction || (action.payload && action.payload.direction);
            return !direction || direction === 'forward';
        });
        const hasBackward = moveActions.some(action => {
            const direction = action.direction || (action.payload && action.payload.direction);
            return !direction || direction === 'backward';
        });
        if (hasForward) {
            container.appendChild(makeGuideButton(
                rulesMoveDirection === 'forward' ? 'Forward ✓' : 'Move Forward',
                () => { rulesMoveDirection = 'forward'; renderRulesGuide(); },
                rulesMoveDirection === 'forward' ? 'guide-action-primary' : 'guide-action-secondary'
            ));
        }
        if (hasBackward) {
            container.appendChild(makeGuideButton(
                rulesMoveDirection === 'backward' ? 'Backward ✓' : 'Move Back',
                () => { rulesMoveDirection = 'backward'; renderRulesGuide(); },
                rulesMoveDirection === 'backward' ? 'guide-action-primary' : 'guide-action-secondary'
            ));
        }
    } else {
        rulesMoveDirection = null;
    }

    const pivotAction = actions.find(action => getActionType(action) === 'activation.pivot');
    if (pivotAction) {
        [-90, -45, 45, 90].forEach(degrees => {
            container.appendChild(makeGuideButton(
                `${degrees < 0 ? '↺' : '↻'} ${Math.abs(degrees)}°`,
                () => dispatchRulesAction({ ...pivotAction, degrees, delta: degrees }),
                'guide-action-secondary'
            ));
        });
    }

    const deployAction = actions.find(action => getActionType(action) === 'draft.deployUnit');
    if (deployAction) {
        const deployPiece = getRulesPieceElement(getRulesActionEntityId(deployAction, 'unitId'));
        if (deployPiece) {
            container.appendChild(makeGuideButton('Face Left', () => rotateStagedRulesPiece(deployPiece, -45), 'guide-action-secondary'));
            container.appendChild(makeGuideButton('Face Right', () => rotateStagedRulesPiece(deployPiece, 45), 'guide-action-secondary'));
        }
    }

    const passAction = actions.find(action => getActionType(action) === 'activation.pass');
    if (passAction) {
        container.appendChild(makeGuideButton('Hold Position', () => {
            rulesMoveDirection = null;
            dispatchRulesAction(passAction);
        }));
    }

    const endPivots = actions.find(action => getActionType(action) === 'activation.endPivots');
    if (endPivots) {
        container.appendChild(makeGuideButton('Finish Activation', () => dispatchRulesAction(endPivots), 'guide-action-primary'));
    }

    const skipStrike = actions.find(action => getActionType(action) === 'activation.skipStrike');
    if (skipStrike) {
        container.appendChild(makeGuideButton('Skip Strike', () => dispatchRulesAction(skipStrike)));
    }

    if (rulesGame && (rulesGame.winner || rulesGame.result)) {
        container.appendChild(makeGuideButton('New Rules Game', () => window.startRulesGame(), 'guide-action-primary'));
    }

    const handledTypes = new Set([
        'bid.submit', 'command.yield', 'activation.move', 'activation.pass',
        'activation.endPivots', 'activation.skipStrike', 'draft.chooseUnit',
        'draft.placeTerrain', 'draft.deployUnit', 'activation.selectUnit',
        'activation.pivot', 'activation.shoot', 'activation.strike'
    ]);
    actions.forEach(action => {
        const type = getActionType(action);
        if (!type || handledTypes.has(type)) return;
        container.appendChild(makeGuideButton(
            action.label || humanizeRulesToken(type),
            () => dispatchRulesAction(action)
        ));
    });

    if (!container.children.length && actionTypes.size === 0 && conn && rulesGame) {
        container.appendChild(makeGuideButton('Waiting for opponent…', () => {}, 'guide-action-secondary', true));
    }
}

function renderRulesGuide() {
    const guide = document.getElementById('game-guide');
    const mode = document.getElementById('guide-mode');
    const phase = document.getElementById('guide-phase');
    const round = document.getElementById('guide-round');
    const player = document.getElementById('guide-player');
    const promptElement = document.getElementById('guide-prompt');
    const details = document.getElementById('guide-details');
    const actionsContainer = document.getElementById('guide-actions');
    if (!guide || !mode || !phase || !round || !player || !promptElement || !details || !actionsContainer) return;

    ['new-rules-game-btn', 'sandbox-quick-deploy-btn'].forEach(id => {
        const button = document.getElementById(id);
        if (button) button.disabled = rulesAutomationBusy || isResettingBoard || Boolean(conn && !isHost);
    });

    document.body.classList.toggle('rules-mode', Boolean(rulesGame));
    if (!rulesGame) {
        guide.dataset.mode = 'sandbox';
        guide.classList.remove('rules-active');
        mode.textContent = 'Sandbox';
        phase.textContent = 'Free Play';
        round.textContent = 'Round —';
        player.textContent = conn ? (isHost ? 'You are Player 1' : 'You are Player 2') : 'Either player';
        promptElement.textContent = 'Move any piece, or start a rules game when you are ready.';
        details.textContent = 'Sandbox keeps free movement, manual wounds, dice, activation markers, and undo.';
        actionsContainer.replaceChildren();
        return;
    }

    const prompt = getRulesPromptForViewer();
    if (conn) syncNetworkBidProtocol();
    const decisionPlayer = (prompt && typeof prompt === 'object' && (prompt.actorId || prompt.playerId))
        || getRulesDecisionPlayer();
    const viewer = getConnectedRulesPlayer();
    const legalActions = getVisibleRulesActions();
    guide.dataset.mode = 'rules';
    guide.classList.add('rules-active');
    mode.textContent = 'Rules On';
    phase.textContent = getRulesPhaseLabel();
    round.textContent = `Round ${rulesGame.round && rulesGame.round.number ? rulesGame.round.number : '—'}`;
    player.textContent = decisionPlayer
        ? `${decisionPlayer === 'p2' ? 'Player 2' : 'Player 1'}${viewer === decisionPlayer ? ' · Your choice' : ''}`
        : 'Automatic step';
    const localBidCommitted = viewer && conn && networkBidProtocol.roundKey === getNetworkBidRoundKey()
        && Boolean(networkBidProtocol.secrets[viewer]);
    promptElement.textContent = (localBidCommitted && rulesGame.phase === 'bid'
        ? 'Your secret bid is committed. Waiting for the other player…'
        : promptText(prompt))
        || (rulesAutomationBusy ? 'Resolving the next required step…' : 'Choose one of the highlighted legal actions.');
    details.textContent = promptDetails(prompt)
        || (viewer && decisionPlayer && viewer !== decisionPlayer
            ? 'Your opponent is choosing. You can still inspect units and measure.'
            : 'Only legal pieces and targets are highlighted. Invalid moves return to their starting point.');
    renderRulesGuideActions(actionsContainer, legalActions);
    requestAnimationFrame(fitTableToScreen);
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

function appendRotationHandle(piece) {
    let handle = piece.querySelector('.rotation-handle');
    if (handle) return;

    handle = document.createElement('div');
    handle.classList.add('rotation-handle');
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', 'Drag to rotate');
    handle.title = 'Drag to rotate';
    handle.addEventListener('pointerdown', onRotationHandlePointerDown);
    piece.appendChild(handle);
}

function unitLabelFits(label) {
    return label.scrollWidth <= label.clientWidth + 1;
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

function createUnitDOM(name, color, x, y, angle, wounds, stats = null, activated = false, metadata = {}) {
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
    div.dataset.angle = angle || 0;
    div.dataset.footprint = unitSize.footprint;
    div.style.transform = `rotate(${angle}deg)`;
    div.dataset.wounds = wounds || 0;
    div.dataset.activated = activated ? 'true' : 'false';
    div.dataset.pieceId = metadata.id || metadata.pieceId || '';
    div.dataset.owner = metadata.owner || '';
    div.dataset.woundsThisRound = String(metadata.woundsThisRound || 0);
    div.dataset.distanceMovedThisRound = String(metadata.distanceMovedThisRound || 0);
    div.classList.toggle('player-one', div.dataset.owner === 'p1');
    div.classList.toggle('player-two', div.dataset.owner === 'p2');
    div._unitStats = unitStats;
    applyUnitTheme(div, name);

    const appendActivationCheckbox = () => {
        let checkbox = div.querySelector('.activation-checkbox');
        if (!checkbox) {
            checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.classList.add('activation-checkbox');
            checkbox.setAttribute('aria-label', 'Activated this round');
            checkbox.title = 'Activated this round';
            checkbox.addEventListener('mousedown', e => e.stopPropagation());
            checkbox.addEventListener('pointerdown', e => e.stopPropagation());
            checkbox.addEventListener('click', e => e.stopPropagation());
            checkbox.addEventListener('dblclick', e => e.stopPropagation());
            checkbox.addEventListener('change', () => {
                if (rulesGame) {
                    checkbox.checked = div.dataset.activated === 'true';
                    showRulesToast('Activations are tracked automatically in rules mode.', 'info');
                    return;
                }
                const nextActivated = checkbox.checked;
                checkbox.checked = !nextActivated;
                div.dataset.activated = checkbox.checked ? 'true' : 'false';
                pushUndo();
                checkbox.checked = nextActivated;
                div.dataset.activated = nextActivated ? 'true' : 'false';
                saveGame();
            });
            div.appendChild(checkbox);
        }

        checkbox.checked = div.dataset.activated === 'true';
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
        if (!selectedPiece) {
            queueUnitTooltip(div);
        }
    });

    div.addEventListener('mouseleave', () => {
        hoveredUnit = null;
        removeRangeRing();
        if (selectedPiece !== div) {
            updateStatsPanel(null);
            if (!selectedPiece) {
                hideUnitTooltip();
            }
        }
    });

    appendActivationCheckbox();
    appendMarker();
    appendRotationHandle(div);
    attachListeners(div);

    table.appendChild(div);
    fitUnitLabelText(div);
    return div;
}

function createTerrainDOM(subType, x, y, _w, _h, angle, metadata = {}) {
    if (!subType || subType === "undefined" || subType === "rough") subType = "field";
    const finalW = Number.isFinite(Number(_w)) && Number(_w) > 0 ? Number(_w) : defaultUnitSizePx.width;
    const finalH = Number.isFinite(Number(_h)) && Number(_h) > 0 ? Number(_h) : defaultUnitSizePx.height;

    const div = document.createElement('div');
    div.classList.add('piece', 'terrain', subType);
    div.innerText = subType.charAt(0).toUpperCase() + subType.slice(1);
    div.style.left = `${x}px`;
    div.style.top = `${y}px`;
    div.style.width = `${finalW}px`;
    div.style.height = `${finalH}px`;
    div.dataset.subType = subType;
    div.dataset.angle = angle || 0;
    div.dataset.pieceId = metadata.id || metadata.pieceId || '';
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
    if (rulesGame) {
        showRulesToast(conn
            ? 'Undo is disabled in network rules games so both players stay in sync.'
            : 'Use Sandbox mode for free-form undo.', 'info');
        return;
    }
    if (undoStack.length === 0) return;
    const previousState = undoStack.pop();
    restoreBoardState(previousState);
};

async function resetBoard(createUnits, shouldCreateTerrain = true, shouldSave = true) {
    rulesSessionGeneration += 1;
    cancelActiveInteraction();
    rulesGame = null;
    localStorage.removeItem(SAVE_KEY);

    table.querySelectorAll('.unit, .terrain, .ghost, .range-ring, .deployment-zone').forEach(p => p.remove());
    undoStack.length = 0;
    hoveredUnit = null;
    hoveredTerrain = null;
    activePiece = null;
    ghostPiece = null;
    activePointerId = null;
    pendingDragPiece = null;
    isDraggingPiece = false;
    measurementPointerId = null;
    clearPieceSelection();

    document.getElementById('cp1').value = 1;
    document.getElementById('cp2').value = 1;
    document.getElementById('dice-count').value = 2;
    normalizeDiceCount(false);
    bidVisibility = { p1: true, p2: true };
    rememberCpValues();
    updateBidUI();
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
    if (shouldSave) saveGame();
}

function createRulesSeed() {
    if (window.crypto && window.crypto.getRandomValues) {
        const value = new Uint32Array(1);
        window.crypto.getRandomValues(value);
        return value[0] || 1;
    }
    return (Date.now() >>> 0) || 1;
}

function createRulesMatchId() {
    if (window.crypto && window.crypto.getRandomValues) {
        const values = new Uint32Array(3);
        window.crypto.getRandomValues(values);
        return `match-${Array.from(values, value => value.toString(36)).join('-')}`;
    }
    return `match-${Date.now().toString(36)}`;
}

function collectSetupUnitsForRules() {
    return Array.from(table.querySelectorAll('.unit')).map((unit, index) => {
        const width = unit.offsetWidth / SCALE;
        const depth = unit.offsetHeight / SCALE;
        const left = (parseFloat(unit.style.left) || 0) / SCALE;
        const top = (parseFloat(unit.style.top) || 0) / SCALE;
        const id = unit.dataset.pieceId || `unit-${index + 1}`;
        unit.dataset.pieceId = id;
        return {
            id,
            name: unit.dataset.name,
            ownerId: null,
            owner: null,
            stats: unit._unitStats ? { ...unit._unitStats } : {},
            size: { width, depth },
            pose: {
                x: left + (width / 2),
                y: top + (depth / 2),
                angle: Number(unit.dataset.angle) || 0
            }
        };
    });
}

window.startRulesGame = async function () {
    if (rulesAutomationBusy || isResettingBoard) {
        showRulesToast('Wait for the current automatic step to finish.', 'info');
        return;
    }
    if (conn && !isHost) {
        showRulesToast('Only the host can start a new shared game.', 'warning');
        return;
    }
    if (!window.SeizeTheDayRules) {
        showRulesToast('The rules engine did not load. Refresh and try again.', 'warning');
        return;
    }

    isResettingBoard = true;
    cancelTerrainCardAnimation();
    try {
        document.getElementById('starting-pool-count').value = DEFAULT_DRAFT_POOL_SIZE;
        await resetBoard(() => createDefaultUnits({ rulesReadyOnly: true }), false, false);
        const units = collectSetupUnitsForRules();
        if (units.length !== DEFAULT_DRAFT_POOL_SIZE) {
            throw new Error(`A rules game needs ${DEFAULT_DRAFT_POOL_SIZE} complete unit profiles; ${units.length} are available.`);
        }

        const seed = createRulesSeed();
        rulesGame = SeizeTheDayRules.createGame({
            matchId: createRulesMatchId(),
            seed,
            units,
            table: {
                width: 48,
                height: 36,
                deploymentDepth: DEPLOY_INCHES,
                terrainSize: {
                    width: defaultUnitSizePx.width / SCALE,
                    height: defaultUnitSizePx.height / SCALE
                }
            }
        });
        latestRulesEventRevision = 0;
        rulesTransientTerrain = null;
        rulesRequestPending = false;
        renderRulesGame({ rebuildBoard: true, announceEvents: true });
    } catch (err) {
        console.error('Unable to start rules game:', err);
        rulesGame = null;
        showRulesToast(err.message || 'Unable to start the rules game.', 'warning');
    } finally {
        isResettingBoard = false;
    }
    renderRulesGuide();
    saveGame();
};

window.startSandboxGame = async function () {
    if (rulesAutomationBusy || isResettingBoard) {
        showRulesToast('Wait for the current automatic step to finish.', 'info');
        return;
    }
    if (conn && !isHost) {
        showRulesToast('Only the host can replace the shared battlefield.', 'warning');
        return;
    }
    isResettingBoard = true;
    try {
        cancelTerrainCardAnimation();
        terrainDeck = createShuffledTerrainDeck();
        renderTerrainCard();
        await resetBoard(createDefaultUnits, false);
        renderRulesGuide();
    } finally {
        isResettingBoard = false;
    }
    renderRulesGuide();
    saveGame();
};

window.resetGame = window.startRulesGame;

window.resetLongSideDeployment = async function () {
    if (rulesAutomationBusy || isResettingBoard) {
        showRulesToast('Wait for the current automatic step to finish.', 'info');
        return;
    }
    if (conn && !isHost) {
        showRulesToast('Only the host can replace the shared battlefield.', 'warning');
        return;
    }
    isResettingBoard = true;
    try {
        cancelTerrainCardAnimation();
        terrainDeck = [];
        renderTerrainCard();
        await resetBoard(createLongSideDeploymentUnits);
        renderRulesGuide();
    } finally {
        isResettingBoard = false;
    }
    renderRulesGuide();
    saveGame();
};

// --- DICE ---
let diceAnimationTimer = null;

function normalizeDiceCount(shouldSave = true) {
    const input = document.getElementById('dice-count');
    const parsed = parseInt(input.value, 10);
    const safeValue = Number.isFinite(parsed) ? Math.min(20, Math.max(1, parsed)) : 2;
    input.value = safeValue;
    if (shouldSave) saveGame();
    return safeValue;
}

function adjustDiceCount(delta) {
    const currentCount = normalizeDiceCount(false);
    document.getElementById('dice-count').value = currentCount + delta;
    normalizeDiceCount();
}

function normalizeStartingPoolCount(shouldSave = true) {
    const input = document.getElementById('starting-pool-count');
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
    if (rulesGame) {
        showRulesToast('Attack dice roll automatically when you choose a target.', 'info');
        return;
    }
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
        try {
            restoreBoardState(saved, true);
        } catch (err) {
            console.warn('The saved game is no longer valid and will be replaced:', err);
            localStorage.removeItem(SAVE_KEY);
            showRulesToast('The old saved game could not be resumed. Starting a fresh rules game.', 'warning', 4000);
            await window.startRulesGame();
        }
    } else {
        await window.startRulesGame();
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

    const match = `${rawValue}`.trim().replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    const parsedValue = match ? Number(match[0]) : NaN;
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

function isRulesReadyUnitStats(unitStats) {
    const name = unitStats && String(unitStats.Unit || '').trim();
    const speed = parseCombatStat(unitStats, ['Speed', 'Move']);
    const drill = parseCombatStat(unitStats, ['Drill']);
    const strike = parseCombatStat(unitStats, ['Melee', 'Strike']);
    const defence = parseCombatStat(unitStats, ['Def', 'Def.', 'Defence', 'Defense']);
    return Boolean(name && speed !== null && drill !== null && strike !== null
        && defence !== null && defence >= 1);
}

function createRandomUnitPool(count, options = {}) {
    const sourceRows = options.rulesReadyOnly
        ? availableUnitRows.filter(isRulesReadyUnitStats)
        : availableUnitRows;
    const remainingUnits = sourceRows.map(unitStats => ({
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

function createDefaultUnits(options = {}) {
    const draftPool = createRandomUnitPool(
        normalizeStartingPoolCount(false),
        { rulesReadyOnly: options.rulesReadyOnly === true }
    );
    if (draftPool.length === 0) {
        console.warn("No units were available in the spreadsheet, so no draft pool was created.");
        return;
    }

    const cols = Math.ceil(Math.sqrt(draftPool.length));
    const rows = Math.ceil(draftPool.length / cols);
    const unitSizes = draftPool.map(getUnitSizePx);
    const shortEdgeClearance = inchesToPx(2);
    // Leave a visible gap: draft cards may not even touch a deployment zone.
    const longEdgeClearance = inchesToPx(DEPLOY_INCHES + 0.5);
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
        ...Array(2).fill(TERRAIN_NO_FEATURE_CARD)
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
    if (!card || !title || !note) return;

    card.classList.remove(
        ...TERRAIN_TYPES.map(type => `terrain-card-${type}`),
        'terrain-card-x',
        'is-empty'
    );

    const pendingRulesTerrain = rulesGame && rulesGame.draft
        ? (rulesGame.draft.pendingTerrainType
            || rulesGame.draft.drawnTerrainType
            || (rulesGame.draft.pendingTerrain && (rulesGame.draft.pendingTerrain.type || rulesGame.draft.pendingTerrain.subType))
            || null)
        : null;
    const visibleRulesTop = rulesGame && rulesGame.draft
        ? rulesGame.draft.terrainDeck[0] || null
        : null;
    const isRulesPreview = Boolean(rulesGame && !pendingRulesTerrain && visibleRulesTop);
    const revealedCard = rulesGame ? (pendingRulesTerrain || visibleRulesTop) : terrainDeck[0];
    if (!revealedCard) {
        card.classList.add('is-empty');
        card.dataset.cardType = '';
        card.setAttribute('aria-disabled', 'true');
        if (rulesGame && rulesGame.draft && !rulesGame.draft.complete) {
            card.setAttribute('aria-label', 'Terrain deck empty.');
            title.textContent = 'Terrain Deck';
            note.textContent = 'No tile available';
        } else {
            card.setAttribute('aria-label', 'Terrain deck empty. Use Sandbox to create a new deck.');
            title.textContent = 'Deck Empty';
            note.textContent = 'Start a new game';
        }
        return;
    }

    const label = getTerrainCardLabel(revealedCard);
    card.classList.add(`terrain-card-${revealedCard}`);
    card.dataset.cardType = revealedCard;
    card.setAttribute('aria-disabled', String(isRulesPreview));
    card.setAttribute('aria-label', isRulesPreview
        ? `Top of terrain deck: ${label}. This visible tile will be taken after the next unit is chosen.`
        : revealedCard === TERRAIN_NO_FEATURE_CARD
            ? 'Revealed X card. It is discarded automatically.'
            : `Revealed ${label} card. Drag it onto the battlefield.`);
    title.textContent = label;
    note.textContent = isRulesPreview
        ? (revealedCard === TERRAIN_NO_FEATURE_CARD ? 'Next · open ground' : 'Next · choose a unit')
        : revealedCard === TERRAIN_NO_FEATURE_CARD
            ? 'Discarding automatically'
            : 'Drag onto battlefield';
}

function createDefaultTerrain() {
    const terrainTypes = ['forest', 'forest', 'hills', 'hills', 'field', 'field'];
    terrainTypes.forEach((type) => {
        const w = defaultUnitSizePx.width;
        const h = defaultUnitSizePx.height;
        const x = Math.random() * (tableWidthPx - w - 100) + 50;
        const y = Math.random() * (inchesToPx(26) - inchesToPx(10)) + inchesToPx(10);
        const angle = Math.floor(Math.random() * 360);
        createTerrainDOM(type, x, y, w, h, angle);
    });
}

function beginTerrainDrag(type, event, shouldPushUndo = true, rulesSize = null) {
    if (event && event.button !== 0) return;
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    clearPieceSelection();
    if (shouldPushUndo && !rulesGame) pushUndo();
    const w = rulesSize && rulesSize.width ? inchesToPx(rulesSize.width) : defaultUnitSizePx.width;
    const h = rulesSize && (rulesSize.height || rulesSize.depth)
        ? inchesToPx(rulesSize.height || rulesSize.depth)
        : defaultUnitSizePx.height;
    const div = createTerrainDOM(type, (tableWidthPx - w) / 2, (tableHeightPx - h) / 2, w, h, 0);
    if (rulesGame) {
        div.dataset.rulesTransient = 'true';
        rulesTransientTerrain = div;
    }
    activePiece = div;
    pendingDragPiece = null;
    ghostPiece = null;
    anchorX = -1;
    div.dataset.offsetX = w / 2;
    div.dataset.offsetY = h / 2;
    isDraggingPiece = true;
    activePointerId = event ? event.pointerId : null;
    if (event) {
        pointerStartX = event.clientX;
        pointerStartY = event.clientY;
    }
    suppressUnitTooltip(Number.MAX_SAFE_INTEGER);
    if (event && event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (!rulesGame) saveGame();
}

window.spawnTerrain = function (type, event) {
    beginTerrainDrag(type, event);
};

window.playTerrainCard = function (event) {
    if (activePointerId !== null || isTerrainCardAnimating) return;
    if (event && (event.button !== 0 || event.isPrimary === false)) return;
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (rulesGame) {
        const placeAction = getVisibleRulesActions().find(action => getActionType(action) === 'draft.placeTerrain');
        const card = document.getElementById('terrain-card');
        const revealedType = card && card.dataset.cardType;
        if (!placeAction || !revealedType || revealedType === TERRAIN_NO_FEATURE_CARD) {
            showRulesToast('Choose a unit first; the visible top tile is taken automatically.', 'info');
            return;
        }
        beginTerrainDrag(revealedType, event, false, placeAction.size || (placeAction.payload && placeAction.payload.size));
        return;
    }

    if (!terrainDeck.length) return;
    pushUndo();
    const revealedCard = terrainDeck.shift();
    animateTerrainCardAdvance();

    if (revealedCard === TERRAIN_NO_FEATURE_CARD) {
        saveGame();
        return;
    }

    beginTerrainDrag(revealedCard, event, false);
};

function attachListeners(element) {
    element.addEventListener('pointerdown', onPiecePointerDown);
    element.addEventListener('wheel', onWheel);
}

// --- KEYBOARD INPUT ---
function isEditableShortcutTarget(target) {
    if (!target) return false;
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

window.addEventListener('keydown', (e) => {
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
            if (rulesGame) {
                showRulesToast('Drag the selected unit’s rotation handle to make one complete pivot.', 'info');
                return;
            }
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
    if (rulesGame && !canRulesRotatePiece(piece)) {
        showRulesToast('That piece cannot pivot during this step.', 'warning');
        return;
    }

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
        if (!rulesGame) pushUndo();
        rotationDragUndoPushed = true;
    }

    setPieceAngle(rotatingPiece, nextAngle, nextAngle - rotationDragStartAngle);
}

function finishRotationDrag(shouldCommit = true) {
    if (!rotatingPiece) return false;

    const completedPiece = rotatingPiece;
    const completedAngle = parseFloat(completedPiece.dataset.angle) || 0;
    const completedDelta = completedAngle - rotationDragStartAngle;
    const didRotate = rotationDragUndoPushed;
    if (!shouldCommit) {
        completedPiece.dataset.angle = String(rotationDragStartAngle);
        completedPiece.style.transform = `rotate(${rotationDragStartAngle}deg)`;
    }
    suppressUnitTooltip();
    if (rotationDragUndoPushed && !rulesGame && shouldCommit) {
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

    if (rulesGame && didRotate && shouldCommit) {
        if (completedPiece.dataset.rulesTransient === 'true') {
            if (!updateRulesTerrainPreview(completedPiece)) snapRulesTerrainPiece(completedPiece, false);
            selectPiece(completedPiece);
            renderRulesGuide();
        } else {
            const pivotAction = getVisibleRulesActions().find(action => getActionType(action) === 'activation.pivot');
            if (pivotAction) {
            dispatchRulesAction({
                ...pivotAction,
                unitId: completedPiece.dataset.pieceId,
                angle: completedAngle,
                delta: completedDelta,
                degrees: completedDelta,
                payload: {
                    ...(pivotAction.payload || {}),
                    unitId: completedPiece.dataset.pieceId,
                    angle: completedAngle,
                    delta: completedDelta,
                    degrees: completedDelta
                }
            });
            }
        }
    } else if (rulesGame && !shouldCommit) {
        renderRulesGame({ rebuildBoard: true, announceEvents: false });
    }

    return true;
}

// --- DRAG LOGIC ---
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
    const pointer = getTablePointerPosition(e);
    pendingDragPiece.dataset.offsetX = pointer.x - (parseFloat(pendingDragPiece.style.left) || 0);
    pendingDragPiece.dataset.offsetY = pointer.y - (parseFloat(pendingDragPiece.style.top) || 0);

    if (pendingDragPiece.setPointerCapture) {
        pendingDragPiece.setPointerCapture(e.pointerId);
    }

    if (isTouchPointer(e)) {
        hideUnitTooltip();
    }
}

function startPieceDrag() {
    if (!pendingDragPiece) return;

    if (rulesGame && !canRulesDragPiece(pendingDragPiece)) {
        const inspectedPiece = pendingDragPiece;
        pendingDragPiece = null;
        selectPiece(inspectedPiece);
        showRulesToast(rulesMoveDirection
            ? 'Only the highlighted unit can move now.'
            : 'Choose a legal action before moving that piece.', 'info');
        return;
    }

    suppressUnitTooltip(Number.MAX_SAFE_INTEGER);
    if (!rulesGame) pushUndo();
    activePiece = pendingDragPiece;
    pendingDragPiece = null;
    isDraggingPiece = true;
    activePiece.classList.add('is-dragging');
    activePieceHalfWidth = activePiece.offsetWidth / 2;
    activePieceHalfHeight = activePiece.offsetHeight / 2;
    ghostPiece = activePiece.cloneNode(true);
    ghostPiece.classList.add('ghost');
    ghostPiece.classList.remove('is-selected');
    ghostPiece.removeAttribute('id');
    ghostPiece.style.transform = activePiece.style.transform;
    table.insertBefore(ghostPiece, activePiece);
    const rect = activePiece.getBoundingClientRect();
    const tableRect = getActiveTableRect();
    anchorX = ((rect.left - tableRect.left) + (rect.width / 2)) / currentScale;
    anchorY = ((rect.top - tableRect.top) + (rect.height / 2)) / currentScale;
    showLine(anchorX, anchorY, anchorX, anchorY);
    positionPieceControls();
}

function buildRulesDragAction(piece) {
    if (!rulesGame || !piece) return null;
    const actions = getVisibleRulesActions();
    const center = {
        x: ((parseFloat(piece.style.left) || 0) + (piece.offsetWidth / 2)) / SCALE,
        y: ((parseFloat(piece.style.top) || 0) + (piece.offsetHeight / 2)) / SCALE,
        angle: Number(piece.dataset.angle) || 0
    };

    if (piece.dataset.rulesTransient === 'true') {
        const template = actions.find(action => getActionType(action) === 'draft.placeTerrain');
        if (!template) return null;
        const terrainType = piece.dataset.subType;
        const size = { width: piece.offsetWidth / SCALE, height: piece.offsetHeight / SCALE };
        return {
            ...template,
            type: 'draft.placeTerrain',
            terrainType,
            subType: terrainType,
            pose: center,
            size,
            payload: { ...(template.payload || {}), terrainType, subType: terrainType, pose: center, size }
        };
    }

    const unitId = piece.dataset.pieceId;
    const deploy = actions.find(action => getActionType(action) === 'draft.deployUnit'
        && (!getRulesActionEntityId(action, 'unitId') || getRulesActionEntityId(action, 'unitId') === unitId));
    if (deploy) {
        return {
            ...deploy,
            type: 'draft.deployUnit',
            unitId,
            pose: center,
            destination: center,
            payload: { ...(deploy.payload || {}), unitId, pose: center, destination: center }
        };
    }

    const move = actions.find(action => {
        if (getActionType(action) !== 'activation.move') return false;
        const direction = action.direction || (action.payload && action.payload.direction);
        return !direction || direction === rulesMoveDirection;
    });
    if (move) {
        const unit = getRulesUnit(unitId);
        const startPose = readRulesPose(unit);
        const distance = Math.hypot(center.x - startPose.x, center.y - startPose.y);
        return {
            ...move,
            type: 'activation.move',
            unitId,
            direction: rulesMoveDirection,
            distance,
            pose: center,
            destination: center,
            to: center,
            payload: {
                ...(move.payload || {}),
                unitId,
                direction: rulesMoveDirection,
                distance,
                pose: center,
                destination: center,
                to: center
            }
        };
    }
    return null;
}

function getRulesPreviewResult(action) {
    if (!rulesGame || !action || !window.SeizeTheDayRules
        || typeof SeizeTheDayRules.validateAction !== 'function') return null;
    try {
        return SeizeTheDayRules.validateAction(rulesGame, {
            ...action,
            actorId: action.actorId || getConnectedRulesPlayer() || getRulesDecisionPlayer(),
            expectedRevision: rulesGame.revision
        });
    } catch (err) {
        return { ok: false, message: err.message };
    }
}

function getRulesAxes(angle) {
    const radians = (Number(angle) || 0) * Math.PI / 180;
    return {
        right: { x: Math.cos(radians), y: Math.sin(radians) },
        forward: { x: Math.sin(radians), y: -Math.cos(radians) }
    };
}

function getRulesProjectionRadius(size, angle, axis) {
    const axes = getRulesAxes(angle);
    const width = Number(size && (size.width ?? size.w)) || 0;
    const height = Number(size && (size.height ?? size.depth ?? size.h)) || 0;
    return (Math.abs((axes.right.x * axis.x) + (axes.right.y * axis.y)) * width / 2)
        + (Math.abs((axes.forward.x * axis.x) + (axes.forward.y * axis.y)) * height / 2);
}

function setRulesPiecePose(piece, pose) {
    if (!piece || !pose) return;
    piece.dataset.angle = String(pose.angle || 0);
    piece.style.left = `${inchesToPx(pose.x) - (piece.offsetWidth / 2)}px`;
    piece.style.top = `${inchesToPx(pose.y) - (piece.offsetHeight / 2)}px`;
    piece.style.transform = `rotate(${pose.angle || 0}deg)`;
}

function findRulesTerrainSnapPose(piece) {
    if (!piece || !rulesGame || !rulesGame.draft || !rulesGame.draft.selectedUnitId) return null;
    const selected = getRulesUnit(rulesGame.draft.selectedUnitId);
    const template = getVisibleRulesActions().find(action => getActionType(action) === 'draft.placeTerrain');
    if (!selected || !template) return null;
    const selectedPose = readRulesPose(selected);
    const selectedSize = selected.size || {};
    const terrainSize = {
        width: piece.offsetWidth / SCALE,
        height: piece.offsetHeight / SCALE
    };
    const desired = {
        x: ((parseFloat(piece.style.left) || 0) + (piece.offsetWidth / 2)) / SCALE,
        y: ((parseFloat(piece.style.top) || 0) + (piece.offsetHeight / 2)) / SCALE
    };
    const angle = Number(piece.dataset.angle) || 0;
    const selectedAxes = getRulesAxes(selectedPose.angle);
    const directions = [
        selectedAxes.right,
        { x: -selectedAxes.right.x, y: -selectedAxes.right.y },
        selectedAxes.forward,
        { x: -selectedAxes.forward.x, y: -selectedAxes.forward.y }
    ];
    const candidates = [];
    directions.forEach(normal => {
        const tangent = { x: -normal.y, y: normal.x };
        const separation = getRulesProjectionRadius(selectedSize, selectedPose.angle, normal)
            + getRulesProjectionRadius(terrainSize, angle, normal);
        const tangentReach = Math.max(0, getRulesProjectionRadius(selectedSize, selectedPose.angle, tangent)
            + getRulesProjectionRadius(terrainSize, angle, tangent) - 0.02);
        const desiredShift = ((desired.x - selectedPose.x) * tangent.x)
            + ((desired.y - selectedPose.y) * tangent.y);
        const clampedShift = Math.max(-tangentReach, Math.min(tangentReach, desiredShift));
        const shifts = [clampedShift, 0, -tangentReach, tangentReach, -tangentReach / 2, tangentReach / 2];
        shifts.forEach(shift => {
            const pose = {
                x: selectedPose.x + (normal.x * separation) + (tangent.x * shift),
                y: selectedPose.y + (normal.y * separation) + (tangent.y * shift),
                angle
            };
            const action = {
                ...template,
                pose,
                size: terrainSize,
                payload: { ...(template.payload || {}), pose, size: terrainSize }
            };
            const preview = getRulesPreviewResult(action);
            if (preview && preview.ok) {
                candidates.push({
                    pose,
                    distance: Math.hypot(pose.x - desired.x, pose.y - desired.y)
                });
            }
        });
    });
    candidates.sort((first, second) => first.distance - second.distance);
    return candidates.length ? candidates[0].pose : null;
}

function updateRulesTerrainPreview(piece) {
    if (!piece) return false;
    const preview = getRulesPreviewResult(buildRulesDragAction(piece));
    const valid = Boolean(preview && preview.ok);
    piece.classList.toggle('rules-placement-valid', valid);
    piece.classList.toggle('rules-placement-invalid', !valid);
    return valid;
}

function snapRulesTerrainPiece(piece, showFeedback = false) {
    const pose = findRulesTerrainSnapPose(piece);
    if (!pose) {
        updateRulesTerrainPreview(piece);
        if (showFeedback) showRulesToast('No legal touching position is available on that side. Move another terrain tile first.', 'warning');
        return false;
    }
    setRulesPiecePose(piece, pose);
    updateRulesTerrainPreview(piece);
    selectPiece(piece);
    renderRulesGuide();
    if (showFeedback) showRulesToast('Terrain snapped to the nearest legal touching position.', 'info');
    return true;
}

function stageRulesTerrainFromGuide(action) {
    if (!action || rulesTransientTerrain || activePointerId !== null) return;
    const type = action.terrainType || (action.payload && action.payload.terrainType)
        || (rulesGame && rulesGame.draft && rulesGame.draft.pendingTerrainType);
    beginTerrainDrag(type, null, false, action.size || (action.payload && action.payload.size));
    const staged = activePiece;
    activePiece = null;
    isDraggingPiece = false;
    activePieceHalfWidth = 0;
    activePieceHalfHeight = 0;
    rulesTransientTerrain = staged;
    snapRulesTerrainPiece(staged, false);
    selectPiece(staged);
    renderRulesGuide();
}

function stagePendingRulesTerrainIfNeeded() {
    if (!rulesGame || rulesTransientTerrain || activePointerId !== null) return;
    const action = getVisibleRulesActions().find(candidate => getActionType(candidate) === 'draft.placeTerrain');
    if (action) stageRulesTerrainFromGuide(action);
}

function rotateStagedRulesPiece(piece, degrees) {
    if (!piece || rulesAutomationBusy || rulesRequestPending) return;
    const nextAngle = normalizeAngle((Number(piece.dataset.angle) || 0) + degrees);
    piece.dataset.angle = String(nextAngle);
    piece.style.transform = `rotate(${nextAngle}deg)`;
    if (piece.dataset.rulesTransient === 'true' && !updateRulesTerrainPreview(piece)) {
        snapRulesTerrainPiece(piece, false);
    }
    selectPiece(piece);
    renderRulesGuide();
}

function cancelStagedRulesTerrain() {
    if (rulesTransientTerrain) rulesTransientTerrain.remove();
    if (selectedPiece === rulesTransientTerrain) clearPieceSelection();
    rulesTransientTerrain = null;
    renderRulesGuide();
    showRulesToast('Terrain placement cancelled. The revealed tile remains available.', 'info');
}

function confirmRulesTerrainPlacement() {
    const piece = rulesTransientTerrain;
    if (!piece || rulesAutomationBusy || rulesRequestPending) return;
    if (!updateRulesTerrainPreview(piece) && !snapRulesTerrainPiece(piece, false)) {
        const preview = getRulesPreviewResult(buildRulesDragAction(piece));
        showRulesToast((preview && preview.message) || 'Place the terrain touching the chosen unit without overlapping deployed units or terrain.', 'warning');
        return;
    }
    const action = buildRulesDragAction(piece);
    const preview = getRulesPreviewResult(action);
    if (!preview || !preview.ok) {
        showRulesToast((preview && preview.message) || 'That terrain placement is not legal.', 'warning');
        return;
    }
    clearPieceSelection();
    piece.remove();
    rulesTransientTerrain = null;
    dispatchRulesAction(action);
}

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
        if (rulesGame && activePiece.classList.contains('unit') && rulesMoveDirection) {
            const unit = getRulesUnit(activePiece.dataset.pieceId);
            const desiredCenterX = newLeft + activePieceHalfWidth;
            const desiredCenterY = newTop + activePieceHalfHeight;
            const projected = projectRulesMove(unit, desiredCenterX, desiredCenterY, rulesMoveDirection);
            newLeft = projected.centerX - activePieceHalfWidth;
            newTop = projected.centerY - activePieceHalfHeight;
        }
        activePiece.style.left = `${newLeft}px`;
        activePiece.style.top = `${newTop}px`;
        targetX = newLeft + activePieceHalfWidth;
        targetY = newTop + activePieceHalfHeight;
    }

    if (anchorX > -1) {
        lineElement.setAttribute('x2', targetX);
        lineElement.setAttribute('y2', targetY);
        const dx = targetX - anchorX;
        const dy = targetY - anchorY;
        const distancePx = Math.sqrt(dx * dx + dy * dy);
        measureTextElement.textContent = `${pxToInches(distancePx)}"`;
        measureTextElement.setAttribute('x', anchorX + (dx / 2) + 10);
        measureTextElement.setAttribute('y', anchorY + (dy / 2) - 10);
    }
}

function onPointerUp(e) {
    if (e.pointerId !== activePointerId) return;
    flushPendingPointerMove();

    if (rotatingPiece) {
        finishRotationDrag(e.type !== 'pointercancel');
        return;
    }

    if (pendingDragPiece && !isDraggingPiece && e.type !== 'pointercancel') {
        handlePieceTap(pendingDragPiece, e);
    }

    const completedRulesPiece = rulesGame && activePiece ? activePiece : null;
    const transientWasMoved = !completedRulesPiece
        || completedRulesPiece.dataset.rulesTransient !== 'true'
        || Math.hypot(e.clientX - pointerStartX, e.clientY - pointerStartY) >= DRAG_THRESHOLD_PX;
    const isTransientRulesPiece = completedRulesPiece
        && completedRulesPiece.dataset.rulesTransient === 'true';
    const completedRulesAction = completedRulesPiece && !isTransientRulesPiece
        && e.type !== 'pointercancel' && transientWasMoved
        ? buildRulesDragAction(completedRulesPiece)
        : null;
    if (activePiece) {
        activePiece.classList.remove('is-dragging');
        if (e.type === 'pointercancel' && ghostPiece && (!rulesGame || isTransientRulesPiece)) {
            activePiece.style.left = ghostPiece.style.left;
            activePiece.style.top = ghostPiece.style.top;
        } else if (!rulesGame) {
            saveGame();
        }
    }
    activePiece = null;
    pendingDragPiece = null;
    activePointerId = null;
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

    if (completedRulesPiece) {
        if (isTransientRulesPiece) {
            rulesTransientTerrain = completedRulesPiece;
            if (e.type !== 'pointercancel' && !updateRulesTerrainPreview(completedRulesPiece)) {
                snapRulesTerrainPiece(completedRulesPiece, false);
            }
            updateRulesTerrainPreview(completedRulesPiece);
            selectPiece(completedRulesPiece);
            renderRulesGuide();
            showRulesToast('Adjust or rotate the terrain, then choose Place Terrain.', 'info');
            return;
        }
        if (completedRulesAction) {
            rulesMoveDirection = null;
            dispatchRulesAction(completedRulesAction);
        } else {
            renderRulesGame({ rebuildBoard: true, announceEvents: false });
            showRulesToast('That placement is not available in this step.', 'warning');
        }
    }
}

function onWheel(e) {
    e.preventDefault(); e.stopPropagation();
    const piece = e.currentTarget;
    if (rulesGame) {
        showRulesToast('Drag the rotation handle to commit one pivot of up to 90°.', 'info');
        return;
    }
    rotatePiece(piece, e.deltaY > 0 ? 2 : -2);
}

window.addEventListener('pointermove', queuePointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

// --- RESPONSIVE TABLE SCALE & BOOTSTRAP ---
let currentScale = 1;
function fitTableToScreen() {
    const container = document.getElementById('table-container');
    const table = document.getElementById('game-table');
    if (!container || !table) return;

    const guide = document.getElementById('game-guide');
    const guideReserve = guide ? Math.ceil(guide.offsetTop + guide.offsetHeight + 10) : 0;
    container.style.paddingTop = `${guideReserve}px`;
    const availableWidth = Math.max(container.clientWidth - 20, 1);
    const availableHeight = Math.max(container.clientHeight - guideReserve - 20, 1);
    const tableWidth = tableWidthPx;
    const tableHeight = tableHeightPx;

    const scaleX = availableWidth / tableWidth;
    const scaleY = availableHeight / tableHeight;

    // Use a unified scale so the battlefield fills the available space
    // without distorting unit or terrain proportions.
    currentScale = Math.max(Math.min(scaleX, scaleY), 0.01);

    table.style.transform = `scale(${currentScale})`;
}

window.addEventListener('resize', fitTableToScreen);

if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitAllUnitLabels).catch(err => {
        console.warn('Unable to refit unit labels after font load:', err);
    });
}

const originalRestoreBoardState = restoreBoardState;
restoreBoardState = function (jsonString, suppressBroadcast = false) {
    originalRestoreBoardState(jsonString, suppressBroadcast);
    fitTableToScreen();
    fitAllUnitLabels();
};

loadUIState();
updateMultiplayerPanelUI();
updateMultiplayerControlsUI();
updateFullscreenUI();
updateRightSidebarUI();
updateBidUI();
renderTerrainCard();

const originalInitGame = initGame;
initGame = async function () {
    await originalInitGame();
    updateBidUI();
    fitTableToScreen();
    fitAllUnitLabels();
    // Second call to ensure layout is settled
    setTimeout(() => {
        fitTableToScreen();
        fitAllUnitLabels();
    }, 100);
};

initGame();
