/* Runs the AI off the main thread so the board stays responsive while it thinks. */
importScripts('engine.js', 'ai.js');
onmessage = e => postMessage(SeizeAI.choose(e.data.state, e.data.player, e.data.options));
