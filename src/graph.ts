import { App, CachedMetadata, TFile } from "obsidian";

/** Frontmatter property that holds the outgoing Folgezettel link(s). */
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

/** Resolve every Folgezettel target declared in a note's frontmatter. */
function resolveTargets(app: App, file: TFile, cache: CachedMetadata | null): TFile[] {
	const value = cache?.frontmatter?.[FOLGEZETTEL_KEY];
	if (value == null) return [];

	const raws = Array.isArray(value) ? value : [value];
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
export function buildGraph(app: App): FolgezettelGraph {
	const outgoing = new Map<string, TFile[]>();
	const incoming = new Map<string, TFile[]>();

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		const targets = resolveTargets(app, file, cache);
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

/** One step of a traversal: either a single next note, a branch, or the end. */
export type Step =
	| { kind: "note"; file: TFile }
	| { kind: "branch"; targets: TFile[] }
	| { kind: "end" };

/**
 * Walk the graph in one direction starting from `start`, up to `maxSteps` notes.
 *
 * The walk stops and reports a `branch` as soon as a note has 2+ neighbours in
 * the requested direction (a Folgezettel junction), or `end` when it has none.
 * A visited-set guards against cycles.
 */
export function walk(
	graph: FolgezettelGraph,
	start: TFile,
	direction: "incoming" | "outgoing",
	maxSteps: number
): { chain: TFile[]; terminator: Step } {
	const edges = graph[direction];
	const chain: TFile[] = [];
	const visited = new Set<string>([start.path]);
	let node = start;

	for (let i = 0; i < maxSteps; i++) {
		const neighbours = edges.get(node.path) ?? [];
		if (neighbours.length === 0) return { chain, terminator: { kind: "end" } };
		if (neighbours.length >= 2) return { chain, terminator: { kind: "branch", targets: neighbours } };

		const next = neighbours[0];
		if (visited.has(next.path)) return { chain, terminator: { kind: "end" } };
		visited.add(next.path);
		chain.push(next);
		node = next;
	}

	return { chain, terminator: { kind: "end" } };
}
