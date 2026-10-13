# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
It covers this plugin's own architecture and design decisions. For conventions generic to any Obsidian
plugin, see `AGENTS.md`.

## Commands

- `npm run dev` — esbuild in watch mode; rebuilds `main.js` on every source change.
- `npm run build` — full type-check (`tsc -noEmit`) then a minified production bundle.
- `npm version <patch|minor|major>` — bumps `manifest.json` + `versions.json` via `version-bump.mjs`.

There is no test runner or linter configured. `npm run build` type-checks under `strict`,
so a green build means the types line up — and *only* that: `tsc` never looks at
`styles.css`, so a change confined to it passes through no gate whatsoever.

**Every change is verified live in the vault Obsidian currently has open, before it is
reported as done. A green build is not a test.** Testing is manual: copy/symlink `main.js`,
`manifest.json` and `styles.css` into that vault's
`.obsidian/plugins/folgezettel-navigator/`, reload the plugin, and check the behaviour or
the rendered styling itself — for a styling change, by reading the computed values off the
live DOM rather than by eye. Restore whatever the test disturbed (the open note, the theme).

*Which* vault is open, and how to drive Obsidian from outside it, differ per machine — a
flatpak on Linux, an ordinary install on Windows — so neither belongs in this file and
neither is written here. Read the vault from Obsidian's own config rather than assuming a
path, and take the tooling from the environment notes for the machine you are on.

## Branches

Development happens on **`develop`**, and commits go there directly — no feature or topic
branches, however tidy one would look. **`main` is for releases**: it advances when a version
is cut, not as work lands. So commit to `develop` where you stand; do not branch off it first,
and do not commit to `main`.

## Architecture

An Obsidian plugin that renders a Luhmann Folgezettel sequence in a sidebar, exposes
jump commands along it, and can extend it by a note. Under the sequence it lists the notes
that link to the shown one in their **body** — the same panel's second answer, and a
disjoint one (see `backlinks.ts`). Eleven source files under `src/`, each a clear layer:

- **`graph.ts`** — pure data layer, no DOM. `buildGraph(app, propertyName)` scans every
  markdown file's configured Folgezettel frontmatter property (default `folgezettel`,
  via the metadata cache) and produces two adjacency maps: `outgoing` (A → its
  continuations) and `incoming` (the reverse edges). Pure function of vault state —
  there is deliberately **no incremental cache**; the graph is rebuilt on each render
  because reading the already-parsed metadata cache is cheap. `folgezettelTargets` is
  that scan for a *single* note (`outgoing[file]`); `buildGraph` is built out of it, and
  `authoring.ts` uses it to see what a note already links to.
- **`view.ts`** — `FolgezettelView` (an `ItemView`), constructed with the plugin so it
  can read live settings. Owns all DOM and rendering (each entry is a left gutter with
  the guide rail + a dot, then the title). Strand traversal lives here, not in
  `graph.ts`, because it depends on pane-local branch state. The panel is **one** strand,
  drawn top to bottom: `walkUp` collects the ancestors (nearest first), `renderChain`
  draws them farthest first, then the active note, then `renderStrand` walks and renders
  the continuations. At a card, everything below moves into a continuation container
  (`branchContinuations`) that a hover preview rebuilds in place (see below).
  `renderStartOfBranch` and `renderEndOfBranch` add the detached entries at the two ends.
  Below all of that, `renderBacklinks` draws the second section (see `backlinks.ts`) into the
  same scroll container, so the two lists scroll as one column.
  `refresh()` re-renders on demand. Each render also reads `bookmarkedPaths` once (see
  `bookmarks.ts`) so entries can be marked as bookmarked, and every entry's title carries the
  vault's file context menu (`attachContextMenu`, see below).
- **`preview.ts`** — `positionPreview(popoverEl, itemEl, viewEl)`: where the native page-preview
  popover goes when the panel is docked in a sidebar. Pure geometry, no `App`, and the only DOM
  it touches is the popover's own box — `view.ts` supplies the three elements and does the
  intercepting (see "Native page preview" below). `previewSidebar` reads the dock off the view's
  container by Obsidian's structural classes (`.mod-right-split`, `.mod-left-split`), which is
  what decides the side, and returns `null` in the main area — the signal to leave the placement
  to Obsidian.
