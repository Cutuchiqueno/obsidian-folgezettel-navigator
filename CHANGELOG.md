# Changelog

All notable changes to Folgezettel Navigator are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Findings from Obsidian's plugin review.** The panel no longer uses `display: contents`,
  which the review flags as only partially supported by older Obsidian versions. Nothing
  changes on screen. And the release files are now built and attested on GitHub, so you can
  verify that they were built from this repository:
  `gh attestation verify main.js --repo Cutuchiqueno/obsidian-folgezettel-navigator`.

## [1.3.0] — 2026-10-22

The accent colour on the rail now follows your index notes instead of your bookmarks: it
shows which notes along a sequence an index already reaches, and a hover tells you what the
index calls them.

### Added

**Notes an index links to stand out on the rail.** A note keeps whatever marker it would
have — dot, numbered branch circle, or an open circle at either end of the thread — and
draws it in your accent colour when an *index note* links to it in its text. An index note
is one whose frontmatter marks it as one, `typ: index` by default.

**See what your index calls a note.** Hover the marker of an indexed note to see the name
its index gives it: the part after the `|` in the link, as in `[[Note|this name]]`. A note
linked under several names lists them all, one per line; one linked by its bare name shows
nothing extra.

**Note type property and Index value settings.** The frontmatter property that holds a
note's type, and the type that makes a note an index note — `typ` and `index` unless you
change them. The value is matched regardless of case, and also as one entry of a list.

### Changed

- **Bookmarks no longer colour the rail.** The accent belongs to indexed notes now (above).
  The bookmark item in the right-click menu is unaffected.
- **The rail's circles no longer explain themselves on hover.** The numbered circle used to
  show "Show 3 branches", and the circle at the top end "Forks into 3 notes" or "Beginning
  of the structure". The only hover left in the gutter is the names of indexed notes.

## [1.2.0] — 2026-10-13

The panel stops being read-only. You can now grow a sequence from it, act on any note in it
without leaving the pane, see at a glance which notes you have bookmarked, and see what else
links to the note you are on.

### Added

**Two commands for extending a sequence.** Until now the plugin only read the structure;
these two write it. Both act on the note you are on and append to the **end** of its
Folgezettel property, so what they add is a further branch and the current branch stays
put.

| Command | Does |
| --- | --- |
| Create following note | Asks for a name, creates the note, links it, and opens it |
| Link following note | Opens a picker of the vault's notes and links the one you choose |

*Create following note* asks for the name in a dialog modeled on Obsidian's rename
dialog. A name that is empty, illegal, or already taken keeps the dialog open with the
reason under the field, instead of throwing away what you typed. *Link following note*
offers every note except the one you are on and the ones it already links to.

**Right-click a note in the panel for its menu.** Every entry now carries a context menu, so
you can act on any note in the sequence without leaving the panel: open it in a tab, split or
window, rename, move, bookmark, delete, copy its path, or reveal it. On mobile, press and
hold a note for the same menu; a press that turns into a flick scrolls the panel instead.

The menu also carries **Create following note** and **Link following note**, and — unlike the
commands, which always act on the note you are in — they extend the note you right-clicked.
So you can grow a branch anywhere in the sequence on show without navigating there first.

**Bookmarked notes stand out on the rail.** A note you have bookmarked keeps whatever marker
it would have — dot, numbered branch circle, or an open circle at either end of the thread —
and draws it in your accent colour, which nothing else on the rail uses any more. So your
bookmarks are visible along the sequence without hiding what kind of note each one is. It
reads Obsidian's core Bookmarks plugin, groups included, and updates as you bookmark and
unbookmark. With that plugin turned off, nothing changes.

**See what else links here.** Under the sequence, after a short rule, the panel lists the
notes that link to the one you are on in their text — ordinary links and embeds, as opposed
to the Folgezettel property that makes the sequence. The two lists never overlap. The
entries open, preview and right-click like every other entry, and are marked with
Obsidian's backlinks icon; there is no guide rail through them, since they are not a
thread. When nothing links to the note, the section is not there at all.

**New note location setting.** Which folder *Create following note* creates notes in,
with folder autocompletion as Obsidian's own path settings have. Left empty — the
default — each note is created next to the note it continues. A folder that does not
exist yet is created.

**The settings are searchable.** All three are declared to Obsidian (1.13 and later), so
they turn up in the search at the top of the settings window instead of only on the
plugin's own tab. On older versions the tab renders as before.

### Changed

- **The page preview opens beside the sidebar, not over the sequence.** Hovering a title
  used to open Obsidian's preview right below or above it, covering the very notes you were
  reading along. With the panel in a sidebar, the preview now opens next to the sidebar,
  level with the note you are pointing at. With the panel in a tab, Obsidian places it as
  usual — a tab has no edge the preview could reliably go beside.
