---
name: Rust Skin Stacker
description: A dark, dense desktop tool for splitting and combining Rust skin stacks, with one indigo accent, flat tonal layers and every number counted.
colors:
  ground: "#0f1117"
  panel: "#161922"
  card: "#1b1f2b"
  card-hover: "#1f2432"
  card-raised: "#232838"
  image-well: "#20253a"
  hairline: "#262b3a"
  control-hover: "#2b3144"
  pill-selected: "#2c3246"
  box-border: "#3d4357"
  scrim: "rgba(5, 6, 10, 0.55)"
  text: "#eceef5"
  text-muted: "#9aa0b4"
  text-faint: "#6c7287"
  on-accent: "#ffffff"
  indigo: "#5b5bf7"
  indigo-bright: "#7171ff"
  indigo-text: "#8b8bff"
  indigo-wash: "rgba(91, 91, 247, 0.14)"
  ok-green: "#3ecf8e"
  warn-amber: "#f2b84b"
  bad-red: "#f0625f"
  bad-wash: "rgba(240, 98, 95, 0.12)"
  danger-text: "#ff8f8c"
  alert-text: "#ffb4b2"
typography:
  display:
    fontFamily: "'Manrope', system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.2
  headline:
    fontFamily: "'Manrope', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.25
  title:
    fontFamily: "'Manrope', system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.45
  body:
    fontFamily: "'Manrope', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.45
  body-strong:
    fontFamily: "'Manrope', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.45
  button:
    fontFamily: "'Manrope', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 800
    lineHeight: 1.45
  body-sm:
    fontFamily: "'Manrope', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.45
  caption:
    fontFamily: "'Manrope', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "'Manrope', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 800
    lineHeight: 1.45
    letterSpacing: "0.08em"
  micro:
    fontFamily: "'Manrope', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.45
  mono:
    fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  xs: "5px"
  sm: "8px"
  control: "9px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  full: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  topbar-height: "60px"
  filters-width: "200px"
  side-width: "340px"
  drawer-width: "380px"
  card-min-width: "160px"
  card-height: "192px"
components:
  button-primary:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.indigo-bright}"
  button-secondary:
    backgroundColor: "{colors.card-raised}"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.control-hover}"
  button-danger:
    backgroundColor: "{colors.bad-wash}"
    textColor: "{colors.danger-text}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-bulk:
    backgroundColor: "{colors.card-raised}"
    textColor: "{colors.text}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "38px"
  button-bulk-hover:
    backgroundColor: "{colors.control-hover}"
  button-bulk-active:
    backgroundColor: "{colors.indigo-wash}"
    textColor: "{colors.indigo-text}"
  icon-button:
    textColor: "{colors.text-muted}"
    rounded: "{rounded.control}"
    width: "36px"
    height: "36px"
  icon-button-hover:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
  input-search:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "38px"
  input-field:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "12px"
  select:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  filter-box-on:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.xs}"
    width: "18px"
    height: "18px"
  skin-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "10px 10px 12px"
    height: "192px"
  skin-card-hover:
    backgroundColor: "{colors.card-hover}"
  skin-card-selected:
    backgroundColor: "{colors.card-raised}"
  image-well:
    backgroundColor: "{colors.image-well}"
    rounded: "{rounded.sm}"
    height: "96px"
  pill:
    backgroundColor: "{colors.card-raised}"
    textColor: "{colors.text-muted}"
    typography: "{typography.micro}"
    rounded: "{rounded.xs}"
    padding: "0 7px"
    height: "20px"
  pill-selected-card:
    backgroundColor: "{colors.pill-selected}"
  section-block:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "14px"
  stepper-button:
    backgroundColor: "{colors.card-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    width: "30px"
    height: "30px"
  stepper-value:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    width: "52px"
    height: "30px"
  progress-track:
    backgroundColor: "{colors.card-raised}"
    height: "8px"
  progress-fill:
    backgroundColor: "{colors.indigo}"
    height: "8px"
  banner-error:
    backgroundColor: "{colors.bad-wash}"
    textColor: "{colors.alert-text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "8px 8px 8px 14px"
  menu:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "6px"
  drawer:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    padding: "22px"
    width: "380px"
  login-card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
    padding: "20px 26px"
    width: "560px"