- **`backlinks.ts`** — `bodyBacklinks(app, file)`: the notes whose **body** links to (or
  embeds) `file`, in vault scan order. Pure data layer like `graph.ts`, and rebuilt per render
  for the same reason. "Not in the frontmatter" is not a filter but *where it reads*: the
  metadata cache keeps body references in `links`/`embeds` and frontmatter ones in
  `frontmatterLinks`, so reading only the first two **is** the rule — nothing to compare
  positions against, and nothing to drift if Obsidian changes how a property stores a link.
  That also makes this list disjoint from the strand by construction, which is the point: the
  strand is the frontmatter relation, this is everything else. Neither
  `metadataCache.resolvedLinks` (it counts both kinds together) nor `getBacklinksForFile`
  (undeclared) can answer the question.
- **`bookmarks.ts`** — `bookmarkedPaths(app)` (the paths of every bookmarked note) and
  `onBookmarksChanged(app, cb)`, read off Obsidian's **core Bookmarks plugin**. That plugin
  is not public API — neither `app.internalPlugins` nor its instance appears in
  `obsidian.d.ts` — so the whole module is a narrow structural type over it and every step
  is optional: disabled, missing or reshaped, the panel draws no bookmarks rather than
  failing to draw. Only whole-`file` entries count — Obsidian's own reading of "this note is
  bookmarked": a bookmarked *folder* bookmarks the folder, not its notes, and an entry with
  a `subpath` marks a heading or block, which is why Obsidian leaves that note's tab header
  unmarked. Groups are walked through. Read fresh per render like the graph, and for the same reason.
- **`navigate.ts`** — pure jump targets over a `FolgezettelGraph`, no DOM and no `App`:
  `previousNotes`/`nextNotes` (the two axes) plus `findParent`, `findLeaf`,
  `findNextJunction`, `findPreviousJunction`. Every walk carries a `visited` set, so a
  link cycle terminates the loop rather than hanging it. Kept free of Obsidian objects
  beyond `TFile` so the walks can be exercised against a plain graph.
- **`commands.ts`** — the six navigation commands, built from one `NavigationCommand`
  table. Each entry reduces to a list of candidate notes, so the three outcomes are
  handled once: none → `Notice`, one → open, several → a `FuzzySuggestModal` picker.
  Commands use `checkCallback` so they hide themselves (and their hotkeys go inert) with
  no active markdown note; the graph is only built when a command actually runs. It also
  exports the two pieces every command needs — `activeNote` (the note a command acts
  from) and `NotePicker` — which `authoring.ts` reuses.
- **`authoring.ts`** — the two commands that *write* the sequence: `Create following
  note` (name dialog → create → link → open) and `Link following note` (picker → link).
  Both entry points (`askForNewNote`, `pickNoteToLink`) take their source note as a parameter
  and are exported, because the panel's context menu offers the same two actions on the note
  that was right-clicked rather than the active one.
  Both end in `appendFolgezettel`, one `processFrontMatter` call that puts a wikilink at
  the **end** of the property. No DOM of its own beyond the two modals it opens.
  `createAndLink` **opens the new note before writing the link, and opens it with
  `active: true`** — both load-bearing, see "Opening and writing must not cross" below.
- **`new-note-modal.ts`** — `NewNoteModal`, the name dialog, modeled on Obsidian's rename
  dialog. It owns no rules: the caller passes `validate`, and a returned message keeps
  the dialog open and appears under the field, so a rejected name is never lost to a
  notice that also took the typed text with it.
