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

import { App, Reference, TFile } from "obsidian";
import { bodyLinks } from "./backlinks";

/** Default frontmatter property that holds a note's type. */
export const NOTE_TYPE_KEY = "typ";
/** Default type that makes a note an index note. */
export const INDEX_VALUE = "index";

/**
 * Every note an **index note** links to in its body — the notes the panel draws in the index
 * colour — keyed by path, each with the names the index notes give it: the alias of each
 * link, distinct, in the order they appear. A note linked only by its bare name maps to an
 * empty list; it is indexed all the same, there is just nothing more to say about it.
 *
 * Only the body counts, read the way the backlinks section reads it (`bodyLinks`): an index
 * is a page of prose and lists, and what it points at there is what it indexes. Links in its
 * frontmatter, a Folgezettel property among them, are a different relation.
 *
 * Read fresh on every render, like the graph: it reads the already parsed metadata cache, and
 * a cache of our own would be one more thing to invalidate. Nor does it need an event of its
 * own, since editing an index note fires the metadata cache's `changed`, which re-renders the
 * panel anyway.
 */
export function indexedNotes(app: App, typeProperty: string, indexType: string): Map<string, string[]> {
	const indexed = new Map<string, string[]>();
	for (const source of app.vault.getMarkdownFiles()) {
		if (!isIndexNote(app, source, typeProperty, indexType)) continue;
		for (const { target, reference } of bodyLinks(app, source)) {
			let names = indexed.get(target.path);
			if (!names) {
				names = [];
				indexed.set(target.path, names);
			}
			const name = linkName(reference);
			if (name && !names.includes(name)) names.push(name);
		}
	}
	return indexed;
}

/**
 * Whether `file` is an index note: its type property is `indexType`, or, written as a list,
 * contains it. Compared as text, trimmed and ignoring case, so `typ: Index` counts as well,
 * and a value of `true` matches the YAML boolean of `index: true`.
 */
function isIndexNote(app: App, file: TFile, typeProperty: string, indexType: string): boolean {
	const raw: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[typeProperty];
	const entries: unknown[] = Array.isArray(raw) ? (raw as unknown[]) : [raw];
	const wanted = indexType.trim().toLowerCase();
	return entries.some(
		(entry) =>
			(typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") &&
			String(entry).trim().toLowerCase() === wanted
	);
}

/**
 * What a link calls its note: the part after `|` of a wikilink, or the text of a markdown
 * link. Null when the link gives no name of its own — a bare `[[Note]]`, whose `displayText`
 * is only the link again.
 */
function linkName(reference: Reference): string | null {
	const wikilink = /^!?\[\[/.test(reference.original);
	if (wikilink && !reference.original.includes("|")) return null;
	return reference.displayText?.trim() || null;
}
