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
const DEPLOY_INCHES = 6;
const TERRAIN_DEFAULT_W = 6;
const TERRAIN_DEFAULT_H = 4;
const THREAT_RANGE_INCHES = 12;
const SAVE_KEY = 'wargameSave_v6';
const UI_STATE_KEY = 'wargameUiState_v1';
const TOOLTIP_HOVER_DELAY_MS = 350;
const TOOLTIP_SUPPRESS_AFTER_MANIPULATION_MS = 300;
const DRAG_THRESHOLD_PX = 8;
const TOUCH_ROTATION_STEP_DEG = 5;

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
let undoStack = [];
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
    setModalVisibility('rulebook-modal', true);
}

function closeRulebook() {
    setModalVisibility('rulebook-modal', false);
}

function openControlsHelp() {
    closeRulebook();
    setModalVisibility('controls-modal', true);
}

function closeControlsHelp() {
    setModalVisibility('controls-modal', false);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeRulebook();
        closeControlsHelp();
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
                            <span class="stat-value">${getStatValue(stats, 'Move')}/${getStatValue(stats, 'Drill')}</span>
                        </div>
                        <div class="stat-chip">
                            <img class="stat-icon" src="icons/shoot.svg" alt="Shoot">
                            <span class="stat-value">${getStatValue(stats, 'Shoot')}</span>
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
    suppressUnitTooltip();
    pushUndo();
    const previousAngle = parseFloat(piece.dataset.angle) || 0;
    setPieceAngle(piece, previousAngle + delta);
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
    let result = '';
    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function hostGame() {
    if (peer) return;
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
        conn = c;
        setupConnection();
        setTimeout(() => sendData({ type: 'SYNC_BOARD', payload: getBoardState({ forNetwork: true }) }), 500);
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
    conn.on('open', () => {
        updateStatus("Connected!");
        document.getElementById('status-indicator').classList.add('status-connected');
        updateBidUI();
    });
    conn.on('data', (data) => {
        handleIncomingData(data);
    });
    conn.on('close', () => {
        updateStatus("Disconnected");
        document.getElementById('status-indicator').classList.remove('status-connected');
        conn = null;
        isHost = false;
        updateMultiplayerControlsUI();
        updateBidUI();
    });
}

function handleIncomingData(data) {
    if (data.type === 'SYNC_BOARD') {
        restoreBoardState(data.payload, true);
    }
    else if (data.type === 'ROLL_DICE') {
        const incomingRolls = Array.isArray(data.rolls) ? data.rolls : [];
        renderDiceRoll(incomingRolls.length ? incomingRolls : createPlaceholderRoll(data.count || 2));
    }
    else if (data.type === 'BID_VISIBILITY') {
        bidVisibility = getNormalizedBidVisibility({
            ...bidVisibility,
            [data.player]: data.visible !== false
        });
        updateBidUI();
    }
    else if (data.type === 'TOGGLE_BIDS') {
        const legacyVisible = data.payload !== true;
        bidVisibility = { p1: legacyVisible, p2: legacyVisible };
        updateBidUI();
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
        pieces: [],
        cp1: document.getElementById('cp1').value,
        cp2: document.getElementById('cp2').value,
        diceCount: document.getElementById('dice-count').value,
        startingPoolCount: document.getElementById('starting-pool-count').value,
        bidVisibility: getNormalizedBidVisibility()
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
            name: el.dataset.name,
            x: parseFloat(el.style.left),
            y: parseFloat(el.style.top),
            angle: el.dataset.angle,
            wounds: el.dataset.wounds,
            activated: el.dataset.activated === 'true',
            color: el.style.backgroundColor,
            stats: el._unitStats || null
        });
    });
    document.querySelectorAll('.terrain').forEach(el => {
        state.pieces.push({
            type: 'terrain',
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
    table.querySelectorAll('.unit, .terrain, .ghost, .range-ring').forEach(p => p.remove());

    const state = JSON.parse(jsonString);
    const data = Array.isArray(state) ? state : state.pieces;

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
            createUnitDOM(obj.name, obj.color, obj.x, obj.y, obj.angle, obj.wounds, obj.stats, obj.activated);
        } else if (obj.type === 'terrain') {
            createTerrainDOM(obj.subType, obj.x, obj.y, obj.w, obj.h, obj.angle);
        }
    });
    saveGame(suppressBroadcast);
}

