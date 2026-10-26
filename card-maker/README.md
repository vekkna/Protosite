# Unit Card Studio

Double-click `Start Card Maker.bat` in the project folder. The app opens at http://127.0.0.1:8765/card-maker/. Requires Python 3, which is already installed on this computer. No packages or account connection needed. Leave the server running while using the editor.

The public sheet is downloaded when the app opens or Refresh sheet is clicked. If it cannot be reached, the last downloaded `unit-cards-source.csv` is used, with a visible status message. No changes are written to Google Sheets.

Select a unit to preview both colours. SN uses the vertical templates; SW uses horizontal. Edit stats, choose or upload artwork, and adjust its size. Changes are kept in this browser; Reset unit restores the source values and initial artwork. Refresh updates source stats but keeps your edits.

Export all creates a ZIP with one full-resolution PNG per unit per colour. Download this pair exports the selected two cards. Print / PDF prints the selected pair at 63 × 88 mm (SN) or 88 × 63 mm (SW); set print scaling to 100% and disable browser headers and footers.

Working templates are in `assets/templates/`: portrait 1260 × 1760 pixels and landscape 1760 × 1260 pixels, both at 508 dpi (20 pixels/mm). PNG exports carry this same physical resolution. The originals in `images/` are preserved. The portrait sources were proportionally too narrow and the prepared versions expand their width to fit the requested footprint. To prepare templates again after replacing originals, run `python card-maker/prepare-assets.py` (development utility requiring Pillow).

All six separate stat icons, including `range-icon.png`, are trimmed to their visible alpha bounds and recoloured in the renderer. Equal cells and fixed gaps between the visible icon edges and number edges replace the old baked-in icon positions.

Stats map to wing = Speed, chevrons = Drill, swords = Melee, target = ranged strength, arrow = range, shield = Def. Ranged `4/24` becomes target `4` and arrow `24`; a dash indicates no ranged attack. Quantity does not multiply cards.

Absent stats appear as `0` in previews, printing, and exports. Source values and actual numeric zeros are preserved. Thin vertical dividers in the card colour separate landscape stats. Portrait cards retain the template's central divider with no horizontal lines between rows.

Artwork assignments include the embedded images imported from the source sheet. Artwork should have a transparent background for a silhouette outline; opaque images receive an outline around their rectangle.

The sheet's `Icon` column can specify a local image filename (or `images/filename.png`). Empty cells use the shared defaults in `unit-artwork.js`. Light Cavalry artwork is raised slightly on its shield. Browser artwork overrides still take precedence; Reset unit restores the sheet assignment.

Images inserted directly into sheet cells are omitted from CSV. To update those assignments, download the public sheet as XLSX, then run `python card-maker/import-sheet-icons.py path/to/export.xlsx`. This reads the RolesStats drawing anchors, maps images to Unit rows in the Icon column, preserves their original image bytes in `images/`, and updates the shared artwork assignments. It does not change the Google Sheet. Reopen the editor and regenerate the cards after importing.

To update Protosite's printable card assets after exporting, run `python card-maker/publish-cards.py path/to/export.zip`. The exported images reflect the last export; refresh and export again after changing the sheet. The unit profile panel uses the live values and separate artwork.

The unit profile shows the sheet-assigned unit image beside the live numerical stats. The full-card preview and display selector have been removed.

Profiles & help starts expanded. Hovering over or selecting a unit reopens it, including during drafting before the first bid reveal. Inspecting a profile does not reveal bids or start the battle.

Protosite's field headquarters defaults to one compact control column on tablets and desktops. Terrain and bidding use short rows, and card previews scale with screen height. In two-column mode, the dice roller follows the turn controls in the first column without being pinned to the screen's bottom edge. Short landscape phones use two columns. Drag the brass divider between the controls and battlefield to resize the panel; widening it to 420 pixels opens a second column. The chosen width is remembered locally. Double-click the divider or press Enter while it is focused to restore automatic sizing; arrow keys also adjust the width. Narrow portrait screens use the stacked layout.

Battlefield units show their sheet-assigned icon at the top right and their enlarged name along the bottom. Each label fits its own unit independently, so a long name does not shrink every label. Either player can pass the active command window or end the round, while unit activations still follow the active player's turn. The parchment, brass, slate and ochre interface is styled in `battle-console.css`.
