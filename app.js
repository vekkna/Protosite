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
const TOUCH_ROTATION_STEP_DEG = 5;
const UNIT_LABEL_MAX_FONT_PX = 10.5;
const UNIT_LABEL_MIN_FONT_PX = 4.5;
const UNIT_LABEL_FONT_STEP_PX = 0.25;

// --- CONVERSIONS ---
const mmToInches = (mm) => mm / 25.4;
const inchesToPx = (inch) => inch * SCALE;
const pxToInches = (px) => (px / SCALE).toFixed(1);

// --- UI STATE & SHELL CONTROLS ---
let bidVisibility = {
    p1: false,
    p2: false
};
let bidsSet = {
    p1: false,
    p2: false
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
    if (isHost) return 'p1';
    if (isGuest) return 'p2';
    if (conn) return isHost ? 'p1' : 'p2';
    return null;
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

function toggleSetBid(playerKey) {
    if (bidsSet[playerKey]) {
        editBid(playerKey);
    } else {
        setBid(playerKey);
    }
}

function setBid(playerKey) {
    const input = getBidInput(playerKey);
    if (!input) return;
    let val = parseInt(input.value, 10);
    if (isNaN(val) || val < 1) val = 1;
    input.value = val;
    bidsSet[playerKey] = true;
    rememberCpValue(playerKey);

    const localKey = getLocalBidPlayerKey();
    if (localKey && localKey === playerKey) {
        sendData({
            type: 'BID_SET',
            player: playerKey,
            isSet: true,
            bid: String(val)
        });
    }
    updateBidUI();
    saveGame();
}

function editBid(playerKey) {
    bidsSet[playerKey] = false;

    const localKey = getLocalBidPlayerKey();
    if (localKey && localKey === playerKey) {
        sendData({
            type: 'BID_SET',
            player: playerKey,
            isSet: false
        });
    }
    updateBidUI();
    saveGame();
}

function triggerRevealBids() {
    if (!bidsSet.p1 || !bidsSet.p2) return;
    revealBids();
}

function revealBids() {
    bidsSet.p1 = true;
    bidsSet.p2 = true;
    bidVisibility.p1 = true;
    bidVisibility.p2 = true;
    const localKey = getLocalBidPlayerKey();
    if (localKey) {
        sendData({
            type: 'REVEAL_BIDS',
            player: localKey,
            bid: getBidInput(localKey) ? getBidInput(localKey).value : null
        });
    }
    updateBidUI();
    updateTerrainSectionVisibility();
    saveGame();
}

function updateBidUI() {
    bidVisibility = getNormalizedBidVisibility();

    const btn = document.getElementById('toggle-bids-btn');
    const localPlayerKey = getLocalBidPlayerKey();
    const isMultiplayer = Boolean(localPlayerKey);
    const areBothRevealed = Boolean(bidVisibility.p1 && bidVisibility.p2);
    const areBothSet = Boolean(bidsSet.p1 && bidsSet.p2);
    const opponentStatusEl = document.getElementById('opponent-status');

    if (opponentStatusEl) {
        if (conn && conn.open) {
            opponentStatusEl.textContent = '● Opponent Connected';
            opponentStatusEl.className = 'opponent-status connected';
        } else if (isHost) {
            opponentStatusEl.textContent = '○ Waiting for Opponent';
            opponentStatusEl.className = 'opponent-status connecting';
        } else if (isGuest || (peer && !conn)) {
            opponentStatusEl.textContent = '○ Connecting...';
            opponentStatusEl.className = 'opponent-status connecting';
        } else {
            opponentStatusEl.textContent = '○ Local Game';
            opponentStatusEl.className = 'opponent-status offline';
        }
    }

    const labelP1 = document.getElementById('label-p1');
    const labelP2 = document.getElementById('label-p2');
    if (labelP1 && labelP2) {
        if (isMultiplayer) {
            labelP1.textContent = isHost ? 'P1 CP (You)' : 'P1 CP (Opponent)';
            labelP2.textContent = isHost ? 'P2 CP (Opponent)' : 'P2 CP (You)';
        } else {
            labelP1.textContent = 'P1 CP';
            labelP2.textContent = 'P2 CP';
        }
    }

    ['p1', 'p2'].forEach(playerKey => {
        const input = getBidInput(playerKey);
        const field = document.querySelector(`[data-bid-player="${playerKey}"]`);
        const setBtn = document.getElementById(`btn-set-${playerKey}`);
        const subtextEl = document.getElementById(`subtext-${playerKey}`);
        if (!input || !field) return;

        const isOwnBid = playerKey === localPlayerKey;
        const isVisible = bidVisibility[playerKey];
        const isSet = Boolean(bidsSet[playerKey]);

        let isHiddenFromViewer;
        if (isMultiplayer) {
            isHiddenFromViewer = !isVisible && !isOwnBid;
        } else {
            isHiddenFromViewer = !areBothRevealed && isSet;
        }
        const isPrivateToViewer = isMultiplayer && isOwnBid && !isVisible;

        field.classList.toggle('bid-hidden', isHiddenFromViewer);
        field.classList.toggle('bid-private', isPrivateToViewer);
        input.readOnly = (isMultiplayer && !isOwnBid) || isSet || areBothRevealed || ['commands', 'complete'].includes(roundState.phase);
        input.setAttribute('aria-label', `${playerKey === 'p1' ? 'Player 1' : 'Player 2'} command point bid${isHiddenFromViewer ? ' hidden' : ''}`);

        if (setBtn) {
            if (areBothRevealed || ['commands', 'complete'].includes(roundState.phase)) {
                setBtn.style.display = 'none';
            } else if (isMultiplayer && !isOwnBid) {
                setBtn.style.display = 'none';
            } else {
                setBtn.style.display = '';
                setBtn.textContent = isSet ? 'Edit' : 'Set';
                setBtn.className = isSet ? 'btn-grey btn-sm bid-set-btn' : 'btn-blue btn-sm bid-set-btn';
                setBtn.title = isSet ? 'Edit your bid' : 'Lock in your bid';
            }
        }

        if (subtextEl) {
            if (isMultiplayer) {
                if (isOwnBid) {
                    if (areBothRevealed) {
                        subtextEl.textContent = 'Revealed';
                        subtextEl.className = 'bid-subtext';
                    } else if (isSet) {
                        subtextEl.textContent = 'Bid Set ✓';
                        subtextEl.className = 'bid-subtext is-set';
                    } else {
                        subtextEl.textContent = 'Hidden from Opponent';
                        subtextEl.className = 'bid-subtext highlight';
                    }
                } else {
                    if (areBothRevealed) {
                        subtextEl.textContent = 'Revealed';
                        subtextEl.className = 'bid-subtext';
                    } else if (isSet) {
                        subtextEl.textContent = 'Opponent Ready ✓';
                        subtextEl.className = 'bid-subtext is-set';
                    } else {
                        subtextEl.textContent = 'Opponent Deciding...';
                        subtextEl.className = 'bid-subtext highlight';
                    }
                }
            } else {
                if (areBothRevealed) {
                    subtextEl.textContent = 'Revealed';
                    subtextEl.className = 'bid-subtext';
                } else if (isSet) {
                    subtextEl.textContent = 'Bid Set ✓';
                    subtextEl.className = 'bid-subtext is-set';
                } else {
                    subtextEl.textContent = 'Not Set';
                    subtextEl.className = 'bid-subtext highlight';
                }
            }
        }
    });

    updateTerrainSectionVisibility();
    updatePlayerBanner();

    if (!btn) return;

    if (areBothRevealed) {
        btn.disabled = false;
        btn.className = 'btn-grey';
        btn.innerText = 'Bids Revealed';
        btn.title = 'Bids have been revealed for this round';
        btn.setAttribute('aria-pressed', 'true');
    } else {
        btn.innerText = 'Reveal Bids';
        btn.setAttribute('aria-pressed', 'false');
        if (areBothSet) {
            btn.disabled = false;
            btn.className = 'btn-gold';
            btn.title = 'Both bids are set. Click to reveal bids!';
        } else {
            btn.disabled = true;
            btn.className = 'btn-grey';
            btn.title = 'Both players must set bids before revealing';
        }
    }
}

function toggleBidVisibility() {
    if (bidVisibility.p1 && bidVisibility.p2) {
        bidVisibility = { p1: false, p2: false };
        bidsSet = { p1: false, p2: false };
    } else {
        bidsSet = { p1: true, p2: true };
        bidVisibility = { p1: true, p2: true };
    }
    const localPlayerKey = getLocalBidPlayerKey();

    if (localPlayerKey) {
        sendData({
            type: 'BID_VISIBILITY',
            player: localPlayerKey,
            visible: bidVisibility[localPlayerKey],
            bid: bidVisibility[localPlayerKey] ? getBidInput(localPlayerKey).value : null
        });
    }

    updateBidUI();
    updateTerrainSectionVisibility();
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

    if (['commands', 'complete'].includes(roundState.phase)) {
        getBidInput(playerKey).value = roundState.bids[playerKey];
        return;
    }
    if (bidsSet[playerKey]) {
        bidsSet[playerKey] = false;
    }
    rememberCpValue(playerKey);
    saveGame();
    if (localPlayerKey && bidVisibility[localPlayerKey]) {
        sendData({
            type: 'BID_VISIBILITY',
            player: localPlayerKey,
            visible: true,
            bid: getBidInput(localPlayerKey).value
        });
    }
    updateBidUI();
}

function updateRightSidebarUI() {
    const rightSidebar = document.getElementById('right-sidebar');
    const toggleBtn = document.getElementById('right-sidebar-toggle');
    if (!rightSidebar || !toggleBtn) return;

    rightSidebar.classList.toggle('sidebar-hidden', isRightSidebarHidden);
    const span = toggleBtn.querySelector('span');
    if (span) span.innerText = isRightSidebarHidden ? '<' : '>';
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

    const root = document.documentElement || {};
    const supported = Boolean(root.requestFullscreen || root.webkitRequestFullscreen);
    const isFullscreen = Boolean(getFullscreenElement());
    button.disabled = !supported;
    button.innerText = isFullscreen ? 'Exit Full Screen' : 'Full Screen';
    button.title = supported
        ? (isFullscreen ? 'Exit full screen' : 'Open game in full screen')
        : 'Full screen is unavailable in this browser';
}

async function toggleFullscreen() {
    const root = document.documentElement || {};
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
    const explicitFootprint = (stats && stats.Footprint ? `${stats.Footprint}`.trim().toUpperCase() : '');
    if (explicitFootprint && UNIT_FOOTPRINTS_MM[explicitFootprint]) {
        return explicitFootprint;
    }
    const name = ((stats && (stats.Unit || stats.name)) || "").toLowerCase();
    if (name.includes('cavalry') || name.includes('mounted')) {
        return 'SN';
    }
    return DEFAULT_UNIT_FOOTPRINT;
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
let isGuest = false;
let currentRoomCode = '';
let isRoomCodeHidden = false;
let hasRevealedFirstBids = false;
const ACTIVE_GAMES_KEY = 'seize_the_day_active_games_v1';
const getGameSaveKey = (roomCode) => 'seize_the_day_save_' + (roomCode || '').toUpperCase();

function isBoardFlipped() {
    return Boolean(isGuest || (conn && !isHost));
}

let lastPieceMoveSendTime = 0;
let pendingPieceMoveData = null;
let pieceMoveBroadcastTimer = null;
let remoteGhostPiece = null;
let remoteAngleIndicatorTimer = null;
let lastPieceRotateSendTime = 0;
let pendingPieceRotateData = null;
let pieceRotateBroadcastTimer = null;

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

    if (isBoardFlipped()) {
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
let terrainDeck = [];
let roundState = CommandTracker.create();
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
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1ONrDG-NfkjDlBoJvRlDNbhBSsCUkxlD_tbmZNQom1PU/export?format=csv&gid=0';
const STATS_CACHE_KEY = 'seize-the-day-unit-stats-cache-v3';
const DEFAULT_DRAFT_POOL_SIZE = 12;

const DEFAULT_UNIT_STATS = [
    { Unit: 'Human Swords', Move: '8/2', Shoot: '-', Strike: '3', Defence: '8' },
    { Unit: 'Human Spears', Move: '8/1', Shoot: '-', Strike: '2', Defence: '8' },
    { Unit: 'Human Cavalry', Move: '12/2', Shoot: '-', Strike: '3', Defence: '8' },
    { Unit: 'Human Mounted Bowmen', Move: '12/3', Shoot: '0/12', Strike: '1', Defence: '7' },
    { Unit: 'Human Archers', Move: '8/1', Shoot: '1/16', Strike: '0', Defence: '7' },
    { Unit: 'Human Light Foot', Move: '8/3', Shoot: '0/6', Strike: '1', Defence: '7' },
    { Unit: 'Elf Swords', Move: '10/3', Shoot: '-', Strike: '4', Defence: '6' },
    { Unit: 'Elf Spears', Move: '10/2', Shoot: '-', Strike: '3', Defence: '6' },
    { Unit: 'Elf Cavalry', Move: '16/3', Shoot: '-', Strike: '4', Defence: '6' },
    { Unit: 'Elf Mounted Bowmen', Move: '16/4', Shoot: '1/14', Strike: '1', Defence: '5' },
    { Unit: 'Elf Archers', Move: '10/2', Shoot: '2/18', Strike: '0', Defence: '5' },
    { Unit: 'Elf Light Foot', Move: '10/4', Shoot: '1/8', Strike: '1', Defence: '5' },
    { Unit: 'Dwarf Swords', Move: '5/3', Shoot: '-', Strike: '4', Defence: '14' },
    { Unit: 'Dwarf Spears', Move: '5/2', Shoot: '-', Strike: '3', Defence: '15' },
    { Unit: 'Dwarf Cavalry', Move: '7/3', Shoot: '-', Strike: '4', Defence: '14' },
    { Unit: 'Dwarf Mounted Bowmen', Move: '7/4', Shoot: '0/12', Strike: '1', Defence: '13' },
    { Unit: 'Dwarf Archers', Move: '5/2', Shoot: '1/16', Strike: '0', Defence: '13' },
    { Unit: 'Dwarf Light Foot', Move: '5/4', Shoot: '0/6', Strike: '2', Defence: '13' },
    { Unit: 'Orc Swords', Move: '8/1', Shoot: '-', Strike: '4', Defence: '7' },
    { Unit: 'Orc Spears', Move: '8/1', Shoot: '-', Strike: '1', Defence: '7' },
    { Unit: 'Orc Cavalry', Move: '12/1', Shoot: '-', Strike: '4', Defence: '7' },
    { Unit: 'Orc Mounted Bowmen', Move: '12/2', Shoot: '0/12', Strike: '2', Defence: '6' },
    { Unit: 'Orc Archers', Move: '8/1', Shoot: '1/16', Strike: '1', Defence: '6' },
    { Unit: 'Orc Light Foot', Move: '8/2', Shoot: '0/6', Strike: '3', Defence: '6' },
    { Unit: 'Undead Swords', Move: '7/1', Shoot: '-', Strike: '3', Defence: '4' },
    { Unit: 'Undead Spears', Move: '7/1', Shoot: '-', Strike: '2', Defence: '4' },
    { Unit: 'Undead Cavalry', Move: '10/1', Shoot: '-', Strike: '3', Defence: '4' },
    { Unit: 'Undead Mounted Bowmen', Move: '10/2', Shoot: '0/12', Strike: '3', Defence: '3' },
    { Unit: 'Undead Archers', Move: '7/1', Shoot: '0/16', Strike: '2', Defence: '3' },
    { Unit: 'Undead Light Foot', Move: '7/2', Shoot: '0/16', Strike: '2', Defence: '3' }
];

let unitStatsDB = {};
let availableUnitRows = [];
let statsLoadPromise = null;

// Initialize default stats immediately
setStatsData(DEFAULT_UNIT_STATS, false);

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
    if (!forceRefresh && availableUnitRows.length > 0 && availableUnitRows !== DEFAULT_UNIT_STATS) {
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

                console.warn("Using default unit stats after load error:", err);
                setStatsData(DEFAULT_UNIT_STATS, false);
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

    const matchedStats = storedStats
        ? normalizeStatsRow(storedStats)
        : (unitStatsDB[unitName] || Object.values(unitStatsDB).find(s => (s.Unit || '').toLowerCase() === unitName.toLowerCase()) || null);

    return {
        unitName,
        stats: matchedStats
    };
}

function getStatValue(stats, ...keys) {
    if (!stats) return '-';
    for (const key of keys) {
        const val = stats[key];
        if (val !== undefined && val !== null && `${val}`.trim() !== '') {
            return `${val}`.trim();
        }
    }
    const lowerEntries = Object.entries(stats).map(([k, v]) => [typeof k === 'string' ? k.toLowerCase() : k, v]);
    for (const key of keys) {
        const lowerKey = typeof key === 'string' ? key.toLowerCase() : key;
        const match = lowerEntries.find(([k]) => k === lowerKey);
        if (match && match[1] !== undefined && match[1] !== null && `${match[1]}`.trim() !== '') {
            return `${match[1]}`.trim();
        }
    }
    return '-';
}

function formatSpeedDrillStat(stats) {
    if (!stats) return '-';
    const move = getStatValue(stats, 'Move');
    if (typeof move === 'string' && move.includes('/')) {
        return move.trim();
    }

    const speed = getStatValue(stats, 'Speed', 'Move');
    const drill = getStatValue(stats, 'Drill');

    if (speed !== '-' && drill !== '-') {
        return `${speed}/${drill}`;
    }
    if (speed !== '-') {
        return `${speed}`;
    }
    return '-';
}

function formatShootRangeStat(stats) {
    if (!stats) return '-';
    const shoot = getStatValue(stats, 'Shoot', 'Ranged');
    if (typeof shoot === 'string' && shoot.includes('/')) {
        return shoot.trim();
    }

    if (shoot === '-' || shoot === '') {
        return '-';
    }

    const range = getStatValue(stats, 'Range');
    if (shoot !== '-' && range !== '-') {
        return `${shoot}/${range}`;
    }
    if (shoot !== '-') {
        return `${shoot}`;
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
                        <div class="stat-chip" title="Speed / Drill">
                            <img class="stat-icon" src="icons/move.svg" alt="Speed / Drill">
                            <span class="stat-value">${formatSpeedDrillStat(stats)}</span>
                        </div>
                        <div class="stat-chip" title="Shoot / Range">
                            <img class="stat-icon" src="icons/shoot.svg" alt="Shoot / Range">
                            <span class="stat-value">${formatShootRangeStat(stats)}</span>
                        </div>
                        <div class="stat-chip" title="Strike">
                            <img class="stat-icon" src="icons/strike.svg" alt="Strike">
                            <span class="stat-value">${getStatValue(stats, 'Strike', 'Melee')}</span>
                        </div>
                        <div class="stat-chip" title="Defence">
                            <img class="stat-icon" src="icons/defence.svg" alt="Defence">
                            <span class="stat-value">${getStatValue(stats, 'Defence', 'Def', 'Defense')}</span>
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
    updateRotationHandleSize(selectedPiece);
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

const PEER_CONFIG = {
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ]
    }
};

function generateShortId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function loadActiveGamesList() {
    try {
        const raw = localStorage.getItem(ACTIVE_GAMES_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
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
        round: meta.round || (roundState && roundState.round) || 1,
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
}

function updateRoomCodeVisibility() {
    const area = document.getElementById('room-code-area');
    const btn = document.getElementById('toggle-room-code-btn');
    if (!area || !btn) return;

    if (isRoomCodeHidden) {
        area.style.display = 'none';
        btn.textContent = 'Show Code';
        btn.setAttribute('aria-expanded', 'false');
    } else {
        area.style.display = 'flex';
        btn.textContent = 'Hide Code';
        btn.setAttribute('aria-expanded', 'true');
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
    } else if (isGuest || (conn && !isHost)) {
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
    } else {
        badge.textContent = 'Local Sandbox';
        badge.className = 'player-role-badge';
        roomText.textContent = 'Local Game';
        statusText.textContent = 'Pass & Play Sandbox';
        statusText.className = 'network-status';
    }
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
            if (typeof prompt !== 'undefined') prompt('Copy room link:', url);
        });
    } else {
        if (typeof prompt !== 'undefined') prompt('Copy room link:', url);
    }
}

function checkUrlAutoJoin() {
    try {
        if (typeof window === 'undefined' || !window.location || !window.location.search) return;
        const params = new URLSearchParams(window.location.search);
        const joinCode = params.get('join') || params.get('room');
        if (joinCode) {
            const input = document.getElementById('landing-join-code');
            if (input) {
                input.value = joinCode.toUpperCase().slice(0, 4);
            }
        }
    } catch (e) {}
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
    isGuest = false;
    hasRevealedFirstBids = false;

    const landing = document.getElementById('landing-screen');
    const container = document.getElementById('container');
    if (landing) landing.style.display = 'none';
    if (container) container.style.display = 'flex';

    if (conn) {
        try { conn.close(); } catch (e) {}
        conn = null;
    }
    if (peer) {
        try { peer.destroy(); } catch (e) {}
        peer = null;
    }

    // Reset battlefield board
    if (table && table.querySelectorAll) {
        table.querySelectorAll('.unit, .terrain, .ghost, .range-ring, .command-token-table').forEach(p => p.remove());
    }
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

    // Spawn starting units from pool
    createDefaultUnits();

    // Shuffled terrain deck
    cancelTerrainCardAnimation();
    terrainDeck = createShuffledTerrainDeck();
    renderTerrainCard();

    // Default round state
    roundState = CommandTracker.create();
    bidVisibility = { p1: false, p2: false };
    bidsSet = { p1: false, p2: false };

    addOrUpdateActiveGame({
        roomCode: shortId,
        role: 'p1',
        isHost: true,
        round: 1,
        lastPlayed: Date.now()
    });

    saveGame(true);

    updatePlayerBanner();
    updateRoomCodeVisibility();
    updateBidUI();
    updateRoundUI();
    fitTableToScreen();
    fitAllUnitLabels();

    hostGame(shortId);

    loadStats().catch(err => console.warn('Background stats refresh:', err));
}

function joinGameFromLanding() {
    const input = document.getElementById('landing-join-code');
    const code = (input ? input.value : '').trim().toUpperCase();
    if (!code || code.length < 3) {
        if (typeof alert !== 'undefined') alert('Please enter a valid room code.');
        if (input && input.focus) input.focus();
        return;
    }
    joinGame(code);
}

function playSoloFromLanding() {
    isHost = false;
    isGuest = false;
    currentRoomCode = '';
    hasRevealedFirstBids = false;
    bidVisibility = { p1: false, p2: false };
    bidsSet = { p1: false, p2: false };

    const landing = document.getElementById('landing-screen');
    const container = document.getElementById('container');
    if (landing) landing.style.display = 'none';
    if (container) container.style.display = 'flex';

    updatePlayerBanner();
    updateRoomCodeVisibility();
    updateBidUI();
    updateRoundUI();
    fitTableToScreen();
    fitAllUnitLabels();
}

function resumeGame(roomCode) {
    if (!roomCode) return;
    const cleanCode = roomCode.toUpperCase();
    const list = loadActiveGamesList();
    const entry = list.find(g => g.roomCode === cleanCode);
    if (!entry) return;

    if (conn) {
        try { conn.close(); } catch (e) {}
        conn = null;
    }
    if (peer) {
        try { peer.destroy(); } catch (e) {}
        peer = null;
    }

    currentRoomCode = cleanCode;
    isHost = Boolean(entry.isHost);
    isGuest = !isHost;

    const landing = document.getElementById('landing-screen');
    const container = document.getElementById('container');
    if (landing) landing.style.display = 'none';
    if (container) container.style.display = 'flex';

    const saved = localStorage.getItem(getGameSaveKey(cleanCode)) || localStorage.getItem(SAVE_KEY);
    if (saved) {
        restoreBoardState(saved, true);
    }

    entry.lastPlayed = Date.now();
    saveActiveGamesList(list);

    updatePlayerBanner();
    updateRoomCodeVisibility();
    updateBidUI();
    updateRoundUI();
    fitTableToScreen();
    fitAllUnitLabels();

    if (isHost) {
        hostGame(cleanCode);
    } else {
        joinGame(cleanCode);
    }

    loadStats().catch(err => console.warn('Background stats refresh:', err));
}

function deleteActiveGame(roomCode, event) {
    if (event && event.stopPropagation) event.stopPropagation();
    if (typeof confirm !== 'undefined' && !confirm(`Are you sure you want to remove Battle ${roomCode}?`)) {
        return;
    }
    removeActiveGame(roomCode);
}

function exitToLanding() {
    saveGame(true);

    if (conn) {
        try { conn.close(); } catch (e) {}
        conn = null;
    }
    if (peer) {
        try { peer.destroy(); } catch (e) {}
        peer = null;
    }

    isHost = false;
    isGuest = false;
    currentRoomCode = '';

    const container = document.getElementById('container');
    const landing = document.getElementById('landing-screen');
    if (container) container.style.display = 'none';
    if (landing) landing.style.display = 'flex';

    renderActiveGamesUI();
}

function hostGame(specificRoomCode = null) {
    if (peer) {
        try { peer.destroy(); } catch (e) {}
        peer = null;
    }
    updateStatus("Initializing...");
    const shortId = (specificRoomCode || currentRoomCode || generateShortId()).toUpperCase();
    currentRoomCode = shortId;
    isHost = true;
    isGuest = false;
    updatePlayerBanner();

    peer = new Peer(shortId, PEER_CONFIG);

    peer.on('open', (id) => {
        updateStatus("Hosting");
        currentRoomCode = id;
        const myIdDisplay = document.getElementById('my-id-display');
        if (myIdDisplay) myIdDisplay.value = id;
        isHost = true;
        isGuest = false;
        updatePlayerBanner();
        updateMultiplayerControlsUI();
        updateBidUI();
        fitTableToScreen();
    });

    peer.on('connection', (c) => {
        conn = c;
        setupConnection();
        sendData({ type: 'SYNC_BOARD', payload: getBoardState({ forNetwork: true }) });
    });
    peer.on('error', (err) => {
        console.error("Peer error:", err);
        if (err.type === 'unavailable-id') {
            peer = null;
            hostGame();
        } else {
            updateStatus("Error: " + (err.type || err.message));
        }
    });
}

function joinGame(hostId = null) {
    let targetCode = hostId;
    if (!targetCode) {
        const landingInput = document.getElementById('landing-join-code');
        const legacyInput = document.getElementById('join-input');
        targetCode = ((landingInput && landingInput.value) || (legacyInput && legacyInput.value) || '').trim();
    }
    if (!targetCode) {
        if (typeof alert !== 'undefined') alert("Enter a Host ID");
        return;
    }
    targetCode = targetCode.toUpperCase();
    currentRoomCode = targetCode;

    if (conn) {
        try { conn.close(); } catch (e) {}
        conn = null;
    }
    if (peer) {
        try { peer.destroy(); } catch (e) {}
        peer = null;
    }

    const landing = document.getElementById('landing-screen');
    const container = document.getElementById('container');
    if (landing) landing.style.display = 'none';
    if (container) container.style.display = 'flex';

    updateStatus("Connecting...");
    isGuest = true;
    isHost = false;
    hasRevealedFirstBids = false;
    bidVisibility = { p1: false, p2: false };
    bidsSet = { p1: false, p2: false };
    updatePlayerBanner();
    fitTableToScreen();

    peer = new Peer(PEER_CONFIG);
    peer.on('open', () => {
        conn = peer.connect(targetCode, { reliable: true });
        setupConnection();
    });
    peer.on('error', (err) => {
        console.error("Peer error:", err);
        updateStatus("Connection Error");
        isGuest = false;
        fitTableToScreen();
        if (typeof alert !== 'undefined') alert("Could not connect. Check Host ID.");
    });
}

function setupConnection() {
    if (!conn) return;

    const onOpen = () => {
        updateStatus("Connected!");
        const statusIndicator = document.getElementById('status-indicator');
        if (statusIndicator) statusIndicator.classList.add('status-connected');
        updatePlayerBanner();
        updateMultiplayerControlsUI();
        updateRoundUI();
        updateBidUI();
        fitTableToScreen();

        if (!isHost) {
            sendData({ type: 'GUEST_JOIN' });
        }
    };

    if (conn.open) {
        onOpen();
    } else {
        conn.on('open', onOpen);
    }

    conn.on('data', (data) => {
        handleIncomingData(data);
    });

    conn.on('close', () => {
        updateStatus("Disconnected");
        const statusIndicator = document.getElementById('status-indicator');
        if (statusIndicator) statusIndicator.classList.remove('status-connected');
        conn = null;
        isHost = false;
        isGuest = false;
        updatePlayerBanner();
        updateRoundUI();
        updateMultiplayerControlsUI();
        updateBidUI();
        fitTableToScreen();
    });

    conn.on('error', (err) => {
        console.error("Data connection error:", err);
    });
}

function handleIncomingData(data) {
    if (!data) return;
    if (data.type === 'GUEST_JOIN') {
        updateStatus("Connected!");
        const statusIndicator = document.getElementById('status-indicator');
        if (statusIndicator) statusIndicator.classList.add('status-connected');
        updatePlayerBanner();
        updateMultiplayerControlsUI();
        updateRoundUI();
        updateBidUI();
        fitTableToScreen();
        sendData({ type: 'SYNC_BOARD', payload: getBoardState({ forNetwork: true }) });
    }
    else if (data.type === 'SYNC_BOARD') {
        restoreBoardState(data.payload, true);
    }
    else if (data.type === 'PIECE_DRAG_START') {
        const piece = findPieceById(data.pieceId);
        if (piece) {
            piece.classList.add('is-remote-moving');
            if (data.x !== undefined && data.y !== undefined) {
                piece.style.left = `${data.x}px`;
                piece.style.top = `${data.y}px`;
            }
            if (data.anchorX !== undefined && data.anchorY !== undefined) {
                if (remoteGhostPiece) remoteGhostPiece.remove();
                remoteGhostPiece = piece.cloneNode(true);
                remoteGhostPiece.classList.add('ghost');
                remoteGhostPiece.classList.remove('is-selected', 'is-remote-moving');
                if (remoteGhostPiece.removeAttribute) remoteGhostPiece.removeAttribute('id');
                remoteGhostPiece.style.transform = piece.style.transform;
                table.insertBefore(remoteGhostPiece, piece);
                showRemoteLine(data.anchorX, data.anchorY, data.targetX !== undefined ? data.targetX : data.anchorX, data.targetY !== undefined ? data.targetY : data.anchorY);
            }
            if (selectedPiece === piece) positionPieceControls();
        }
    }
    else if (data.type === 'PIECE_DRAG_MOVE') {
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
    }
    else if (data.type === 'PIECE_DRAG_END') {
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
    }
    else if (data.type === 'PIECE_ROTATE_START' || data.type === 'PIECE_ROTATE') {
        const piece = findPieceById(data.pieceId);
        if (piece) {
            piece.classList.add('is-remote-rotating');
            piece.dataset.angle = String(data.angle);
            piece.style.transform = `rotate(${data.angle}deg)`;
            showRemoteAngleIndicator(piece, data.delta !== undefined ? data.delta : data.angle);
            if (selectedPiece === piece) positionPieceControls();
        }
    }
    else if (data.type === 'PIECE_ROTATE_END') {
        const piece = findPieceById(data.pieceId);
        if (piece) {
            piece.classList.remove('is-remote-rotating');
            piece.dataset.angle = String(data.angle);
            piece.style.transform = `rotate(${data.angle}deg)`;
            if (selectedPiece === piece) positionPieceControls();
        }
    }
    else if (data.type === 'ROLL_DICE') {
        const incomingRolls = Array.isArray(data.rolls) ? data.rolls : [];
        renderDiceRoll(incomingRolls.length ? incomingRolls : createPlaceholderRoll(data.count || 2));
    }
    else if (data.type === 'BID_SET') {
        bidsSet[data.player] = Boolean(data.isSet);
        if (data.bid !== undefined && data.bid !== null) {
            lastKnownCpValues[data.player] = String(data.bid);
            const input = getBidInput(data.player);
            if (input && bidVisibility[data.player]) {
                input.value = data.bid;
            }
        }
        updateBidUI();
    }
    else if (data.type === 'REVEAL_BIDS') {
        bidsSet = { p1: true, p2: true };
        bidVisibility = { p1: true, p2: true };
        if (data.player && data.bid !== undefined && data.bid !== null) {
            const input = getBidInput(data.player);
            if (input) {
                input.value = data.bid;
            }
            rememberCpValue(data.player);
        }
        const localKey = getLocalBidPlayerKey();
        if (localKey && data.player !== localKey) {
            sendData({
                type: 'REVEAL_BIDS',
                player: localKey,
                bid: getBidInput(localKey) ? getBidInput(localKey).value : null
            });
        }
        updateBidUI();
        updateTerrainSectionVisibility();
        saveGame(true);
    }
    else if (data.type === 'BID_VISIBILITY') {
        bidVisibility = getNormalizedBidVisibility({
            ...bidVisibility,
            [data.player]: data.visible !== false
        });
        if (data.bid !== undefined && data.bid !== null) {
            const input = getBidInput(data.player);
            if (input) {
                input.value = data.bid;
                rememberCpValue(data.player);
            }
        }
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
    const statusIndicator = document.getElementById('status-indicator');
    if (statusIndicator) statusIndicator.innerText = msg;
    const networkStatus = document.getElementById('network-status');
    if (networkStatus && (!conn || !conn.open)) networkStatus.innerText = msg;
}

function copyId() {
    const copyText = document.getElementById("my-id-display");
    if (!copyText) return;
    if (copyText.select) copyText.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(copyText.value);
    }
    if (typeof alert !== 'undefined') alert("ID Copied to Clipboard!");
}

// --- ROUND & COMMAND TRACKING ---
function setCommandFeedback(message) {
    document.getElementById('command-feedback').textContent = message;
}

function getAssignedPlayer(unit) {
    if (unit.dataset.owner) return unit.dataset.owner;
    const centerY = parseFloat(unit.style.top) + parseFloat(unit.style.height) / 2;
    return centerY >= tableHeightPx / 2 ? 'p1' : 'p2';
}

function setFirstRoundTie(player) {
    if (roundState.round > 0 || !['p1', 'p2'].includes(player)) return;
    pushUndo();
    roundState = { ...roundState, firstTie: player };
    saveGame();
}

function assignUnitOwner(index, owner) {
    if (!['setup', 'bidding'].includes(roundState.phase)) return;
    const unit = [...table.querySelectorAll('.unit:not(.ghost)')][index];
    if (!unit || !['', 'p1', 'p2'].includes(owner)) return;
    pushUndo();
    if (owner) unit.dataset.owner = owner;
    else delete unit.dataset.owner;
    saveGame();
}

function advanceRound() {
    try {
        if (roundState.phase === 'complete') {
            pushUndo();
            roundState = CommandTracker.next(roundState);
            bidVisibility = { p1: false, p2: false };
            bidsSet = { p1: false, p2: false };
            table.querySelectorAll('.unit:not(.ghost)').forEach(unit => {
                unit.dataset.activated = 'false';
                unit.querySelector('.activation-checkbox').checked = false;
            });
        } else {
            if (!bidVisibility.p1 || !bidVisibility.p2) throw new Error('Reveal both bids before starting commands.');
            const units = [...table.querySelectorAll('.unit:not(.ghost)')];
            const counts = { p1: 0, p2: 0 };
            units.forEach(unit => counts[getAssignedPlayer(unit)]++);
            const bids = { p1: Number(getBidInput('p1').value), p2: Number(getBidInput('p2').value) };
            const nextState = CommandTracker.start(roundState, bids, counts);
            pushUndo();
            roundState = nextState;
            units.forEach(unit => {
                unit.dataset.owner = getAssignedPlayer(unit);
                unit.dataset.activated = 'false';
                unit.querySelector('.activation-checkbox').checked = false;
            });
        }
        setCommandFeedback('');
        saveGame();
    } catch (error) {
        setCommandFeedback(error.message);
    }
}

function passCommandWindow() {
    try {
        const activePlayer = CommandTracker.activePlayer(roundState);
        const localPlayer = getLocalBidPlayerKey();
        if (localPlayer && activePlayer !== localPlayer) throw new Error('Only the active player can pass.');
        const nextState = CommandTracker.pass(roundState, activePlayer);
        pushUndo();
        roundState = nextState;
        setCommandFeedback('');
        saveGame();
    } catch (error) {
        setCommandFeedback(error.message);
    }
}

function updateTerrainSectionVisibility() {
    const terrainSection = document.getElementById('terrain-section');
    if (!terrainSection) return;
    if (bidVisibility && bidVisibility.p1 && bidVisibility.p2) {
        hasRevealedFirstBids = true;
    }
    const isDraftOver = hasRevealedFirstBids || (roundState && (roundState.round >= 1 || roundState.phase !== 'setup'));
    terrainSection.style.display = isDraftOver ? 'none' : 'block';
}

function updateRoundUI() {
    updateTerrainSectionVisibility();
    const panel = document.getElementById('round-panel');
    if (!panel) return;
    const state = roundState;
    const activePlayer = CommandTracker.activePlayer(state);
    const localPlayer = getLocalBidPlayerKey();
    const units = [...table.querySelectorAll('.unit:not(.ghost)')];
    const isAssigning = ['setup', 'bidding'].includes(state.phase);
    document.getElementById('round-title').textContent = state.round ? `Round ${state.round}` : 'Battle setup';
    const status = document.getElementById('round-status');
    if (state.phase === 'commands') {
        const masterName = state.master ? state.master.toUpperCase() : 'P1';
        const activeName = activePlayer ? activePlayer.toUpperCase() : masterName;
        status.textContent = `${masterName} is Master Tactician. ${activeName} may activate or pass.`;
    } else if (state.phase === 'complete') {
        const masterName = state.master ? state.master.toUpperCase() : 'P1';
        status.textContent = `Round complete. Unspent commands are lost. ${masterName} keeps Master Tactician on a tied bid next round.`;
    } else {
        const masterName = state.master ? state.master.toUpperCase() : (state.firstTie ? state.firstTie.toUpperCase() : 'P2');
        status.textContent = state.phase === 'setup'
            ? 'Deploy armies, set bids, then start round 1.'
            : `Set and reveal bids. ${masterName} keeps Master Tactician on a tie.`;
    }
    const windows = document.getElementById('command-windows');
    windows.replaceChildren();
    if (state.master && ['commands', 'complete'].includes(state.phase)) {
        const opponent = state.master === 'p1' ? 'p2' : 'p1';
        [state.master, opponent, state.master].forEach((player, index) => {
            const item = document.createElement('li');
            item.textContent = `${player.toUpperCase()}${index === 1 ? '' : ' · Master Tactician'}${index === 2 ? ' · final window' : ''}`;
            if (state.phase === 'commands' && index === state.window) {
                item.className = 'current-window';
                item.setAttribute('aria-current', 'step');
            } else if (state.phase === 'complete' || index < state.window) item.className = 'closed-window';
            windows.appendChild(item);
        });
    }
    const totals = document.getElementById('command-totals');
    totals.replaceChildren();
    for (const player of ['p1', 'p2']) {
        const army = units.filter(unit => getAssignedPlayer(unit) === player);
        const activated = army.filter(unit => unit.dataset.activated === 'true');
        const line = document.createElement('p');
        line.textContent = `${player.toUpperCase()}: ${state.remaining[player]} command${state.remaining[player] === 1 ? '' : 's'} · ${activated.length}/${army.length} activated`;
        totals.appendChild(line);
    }
    const action = document.getElementById('round-action-btn');
    action.hidden = state.phase === 'commands';
    action.textContent = state.phase === 'setup' ? 'Start round 1'
        : state.phase === 'complete' ? `Next round (${state.round + 1})` : 'Resolve bids & start commands';
    const pass = document.getElementById('pass-command-btn');
    pass.hidden = state.phase !== 'commands';
    pass.disabled = Boolean(localPlayer && localPlayer !== activePlayer);
    pass.textContent = activePlayer ? `${activePlayer.toUpperCase()} passes${state.window === 2 ? ' · end round' : ''}` : 'Pass';
    document.getElementById('tracker-bids').hidden = !isAssigning;
    document.getElementById('first-tie-field').hidden = state.round > 0;
    document.getElementById('first-tie-player').value = state.firstTie;
    const roster = document.getElementById('army-roster');
    roster.replaceChildren();
    units.forEach((unit, index) => {
        const player = getAssignedPlayer(unit);
        let badge = unit.querySelector('.owner-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'owner-badge';
            unit.appendChild(badge);
        }
        badge.textContent = unit.dataset.owner ? player.toUpperCase() : '';
        unit.classList.toggle('has-command', unit.dataset.activated === 'true');
        const checkbox = unit.querySelector('.activation-checkbox');
        checkbox.disabled = state.phase !== 'commands' || activePlayer !== player
            || Boolean(localPlayer && localPlayer !== player)
            || (unit.dataset.activated !== 'true' && state.remaining[player] === 0);
        checkbox.setAttribute('aria-label', `${player.toUpperCase()} ${unit.dataset.name}: activated this round`);
        checkbox.title = checkbox.disabled ? 'Activate during your window with a command available' : 'Spend or return one command';
        const row = document.createElement('label');
        row.className = 'army-roster-row';
        const name = document.createElement('span');
        name.textContent = `${unit.dataset.activated === 'true' ? '✓ ' : ''}${unit.dataset.name}`;
        const select = document.createElement('select');
        [['', 'Position'], ['p1', 'P1'], ['p2', 'P2']].forEach(([value, text]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            select.appendChild(option);
        });
        select.value = unit.dataset.owner || '';
        select.disabled = !isAssigning;
        select.setAttribute('aria-label', `Owner of ${unit.dataset.name}, unit ${index + 1}`);
        select.addEventListener('change', () => assignUnitOwner(index, select.value));
        row.append(name, select);
        roster.appendChild(row);
    });
    updateBidUI();
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
        terrainDeck: [...terrainDeck],
        roundState,
        bidVisibility: getNormalizedBidVisibility(),
        bidsSet: { ...bidsSet }
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
            unitId: el.dataset.unitId || getPieceId(el),
            name: el.dataset.name,
            x: parseFloat(el.style.left),
            y: parseFloat(el.style.top),
            angle: el.dataset.angle,
            wounds: el.dataset.wounds,
            activated: el.dataset.activated === 'true',
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
    table.querySelectorAll('.unit, .terrain, .ghost, .range-ring').forEach(p => p.remove());

    const state = JSON.parse(jsonString);
    const data = Array.isArray(state) ? state : state.pieces;
    roundState = state.roundState || CommandTracker.create();

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
        if (state.bidsSet) {
            bidsSet = {
                p1: Boolean(state.bidsSet.p1),
                p2: Boolean(state.bidsSet.p2)
            };
        } else {
            bidsSet = {
                p1: Boolean(bidVisibility.p1),
                p2: Boolean(bidVisibility.p2)
            };
        }
        updateBidUI();
    }

    data.forEach(obj => {
        if (obj.type === 'unit') {
            const unit = createUnitDOM(obj.name, obj.color, obj.x, obj.y, obj.angle, obj.wounds, obj.stats, obj.activated, obj.owner);
            if (obj.unitId) unit.dataset.unitId = obj.unitId;
        } else if (obj.type === 'terrain') {
            const piece = createTerrainDOM(obj.subType, obj.x, obj.y, obj.w, obj.h, obj.angle, obj.pieceId);
            if (obj.pieceId) piece.dataset.pieceId = obj.pieceId;
        }
    });
    saveGame(suppressBroadcast);
}

function saveGame(suppressBroadcast = false) {
    rememberCpValues();
    const state = getBoardState();
    localStorage.setItem(SAVE_KEY, state);
    if (currentRoomCode) {
        localStorage.setItem(getGameSaveKey(currentRoomCode), state);
        addOrUpdateActiveGame({
            roomCode: currentRoomCode,
            role: isHost ? 'p1' : 'p2',
            isHost: isHost,
            round: (roundState && roundState.round) || 1,
            lastPlayed: Date.now()
        });
    }
    updateRoundUI();
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
                try {
                    const player = div.dataset.owner;
                    const localPlayer = getLocalBidPlayerKey();
                    if (localPlayer && player !== localPlayer) throw new Error('You can only activate your own units.');
                    const nextState = CommandTracker.activate(roundState, player, nextActivated);
                    pushUndo();
                    roundState = nextState;
                    checkbox.checked = nextActivated;
                    div.dataset.activated = String(nextActivated);
                    setCommandFeedback('');
                    saveGame();
                } catch (error) {
                    setCommandFeedback(error.message);
                }
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

function createTerrainDOM(subType, x, y, _w, _h, angle, pieceId) {
    if (!subType || subType === "undefined" || subType === "rough") subType = "field";
    const finalW = defaultUnitSizePx.width;
    const finalH = defaultUnitSizePx.height;

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

    table.querySelectorAll('.unit, .terrain, .ghost, .range-ring').forEach(p => p.remove());
    undoStack.length = 0;
    roundState = CommandTracker.create();
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
    bidVisibility = { p1: false, p2: false };
    bidsSet = { p1: false, p2: false };
    hasRevealedFirstBids = false;
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
        const melee = parseCombatStat(stats, ['Strike', 'Melee']);
        const defence = parseCombatStat(stats, ['Defence', 'Def', 'Def.', 'Defense']);

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

    const revealedCard = terrainDeck[0];
    if (!revealedCard) {
        card.classList.add('is-empty');
        card.dataset.cardType = '';
        card.setAttribute('aria-disabled', 'true');
        card.setAttribute('aria-label', 'Terrain deck empty. Use Reset Board to create a new deck.');
        title.textContent = 'Deck Empty';
        note.textContent = 'Use Reset Board';
        return;
    }

    const label = getTerrainCardLabel(revealedCard);
    card.classList.add(`terrain-card-${revealedCard}`);
    card.dataset.cardType = revealedCard;
    card.setAttribute('aria-disabled', 'false');
    card.setAttribute('aria-label', revealedCard === TERRAIN_NO_FEATURE_CARD
        ? 'Revealed X card. Drag to discard it and reveal the next card.'
        : `Revealed ${label} card. Drag it onto the battlefield.`);
    title.textContent = label;
    note.textContent = revealedCard === TERRAIN_NO_FEATURE_CARD
        ? 'Discard — no terrain'
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

function beginTerrainDrag(type, event, shouldPushUndo = true) {
    if (event && event.button !== 0) return;
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    clearPieceSelection();
    if (shouldPushUndo) pushUndo();
    const w = defaultUnitSizePx.width;
    const h = defaultUnitSizePx.height;
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
}

window.spawnTerrain = function (type, event) {
    beginTerrainDrag(type, event);
};

window.playTerrainCard = function (event) {
    if (activePointerId !== null || isTerrainCardAnimating || !terrainDeck.length) return;
    if (event && (event.button !== 0 || event.isPrimary === false)) return;
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

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
    if (isBoardFlipped()) {
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
    const isRing = Boolean(e.target && (
        (e.target.classList && (e.target.classList.contains('ring-hit') || e.target.classList.contains('ring-node'))) ||
        (e.target.closest && e.target.closest('.ring-hit, .ring-node'))
    ));
    if (!isRing) return;

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
    if (pieceRotateBroadcastTimer) {
        clearTimeout(pieceRotateBroadcastTimer);
        pieceRotateBroadcastTimer = null;
    }
    pendingPieceRotateData = null;
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
    const pieceLeft = parseFloat(pendingDragPiece.style.left) || 0;
    const pieceTop = parseFloat(pendingDragPiece.style.top) || 0;
    pendingDragPiece.dataset.offsetX = pointer.x - pieceLeft;
    pendingDragPiece.dataset.offsetY = pointer.y - pieceTop;

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
    anchorX = (parseFloat(activePiece.style.left) || 0) + activePieceHalfWidth;
    anchorY = (parseFloat(activePiece.style.top) || 0) + activePieceHalfHeight;
    showLine(anchorX, anchorY, anchorX, anchorY);
    positionPieceControls();

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
        broadcastPieceMoveThrottled(activePiece, newLeft, newTop, anchorX, anchorY, targetX, targetY);
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
        if (isBoardFlipped()) {
            measureTextElement.setAttribute('transform', `rotate(180, ${textX}, ${textY})`);
        } else {
            measureTextElement.removeAttribute('transform');
        }
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
        const pieceId = getPieceId(activePiece);
        const finalLeft = parseFloat(activePiece.style.left) || 0;
        const finalTop = parseFloat(activePiece.style.top) || 0;
        if (pieceMoveBroadcastTimer) {
            clearTimeout(pieceMoveBroadcastTimer);
            pieceMoveBroadcastTimer = null;
        }
        pendingPieceMoveData = null;
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
    const appContainer = document.getElementById('container');
    const container = document.getElementById('table-container');
    const table = document.getElementById('game-table');
    const leftSidebar = document.getElementById('left-sidebar');
    const rightSidebar = document.getElementById('right-sidebar');
    if (!container || !table) return;

    if (appContainer && leftSidebar && appContainer.clientWidth > 400 && appContainer.clientHeight > 300) {
        const totalWidth = appContainer.clientWidth;
        const totalHeight = appContainer.clientHeight;
        const isRightHidden = isRightSidebarHidden || (rightSidebar && rightSidebar.classList.contains('sidebar-hidden'));
        const rightWidth = (rightSidebar && !isRightHidden) ? (rightSidebar.offsetWidth || 210) : 0;
        const gap = 8;
        const numGaps = rightWidth > 0 ? 2 : 1;

        // Container borders / padding take ~4px vertically
        const availableHeight = Math.max(totalHeight - 4, 1);
        const idealScale = availableHeight / tableHeightPx;
        const idealTableWidth = tableWidthPx * idealScale;
        const spaceForLeft = totalWidth - idealTableWidth - rightWidth - (numGaps * gap);

        const minSidebarWidth = 260;
        const maxSidebarWidth = 440;
        if (!isNaN(spaceForLeft)) {
            const targetLeftWidth = Math.max(minSidebarWidth, Math.min(Math.floor(spaceForLeft), maxSidebarWidth));
            leftSidebar.style.width = `${targetLeftWidth}px`;
        }
    }

    const containerWidth = container.clientWidth || (container.getBoundingClientRect ? container.getBoundingClientRect().width : 0) || tableWidthPx;
    const containerHeight = container.clientHeight || (container.getBoundingClientRect ? container.getBoundingClientRect().height : 0) || tableHeightPx;
    const availableWidth = Math.max(containerWidth - 4, 1);
    const availableHeight = Math.max(containerHeight - 4, 1);
    const tableWidth = tableWidthPx;
    const tableHeight = tableHeightPx;

    const scaleX = availableWidth / tableWidth;
    const scaleY = availableHeight / tableHeight;

    // Use a unified scale so the battlefield fills the screen as tall as possible
    // without distorting unit or terrain proportions.
    currentScale = Math.max(Math.min(scaleX, scaleY), 0.01) || 1;
    activeTableRect = null;

    const flipped = isBoardFlipped();
    table.classList.toggle('is-flipped', flipped);
    const rotateTransform = flipped ? ' rotate(180deg)' : '';
    table.style.transform = `scale(${currentScale})${rotateTransform}`;
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
updateRoundUI();

const originalInitGame = initGame;
initGame = async function () {
    await originalInitGame();
    renderActiveGamesUI();
    checkUrlAutoJoin();
    updatePlayerBanner();
    updateRoomCodeVisibility();
    updateBidUI();
    fitTableToScreen();
    fitAllUnitLabels();
    // Second call to ensure layout is settled
    setTimeout(() => {
        fitTableToScreen();
        fitAllUnitLabels();
    }, 100);
};

if (typeof window !== 'undefined') {
    window.hostGame = hostGame;
    window.joinGame = joinGame;
    window.hostGameFromLanding = hostGameFromLanding;
    window.joinGameFromLanding = joinGameFromLanding;
    window.playSoloFromLanding = playSoloFromLanding;
    window.resumeGame = resumeGame;
    window.deleteActiveGame = deleteActiveGame;
    window.exitToLanding = exitToLanding;
    window.toggleRoomCodeArea = toggleRoomCodeArea;
    window.copyRoomLink = copyRoomLink;
    window.updatePlayerBanner = updatePlayerBanner;
    window.updateTerrainSectionVisibility = updateTerrainSectionVisibility;
    window.toggleBidVisibility = toggleBidVisibility;
    window.toggleSetBid = toggleSetBid;
    window.setBid = setBid;
    window.editBid = editBid;
    window.triggerRevealBids = triggerRevealBids;
    window.revealBids = revealBids;
    window.handleCpBidChange = handleCpBidChange;
    window.advanceRound = advanceRound;
    window.passCommandWindow = passCommandWindow;
    window.loadActiveGamesList = loadActiveGamesList;
    window.saveActiveGamesList = saveActiveGamesList;
    window.isBoardFlipped = isBoardFlipped;
    window.fitTableToScreen = fitTableToScreen;
    window.getTablePointerPosition = getTablePointerPosition;
    window.getPieceId = getPieceId;
    window.findPieceById = findPieceById;
    window.createUnitDOM = createUnitDOM;
    window.createTerrainDOM = createTerrainDOM;
    window.getBoardState = getBoardState;
    window.restoreBoardState = restoreBoardState;
    window.handleIncomingData = handleIncomingData;
    window.updateRotationHandleSize = updateRotationHandleSize;
    window.appendRotationHandle = appendRotationHandle;
    window.onRotationHandlePointerDown = onRotationHandlePointerDown;
    window.onPiecePointerDown = onPiecePointerDown;
    window.onPointerUp = onPointerUp;
    window.handlePointerMove = handlePointerMove;
    window.formatSpeedDrillStat = formatSpeedDrillStat;
    window.formatShootRangeStat = formatShootRangeStat;
    window.buildStatsMarkup = buildStatsMarkup;
    window.getUnitStats = getUnitStats;
    window.unitStatsDB = unitStatsDB;
    window.availableUnitRows = availableUnitRows;
    window.DEFAULT_UNIT_STATS = DEFAULT_UNIT_STATS;
    window.SHEET_URL = SHEET_URL;
    Object.defineProperty(window, 'roundState', {
        get: () => roundState,
        set: (v) => { roundState = v; },
        configurable: true
    });
    Object.defineProperty(window, 'bidsSet', {
        get: () => bidsSet,
        set: (v) => { bidsSet = v; },
        configurable: true
    });
    Object.defineProperty(window, 'bidVisibility', {
        get: () => bidVisibility,
        set: (v) => { bidVisibility = v; },
        configurable: true
    });
}

initGame();