function saveGame(suppressBroadcast = false) {
    rememberCpValues();
    const state = getBoardState();
    localStorage.setItem(SAVE_KEY, state);
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

function createUnitDOM(name, color, x, y, angle, wounds, stats = null, activated = false) {
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
    div.innerText = name;
    div.dataset.name = name;
    div.dataset.angle = angle || 0;
    div.dataset.footprint = unitSize.footprint;
    div.style.transform = `rotate(${angle}deg)`;
    div.dataset.wounds = wounds || 0;
    div.dataset.activated = activated ? 'true' : 'false';
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
    return div;
}

function createTerrainDOM(subType, x, y, w, h, angle) {
    if (!subType || subType === "undefined") subType = "rough";
    const finalW = w || inchesToPx(TERRAIN_DEFAULT_W);
    const finalH = h || inchesToPx(TERRAIN_DEFAULT_H);

    const div = document.createElement('div');
    div.classList.add('piece', 'terrain', subType);
    div.innerText = subType.charAt(0).toUpperCase() + subType.slice(1);
    div.style.left = `${x}px`;
    div.style.top = `${y}px`;
    div.style.width = `${finalW}px`;
    div.style.height = `${finalH}px`;
    div.dataset.subType = subType;
    div.dataset.angle = angle || 0;
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

async function resetBoard(createUnits) {
    localStorage.removeItem(SAVE_KEY);

    table.querySelectorAll('.unit, .terrain, .ghost, .range-ring').forEach(p => p.remove());
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
    createDefaultTerrain();
    saveGame();
}

window.resetGame = async function () {
    await resetBoard(createDefaultUnits);
};

window.resetLongSideDeployment = async function () {
    await resetBoard(createLongSideDeploymentUnits);
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

    const cols = Math.min(4, Math.max(1, draftPool.length));
    const rows = Math.ceil(draftPool.length / cols);
    const padding = 20; // Space between units

    const unitSizes = draftPool.map(getUnitSizePx);
    const colWidths = Array.from({ length: cols }, (_, col) =>
        Math.max(...unitSizes.filter((_, i) => i % cols === col).map(size => size.width), 0)
    );
    const rowHeights = Array.from({ length: rows }, (_, row) =>
        Math.max(...unitSizes.filter((_, i) => Math.floor(i / cols) === row).map(size => size.height), 0)
    );

    // Calculate total grid dimensions to center mixed footprint units.
    const gridWidth = colWidths.reduce((total, width) => total + width, 0) + ((cols - 1) * padding);
    const gridHeight = rowHeights.reduce((total, height) => total + height, 0) + ((rows - 1) * padding);

    const startX = (tableWidthPx - gridWidth) / 2;
    const startY = (tableHeightPx - gridHeight) / 2;
    const colOffsets = colWidths.map((_, col) =>
        colWidths.slice(0, col).reduce((total, width) => total + width + padding, 0)
    );
    const rowOffsets = rowHeights.map((_, row) =>
        rowHeights.slice(0, row).reduce((total, height) => total + height + padding, 0)
    );

    draftPool.forEach((unitStats, i) => {
        const name = unitStats.Unit;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const unitSize = unitSizes[i];

        const x = startX + colOffsets[col] + ((colWidths[col] - unitSize.width) / 2);
        const y = startY + rowOffsets[row] + ((rowHeights[row] - unitSize.height) / 2);

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
function createDefaultTerrain() {
    const terrainTypes = ['forest', 'forest', 'hills', 'hills', 'rough', 'rough'];
    terrainTypes.forEach((type) => {
        const w = inchesToPx(TERRAIN_DEFAULT_W);
        const h = inchesToPx(TERRAIN_DEFAULT_H);
        const x = Math.random() * (tableWidthPx - w - 100) + 50;
        const y = Math.random() * (inchesToPx(26) - inchesToPx(10)) + inchesToPx(10);
        const angle = Math.floor(Math.random() * 360);
        createTerrainDOM(type, x, y, w, h, angle);
    });
}

window.spawnTerrain = function (type, event) {
    if (event && event.button !== 0) return;
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    clearPieceSelection();
    pushUndo();
    const w = inchesToPx(TERRAIN_DEFAULT_W);
    const h = inchesToPx(TERRAIN_DEFAULT_H);
    const div = createTerrainDOM(type, (tableWidthPx - w) / 2, (tableHeightPx - h) / 2, w, h, 0);
    activePiece = div;
    pendingDragPiece = null;
    ghostPiece = null;
    anchorX = -1;
    div.dataset.offsetX = w / 2;
    div.dataset.offsetY = h / 2;
    isDraggingPiece = true;
    activePointerId = event ? event.pointerId : null;
    suppressUnitTooltip(Number.MAX_SAFE_INTEGER);
    if (event && event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    saveGame();
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
            const step = e.shiftKey ? 1 : 2;
            rotatePiece(target, e.key === 'ArrowRight' ? step : -step);
            return;
        }
    }

    if (!isPlus && !isMinus) return;

    if (hoveredUnit) {
        adjustUnitWounds(hoveredUnit, isPlus ? 1 : -1);
    }
    else if (hoveredTerrain) {
        pushUndo();
        let w = parseFloat(hoveredTerrain.style.width);
        let h = parseFloat(hoveredTerrain.style.height);
        const factor = isPlus ? 1.1 : 0.9;
        hoveredTerrain.style.width = `${w * factor}px`;
        hoveredTerrain.style.height = `${h * factor}px`;
        saveGame();
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
        pushUndo();
        rotationDragUndoPushed = true;
    }

    setPieceAngle(rotatingPiece, nextAngle, nextAngle - rotationDragStartAngle);
}

function finishRotationDrag() {
    if (!rotatingPiece) return false;

    suppressUnitTooltip();
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
    const rect = pendingDragPiece.getBoundingClientRect();
    pendingDragPiece.dataset.offsetX = (e.clientX - rect.left) / currentScale;
    pendingDragPiece.dataset.offsetY = (e.clientY - rect.top) / currentScale;

    if (pendingDragPiece.setPointerCapture) {
        pendingDragPiece.setPointerCapture(e.pointerId);
    }

    if (isTouchPointer(e)) {
        hideUnitTooltip();
    }
}

function startPieceDrag() {
    if (!pendingDragPiece) return;

    suppressUnitTooltip(Number.MAX_SAFE_INTEGER);
    pushUndo();
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
        const newLeft = pointer.x - offX;
        const newTop = pointer.y - offY;
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
        finishRotationDrag();
        return;
    }

    if (pendingDragPiece && !isDraggingPiece && e.type !== 'pointercancel') {
        handlePieceTap(pendingDragPiece, e);
    }

    if (activePiece) {
        activePiece.classList.remove('is-dragging');
        saveGame();
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
function fitTableToScreen() {
    const container = document.getElementById('table-container');
    const table = document.getElementById('game-table');
    if (!container || !table) return;

    const availableWidth = Math.max(container.clientWidth - 20, 1);
    const availableHeight = Math.max(container.clientHeight - 20, 1);
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

const originalRestoreBoardState = restoreBoardState;
restoreBoardState = function (jsonString, suppressBroadcast = false) {
    originalRestoreBoardState(jsonString, suppressBroadcast);
    fitTableToScreen();
};

loadUIState();
updateMultiplayerPanelUI();
updateMultiplayerControlsUI();
updateFullscreenUI();
updateRightSidebarUI();
updateBidUI();

const originalInitGame = initGame;
initGame = async function () {
    await originalInitGame();
    updateBidUI();
    fitTableToScreen();
    // Second call to ensure layout is settled
    setTimeout(fitTableToScreen, 100);
};

initGame();
