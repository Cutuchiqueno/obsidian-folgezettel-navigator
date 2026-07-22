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
  edges). `walk(...)` traverses one direction from a start note. Both are pure
  functions of vault state — there is deliberately **no incremental cache**; the graph
  is rebuilt on each render because reading the already-parsed metadata cache is cheap.
- **`view.ts`** — `FolgezettelView` (an `ItemView`). Owns all DOM and rendering (each
  entry is a left gutter with the guide rail + direction chevron, then the title), plus
  the branch hover-popup lifecycle.
- **`main.ts`** — plugin entry: registers the view type, ribbon icon, and command.

### Key model decisions (read before changing traversal/rendering)

- **Edge direction = reading direction.** An edge A → B means "B continues A" (B is in
  A's `folgezettel`). So `incoming` renders *above* the active note and `outgoing`
  renders *below* it. Do not flip these without also flipping the render order in
  `view.ts`.
- **Junctions terminate a strand.** `walk()` stops and returns a `branch` terminator
  the moment a note has 2+ neighbours in the walk direction; a single neighbour is
  followed, zero ends the strand. `MAX_STEPS` (5) caps each direction. The upward chain
  is reversed at render time so top-to-bottom reads with the sequence.
- **Rendering is full teardown.** `render()` calls `contentEl.empty()` and rebuilds.
  It is wired to `active-leaf-change`, `metadataCache` `resolved`, and `changed` — so
  the panel re-centers on note switches and refreshes when links change.

### Obsidian integration points

- **Link resolution:** `metadataCache.getFirstLinkpathDest(linkpath, sourcePath)`.
  `graph.ts:toLinkpath` normalizes raw frontmatter values, tolerating both
  `"[[Wikilink]]"` and bare `Note` forms and stripping `#heading`/`|alias`.
- **Native page preview:** entries trigger the `hover-link` workspace event with
  `hoverParent: this` (the view exposes a `hoverPopover` slot for it). This inherits the
  user's "hover to preview" / Ctrl-key setting for free — do not reimplement previews.
- **Navigation:** `workspace.getLeaf(newLeaf).openFile(file)`; Ctrl/Cmd-click opens in a
  new leaf, matching native link behavior.
- **Branch popup** is a hand-rolled `document.body` element reusing Obsidian's `.menu` /
  `.menu-item` classes for native styling; guard its lifecycle through
  `clearBranchPopup()` (also called on `onClose`) to avoid leaking detached nodes.

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

The indentation rail is a per-entry `.folgezettel-marker::before` spanning full row
height, so consecutive entries form one continuous line; it is hidden on the active
(pivot) row.
