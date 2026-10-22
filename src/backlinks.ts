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

import { App, getLinkpath, Reference, TFile } from "obsidian";

/**
 * The notes whose **body** links to (or embeds) `file`, in vault scan order.
 *
 * "Not in the frontmatter" is not a filter here, it is where we read: Obsidian's metadata
 * cache keeps body references in `links` and `embeds` and frontmatter ones in
 * `frontmatterLinks`, so reading only the first two *is* the rule — no positions to compare,
 * and nothing to drift if Obsidian changes how a property stores its links. That also keeps
 * this list disjoint from the Folgezettel strand, which is built from a frontmatter property
 * alone (see `graph.ts`).
 *
 * Neither `metadataCache.resolvedLinks` nor `getBacklinksForFile` will do: the first counts
 * frontmatter and body links together and so cannot answer this question, and the second is
 * absent from `obsidian.d.ts`. Like `buildGraph` this scans the vault on demand, which is
 * cheap because the metadata cache is already parsed.
 */
export function bodyBacklinks(app: App, file: TFile): TFile[] {
	const sources: TFile[] = [];

	for (const source of app.vault.getMarkdownFiles()) {
		// One reference is enough: a note that links here ten times is still one entry. The
		// note itself never qualifies, since a note's links leave out its own references.
		if (bodyLinks(app, source).some((link) => link.target.path === file.path)) sources.push(source);
	}

	return sources;
}

/** A body reference together with the note it resolves to. */
export interface BodyLink {
	target: TFile;
	reference: Reference;
}

/**
 * The links (and embeds) in the **body** of `source`, each with the note it points at, in
 * the order they appear, repeats included. Links that resolve to nothing are dropped, and so
 * are references to the note itself: `[[#Heading]]` resolves to its own source, and a table
 * of contents is not a link to another note.
 *
 * `bodyBacklinks` is this, read backwards, and `index-notes.ts` reads an index note's body
 * through it — so both draw the line between body and frontmatter in the same place. The
 * reference comes along because the index needs what a link *calls* its note, too.
 */
export function bodyLinks(app: App, source: TFile): BodyLink[] {
	const cache = app.metadataCache.getFileCache(source);
	if (!cache) return [];

	const links: BodyLink[] = [];
	const refs: Reference[] = [...(cache.links ?? []), ...(cache.embeds ?? [])];
	for (const reference of refs) {
		// `link` is the raw target: `getLinkpath` drops the `#heading` / `^block` subpath, and
		// an alias never reaches it (that is `displayText`).
		const target = app.metadataCache.getFirstLinkpathDest(getLinkpath(reference.link), source.path);
		if (target && target.path !== source.path) links.push({ target, reference });
	}
	return links;
}