---

# Design System: Rust Skin Stacker

## Overview

**Creative North Star: "The Honest Stockroom"** (Russian: «Честный склад»)

The window is a calm stockroom where every item is counted and nothing is hidden: you see what is on the shelves, what a job will move, and afterwards a tally that proves nothing went missing. Honesty is the style. Plain surfaces, exact numbers and statements that are true even when a step fails (a processed card says "processed", not "done").

A dark, fixed-palette desktop window built for one operation: split or combine stacks of Rust skins, and show that nothing was lost. The work is laid out in plain view. A card grid sits in the middle, filters on the left, a details panel on the right. Before anything runs, the screen says what will change; afterwards it says whether the counts match. It is a tool (Operate mode), not a storefront: dense but not cramped, keyboard reachable, readable for the few minutes a run takes.

Surfaces are flat and stacked by tone, not by shadow. Type is Manrope in heavy weights on near-black blue-greys. One indigo accent marks the primary action, the current selection and the run in progress. Status colour is rare and carries meaning: green is verified, amber is waiting, red is a fault. Motion is short and quiet, and it switches off entirely under reduced-motion.

The product has to feel at home for Rust players without borrowing case-site spectacle. The confirmed rejections are neon, gloss, glow, gradient text and anything that reads as a casino. Steam supplies only names and item pictures; they are shown as plain text and as images inside quiet wells, never as markup.

