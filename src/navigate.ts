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

import { TFile } from "obsidian";
import { FolgezettelGraph } from "./graph";

/*
 * Jump targets for the navigation commands: pure functions of the graph, so they can
 * be reasoned about (and tested) without a workspace.
 *
 * Unlike the sidebar — which picks a branch by the reader's click or, failing that, by
 * most recent mtime — these walks always follow the **first** declared link of a
 * junction. That is the definition of "the current branch" here: the first entry of a
 * note's Folgezettel property continues the strand, every later entry starts a new one.
 *
 * Every walk carries a `visited` set, so a cycle in the vault's links terminates the
 * loop instead of hanging it.
 */

/** Notes that list `file` in their Folgezettel property — the "previous" axis. */
export function previousNotes(graph: FolgezettelGraph, file: TFile): TFile[] {
	return graph.incoming.get(file.path) ?? [];
}

/** Notes listed in `file`'s Folgezettel property — the "following" axis. */
export function nextNotes(graph: FolgezettelGraph, file: TFile): TFile[] {
	return graph.outgoing.get(file.path) ?? [];
}

/** A note with two or more continuations, i.e. where the sequence forks. */
function isJunction(graph: FolgezettelGraph, file: TFile): boolean {
	return nextNotes(graph, file).length >= 2;
}

/**
 * The predecessor to follow when walking upward. A note should have at most one, but
 * nothing stops a vault from linking the same note from two places; we then take the
 * first, so the walk stays deterministic instead of failing.
 */
function predecessor(graph: FolgezettelGraph, file: TFile): TFile | null {
	return previousNotes(graph, file)[0] ?? null;
}

/** The successor that continues the current branch: the first declared link. */
function successor(graph: FolgezettelGraph, file: TFile): TFile | null {
	return nextNotes(graph, file)[0] ?? null;
}

/**
 * The note the current branch was started from: the nearest ancestor that forks *and*
 * whose fork we left by a link other than its first — a first link continues a branch,
 * a later one opens a new one. Walking past junctions we are merely continuing through
 * is the whole point; the nearest fork is `findPreviousJunction`, not this.
 *
 * When no such ancestor exists the branch was never branched off anything, so we fall
 * back to the beginning of the structure: the topmost note, which nothing links to.
 * Null means the note is itself that beginning.
 */
export function findParent(graph: FolgezettelGraph, file: TFile): TFile | null {
	const visited = new Set<string>([file.path]);
	let node = file;
	let beginning: TFile | null = null;

	for (;;) {
		const prev = predecessor(graph, node);
		if (!prev || visited.has(prev.path)) return beginning;
		visited.add(prev.path);

		const options = nextNotes(graph, prev);
		if (options.length >= 2 && options[0].path !== node.path) return prev;

		node = prev;
		beginning = prev;
	}
}

/**
 * The end of the current branch: follow first links downward until a note has no
 * continuation. Null when `file` is already that end.
 */
export function findLeaf(graph: FolgezettelGraph, file: TFile): TFile | null {
	const visited = new Set<string>([file.path]);
	let node = file;
	let leaf: TFile | null = null;

	for (;;) {
		const next = successor(graph, node);
		if (!next || visited.has(next.path)) return leaf;
		visited.add(next.path);
		node = next;
		leaf = next;
	}
}

/** The next fork down the current branch, excluding `file` itself. */
export function findNextJunction(graph: FolgezettelGraph, file: TFile): TFile | null {
	const visited = new Set<string>([file.path]);
	let node = file;

	for (;;) {
		const next = successor(graph, node);
		if (!next || visited.has(next.path)) return null;
		visited.add(next.path);
		if (isJunction(graph, next)) return next;
		node = next;
	}
}

/** The nearest fork up the previous axis, excluding `file` itself. */
export function findPreviousJunction(graph: FolgezettelGraph, file: TFile): TFile | null {
	const visited = new Set<string>([file.path]);
	let node = file;

	for (;;) {
		const prev = predecessor(graph, node);
		if (!prev || visited.has(prev.path)) return null;
		visited.add(prev.path);
		if (isJunction(graph, prev)) return prev;
		node = prev;
	}
}
