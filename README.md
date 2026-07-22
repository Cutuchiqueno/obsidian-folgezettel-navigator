# Folgezettel Navigator

An [Obsidian](https://obsidian.md) plugin that visualizes and navigates a
Luhmann-style **Folgezettel** note sequence in a sidebar panel.

In a Zettelkasten, each note continues one or more other notes. This plugin
reads those continuation links from a `folgezettel` frontmatter property and
draws the sequence around whatever note you are currently reading.

## How it works

Add a `folgezettel` property to a note pointing at the note(s) that continue it:

```yaml
---
folgezettel:
  - "[[21b3 Second thought]]"
  - "[[21c1 A parallel branch]]"
---
```

- A note may declare **several** Folgezettel targets (an outgoing junction).
- A note may be the Folgezettel target of **several** notes (an incoming junction).

## The Folgezettel panel

Open it from the ribbon (branch icon) or the command palette
(**Open Folgezettel navigator**). The panel always tracks the active note:

- The **active note** sits in the center.
- Up to **5 incoming** notes (what leads here) extend **upward**.
- Up to **5 outgoing** notes (what continues from here) extend **downward**.
- At a **junction** (2+ links in either direction) the sequence stops and shows a
  **branch indicator**. Hover it to list the candidate notes and pick which
  strand to follow next.

Every entry behaves like a native Obsidian link: **Ctrl/Cmd-hover** for a page
preview, **click** to open the note (which re-centers the panel on it).

## Development

```bash
npm install      # install dependencies
npm run dev      # watch + rebuild main.js on change
npm run build    # type-check and produce a production bundle
```

To test in a vault, symlink or copy `main.js`, `manifest.json`, and `styles.css`
into `<vault>/.obsidian/plugins/folgezettel-navigator/`, then enable the plugin
and reload.