- **`settings.ts`** — `FolgezettelSettings` (`propertyName`, `maxSteps`,
  `newNoteFolder`), `DEFAULT_SETTINGS` (`folgezettel`, `5`, `""`), and the
  `FolgezettelSettingTab`: a text field for the property, a folder field with
  type-ahead for the new-note folder, a `1–10` slider for the per-direction note count.
  The tab is written **twice over**, and deliberately:
  `getSettingDefinitions()` declares the three settings (Obsidian 1.13+), which is what
  puts them in Obsidian's settings **search** — a tab that only draws itself in
  `display()` cannot be found there — and gets the folder field its type-ahead from
  Obsidian; `display()` stays as the imperative fallback for the older versions
  `manifest.json` still admits, and with it `FolderSuggest`, an
  `AbstractInputSuggest<TFolder>` over `vault.getAllFolders(true)` (picking an option
  there has to `trigger("input")` by hand, because `setValue` alone does not fire the
  event the component's `onChange` listens for). Obsidian skips `display()` whenever
  `getSettingDefinitions()` returns anything, so the two never both run — keep them
  saying the same thing (`LABELS` holds the wording for both), and drop the fallback
  when `minAppVersion` reaches 1.13. `setControlValue` is overridden because the
  inherited one only writes the data file: it normalizes the two text fields and then
  goes through `saveSettings()`, so a change re-renders the open panels.
- **`main.ts`** — plugin entry: loads settings, registers the view type (passing itself
  to the view), the ribbon icon, the panel command, the navigation commands (via
  `registerNavigationCommands`), the authoring commands (via
  `registerAuthoringCommands`), and the settings tab. `saveSettings()`
  persists and then `refresh()`es every open pane so changes apply immediately.

### Key model decisions (read before changing traversal/rendering)

- **Edge direction = reading direction.** An edge A → B means "B continues A" (B is in
  A's `folgezettel`). So `incoming` renders *above* the active note and `outgoing`
  renders *below* it. Do not flip these without also flipping the render order in
  `view.ts`.
- **The list hangs from the top of the panel.** One flex column, packed at the top, inside
  the scroll container `.folgezettel-scroll` (`overflow-y: auto`) that also holds the
  backlinks section, so a panel taller than the pane can still be read through — the bar
  appears only when it is needed, and there is only ever **one** of them. The active note is
  *not* pinned to a fixed height — it sits below however many ancestors there are, and moves
  as the reader navigates.

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
- **Junctions are followed, not stopped.** A note with 2+ links takes the numbered circle
  and the strand continues along the chosen option — the reader's pick
  (`branches.selections`) if any, else the **first declared link** (`selectedOption`). A
  single link is followed, zero ends the strand. The per-direction note cap is
  `settings.maxSteps` (default 5, configurable 1–10; the branch head counts against it
  like any row). The upward chain is collected by `walkUp` and drawn farthest-first, so
  top-to-bottom reads with the sequence.
- **Each strand ends in a detached far-end entry.** Where the per-direction cap cuts a
  walk short, one extra entry is appended past the end — `renderStartOfBranch` at the top,
  `renderEndOfBranch` at the bottom: upward the note the
  current branch was started from (`findParent` from the **active** note — it is that
  note's branch on show), downward the note the strand runs out at (`findLeaf` from the
  **last drawn** note, so a branch the reader picked or is previewing ends at *its* leaf,
  not the first link's). It is drawn detached — a gap on the strand-facing side, both rail
  segments hidden — and does **not** count against `maxSteps`. Upward it is drawn by
  `renderFarEndParent`, which gives it the junction's numbered circle when that note forks
  and, when it does not, the open circle a leaf gets at that same size (the beginning of
  the structure, the thread's other end); a beginning that forks gets the numbered circle
  drawn open, saying both — visual only, with no expand handler, because
  everything between it and the active note is fixed and so there is nothing to choose.
  Downward it keeps the ordinary dot, hollow because a leaf always is. Three
  cases draw nothing: the note is already on screen (the `visited` guard; downward,
  `findLeaf` returns `null` exactly when the farthest entry *is* the leaf), there is no
  such note (the active note is itself the beginning), or — upward only — the farthest
  entry is a junction card, which is already the fork a parent would point at. Because it
  is emitted where the walk stops, it
  lands inside the innermost continuation container, so `renderContinuation` rebuilds it
  with the rest of a hover preview instead of leaving a stale leaf behind.
- **Branch state is pane-local and per-note, and lives as long as the note is open.**
  A note's `BranchState` — `expanded` (which junction cards are open) and `selections`
  (junction key → chosen option path) — is kept in the view's `branchStates`, keyed by
  note path; `render()` points `branches` at the shown note's entry, and that drives
  `renderStrand`. So switching to another tab and back finds a strand exactly as the
  reader left it — the menus left open included — and a metadata refresh never touches it.
  It goes when the note's **last tab** does: `pruneBranchStates` keeps only the notes some
  markdown leaf still shows, and runs on `layout-change` (a background tab closing changes
  no active note) and whenever the shown note changes (a tab that moved on to another
  note). It reads each leaf's `getViewState().state.file`, not its view, because a
  background tab not looked at since startup holds a deferred view; and it always keeps the
  shown note, which may sit in a view that is not a markdown one. Only the hover
  `previewBranch` still resets with the note.
  Junction key = `` `${kind}|${junction.path}` ``, where `kind` is the entry's slot
  (`incoming` / `outgoing` / `active`) — see `branchKey`.
- **The circle goes on the note that has the links; the menu opens one row down.**
  "Here it branches" is a fact about the note with 2+ entries in its Folgezettel property,
  so `forkOptions(file)` reads `outgoing[file]` and `attachBranchToggle` trades that row's
  dot for the numbered circle — wherever the row sits: above the active note, below it, or
  *as* the active note. The option list it opens belongs one row **down**, on the branch
  head, because that is where those branches begin; `renderMenuRow` puts it in place of
  that row's title and the row keeps its own marker. So the two are always adjacent, and a
  note never loses the circle by being entered.

  Two earlier readings are wrong and both cost the reader the fork. `edges[direction]`
  counts a note's **predecessors** when walking up — a different question entirely.
  `outgoing[incoming[file][0]]` asks whether the note *starts* a branch, which is true but
  hangs the icon one row below the fact it describes.

  The circle is attached only when the branch-head row is actually drawn (`renderStrand`
  checks `remaining > 0` first), so it never opens onto nothing. Upward that always holds:
  every ancestor's head is the next row down.
- **Every fork hovers; upward a pick opens, downward it re-roots.** One path for both:
  `previewBranch` → `renderContinuation`, and one row type, `renderMenuRow`. What differs
  is how much the continuation holds. Downward it is the strand beyond the head; upward it
  is **everything below** — the remaining ancestors, the active note and its continuations,
  all of which belong to the branch being looked away from. Clicking differs for the same
  reason: a pick in an `outgoing` menu re-roots the drawn strand and never opens, while one
  in an `incoming` or `active` menu opens the note. From above, the drawn path is the one
  that leads to the note you are on, so going to the branch is the only way to switch to
  it. The menu row's own `kind` decides which, so the fork at the active note (menu below,
  `outgoing`) re-roots while the fork above it (menu on the active row) opens.
- **A fork reads as a normal row until its circle is clicked.** Collapsed, both rows are
  ordinary entries: the forking note's title (click opens it) with the circle in its
  gutter, and below it the branch head's title. Clicking the circle turns the row below
  into the option list — in the **order the property declares**, with the current branch
  marked in place by the hover background until the cursor takes it, never moved to the
  top — and drops that row's own gutter icon for as long as the menu is
  open. Picking an option collapses it. So a title click and a gutter-icon click on the
  same row do different things, and the icon acts on the row beneath.
- **Hover preview is a partial rebuild — never route it through `render()`.** Hovering
  an option in an expanded card (either direction) sets `previewBranch` and reroutes
  that junction's continuation to the hovered option via `renderContinuation(key)`,
  which re-empties **only** that junction's continuation container (tracked in
  `branchContinuations`) and leaves the card — and the option under the cursor —
  untouched. A full `render()` here tears down the hovered element and thrashes
  mouseenter/mouseleave (empirically ~19 renders + a stuck preview), which is exactly
  the bug this design avoids. The card's option order never changes during preview
  (it is the declared order, always). **The hover handlers are attached only when
  `!Platform.isMobile`** — touch has no hover and never fires `mouseleave`, so a mobile
  preview would get stuck; mobile relies on tap-to-select (the option `click` handler).
- **A bookmark is a colour, never a shape.** A bookmarked note keeps whatever gutter icon
  its role calls for — dot, hollow leaf ring, or the numbered branch circle — and changes
  only its colour, so the marker still answers "what kind of note is this?" while the
  bookmark reads at a glance. `renderEntry` and `renderFarEndParent` put `is-bookmarked` on
  the **row**, not the icon, so the one rule per shape covers every icon that row can end up
  with — including the branch circle `attachBranchToggle` swaps in afterwards. The colour is
  `--interactive-accent`, and it is the **only** thing in the gutter that wears it: the active
  note is marked by its row highlight alone, its icon drawn in the same muted grey as every
  other (see Styling). Give the active note's icon the accent back and the bookmark colour has
  to go looking for one of its own again.
- **The second section is a set, not a sequence — and it disappears when empty.** The
  backlinks below the strand are the notes that mention this one in prose: unordered (vault
  scan order, no reading direction to honour), unthreaded (no rail, because nothing threads
  them), and marked with the Backlinks pane's own icon rather than a dot, which would claim a
  place in the strand they do not have. `renderBacklinks` returns before drawing anything when
  there are none — the rule included — so a note nothing links to leaves the panel looking
  exactly as it did before the section existed; an empty heading would cost every such note a
  line to say nothing. Rows are otherwise ordinary entries and go through `renderTitleLink`
  like every other, which is what gives them the preview, the menu and the bookmark colour for
  free. They keep the `folgezettel-entry` class for two concrete reasons: the page preview
  centres on `closest(".folgezettel-entry")`, and the bookmark rules are scoped to it.
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
  `branches.selections`, which is pane-local exploration and lasts only as long as the
  note stays open. Keep the two in step: changing the default on one side without the other
  re-opens the split this rule exists to close.
- **A written link goes to the end, and only to the end.** Both authoring commands append,
  never insert — so a new note is a further branch off the active note and the current
  branch (the first entry) is left alone. Inserting at the front would silently re-route
  every reader of that note, and every jump command with it. The value is always written
  back as a **list**, even when it was a scalar or absent: order carries meaning here, and
  a scalar has no room for the entry the next call adds. Blank entries (the empty list item
  Obsidian leaves behind) are dropped on the way, since writing one back out yields a
  broken link. The link itself is `[[…]]` around `metadataCache.fileToLinktext`, which is
  what Obsidian's own property editor writes and what `graph.ts:toLinkpath` reads back —
  `generateMarkdownLink` is **not** used, because with markdown links enabled it would
  produce a form the property never holds and the graph cannot resolve.
- **Opening and writing must not cross.** Writing a note's frontmatter schedules a
  re-render in every view showing *that* note — Obsidian's Properties pane most visibly.
  Open a different note in between and the pane rebinds to the new file while the pending
  update paints the **old** note's rows into it, and nothing re-renders it again until the
  new note itself changes: the reader sits in a new note described by the properties of
  the one they left. So `createAndLink` opens first and appends afterwards. A delay
  between the two works as well and is worse — it makes correctness a matter of timing.
  Opening also has to pass `active: true`: the name dialog took focus off the editor, and
  without it the file opens in a pane that never becomes active, leaving every view that
  follows the active file a note behind. The same is true of `commands.ts:open`, which the
  command palette (a modal itself) can reach with the editor unfocused.
- **New notes land next to the note they continue, unless told otherwise.** An empty
  `newNoteFolder` means "the source note's own folder", `"/"` (what the folder picker
  writes for the vault root) means the root, and a missing folder is created. So the
  default needs no configuration and keeps a Zettelkasten's notes together.
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
  `"[[Wikilink]]"` and bare `Note` forms and stripping `#heading`/`|alias`. Body references
  arrive already parsed, so `backlinks.ts` only puts them through the public `getLinkpath` to
  drop a subpath; an alias never reaches `ref.link` (that is `displayText`).
- **Body vs. frontmatter references:** `CachedMetadata` splits them — `links` and `embeds`
  against `frontmatterLinks` — which is what lets the two sections of the panel read the same
  cache and never overlap (see `backlinks.ts`).
- **The Backlinks pane's icon:** `setIcon(el, "links-coming-in")`, the id that view returns
  from `getIcon()`. It is Obsidian's own registered icon, not a Lucide lookalike, so the
  section is marked with the symbol the reader already associates with the relation.
- **Native page preview:** entries trigger the `hover-link` workspace event with
  `hoverParent: this` (the view exposes a `hoverPopover` slot for it). This inherits the
  user's "hover to preview" / Ctrl-key setting for free — do not reimplement previews.
  Skipped on `Platform.isMobile` (a tap just opens the note).

  **Docked in a sidebar, its placement is this panel's** — Obsidian's positioner only ever puts
  a popover above or below its target, so a preview opened from an entry covers the entries
  under it, which in a strand is precisely what the reader was looking at.
  `view.ts:placeBesidePane` moves it clear of the whole sidebar and centres it on the hovered
  row: left of a right sidebar, right of a left sidebar. The geometry is `preview.ts`; three
  things make the interception work.

  **In the main area it is not.** A tab group has no fixed place — it can be anywhere, split
  however the reader likes, and as wide as the window — so there is no "beside" that is
  reliably free, and moving the preview out of a pane that fills the window only puts it over
  the editor instead. So `placeBesidePane` returns before replacing anything, and the whole
  native behaviour stands. Note what that rules out: replacing `position` with a no-op and
  letting the first placement lie. Obsidian's later calls are how it follows its own content as
  the embed loads, and swallowing them would strand the preview where the empty box started.
  - **The `hoverPopover` slot is an accessor, not a field.** A popover assigns itself there as
    it shows (`onShow`), and that is the only moment the panel can reach the instance — the
    `hover-link` event hands back nothing. The setter is the hook.
  - **We replace the instance's `position`, not just its coordinates.** Obsidian positions a
    popover more than once: at `show()`, and again from a `ResizeObserver` as the embedded note
    loads and the box settles. Moving it once in the setter would be undone the moment the
    content arrived. `position` is real and absent from `obsidian.d.ts`, so it is reached
    through a structural type and only replaced where it is actually a function — otherwise the
    native placement simply stands. Ordering is safe: Obsidian's own `position()` runs
    immediately *before* `onShow` hands us the popover, and ours follows in the same turn, so
    nothing is painted in between.
  - **The row is remembered on `mouseover`, not read off the popover.** `targetEl` is another
    undeclared internal, and the panel already knows which entry it fired for. It centres on
    the entry row rather than the title, since that is the item the reader is pointing at and
    what grows when a title wraps. A row that was re-rendered away while the popover was
    opening is left to Obsidian's placement (`isConnected`), rather than anchored to a detached
    node at the screen corner.
- **Mobile:** the plugin is mobile-compatible (`isDesktopOnly: false`, no Node/Electron
  APIs). Everything works by tap, with a **long press** standing in for the right-click file
  menu (above); only the two desktop **hover** affordances — the branch option preview and the
  page preview — are gated off via `Platform.isMobile`.
- **Bookmarks:** `app.internalPlugins.getPluginById("bookmarks")`, through `bookmarks.ts`
  — unofficial, hence the defensive reading there. Its instance's `changed` event re-renders
  the open panels (registered in `view.ts:onOpen`); when it is unavailable the colour simply
  waits for the next render there would have been anyway. The subscription is made once, at
  `onOpen`, so a Bookmarks plugin *enabled later* is picked up by `bookmarkedPaths` (read per
  render) but stops delivering its own live updates until the pane is reopened.
- **File context menu:** right-clicking a title builds a `Menu` in `fileMenu`, adds what the
  vault gives a note plus this panel's own two authoring actions, fires
  `workspace.trigger("file-menu", menu, file, VIEW_TYPE, leaf)`, and then **prunes** what came
  back. Obsidian has **no shared builder** for that menu — the File Explorer, the graph view
  and the canvas each assemble their own items and then fire the same event — so the menu is
  assembled from three sides:
  - *Added here:* "Open in new tab", "Open to the right", "Rename...", "Delete" — measured
    against a live vault, the only wanted items the event does **not** bring. Add one it does
    bring and it appears twice (how "Open in new window" came and went). Rename and delete go
    through `fileManager.promptForFileRename` / `promptForDeletion`: real, absent from
    `obsidian.d.ts`, reached through a structural type, and each item is offered only when its
    method is there.
  - *This panel's own:* "Create following note" and "Link following note", in a `folgezettel`
    section of their own, which lands between the open group and the file operations because
    `Menu` orders sections by first appearance and these are added before the event fires.
    Both call into `authoring.ts` with **the right-clicked note** as the source, not the
    active one — the commands cannot do that, and it is the reason the menu carries them.
  - *Pruned afterwards:* `PRUNED_MENU_ITEMS` — the `view.linked` group (local graph,
    backlinks, outgoing links, properties, outline: views about a note, not operations on a
    file), "Merge entire file with...", and "Open in default app". Matching is by section,
    icon and callback source, never by **title**, which is localised and would stop matching
    the moment Obsidian runs in another language. The first two are unique by section and
    icon; "Open in default app" shares both with "Show in system explorer", which stays, so it
    is told apart by the `openWithDefaultApp` in its callback. `pruneMenu` reaches into
    `menu.items` (no public way to remove an item) and detaches each entry's DOM node with it,
    since `Menu` appends nodes as items are added and only reorders at show time; every step
    is guarded, so a renamed internal prunes nothing rather than breaking the menu.

  Sections are named as core names them (`open`, `action`, `danger`) so contributed items
  interleave instead of piling up; there is no `title` label item, by request. The handler
  sits on the title link, which fills the row apart from the gutter — so the branch circle
  keeps its own gutter, and a right-click there does nothing.
- **Long press is the touch spelling of that menu.** `attachLongPress` (mobile only) opens the
  same `Menu` with `showAtPosition` after `LONG_PRESS_MS` on the finger. Three things make it
  behave: every listener is **passive**, because the panel is a scrolling list and a press
  must never swallow a scroll — so a move past `LONG_PRESS_SLOP_PX` (or a second finger)
  cancels it instead; the release still fires a `click`, which `swallowNextTap` eats so the
  note behind the menu does not open; and `contextmenu` stays attached on mobile too (a tablet
  with a trackpad can right-click), with the timer cancelling on `contextmenu` and a
  timer-opened menu swallowing any `contextmenu` a WebView fires behind it within
  `PRESS_MENU_GRACE_MS`. Verified under `app.emulateMobile(true)`: press opens the menu and
  the release does not navigate, a 40px move cancels it, a quick tap still opens the note.
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

A sequence note shows a filled dot (`.folgezettel-dot`) in the gutter, drawn in
`--nav-item-color` (the muted title gray) — the active (pivot) note included, since its row
already carries `--nav-item-background-active` and a second mark would only spend the accent
twice. A **leaf** — a note nothing continues — keeps that size and colour but is drawn
hollow: `background-color: transparent` plus an inset `box-shadow` ring of
`--fz-ring-width`, which leaves the shape exactly `--fz-icon-size` across so the rail gaps
still line up (a border would grow the box). It applies to the active note too, and marks
a thread that really ends apart from one `maxSteps` merely cut short. A forking row has no
dot at all — `attachBranchToggle` empties the marker before adding the circle — so the
count keeps the slot. A row **carrying an open menu has no icon at all**: it stands for a
choice, not yet for a note, so a dot or a circle there would describe whichever branch
happens to lead; `renderMenuRow` leaves the marker empty and closing the menu redraws
whatever the note then chosen calls for. Its rail runs straight through instead of stopping
short — `.folgezettel-entry.is-expanded .folgezettel-marker` zeroes `--fz-icon-size` and
`--fz-rail-gap`, which closes the two segments into one line past the card. The gutter icon sits at the entry's **vertical centre**
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
otherwise cap its width at half the marker). The count itself sits in a
`.folgezettel-branch-count` span, which exists only so the digit can be trimmed to its own
ink (`text-box: trim-both cap alphabetic`): centring the bare text centres its *line box*,
as tall as the font's ascent plus descent, and a digit has no descender, so the unused
descent space lifts the number about a pixel off the circle's centre — and device-pixel
rounding then makes that read as a bug of the topmost entry, the one row whose circle always
falls on the same unlucky half-pixel. A bare text node is an anonymous flex item that no
selector can reach, hence the span. Engines without `text-box` ignore the rule and keep the
old placement. When expanded, its
`.folgezettel-branch-options` list takes the place of the title, styled to mirror
Obsidian's search-result preview (`.search-result-file-matches` — `--search-result-background`,
a `box-shadow` border ring, options divided by `border-bottom`). An expanded card takes a
small margin on both sides, so its filled background never butts against a neighbouring
filled row — the active one above or below it, or another expanded card.

