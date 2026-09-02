# AGENTS.md

Generic conventions for building Obsidian community plugins — the parts that
hold for *any* such plugin, not just this one. For this plugin's specific
architecture, model decisions, and styling pitfalls, see `CLAUDE.md`.

Where this repo currently diverges from a convention below, the divergence is
called out inline so the two files never contradict each other.

## Manifest

`manifest.json` must carry a plugin ID, display name, semantic version,
minimum Obsidian app version, and description. The ID is a permanent
identifier — once released, it must not change, since it's how Obsidian and
the community plugin registry key the plugin.

## Code organization

Keep the plugin entry point (`main.ts`) focused on lifecycle: loading
settings, registering views/commands/ribbon icons, wiring the settings tab.
Delegate actual feature logic to separate, single-purpose modules rather than
growing the entry file. As a rule of thumb, split a file once it grows past
roughly 200–300 lines into something with a clear seam.

## Security: local-first by default

Default to local/offline operation. Only make a network request when it's
essential to a feature, and make that essential when a user can see it — no
silent background calls to third-party services. *(This repo currently makes
no network calls at all — verified no `requestUrl`/`fetch`/`XMLHttpRequest`
anywhere in `src/`.)*

## Resource cleanup

Register event listeners, intervals, and other teardown-needing resources
through Obsidian's `register*` helpers (`registerEvent`, `registerInterval`,
`registerDomEvent`, etc.) rather than managing them by hand, so Obsidian
disposes of them automatically when the plugin unloads.

## Dependencies

Avoid pulling in large dependencies; prefer packages that work in a browser
context (the plugin runs inside Obsidian's renderer, not Node, unless
`isDesktopOnly` opts into Electron/Node APIs).

## Async code and startup

Use `async`/`await` with real error handling rather than unhandled promises.
Keep `onload()` lightweight — expensive work should happen lazily (e.g. on
first render) rather than blocking Obsidian's startup.

## Dev workflow

- `npm install` for setup.
- `npm run dev` — watch-mode build.
- `npm run build` — production build.

Manual testing is the norm for Obsidian plugins: build, then copy or symlink
the release artifacts (`main.js`, `manifest.json`, and `styles.css` if
present) into `<Vault>/.obsidian/plugins/<plugin-id>/`, then enable the
plugin from Obsidian's Community Plugins settings. *(This repo's exact
commands and current lint/test status are in `CLAUDE.md`'s Commands
section.)*

## Housekeeping

Never commit build artifacts (`main.js`) or `node_modules/` — both should be
gitignored.
