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
  `graph.ts`, because it depends on pane-local branch state. Both sides are walked *and*
  rendered together by `renderStrand(parent, from, direction, visited, budget)`, emitting
  entries nearest → farthest; at a junction it renders the card plus a continuation
  container (`branchContinuations`) that a hover preview can rebuild in place (see below).
  The incoming region is flipped visually with CSS `column-reverse` so the same
  nearest-first walk reads bottom → top. `refresh()` re-renders on demand.
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
- **Active note pinned to the vertical centre.** The list is a flex column of three
  parts: an incoming region (`flex: 1`, `column-reverse` so it's bottom-anchored and
  grows upward), the active entry (`flex: 0 0 auto`), and an outgoing region (`flex: 1`,
  top-anchored). Each region grows *outward* from the active note and clips at its far
  end (`overflow: hidden`, so tall strands are cut off, not scrolled). This is not just
  cosmetic: because every continuation grows away from the active note, a hovered branch
  card never shifts under the cursor — the precondition that makes the hover preview
  work in **both** directions.
- **Junctions are followed, not stopped.** When a note has 2+ neighbours in the walk
  direction, a `branch` entry is emitted and the strand continues along the chosen
  option — the reader's pick (`branchSelections`) if any, else the **first declared
  link** (`selectedOption`). A single neighbour is followed, zero ends the strand. The per-direction note cap is `settings.maxSteps` (default 5, configurable
  1–10; branch entries count against it). The upward chain is reversed at render time so
  top-to-bottom reads with the sequence.
- **Branch state is pane-local and per-note.** `expandedBranches` (which junction
  cards are open) and `branchSelections` (junction key → chosen option path) live on
  the view and drive `renderStrand`. They are **cleared whenever the shown note
  changes** (the `currentPath` guard in `render()`, which also treats "no note" as a
  change) but survive metadata refreshes.
  Junction key = `` `${direction}|${junction.path}` `` (see `branchKey`).
- **A junction renders inline as a normal entry when collapsed.** It shows the chosen
  option's title (click opens the note) with a fork icon in the gutter; clicking the
  fork icon expands the entry into the full option list (a card — see Styling), the
  **chosen option first, not emphasised**, and picking one collapses it and re-roots the
  strand (it does **not** open the note). So a title click and a gutter-icon click on
  the same entry do different things.
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
note. The gutter icon sits at the entry's **vertical centre** (`top: 50%`); the marker is
`align-items: stretch`, so it spans the entry's full height and the icon stays centred
however many lines the title wraps to (the title's small left padding sets the
gutter-to-text gap). The indentation rail is drawn per entry as **two** guide segments,
`.folgezettel-marker::before` (above the icon) and `::after` (below), each stopping
`--fz-rail-gap` short of the icon — `50% ∓ (--fz-icon-size / 2 + --fz-rail-gap)` — so the
line never touches it. `--fz-icon-size` is `8px` for the dot, overridden to `14px` on the
branch marker for the larger fork. Consecutive entries' segments meet at the row boundary
to read as one line; both segments are hidden on the active (pivot) row.

A junction entry uses a `git-fork` icon (`.folgezettel-branch-toggle`) in the gutter slot
instead of the dot; when expanded, its
`.folgezettel-branch-options` list takes the place of the title, styled to mirror
Obsidian's search-result preview (`.search-result-file-matches` — `--search-result-background`,
a `box-shadow` border ring, options divided by `border-bottom`). When the entry nearest
the active row is an expanded card (each region's `:first-child`, since the walk is
nearest-first), a small margin on its active-facing side keeps its filled background
from butting against the active row's — `margin-top` for outgoing, `margin-bottom` for
incoming (the region is `column-reverse`, so the nearest card sits at its bottom).

The list splits into `.folgezettel-region.is-incoming` / `.is-outgoing` (each `flex: 1`,
`overflow: hidden`) with the active entry between them, so the active note stays
vertically centred (see "Active note pinned to the vertical centre"). The incoming
region uses `flex-direction: column-reverse`, so the nearest-first walk order renders
bottom → top. Each junction's continuation is wrapped in a `.folgezettel-continuation`
element set to `display: contents` (layout-transparent), so a hover preview can rebuild
just that subtree without perturbing the sequence's flex layout.
