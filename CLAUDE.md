# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
It covers this plugin's own architecture and design decisions. For conventions generic to any Obsidian
plugin, see `AGENTS.md`.

## Commands

- `npm run dev` — esbuild in watch mode; rebuilds `main.js` on every source change.
- `npm run build` — full type-check (`tsc -noEmit`) then a minified production bundle.
- `npm version <patch|minor|major>` — bumps `manifest.json` + `versions.json` via `version-bump.mjs`.

There is no test runner or linter configured. `npm run build` is the correctness gate:
the `tsc` step runs under `strict` mode, so a green build means the types line up.

Testing is manual: copy/symlink `main.js`, `manifest.json`, and `styles.css` into a
vault's `.obsidian/plugins/folgezettel-navigator/` and reload Obsidian.

## Architecture

An Obsidian plugin that renders a Luhmann Folgezettel sequence in a sidebar and exposes
jump commands along it. Six source files under `src/`, each a clear layer:

- **`graph.ts`** — pure data layer, no DOM. `buildGraph(app, propertyName)` scans every
  markdown file's configured Folgezettel frontmatter property (default `folgezettel`,
  via the metadata cache) and produces two adjacency maps: `outgoing` (A → its
  continuations) and `incoming` (the reverse edges). Pure function of vault state —
  there is deliberately **no incremental cache**; the graph is rebuilt on each render
  because reading the already-parsed metadata cache is cheap.
- **`view.ts`** — `FolgezettelView` (an `ItemView`), constructed with the plugin so it
  can read live settings. Owns all DOM and rendering (each entry is a left gutter with
  the guide rail + a dot, then the title). Strand traversal lives here, not in
  `graph.ts`, because it depends on pane-local branch state. The panel is **one** strand,
  drawn top to bottom: `walkUp` collects the ancestors (nearest first), `renderChain`
  draws them farthest first, then the active note, then `renderStrand` walks and renders
  the continuations. At a card, everything below moves into a continuation container
  (`branchContinuations`) that a hover preview rebuilds in place (see below).
  `renderStartOfBranch` and `renderEndOfBranch` add the detached entries at the two ends.
  `refresh()` re-renders on demand.
- **`navigate.ts`** — pure jump targets over a `FolgezettelGraph`, no DOM and no `App`:
  `previousNotes`/`nextNotes` (the two axes) plus `findParent`, `findLeaf`,
  `findNextJunction`, `findPreviousJunction`. Every walk carries a `visited` set, so a
  link cycle terminates the loop rather than hanging it. Kept free of Obsidian objects
  beyond `TFile` so the walks can be exercised against a plain graph.
- **`commands.ts`** — the six navigation commands, built from one `NavigationCommand`
  table. Each entry reduces to a list of candidate notes, so the three outcomes are
  handled once: none → `Notice`, one → open, several → a `FuzzySuggestModal` picker.
  Commands use `checkCallback` so they hide themselves (and their hotkeys go inert) with
  no active markdown note; the graph is only built when a command actually runs.
- **`settings.ts`** — `FolgezettelSettings` (`propertyName`, `maxSteps`), `DEFAULT_SETTINGS`
  (`folgezettel`, `5`), and the `FolgezettelSettingTab` (a text field for the property,
  a `1–10` slider for the per-direction note count).
- **`main.ts`** — plugin entry: loads settings, registers the view type (passing itself
  to the view), the ribbon icon, the panel command, the navigation commands (via
  `registerNavigationCommands`), and the settings tab. `saveSettings()`
  persists and then `refresh()`es every open pane so changes apply immediately.

### Key model decisions (read before changing traversal/rendering)