The options keep the order the Folgezettel property declares them in. The branch currently
taken (`.is-current`) stays wherever it was declared, and wears the hover background
before the cursor is anywhere in the list, so the menu opens already showing where the
strand runs. It was once moved to the top, which reshuffled the list after every pick and
hid the declared order — the very order that says which branch continues the strand. The
highlight is written as `.folgezettel-branch-options:not(:hover)` rather than a rule that clears the highlight when the list is hovered: hovering the current option
would then have to out-specify its own clearing rule. With `:not(:hover)` the two rules
never overlap — inside the list only `.folgezettel-branch-option:hover` applies, and the
background simply follows the cursor.

A **bookmarked** note's icon is drawn in `--fz-bookmark-color`, which is
`--interactive-accent`: the filled dot takes it as a fill, a leaf's ring as its ring colour,
and the branch circle as its fill, with the count knocked out in `--text-on-accent`, the ink
Obsidian pairs with that fill in either theme. An open root circle takes it on ring and
count together. The accent is the reader's own colour, follows
whatever the theme or they set, and nothing else in the gutter uses it — the active row is
marked by its highlight, not its icon — so it means "bookmarked" and nothing else.

It did not start there. While the active note's dot wore the accent, the bookmark needed a
colour that stayed clear of it *and* still belonged to the panel, and those answer to
different properties: **hue carries the distance, chroma carries the glare.** Three fixed
colours failed on one axis or the other — `--color-yellow` sat 4° off the true complement at
full chroma (maximum distance *and* maximum vibration, exactly the pair that glares),
`--color-cyan` glared the same way at 98°, `--color-pink` muted was quiet but only 62° off,
near enough to read as a shade of the accent — and the answer was to derive the colour from
the accent instead: `oklch(from var(--interactive-accent) l c calc(h + 180))` mixed 60% into
`--nav-item-color`, the muted complement, behind an `@supports (color: oklch(from red l c h))`
guard for engines without relative colour syntax. All of that existed to avoid the accent.
With the active note's icon no longer wearing it, there is nothing left to avoid, and the
derivation, its guard and its fallback are gone with it.

