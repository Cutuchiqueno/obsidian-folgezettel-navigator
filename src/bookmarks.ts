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

import { App, EventRef } from "obsidian";

/**
 * Which of the vault's notes are bookmarked, read off Obsidian's core Bookmarks plugin.
 *
 * That plugin is **not** part of the public API — `obsidian.d.ts` declares neither
 * `app.internalPlugins` nor the instance below — so everything here is reached through a
 * narrow structural type and every step is optional: the plugin can be disabled, missing,
 * or (a future version) shaped differently, and the panel then simply draws no bookmarks
 * rather than failing to draw at all.
 */

/** One entry of the bookmarks tree; only the fields this module reads are declared. */
interface BookmarkItem {
	type?: string;
	path?: string;
	/** Set when the bookmark points at a heading or block rather than the note itself. */
	subpath?: string;
	/** Present on groups: the bookmarks nested inside them. */
	items?: BookmarkItem[];
}

interface BookmarksInstance {
	getBookmarks?: () => BookmarkItem[];
	/** The same tree on older versions, before `getBookmarks` existed. */
	items?: BookmarkItem[];
	/** Fires whenever a bookmark is added, removed, renamed or moved. */
	on?: (name: "changed", callback: () => void) => EventRef;
}

interface InternalPlugin {
	enabled?: boolean;
	instance?: BookmarksInstance;
}

interface AppWithInternalPlugins extends App {
	internalPlugins?: { getPluginById?: (id: string) => InternalPlugin | null };
}

/** Depth bound on the group tree, in case a malformed file nests groups without end. */
const MAX_GROUP_DEPTH = 20;

/**
 * The paths of every bookmarked note. Empty when the Bookmarks plugin is off or absent.
 *
 * Only whole-`file` bookmarks are collected, which is Obsidian's own reading of "this note
 * is bookmarked": a bookmarked *folder* bookmarks the folder and not the notes in it, and a
 * bookmark carrying a `subpath` marks a heading or block, which is why Obsidian leaves the
 * note's own tab header unmarked for it. Groups are walked through, since a bookmark inside
 * one is bookmarked all the same (`getBookmarks()` already flattens them; the walk keeps
 * this working if it ever stops doing so, and the set makes the overlap free).
 *
 * Read fresh on every render, like the graph: it is a walk over a handful of in-memory
 * objects, and a cache would be one more thing to invalidate.
 */
export function bookmarkedPaths(app: App): Set<string> {
	const paths = new Set<string>();
	const instance = bookmarksInstance(app);
	const roots = instance?.getBookmarks?.() ?? instance?.items ?? [];
	collectFilePaths(roots, paths, 0);
	return paths;
}

/**
 * Call `callback` whenever the bookmarks change, so the panel can recolour its markers.
 * Returns null when the plugin is unavailable or does not emit the event — bookmarking a
 * note then shows up on the panel's next render for another reason (opening a note,
 * editing frontmatter) instead of immediately.
 */
export function onBookmarksChanged(app: App, callback: () => void): EventRef | null {
	const instance = bookmarksInstance(app);
	if (typeof instance?.on !== "function") return null;
	try {
		return instance.on("changed", callback);
	} catch {
		return null;
	}
}

function bookmarksInstance(app: App): BookmarksInstance | null {
	const plugin = (app as AppWithInternalPlugins).internalPlugins?.getPluginById?.("bookmarks");
	if (!plugin?.enabled) return null;
	return plugin.instance ?? null;
}

function collectFilePaths(items: BookmarkItem[], paths: Set<string>, depth: number): void {
	if (!Array.isArray(items) || depth > MAX_GROUP_DEPTH) return;
	for (const item of items) {
		if (item?.type === "file" && typeof item.path === "string" && !item.subpath) paths.add(item.path);
		if (item?.items) collectFilePaths(item.items, paths, depth + 1);
	}
}