- **Edge direction = reading direction.** An edge A → B means "B continues A" (B is in
  A's `folgezettel`). So `incoming` renders *above* the active note and `outgoing`
  renders *below* it. Do not flip these without also flipping the render order in
  `view.ts`.
- **The list hangs from the top of the panel.** One flex column, packed at the top, and
  scrollable (`overflow-y: auto`) so a strand taller than the pane can still be reached —
  the bar appears only when it is needed. The active note is *not* pinned to a fixed
  height — it sits below however many ancestors there are, and moves as the reader
  navigates.

  The scroll container carries `scrollbar-gutter: stable` and it must keep it: near the
  overflow threshold a preview changes the strand's height, and a bar that appeared and
  vanished with it would change the content width, rewrap titles and slide the card under
  the cursor. The gutter costs no width: `.view-content.folgezettel-view` takes the pane's
  right padding off and lets the reserved strip serve as it, so the bar lands flush at the
  pane edge. That selector needs both classes — Obsidian's own
  `.workspace-leaf-content .view-content` out-specifies a single class, which is also why
  the plain `.folgezettel-view { padding }` rule above it has never actually applied.
  (One case the gutter cannot cover: scrolled well down, a preview that shortens the
  strand enough forces the browser to clamp `scrollTop`, which moves everything. It takes
  a pane short enough to scroll *and* a card below the fold.)

  This is not cosmetic. Anchoring at the top makes every row's position depend only on
  what is **above** it, so a card can own everything below it and a hover preview can
  replace all of that — the rest of the ancestors, the active note, its continuations —
  without the card ever moving under the cursor. The earlier centred layout could not do
  that: its incoming region was bottom-anchored, so rebuilding the rows between a card and
  the active note slid the card, which is exactly the hover thrash the partial-rebuild
  design exists to avoid.

  What makes top-anchoring safe is that **no walk grows a strand upward any more.** The
  ancestors are collected once by `walkUp` before anything is drawn, and every preview
  runs downward through `renderStrand`. Reintroduce an upward-growing preview and the
  anchoring breaks with it.
- **Junctions are followed, not stopped.** When a note has 2+ neighbours in the walk
  direction, a `branch` entry is emitted and the strand continues along the chosen
  option — the reader's pick (`branchSelections`) if any, else the **first declared
  link** (`selectedOption`). A single neighbour is followed, zero ends the strand. The per-direction note cap is `settings.maxSteps` (default 5, configurable
  1–10; branch entries count against it). The upward chain is reversed at render time so
  top-to-bottom reads with the sequence.
- **Each strand ends in a detached far-end entry.** Where the per-direction cap cuts a
  walk short, `renderFarEnd` appends one extra entry past the end: upward the note the
  current branch was started from (`findParent` from the **active** note — it is that
  note's branch on show), downward the note the strand runs out at (`findLeaf` from the
  **last drawn** note, so a branch the reader picked or is previewing ends at *its* leaf,
  not the first link's). It is drawn detached — a gap on the strand-facing side, both rail
  segments hidden — and does **not** count against `maxSteps`. Upward it is drawn by
  `renderFarEndParent`, which gives it the junction's numbered circle when that note forks
  and, when it does not, the open circle a leaf gets at that same size (the beginning of
  the structure, the thread's other end) — visual only, with no expand handler, because
  everything between it and the active note is fixed and so there is nothing to choose.
  Downward it keeps the ordinary dot, hollow because a leaf always is. A sibling circle
  does *not* count as "the farthest entry is a junction card" for the rule below — that
  keys on a junction the **walk** produced, which is the one that ends the walk. Three
  cases draw nothing: the note is already on screen (the `visited` guard; downward,
  `findLeaf` returns `null` exactly when the farthest entry *is* the leaf), there is no
  such note (the active note is itself the beginning), or — upward only — the farthest
  entry is a junction card, which is already the fork a parent would point at. Because it
  is emitted where the walk stops, it
  lands inside the innermost continuation container, so `renderContinuation` rebuilds it
  with the rest of a hover preview instead of leaving a stale leaf behind.
- **Branch state is pane-local and per-note.** `expandedBranches` (which junction
  cards are open) and `branchSelections` (junction key → chosen option path) live on
  the view and drive `renderStrand`. They are **cleared whenever the shown note
  changes** (the `currentPath` guard in `render()`, which also treats "no note" as a
  change) but survive metadata refreshes.
  Junction key = `` `${kind}|${junction.path}` ``, where `kind` is the entry's slot
  (`incoming` / `outgoing` / `active`) — see `branchKey`.
- **Junction-ness belongs to the note, not to the walk direction.** A note is one of
  several branches when its **parent forks** — `siblingOptions(file)` asks
  `outgoing[incoming[file][0]]` — and it carries the numbered circle wherever it is drawn:
  below the active note, above it, or *as* the active note. Do not go back to reading it
  off `edges = graph[direction]`: upward that counts a note's **predecessors**, which is a
  different question, and answering it there is what used to make a note lose its circle
  the moment the reader entered its branch (the fork was then unreachable from every note
  along it). The circle always sits on the *branch*, never on the forking note — that is
  the entry the reader is standing on and can switch away from.
- **Every card hovers; upward a pick opens, downward it re-roots.** Both kinds of card
  preview on hover through the same `previewBranch` / `renderContinuation` path. What
  differs is how much they replace: an outgoing junction's continuation holds the strand
  beyond it, while a sibling card's holds **everything below** — the remaining ancestors,
  the active note and its continuations, all of which belong to the branch being looked
  away from. Clicking differs for the same reason: `renderBranchEntry` (downward) re-roots
  the drawn strand and never opens, while `renderSiblingEntry` (upward and on the active
  row) opens the note. From above, the drawn path is the one that leads to the note you
  are on, so going to the sibling is the only way to actually switch to it.
- **A junction renders inline as a normal entry when collapsed.** It shows the chosen
  option's title (click opens the note) with a filled circle in the gutter carrying the
  number of options; clicking that circle expands the entry into the full option list
  (a card — see Styling), the **chosen option first, not emphasised**, and picking one
  collapses it and re-roots the strand (it does **not** open the note). So a title click
  and a gutter-icon click on the same entry do different things.
- **Hover preview is a partial rebuild — never route it through `render()`.** Hovering
  an option in an expanded card (either direction) sets `previewBranch` and reroutes
  that junction's continuation to the hovered option via `renderContinuation(key)`,
  which re-empties **only** that junction's continuation container (tracked in
  `branchContinuations`) and leaves the card — and the option under the cursor —
  untouched. A full `render()` here tears down the hovered element and thrashes
  mouseenter/mouseleave (empirically ~19 renders + a stuck preview), which is exactly
  the bug this design avoids. The card's option order never changes during preview
  (chosen option stays first). **The hover handlers are attached only when
  `!Platform.isMobile`** — touch has no hover and never fires `mouseleave`, so a mobile
  preview would get stuck; mobile relies on tap-to-select (the option `click` handler).
- **Rendering is otherwise full teardown.** `render()` calls `contentEl.empty()` and
  rebuilds; expand/select/navigation mutate state and call `render()` (hover preview is
  the lone exception, above). It is wired to `metadataCache` `resolved`/`changed`, and —
  via `renderIfNoteChanged` — to `active-leaf-change` and `file-open`. **That navigation
  handler guards on the active note path** (`activeNotePath() !== currentPath`, where
  `activeNotePath()` is the active markdown file's path or `null` for a non-note view):
  merely focusing the pane fires `active-leaf-change` with the same file, and an
  unconditional re-render there rebuilds the DOM mid-click — destroying the clicked
  element before `mouseup`, which made the pane require two clicks when focus started in
  the editor. Crucially, `render()` sets `currentPath` in **every** branch — the empty
  state included (to `null`) — otherwise leaving to a non-note view (e.g. the graph) and
  back would keep `currentPath` stale and the pane stuck on the "open a note" message.

- **"Current branch" = the *first* declared link, everywhere.** The first entry of a
  note's Folgezettel property continues the strand; every later entry starts a new one.
  `navigate.ts` follows `outgoing[...][0]` at every junction, and the panel's
  `selectedOption` defaults to `options[0]` — so a jump command and the drawn strand
  agree on where the current branch runs. The panel's only departure is the reader's own
  `branchSelections`, which is transient, pane-local exploration and resets with the
  note. Keep the two in step: changing the default on one side without the other
  re-opens the split this rule exists to close.
- **`findParent` is not `findPreviousJunction`.** The previous junction is the nearest
  ancestor that forks at all. The *parent* is the nearest ancestor that forks **and**
  whose fork this strand left by a non-first link — i.e. where the current branch was
  actually started; junctions we merely continued straight through are skipped. When no
  such ancestor exists, `findParent` falls back to the beginning of the structure (the
  topmost note nothing links to), and returns `null` only when the note *is* that
  beginning.
- **Several notes linking to the same note is malformed data, handled defensively.**
  A well-formed structure gives each note at most one predecessor. When the vault breaks
  that, `incoming` order is just vault scan order, so there is no principled "the"
  previous note: the upward walks take `incoming[0]` to stay deterministic, and `Open
  previous note` shows the picker rather than silently guessing. This is a safeguard
  against bad data, not a supported topology — don't build features on it.

  The panel once did: a multi-parent note got a junction card of its **predecessors**, and
  picking one re-rooted the strand above it. That was removed, because it was the last walk
  that grew a strand upward and so the last obstacle to top-anchoring the list (above).
  `walkUp` now takes `incoming[0]` silently, like every other upward walk. Bringing it back
  means giving up the layout — and a second meaning for the numbered circle.

### Obsidian integration points

- **Link resolution:** `metadataCache.getFirstLinkpathDest(linkpath, sourcePath)`.
  `graph.ts:toLinkpath` normalizes raw frontmatter values, tolerating both
  `"[[Wikilink]]"` and bare `Note` forms and stripping `#heading`/`|alias`.
- **Native page preview:** entries trigger the `hover-link` workspace event with
  `hoverParent: this` (the view exposes a `hoverPopover` slot for it). This inherits the
  user's "hover to preview" / Ctrl-key setting for free — do not reimplement previews.
  Skipped on `Platform.isMobile` (a tap just opens the note).
- **Mobile:** the plugin is mobile-compatible (`isDesktopOnly: false`, no Node/Electron
  APIs). Everything works by tap; only the two desktop **hover** affordances — the branch
  option preview and the page preview — are gated off via `Platform.isMobile`.
- **Navigation:** `workspace.getLeaf(newLeaf).openFile(file)`; Ctrl/Cmd-click opens in a
  new leaf, matching native link behavior. Selecting a branch option, by contrast, never
  opens a note — it only mutates pane state and re-renders.

### Styling

The panel is deliberately modeled on the **File Explorer nav item**, so `styles.css`
uses the same theme variables the Explorer does — `--nav-item-color`,
`--nav-item-color-hover`, `--nav-item-background-active`, `--indentation-guide-color`,
`--indentation-guide-width` — rather than generic accent/text tokens. Match those when
extending it; prefer a variable-based rule over a hard-coded color or dimension.

Non-obvious pitfall when touching the entry markup/styling:

- **The title is an `<a>`,** so it inherits Obsidian's link-accent color on `:hover`.
  `.folgezettel-title:hover` explicitly overrides `color` to `--nav-item-color-hover` to
  keep it looking like a nav item, not a link.

A sequence note shows a filled dot (`.folgezettel-dot`) in the gutter — `--nav-item-color`
(the muted title gray) for sequence notes, `--interactive-accent` for the active (pivot)
note. A **leaf** — a note nothing continues — keeps that size and colour but is drawn
hollow: `background-color: transparent` plus an inset `box-shadow` ring of
`--fz-ring-width`, which leaves the shape exactly `--fz-icon-size` across so the rail gaps
still line up (a border would grow the box). It applies to the active note too, and marks
a thread that really ends apart from one `maxSteps` merely cut short. A junction or
sibling entry has no dot at all, so its numbered circle keeps the slot even when the
option it names is a leaf. The gutter icon sits at the entry's **vertical centre**
(`top: 50%`); the marker is
`align-items: stretch`, so it spans the entry's full height and the icon stays centred
however many lines the title wraps to (the title's small left padding sets the
gutter-to-text gap). The indentation rail is drawn per entry as **two** guide segments,
`.folgezettel-marker::before` (above the icon) and `::after` (below), each stopping
`--fz-rail-gap` short of the icon — `50% ∓ (--fz-icon-size / 2 + --fz-rail-gap)` — so the
line never touches it. `--fz-icon-size` is `8px` for the dot, overridden to `14px` on the
branch marker for the larger branch-count circle. Consecutive entries' segments meet at
the row boundary to read as one line; both segments are hidden on the active (pivot) row.

A junction entry uses a filled circle carrying the number of selectable branches
(`.folgezettel-branch-toggle`) in the gutter slot instead of the dot — the same
`--nav-item-color` fill, with the count knocked out in `--background-primary`, and a
`min-width` + pill radius + `white-space: nowrap` so a longer count widens the shape
instead of wrapping inside it (it is absolutely positioned, so shrink-to-fit would
otherwise cap its width at half the marker). When expanded, its
`.folgezettel-branch-options` list takes the place of the title, styled to mirror
Obsidian's search-result preview (`.search-result-file-matches` — `--search-result-background`,
a `box-shadow` border ring, options divided by `border-bottom`). An expanded card takes a
small margin on both sides, so its filled background never butts against a neighbouring
filled row — the active one above or below it, or another expanded card.

The far-end entries (`.folgezettel-entry.is-detached`) are set apart by
a margin on the side facing the strand — `margin-bottom` on the one at the top,
`margin-top` on the one at the bottom — and both `.folgezettel-marker` segments hidden. Its neighbour keeps its own segments, which
stop at the row boundary, so the guide line ends, the gap follows, and the detached entry
carries no line at all. Above the strand it also takes the row class `is-branch` and
carries a `.folgezettel-branch-toggle` — the same circle a junction uses, holding the
fork's count or, at the beginning of the structure, nothing at all — with the hover fill
and the pointer cursor taken back off under `.is-detached`, since there is nothing here to
click. That beginning also takes the row class `is-root`, which leaves the circle empty and
rings it like a leaf, so the thread's two ends match; its rule is repeated under `:hover`
to outrank the `.is-detached` hover fill above it.

`.folgezettel-list` is a single flex column with `justify-content: flex-start`, so the
strand hangs from the panel's top edge; `overflow-y: auto` plus `scrollbar-gutter: stable`
scrolls it when the pane is too short without letting the bar's arrival resize the content
(see "The list hangs from the top of the panel"). Entries carry `is-incoming` /
`is-active` / `is-outgoing` for styling only — there is no longer a container per side.
Everything below a card is wrapped in a `.folgezettel-continuation` element set to
`display: contents` (layout-transparent), so a hover preview can rebuild just that subtree
without perturbing the strand's flex layout.