- **The note you are on is marked by its highlighted row alone.** Its marker is now drawn
  in the same grey as every other, which leaves the accent colour to bookmarks.
- **An open branch menu keeps the order of the Folgezettel property.** It used to move the
  branch you are on to the top, so the order changed after every pick and no longer showed
  which branch continues the thread. That branch is now highlighted where it stands.
- **The beginning of a structure is drawn as an open circle wherever it branches.** A
  first note that forks used to look like any other fork; it now keeps its number inside an
  open circle — at the top of the panel, further up the sequence, and when you are on it —
  so the two ends of a thread still match.

### Fixed

- **Your branch choices survive a switch to another tab.** Picking branches in the panel,
  switching to a tab with another note and coming back used to reset the panel to first
  links. It now keeps the branches you picked, and any branch menus you left open, for as
  long as the note stays open in a tab; closing it lets them go.
- **The number in a branch circle sits in its centre.** It used to sit about a pixel high,
  most visibly on the topmost entry.

## [1.1.0] — 2026-09-02

You can now move along a sequence from the keyboard, see at a glance what kind of note
each entry is, and look down a branch before deciding to take it.

### Added

**Six commands for moving along the sequence.** They work whether or not the panel is
open, and you can give any of them a hotkey. Find them in the command palette under
*Folgezettel Navigator*:

| Command | Goes to |
| --- | --- |
| Open previous note | The note that leads into this one |
| Open following note | The note this one continues into |
| Open parent note | The note this branch was started from |
| Open leaf note | The end of the current branch |
| Open next junction note | The next fork further down the branch |
| Open previous junction note | The nearest fork further up |

They disappear from the palette when no note is open, and when a jump is genuinely
ambiguous they ask which note you meant instead of guessing.

**The gutter now tells you what kind of note you are looking at.** Previously every note
carried the same dot and a fork carried a small branch glyph. The markers now distinguish
five things:

| Marker | Meaning |
| --- | --- |
| Filled dot | A note in the sequence |
| Accent-coloured dot | The note you are on |
| Filled circle with a number | A note that branches, and how many branches it has |
| Small open circle | A note nothing continues — the end of the thread |
| Large open circle | The beginning of the structure |

The number means you can see how many branches a fork holds without opening it. The open
circles matter because a thread that genuinely ends now looks different from one the panel
merely cut short at your chosen length — and the two ends of a thread are drawn alike.

**Both ends of the branch stay in view.** When the sequence runs on past the number of
notes you have chosen to show, an extra entry appears above it for the note the branch was
started from, and below it for the note the branch ends at. They are set apart by a gap
with no guide rail running to them, because they are not the next note along — they are
the two ends of the branch you are somewhere in the middle of. Either is left out when it
is already on screen.

**Look down a branch before you take it.** Hovering an option in an open branch menu shows
you where that branch leads. For a fork above the note you are on, the preview stands in
for everything below the menu — the rest of the sequence, your current note included — and
everything snaps back as soon as you move the pointer away.

**Scrolling.** If the pane is too short for the sequence, the panel scrolls. If it isn't,
there is no scrollbar.

### Changed

- **The panel reads from the top down.** The sequence starts at the top of the pane and
  runs straight down in the order the notes continue one another, with the note you are on
  in its place along the thread. It used to be pinned to the middle of the pane with the
  sequence growing outward from it in both directions.
- **The branch circle sits on the note that actually branches** — the one with more than
  one link in its Folgezettel property — instead of on the note that starts one of the
  branches. The list of branches still opens on the row below, where those branches begin.
- **An open branch menu shows the branch you are on already highlighted**, and the row it
  occupies drops its gutter marker while it is open, since it is showing you a choice
  rather than one note. Closing it brings back the marker for whichever note you picked.

### Fixed

- **Entering a branch no longer costs you the fork you came from.** The numbered marker
  used to vanish as soon as you opened the first note of a branch, and stayed gone as you
  moved further down it — so from anywhere along a branch there was no way back to its
  siblings without navigating away. Forks above the note you are on now stay open-able.

### Removed

- **The choice of predecessor on notes that two notes link to.** The panel used to let you
  pick which of them to show above. That situation is a mistake in the notes rather than a
  real branch, so the panel no longer offers a choice there — it follows the first one,
  the same as the jump commands always have.

## [1.0.1] — 2026-07-24

- Fixed the findings from Obsidian's automated plugin review.
- Internal typing fix for the panel's page-preview support.

## [1.0.0] — 2026-07-22

- First release: a sidebar panel showing the Folgezettel sequence around the note you are
  on, with forks you can expand and pick from, Obsidian's own page previews on hover, and
  settings for which frontmatter property to read and how many notes to show on each side.