Obsidian's highlight colour (`--highlight-background`, which already folds in a theme's
legacy `--text-highlight-bg`) was considered and is **not** used. It is a 30% wash made for
sitting behind text and derives from `--color-yellow`: opaque it is just that yellow, and
left translucent an 8px dot painted in it all but vanishes on a light background (1.25:1
against white, measured).

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

`is-root` is a fact about the note — nothing lists it in its Folgezettel property
(`isRoot`, off `incoming`) — so `renderEntry` puts it on every row it draws for one, not
just the far end. It only changes a **branch circle**: a beginning that forks keeps its
count but is drawn open, ring and count both `currentColor` in `--nav-item-color`, as the
far end, as an ancestor and as the active note alike. A beginning that does not fork keeps
its ordinary dot inside the strand; only the far end draws it as the empty ring. In the
strand the open circle is still the fork's control, so on hover ring and count take
`--nav-item-color-hover` where a filled circle changes its fill (`:not(.is-detached)`,
since the far end is not a control). At the far end, a note that does not fork is treated as
the beginning even when a link cycle gives it a predecessor — it is what `findParent` fell
back to — so it never ends up a filled circle with nothing in it.

`.folgezettel-list` is a single flex column with `justify-content: flex-start`, so the
strand hangs from the panel's top edge. The scrolling is one level up, on
`.folgezettel-scroll`, which holds the strand, the divider and the backlinks section:
`overflow-y: auto` plus `scrollbar-gutter: stable` scrolls the panel as one column when the
pane is too short, without letting the bar's arrival resize the content (see "The list hangs
from the top of the panel"). Entries carry `is-incoming` /
`is-active` / `is-outgoing` for styling only — there is no longer a container per side.
Everything below a card is wrapped in a `.folgezettel-continuation` element set to
`display: contents` (layout-transparent), so a hover preview can rebuild just that subtree
without perturbing the strand's flex layout.

The backlinks section is separated by `.folgezettel-divider`: a rule `2em` wide, centred with
`margin: var(--size-4-4) auto`, at `--border-width` in `--hr-color` — the colour every border
and `<hr>` in the app resolves to. Its `em` is the panel's own `--font-ui-small`, set on the
element, so the ornament keeps its measure against the text it divides rather than against a
root font it never uses; short and centred, it reads as a break between two lists rather than
as the frame of a second panel. Rows there are ordinary `.folgezettel-entry` elements with
`is-backlink`, which hides both `.folgezettel-marker` rail segments, and their gutter carries
`.folgezettel-backlink-icon` — Obsidian's Backlinks icon at `--icon-xs` (14px, the branch
circle's slot) in `--nav-item-color`, taking `--fz-bookmark-color` when the row is bookmarked
like every other icon in the gutter.
