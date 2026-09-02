# Changelog

All notable changes to Folgezettel Navigator are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