**Key Characteristics:**
- Single fixed dark palette (`color-scheme: dark`); no light theme.
- One accent, indigo (#5b5bf7), plus three status colours used sparingly.
- Flat tonal layering with 1px hairlines; shadows only on things that float.
- Manrope 500 to 800, tabular numerals for every count, self-hosted with Tabler outline icons.
- Three-column frame under a 60px top bar; the whole window never scrolls, its columns do.
- Preview in place: cards show "becomes ..." and dim when a plan is open; a reconciliation verdict closes the run.
- Motion 150 to 250 ms on one easing curve, disabled under `prefers-reduced-motion`.

## Colors

A near-black blue-grey ground with slightly lighter, slightly bluer surfaces stepping up toward the card, and a single saturated indigo that is allowed to be loud because it appears so rarely. Hex values are canonical in the frontmatter; CSS custom property names are given for mapping to code.

### Primary
- **Signal Indigo** (#5b5bf7, `--acc`): the one accent. Primary buttons, the selected card's border, filled checkboxes, slider and progress fills, the logo tile and the 1.5px focus ring on search and fields.
- **Bright Indigo** (#7171ff, `--acc-2`): hover state of the primary button, the border of the card being processed right now, the focus ring (2px), links and the hint icon.
- **Text Indigo** (#8b8bff, `--acc-text`): accent used as small text ("becomes ...", the active bulk toggle, step numbers). Lighter than Signal Indigo because small text needs at least 4.5:1 on card surfaces.
- **Indigo Wash** (rgba(91, 91, 247, 0.14), `--acc-bg`): tint behind the active bulk toggle, step numbers and the hint icon tile.

### Tertiary (status signals)
- **Verified Green** (#3ecf8e, `--ok`): confirmed facts only: a matching reconciliation, "yes" flags, the live-token dot, the shield and scale icons.
- **Hold Amber** (#f2b84b, `--warn`): something needs attention or time: notes, "available from" dates, the Steam wait line.
- **Fault Red** (#f0625f, `--bad`): errors, an expired token dot, failed verdicts and the destructive menu item.
- **Fault Wash** (rgba(240, 98, 95, 0.12), `--bad-bg`): background of the error banner and the Stop button.
- **Soft Fault Red** (#ff8f8c): label colour on the Stop button, lighter for legibility on the wash.
- **Pale Fault Red** (#ffb4b2): text inside the error banner.

### Neutral
- **Night Ground** (#0f1117, `--bg`): window background; also the sunken fill of the count box and the token field.
- **Slate Panel** (#161922, `--panel`): the right-hand panel, the settings drawer and the login card.
- **Ink Card** (#1b1f2b, `--card`): cards, the search field, section blocks, menus, the sort control.
- **Lifted Ink** (#1f2432, `--card-hover`): card hover.
- **Raised Slate** (#232838, `--card-2`): selected card, secondary buttons, bulk toggles, pills, progress track.
- **Dusk Well** (#20253a, `--img`): the well behind every skin picture and thumbnail.
- **Hairline Slate** (#262b3a, `--line`): 1px dividers between columns, rows and around floating surfaces.
- **Pressed Slate** (#2b3144): hover fill for secondary buttons, bulk toggles and stepper buttons.
- **Selected Pill** (#2c3246): pill fill on a selected card.
- **Checkbox Edge** (#3d4357): resting border of filter checkboxes.
- **Scrim** (rgba(5, 6, 10, 0.55)): backdrop behind the settings drawer.
- **Mist White** (#eceef5, `--text`): primary text.
- **Fog Grey** (#9aa0b4, `--text-2`): secondary and all small readable text.
- **Dim Grey** (#6c7287, `--text-3`): placeholder pictograms, list bullets and hover borders only, never readable text.
- **Pure White** (#ffffff): text and icons on indigo, slider thumb.

### Named Rules
**The One Indigo Rule.** Indigo is the only accent. It marks the primary action, the current selection and focus, the run in progress and what will change ("becomes"). Its only decorative uses are the logo tile and the small hint and step badges.

**The Verified-Green Rule.** Green means a fact was confirmed (a matching count, a "yes", a live token), never merely that steps ran. A processed card is written in neutral grey because some of its steps may have failed.

**The Readable-Small-Text Rule.** Small readable text is Fog Grey (#9aa0b4) or lighter, and small accent text is Text Indigo (#8b8bff); both keep at least 4.5:1 on the surfaces they sit on, which a test enforces. Dim Grey (#6c7287) is for pictograms and decoration.

## Typography

**Display Font:** Manrope (with system-ui, sans-serif)
**Body Font:** Manrope (with system-ui, sans-serif)
**Label/Mono Font:** Manrope for labels; ui-monospace, 'Cascadia Mono', Consolas, monospace for the token field only.

**Character:** Manrope is geometric and slightly wide, set in heavy weights for names and actions and medium for running text. It reads firmly on dark without decoration. Fonts (500, 600, 700, 800) and Tabler outline icons are bundled from npm; there is no CDN.

### Hierarchy
- **Display** (800, 24px, 1.2): the sign-in title only.
- **Headline** (800, 20px, 1.25): side-panel headings, the skin name, the drawer title and the key figures in plan facts.
- **Title** (800, 18px, 1.45): the "Inventory" heading above the grid. The wordmark is 17px / 800.
- **Body** (500, 14px, 1.45): base text, filter options, menu items, selects, search input.
- **Body Strong** (700, 14px, 1.45): bulk toggles, verdict lines, links.
- **Button** (800, 14px, 1.45): every `.btn` label, with an 18px icon and an 8px gap.
- **Body Small** (500, 13px, 1.45): card names (700), key-value rows, queue rows, account line, preview line, status line.
- **Caption** (500, 13px, 1.5): card sub-line, notes, footers, option counts, inventory totals, disclaimer.
- **Label** (800, 12px, 0.08em, uppercase): column headings ("Show", "Type"), the queue heading, field labels.
- **Micro** (700, 12px): layout pills on cards; slider ticks are 12px at weight 500.
- **Mono** (500, 13px, 1.5): the token paste field.

Weight 600 appears once (mismatch lines in the result); 500 is the running weight and 700 to 800 carry structure.

### Named Rules
**The Tabular Numbers Rule.** Every count, quantity, duration, token lifetime, slider tick and progress figure uses tabular numerals (`font-variant-numeric: tabular-nums`, the `.num` class; cards and pills set it directly) so columns of figures hold their width as they change.

**The Self-Hosted Type Rule.** Manrope and Tabler icons come from npm and ship inside the build. Never load a font or icon set from a CDN.

## Layout

A desktop window with a fixed frame: a 60px top bar, then three columns under it. Filters take 200px on the left, the card grid takes the rest, the details panel takes 340px on the right (`200px minmax(0, 1fr) 340px`). Below 1100px of window width the side columns narrow to 168px and 304px, the filters' side padding drops from 16px to 12px (more room for the "Нельзя передать" label), content padding from 18px to 14px and panel padding from 18px to 16px. The window opens at 1440 x 900 and cannot go below 1024 x 640. The page itself never scrolls; each column scrolls on its own, and the top bar and the panel's action dock stay put.

**Interface scale.** Settings offer Auto (the default) and 100, 110, 125 and 150% (Ctrl+= and Ctrl+− step through them, starting from what Auto gives now; Ctrl+0 returns to Auto). Auto goes by the screen height in logical pixels: 125% from 1400px (a 1440px screen at 100% system scaling), 110% from 1150px, 100% below. The window opens at 1440 x 900 so that Auto at 125% still leaves 1152 x 720 CSS pixels, above the narrow layout. The scale zooms the whole window (the webview), not the CSS: type, cards and spacing grow together, every size in this document stays in CSS pixels, and the virtual grid keeps counting in them. The window never gets smaller than 1024 x 640 CSS pixels: in a small window the applied scale drops by itself to the largest step that still fits and comes back when the window grows.

The card grid is virtual: only visible rows are in the DOM, so inventories of thousands stay quick. Columns are `floor((width + 12) / (160 + 12))`, so cards are at least 160px wide, 12px apart and exactly 192px tall. That gives four columns at 1280px and three at 1024px. Rows are shifted with a transform and scroll anchoring is off.

Spacing is a hand-set rhythm of even pixel steps rather than a token scale: 4, 6, 8, 10, 12, 14, 16, 18, 20 and 22px all recur. The frontmatter lists the main steps (4, 8, 12, 16, 20) and the structural sizes. Column padding is 16px (filters), 16 to 18px (content, side), 20px (top bar sides). Controls range from 30px (steppers, language button) through 36 to 40px (icon buttons, bulk toggles, fields) to 44px (buttons); the Run button is 50px.

In the side panel the content area scrolls and the action buttons sit in a dock fixed to the bottom. In a low window (up to 700px tall) the large item picture shrinks from 196px to 120px so the buttons still fit without scrolling.

### Named Rules
**The Three-Column Frame Rule.** Every screen in the main window is a filter, grid and panel combination under the top bar. New views are new panel contents or a drawer over the frame, not new page layouts.

**The Docked Actions Rule.** In the side panel, content scrolls and the buttons stay docked at the bottom, visible at any window height. The main action is the first or topmost of the dock, full width in single-column docks.

## Elevation & Depth

The system is flat and tonal. Depth is a ladder of surface colours: ground (#0f1117) under panel (#161922) under card (#1b1f2b) under raised (#232838), with 1px hairlines (#262b3a) between regions. Cards, sections and panels carry no shadow at rest or on hover; hover only lightens the fill. Shadows are kept for things that actually float above the window, plus the slider thumb.

State is shown with a solid ring, not a glow: a 1.5px indigo border or inset ring for selection, the active bulk toggle and focused search; a 1px inset ring in bright indigo for the card being processed; a 2px bright indigo focus outline offset 2px (inside the card at -3px so scrolling does not clip it).

### Shadow Vocabulary
- **Menu float** (`box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45)`): the top-bar dropdown menu, with a 1px hairline border.
- **Drawer edge** (`box-shadow: -16px 0 40px rgba(0, 0, 0, 0.35)`): the settings drawer, over a scrim of rgba(5, 6, 10, 0.55).
- **Slider thumb** (`box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4)`): the white 18px thumb.
- **State ring** (`box-shadow: inset 0 0 0 1.5px #5b5bf7`): active bulk toggle and focus-within search; the card being processed right now uses `inset 0 0 0 1px #7171ff`.

### Named Rules
**The Flat-Until-Floating Rule.** In-flow surfaces separate by tone and hairline only. An outer shadow is allowed on a surface only when it overlays the window (menu, drawer) and on the slider thumb.

**The Ring-Not-Glow Rule.** Selection and focus are crisp solid rings of indigo. No blurred glow, no coloured shadow.

## Shapes

Softly rounded rectangles on a small ladder: 5px for checkboxes and pills, 8px for image wells, thumbnails, the logo tile, language button and stepper buttons, 9px for top-bar controls (bulk toggles, search, icon buttons), 10px for buttons, fields, the menu and the banner, 12px for cards, section blocks, the large picture and info blocks, 16px for the sign-in card. Circles (50%) are used for the status dot, radio boxes, step numbers and the slider thumb. Smaller one-offs: 3px slider track, 4px progress bar, 6px queue thumbnail.

Regions are divided by 1px hairlines (top bar bottom, column edges, fact rows, floating surfaces). Interactive outlines are 1.5px: a transparent border on cards that turns indigo when selected, the checkbox edge, and field borders that turn indigo on focus. Pictures are centred and contained (never cropped) inside an image well; a missing picture shows an outline photo-off icon in Dim Grey.

## Components

Quiet, compact controls on dark: solid fills, no gradients, one filled button per view. Icons are Tabler outline (stroke 2) at 18px in buttons, 20px in icon buttons, 16px in notes and 22 to 32px as placeholders.

### Buttons
- **Shape:** gently rounded (10px); 44px tall, 16px side padding, label 14px / 800, icon 18px with an 8px gap.
- **Primary:** Signal Indigo (#5b5bf7) with white text. Hover: Bright Indigo (#7171ff), 150ms. One per dock; sizes: 44px default, 50px "Run", 32px in the banner.
- **Secondary:** Raised Slate (#232838) with Mist White text. Hover: Pressed Slate (#2b3144). Cancel is 40px tall.
- **Danger:** Fault Wash fill with Soft Fault Red text, used for "Stop" only. No hover change is defined.
- **Disabled:** 45% opacity and a default cursor, on every button.
- **Bulk toggle (top bar):** 38px, 9px radius, 14px / 700, Raised Slate. While its plan is open it becomes Indigo Wash with Text Indigo and an inset 1.5px indigo ring (`aria-pressed`).
- **Icon button:** 36px square, 9px radius, Fog Grey glyph; hover or expanded fills with Ink Card and Mist White. The language button is 30px tall, 13px / 800.
- **Link:** Bright Indigo, 700, underline on hover.

### Top bar and menu
- **Style:** 60px, 1px bottom hairline, 20px side padding, 10px gaps. Left: 30px indigo logo tile (8px radius, white stack icon) and the 17px / 800 wordmark, then the two bulk toggles. Right: the account line (8px status dot, 13px Fog Grey, token time left) pushed with auto margin, the language button and the dots menu button.
- **Menu:** Ink Card, 1px hairline, 10px radius, 230px wide, 6px padding, rises in over 150ms; 36px items with an 18px Fog Grey icon, hover Raised Slate, the destructive item in Fault Red. Escape or outside click closes it.

### Filters and fields
- **Search:** 38px, 9px radius, Ink Card; Fog Grey placeholder and icon; focus shows an inset 1.5px indigo ring.
- **Options:** rows of 18px boxes with 1.5px Checkbox Edge border: round for single choice ("Show"), 5px radius for multiple ("Type"); checked is solid indigo with a white check; the count is 13px Fog Grey, tabular, right aligned. Group headings use the Label style.
- **Untradable switch:** under the "Show" options, a square checkbox "Нельзя передать" ("Untradable"), the same 14px as the options, with its count. The count stays on the first line, in the same column as the counts above; when the label does not fit next to it, the label wraps between words. It shows hidden Twitch drops and the like, and appears only when the inventory has such items.
- **Inventory totals:** a definition list pinned to the column bottom, 13px Fog Grey labels with Mist White 700 values. Values are plain tabular numbers with no unit, so the column lines up on the right; the unit lives in the label ("Всего штук" / "Total pieces"). When the inventory has hidden untradable items, a "Нельзя передать" ("Untradable") row counts their pieces.
- **Select (sort, language):** Ink Card, 1.5px hairline border, 10px radius, 40px in the drawer (34px, borderless, 8px radius inside the grid bar); focus turns the border indigo.
- **Token field:** monospace 13px, Night Ground fill, 1.5px hairline border, 10px radius, resizes vertically, about three lines (76px min); focus turns the border indigo; the status line below is 13px, green when valid and red when not.

### Skin Card (signature)
A 192px tile: 13px / 700 name (one line, ellipsis), 13px sub-line, a 96px image well with a contained 84px picture, and a row of 20px pills describing the layout (stack pills such as "x8" in Mist White, "3 singles" in Fog Grey). Stack pills never shrink; when the row runs out of room, the last pill (singles or "+N") shrinks and ends in an ellipsis instead of being cut mid-letter.
- **Default:** Ink Card, 12px radius, 10px padding (12px bottom), 1.5px transparent border. Hover: Lifted Ink (#1f2432).
- **Selected:** 1.5px Signal Indigo border and Raised Slate fill; pills turn to Selected Pill (#2c3246).
- **Preview:** while a plan is open, affected cards write "becomes ..." in Text Indigo 700 and unaffected cards dim to 35% opacity.
- **Now processing:** 1.5px Bright Indigo border plus an inset 1px ring, brighter than selected.
- **Processed:** the sub-line reads "processed" in Fog Grey.
- **Loading:** skeleton cards with a 1.4s linear shimmer between Ink Card and Raised Slate.
- **Focus:** the 2px ring is drawn inside the card (offset -3px).

### Side panel
- **Container:** Slate Panel, 1px left hairline, 18px padding (16px below 1100px). A view change fades the new view up 4px over 200ms; updates inside a view (progress, selection) do not animate.
- **Section block:** Ink Card, 12px radius, 14px padding, 13px / 800 heading. Holds the "Split off one by one" control.
- **Count stepper and slider:** 30px stepper buttons (8px radius, Raised Slate) around a 52px by 30px value box (Night Ground, 15px / 800, no spin arrows); a 6px slider track filled with indigo up to the value, an 18px white thumb, 12px tick labels, and a 13px Fog Grey preview line with the new layout in Mist White 700.
- **Facts:** definition rows with a 13px Fog Grey label and a right-aligned 20px / 800 figure, each row closed by a 1px hairline (16px figures in the result).
- **Queue:** 28px picture thumbnails (6px radius), 13px names with "x amount", 13px Fog Grey request counts on the right; the list scrolls.
- **Notes and verdicts:** 13px notes with a 16px icon in Hold Amber (attention), Verified Green (ok) or Fog Grey (muted); the verdict line is 14px / 700 with an 18px icon, green when the count matches and red with a mismatch list when not.
- **Progress:** 8px track in Raised Slate with an indigo fill, 4px radius; below it the progress line, current item, time left, and a Hold Amber 700 "waiting" line when Steam asks to pause.
- **Loading:** while the inventory is read outside a run, the panel shows the "Loading the inventory…" heading, the same Hold Amber "waiting" line when Steam asks to pause, and the Stop button in the dock.
- **Dock:** buttons in a grid with 8px gaps (two columns for pairs such as "Split off 1" and "Combine"); the Run button is 50px, Cancel 40px; the item and multi views end with a 13px Fog Grey footer line.

### Error banner
Fault Wash fill, Pale Fault Red 13px text, 10px radius, 8px 8px 8px 14px padding, an 18px alert icon and a 32px action button pushed right (primary for a new token, secondary for retry, secondary "Dismiss" for a scale error, which also goes away by itself once the scale changes or saves). It rises in over 200ms and carries `role="alert"`.

### Settings drawer
Slides in from the right over a scrim: 380px, Slate Panel, 1px left hairline, 22px padding, 18px gaps, Drawer edge shadow, 200ms slide of 24px with fade. Heading 20px / 800 and a close icon button; label-over-control fields; two buttons at the bottom (primary Save, secondary Close). The rest of the window is inert while it is open and Tab is trapped inside.

### Sign-in card
Centred card, `min(560px, 100%)`, Slate Panel with a 1px hairline, 16px radius, 20px by 26px padding, 10px gaps, 16px of screen padding above and below, rising in over 250ms. The empty status line is pulled up to 4px under the token field and 8px above Continue, so the screen fits 1152 x 720 (a 1440 x 900 window at 125%) and 1280 x 800 without scrolling; at 1024 x 640 it scrolls, with Continue still in view. Wordmark and language button on top, a 24px / 800 title, three numbered steps (24px circular badges in Indigo Wash with Text Indigo), a secondary button to open the token page, the token field, the status line, a primary Continue that stays disabled until the token validates, a "why this is safe" block (Ink Card, 12px radius, green shield icon, small grey bullets) and a centred 13px disclaimer. The non-affiliation line ("Not affiliated with Valve or Facepunch") stays on this screen and in settings.

### Named Rules
**The Preview-In-Place Rule.** What an operation will do is shown on the grid before it runs: affected cards say "becomes ...", the rest dim to 35%, and the result closes with a reconciliation verdict in the panel.

**The Text-Only Steam Data Rule.** Names and labels that come from Steam are plain text, truncated with an ellipsis and repeated in `title`, never markup. The only Steam visual is the item picture, held in an image well.

## Do's and Don'ts

### Do:
- **Do** keep indigo (#5b5bf7) for the primary action, selection, progress and "becomes" text; one filled primary button per view.
- **Do** build depth from tone: ground #0f1117, panel #161922, card #1b1f2b, raised #232838, with 1px #262b3a hairlines.
- **Do** set every count, duration and amount in tabular numerals.
- **Do** keep small readable text at Fog Grey (#9aa0b4) or lighter, and accent text at #8b8bff.
- **Do** keep motion between 150 and 250 ms on `cubic-bezier(0.2, 0.7, 0.2, 1)`, and make it vanish under `prefers-reduced-motion`.
- **Do** dock panel actions at the bottom and let the panel content scroll above them.
- **Do** show state with solid rings: 1.5px indigo for selection, 2px bright indigo outline (offset 2px) for focus.
- **Do** draw Steam pictures contained inside a Dusk Well (#20253a) and fall back to the outline photo-off icon.
- **Do** keep the window usable at 1280 x 800 and at its 1024 x 640 minimum, with three card columns at the minimum.

### Don't:
- **Don't** introduce a second accent hue or spend indigo on decoration beyond the logo tile and small badges.
- **Don't** write a finished or processed state in green; green is for verified facts.
- **Don't** use neon, glow, gloss, gradient text or case-site and casino styling; the only gradients are the skeleton shimmer and the slider fill.
- **Don't** put shadows on cards, sections or panels; shadows belong to the menu, the drawer and the slider thumb.
- **Don't** use Dim Grey (#6c7287) for text people must read.
- **Don't** add a light theme or a theme switch; the palette is fixed.
- **Don't** put `style` attributes in markup or build DOM from HTML strings (no `innerHTML`); the production CSP allows only the bundled stylesheet.
- **Don't** load fonts, icons or images from a CDN other than the Steam item-image host.
- **Don't** put "Steam" in the product name, imitate Valve or Facepunch branding, or drop the non-affiliation line from the sign-in and settings screens.
- **Don't** let the page itself scroll or let the panel buttons scroll out of view.
