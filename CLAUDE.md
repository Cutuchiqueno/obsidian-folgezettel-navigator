# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — esbuild in watch mode; rebuilds `main.js` on every source change.
- `npm run build` — full type-check (`tsc -noEmit`) then a minified production bundle.
- `npm version <patch|minor|major>` — bumps `manifest.json` + `versions.json` via `version-bump.mjs`.

There is no test runner or linter configured. `npm run build` is the correctness gate:
the `tsc` step runs under `strict` mode, so a green build means the types line up.

Testing is manual: copy/symlink `main.js`, `manifest.json`, and `styles.css` into a
vault's `.obsidian/plugins/folgezettel-navigator/` and reload Obsidian.

## Architecture

An Obsidian plugin that renders a Luhmann Folgezettel sequence in a sidebar. Three
source files under `src/`, each a clear layer:

- **`graph.ts`** — pure data layer, no DOM. `buildGraph(app)` scans every markdown
  file's `folgezettel` frontmatter property (via the metadata cache) and produces
  two adjacency maps: `outgoing` (A → its continuations) and `incoming` (the reverse
  edges). Pure function of vault state — there is deliberately **no incremental
  cache**; the graph is rebuilt on each render because reading the already-parsed
  metadata cache is cheap.
- **`view.ts`** — `FolgezettelView` (an `ItemView`). Owns all DOM and rendering (each
  entry is a left gutter with the guide rail + a direction chevron, then the title).
  Strand traversal lives here, not in `graph.ts`, because it depends on pane-local
  branch state. The **incoming** side is computed by `buildStrand` then rendered; the
  **outgoing** side is walked *and* rendered together by `renderOutgoing`, so each
  junction's continuation gets its own container that a hover preview can rebuild in
  place (see below).
- **`main.ts`** — plugin entry: registers the view type, ribbon icon, and command.

### Key model decisions (read before changing traversal/rendering)

- **Edge direction = reading direction.** An edge A → B means "B continues A" (B is in
  A's `folgezettel`). So `incoming` renders *above* the active note and `outgoing`
  renders *below* it. Do not flip these without also flipping the render order in
  `view.ts`.
- **Active note pinned to the vertical centre.** The list is a flex column of three
  parts: an incoming region (`flex: 1`, bottom-anchored via `justify-content:
  flex-end`), the active entry (`flex: 0 0 auto`), and an outgoing region (`flex: 1`,
  top-anchored). Each region grows *outward* from the active note and clips at its far
  end (`overflow: hidden`, so tall strands are cut off, not scrolled). This is not just
  cosmetic: because every continuation grows away from the active note, a hovered branch
  card never shifts under the cursor — the precondition that lets the outgoing hover
  preview work, and that the (still unbuilt) incoming preview will rely on.
- **Junctions are followed, not stopped.** When a note has 2+ neighbours in the walk
  direction, a `branch` entry is emitted and the strand continues along the chosen
  option — the reader's pick (`branchSelections`) if any, else the option with the most
  recent file **mtime** (`mostRecent`). A single neighbour is followed, zero ends the
  strand. `MAX_STEPS` (5) caps the note count per direction (branch entries count). The
  upward chain is reversed at render time so top-to-bottom reads with the sequence.
- **Branch state is pane-local and per-note.** `expandedBranches` (which junction
  cards are open) and `branchSelections` (junction key → chosen option path) live on
  the view and drive `buildStrand`. They are **cleared whenever the active note
  changes** (`currentPath` guard in `render()`) but survive metadata refreshes.
  Junction key = `` `${direction}|${junction.path}` `` (see `branchKey`).
- **A junction renders inline as a normal entry when collapsed.** It shows the chosen
  option's title (click opens the note) with a fork icon in the gutter; clicking the
  fork icon expands the entry into the full option list (a card — see Styling), the
  **chosen option first, not emphasised**, and picking one collapses it and re-roots the
  strand (it does **not** open the note). So a title click and a gutter-icon click on
  the same entry do different things.
- **Outgoing hover preview is a partial rebuild — never route it through `render()`.**
  Hovering an option in an expanded *outgoing* card sets `previewBranch` and reroutes
  that junction's continuation to the hovered option via `renderContinuation(key)`,
  which re-empties **only** that junction's continuation container (tracked in
  `branchContinuations`) and leaves the card — and the option under the cursor —
  untouched. A full `render()` here tears down the hovered element and thrashes
  mouseenter/mouseleave (empirically ~19 renders + a stuck preview), which is exactly
  the bug this design avoids. The card's option order never changes during preview
  (chosen option stays first). Incoming previews are deliberately not implemented yet.
