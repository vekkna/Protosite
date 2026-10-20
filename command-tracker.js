// Round transitions are independent of the board so they can be checked in isolation.
const CommandTracker = {
    create(options = {}) {
        const firstTie = options.firstTie || (options.firstDraftPick ? (options.firstDraftPick === 'p1' ? 'p2' : 'p1') : 'p2');
        return { round: 0, phase: 'setup', master: null, window: 0,
            remaining: { p1: 0, p2: 0 }, bids: { p1: 0, p2: 0 }, firstTie };
    },
    activePlayer(state) {
        if (state.phase !== 'commands') return null;
        return state.window === 1 ? (state.master === 'p1' ? 'p2' : 'p1') : state.master;
    },
    start(state, bids, counts) {
        if (!['setup', 'bidding'].includes(state.phase)) throw new Error('Finish the current round first.');
        for (const player of ['p1', 'p2']) {
            if (!Number.isInteger(bids[player]) || bids[player] < 1 || bids[player] > counts[player]) {
                throw new Error(`${player.toUpperCase()} must bid from 1 to ${counts[player]} (their units on the battlefield).`);
            }
        }
        const master = bids.p1 === bids.p2 ? (state.master || state.firstTie)
            : (bids.p1 < bids.p2 ? 'p1' : 'p2');
        return { ...state, round: Math.max(1, state.round), phase: 'commands', master, window: 0,
            bids: { ...bids }, remaining: { ...bids } };
    },
    pass(state, player) {
        if (player && this.activePlayer(state) !== player) throw new Error('Only the active player can pass.');
        if (state.window === 2) return { ...state, phase: 'complete', remaining: { p1: 0, p2: 0 } };
        return { ...state, window: state.window + 1 };
    },
    activate(state, player, activated) {
        if (!player || this.activePlayer(state) !== player) throw new Error('This unit’s player has no open activation window.');
        if (activated && state.remaining[player] < 1) throw new Error('This player has no commands remaining.');
        if (!activated && state.remaining[player] >= state.bids[player]) throw new Error('No spent command to return.');
        return { ...state, remaining: { ...state.remaining,
            [player]: state.remaining[player] + (activated ? -1 : 1) } };
    },
    next(state) {
        if (state.phase !== 'complete') throw new Error('Finish the command phase first.');
        return { ...state, round: state.round + 1, phase: 'bidding', window: 0,
            bids: { p1: 0, p2: 0 }, remaining: { p1: 0, p2: 0 } };
    }
};
if (typeof module !== 'undefined') module.exports = CommandTracker;
if (typeof window !== 'undefined') window.CommandTracker = CommandTracker;
