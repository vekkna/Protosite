# Editing the game's text

These are the source files used by the local game. Search for the current wording,
change the text, save, then refresh Firefox with Ctrl+F5.

| File | Text to edit | Example search |
| --- | --- | --- |
| `index.html` | Main menu, permanent sidebar labels, controls help | `Play the AI`, `Field headquarters`, `Field Controls` |
| `guided-play.js` | Draft instructions, turn guidance and order buttons | `Tap an available unit`, `Confirm Unit Deployment`, `Drag the unit to move` |
| `app.js` | Unit and terrain popups, connection status, other interface messages | `Slowing:`, `Playing against the AI`, `Speed / Drill` |
| `battle-ux.js` | Narration of the AI's current order | `AI commands`, `withdraws` |
| `engine.js` | Battle log entries and explanations of illegal actions | `Deployment complete`, `Units can’t overlap` |
| `game-rules.html` | The rulebook displayed inside the game | Search for the heading you want |

In JavaScript files, keep the surrounding quotes/backticks and expressions such as
`${picked.name}` intact. Those expressions insert a unit name, distance or player.
In HTML, keep the tags and attributes intact and edit the text between them.

The full unit profiles come from the connected stats spreadsheet; fallback unit
profiles are in `app.js` under `FALLBACK_DEFAULT_UNITS`. Card maker text is separate,
in `card-maker/index.html` and `card-maker/studio.js`.

The folders under `sites/` are hosting copies. Edit the root files above for the
local game; publishing is a separate step.