- **Rendering is otherwise full teardown.** `render()` calls `contentEl.empty()` and
  rebuilds; expand/select/navigation mutate state and call `render()` (hover preview is
  the lone exception, above). It is wired to `active-leaf-change`, `metadataCache`
  `resolved`, and `changed` — so the panel re-centers on note switches and refreshes
  when links change.

### Obsidian integration points

- **Link resolution:** `metadataCache.getFirstLinkpathDest(linkpath, sourcePath)`.
  `graph.ts:toLinkpath` normalizes raw frontmatter values, tolerating both
  `"[[Wikilink]]"` and bare `Note` forms and stripping `#heading`/`|alias`.
- **Native page preview:** entries trigger the `hover-link` workspace event with
  `hoverParent: this` (the view exposes a `hoverPopover` slot for it). This inherits the
  user's "hover to preview" / Ctrl-key setting for free — do not reimplement previews.
- **Navigation:** `workspace.getLeaf(newLeaf).openFile(file)`; Ctrl/Cmd-click opens in a
  new leaf, matching native link behavior. Selecting a branch option, by contrast, never
  opens a note — it only mutates pane state and re-renders.

### Styling

The panel is deliberately modeled on the **File Explorer nav item**, so `styles.css`
uses the same theme variables the Explorer does — `--nav-item-color`,
`--nav-item-color-hover`, `--nav-item-background-active`, `--indentation-guide-color`,
`--indentation-guide-width` — rather than generic accent/text tokens. Match those when
extending it; prefer a variable-based rule over a hard-coded color or dimension.

Two non-obvious pitfalls when touching the entry markup/styling:

- **The chevron is the Explorer's `right-triangle` SVG, hand-built in `view.ts`
  (`createChevron`).** `createSvg`'s `cls` must be an **array** (`["svg-icon",
  "right-triangle"]`); a space-separated string throws (`DOMTokenList` rejects the
  space) and silently aborts the whole render. Its stroke-width is set to `4px` in CSS
  to match the Explorer (the default `--icon-stroke` is too thin).
- **The title is an `<a>`,** so it inherits Obsidian's link-accent color on `:hover`.
  `.folgezettel-title:hover` explicitly overrides `color` to `--nav-item-color-hover` to
  keep it looking like a nav item, not a link.

The indentation rail is drawn per entry as **two** guide segments,
`.folgezettel-marker::before` (above the icon) and `::after` (below), which stop
`--fz-rail-gap` short of the gutter icon so the line never touches it — as the Explorer
clears its collapse triangles. The gap is anchored to `--fz-icon-top` / `--fz-icon-size`
(marker-scoped custom properties; the branch marker overrides `--fz-icon-size` to `14px`
for the larger fork). Consecutive entries' segments meet at the row boundary to read as
one line; both segments are hidden on the active (pivot) row.

A junction entry replaces the direction chevron with a `git-fork` icon
(`.folgezettel-branch-toggle`) in the same gutter slot; when expanded, its
`.folgezettel-branch-options` list takes the place of the title, styled to mirror
Obsidian's search-result preview (`.search-result-file-matches` — `--search-result-background`,
a `box-shadow` border ring, options divided by `border-bottom`). When such an expanded
card sits directly next to the active row, an adjacent-sibling rule adds a small
`margin-top` so its filled background does not butt against the active row's.

The list splits into `.folgezettel-region.is-incoming` / `.is-outgoing` (each `flex: 1`,
`overflow: hidden`) with the active entry between them, so the active note stays
vertically centred (see "Active note pinned to the vertical centre"). Each outgoing
junction's continuation is wrapped in a `.folgezettel-continuation` element set to
`display: contents` (layout-transparent), so a hover preview can rebuild just that
subtree without perturbing the sequence's flex layout.
