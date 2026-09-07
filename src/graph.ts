/*
 * Folgezettel Navigator — an Obsidian plugin for navigating Folgezettel note sequences.
 * Copyright (C) 2026 Niels-Oliver Walkowski
 *
 * This program is free software: you can redistribute it and/or modify it under the
 * terms of the GNU General Public License as published by the Free Software Foundation,
 * either version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
 * PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with this
 * program. If not, see <https://www.gnu.org/licenses/>.
 */

import { App, TFile } from "obsidian";

/** Default frontmatter property that holds the outgoing Folgezettel link(s). */
export const FOLGEZETTEL_KEY = "folgezettel";

/**
 * A directed graph of the vault's Folgezettel relationships.
 *
 * Edges point in the reading direction of the sequence: an edge A -> B means
 * "note B is a Folgezettel (continuation) of note A", i.e. B appears in A's
 * `folgezettel` property.
 *
 *  - `outgoing[A]` = notes that continue A  (rendered *below* the active note)
 *  - `incoming[B]` = notes that A continues (rendered *above* the active note)
 *
 * Keys are file paths; values are the resolved target files.
 */
export interface FolgezettelGraph {
	outgoing: Map<string, TFile[]>;
	incoming: Map<string, TFile[]>;
}

/** Turn a raw frontmatter value (`[[Note]]`, `Note`, `Note#heading|alias`) into a linkpath. */
function toLinkpath(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	let text = raw.trim();
	const wikilink = text.match(/^\[\[(.+?)\]\]$/);
	if (wikilink) text = wikilink[1];
	// Drop alias and subpath/heading fragments.
	text = text.split("|")[0].split("#")[0].trim();
	return text.length > 0 ? text : null;
}

/**
 * Resolve every Folgezettel target declared in a note's frontmatter, in declared order
 * (the first entry continues the current branch, every later one starts a new one).
 * This is `outgoing[file]` for a single note — the graph is built out of it, and the
 * authoring commands use it to see what a note already links to.
 */
export function folgezettelTargets(app: App, file: TFile, propertyName: string): TFile[] {
	const cache = app.metadataCache.getFileCache(file);
	const value: unknown = cache?.frontmatter?.[propertyName];
	if (value == null) return [];

	const raws: unknown[] = Array.isArray(value) ? (value as unknown[]) : [value];
	const targets: TFile[] = [];
	const seen = new Set<string>();

	for (const raw of raws) {
		const linkpath = toLinkpath(raw);
		if (!linkpath) continue;
		const dest = app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
		if (dest && !seen.has(dest.path)) {
			seen.add(dest.path);
			targets.push(dest);
		}
	}
	return targets;
}

/**
 * Scan the whole vault and build the Folgezettel graph.
 *
 * This is cheap enough to run on demand (it reads the already-parsed metadata
 * cache, not the files themselves), which keeps the view a pure function of the
 * current vault state and avoids incremental-update bookkeeping.
 */
export function buildGraph(app: App, propertyName: string): FolgezettelGraph {
	const outgoing = new Map<string, TFile[]>();
	const incoming = new Map<string, TFile[]>();

	for (const file of app.vault.getMarkdownFiles()) {
		const targets = folgezettelTargets(app, file, propertyName);
		if (targets.length === 0) continue;

		outgoing.set(file.path, targets);
		for (const target of targets) {
			const arr = incoming.get(target.path);
			if (arr) {
				// A note may be listed twice by the same source; keep edges unique.
				if (!arr.some((f) => f.path === file.path)) arr.push(file);
			} else {
				incoming.set(target.path, [file]);
			}
		}
	}

	return { outgoing, incoming };
}
