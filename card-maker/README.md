# Unit Card Studio

Double-click `Start Card Maker.bat` in the project folder. The app opens at http://127.0.0.1:8765/card-maker/. Requires Python 3, which is already installed on this computer. No packages or account connection needed. Leave the server running while using the editor.

The public sheet is downloaded when the app opens or Refresh sheet is clicked. If it cannot be reached, the last downloaded `unit-cards-source.csv` is used, with a visible status message. No changes are written to Google Sheets.

Select a unit to preview both colours. SN uses the vertical templates; SW uses horizontal. Edit stats, choose or upload artwork, and adjust its size. Changes are kept in this browser; Reset unit restores the source values and initial artwork. Refresh updates source stats but keeps your edits.

Export all creates a ZIP with one full-resolution PNG per unit per colour. Download this pair exports the selected two cards. Print / PDF prints the selected pair at 63 × 88 mm (SN) or 88 × 63 mm (SW); set print scaling to 100% and disable browser headers and footers.

Stats map to wing = Speed, chevrons = Drill, swords = Melee, target = ranged strength, arrow = range, shield = Def. Ranged `4/24` becomes target `4` and arrow `24`; a dash indicates no ranged attack. Quantity does not multiply cards.

Absent stats appear as `0` in previews, printing, and exports. Source values and actual numeric zeros are preserved. Thin dividers in the card colour separate each stat section.

Artwork assignments are initial interpretations of the images provided in the images folder. Crossbows currently uses the bow image as a placeholder; choose or upload a crossbow image to replace it. Artwork should have a transparent background for a silhouette outline; opaque images receive an outline around their rectangle.
