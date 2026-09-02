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

import { HoverPopover, ItemView, Platform, TFile, WorkspaceLeaf } from "obsidian";
import { buildGraph, FolgezettelGraph } from "./graph";
import { findLeaf, findParent } from "./navigate";
import type FolgezettelPlugin from "./main";

export const VIEW_TYPE_FOLGEZETTEL = "folgezettel-navigator-view";

/** Safety bound on strand-walk iterations (cycles are already guarded by `visited`). */
const MAX_ITERATIONS = 100;

/**
 * Which part of the strand an entry belongs to. Styling and state keys only — the panel
 * is walked and drawn as **one** strand, top to bottom, not as two opposed halves.
 */
type EntryKind = "incoming" | "outgoing" | "active";

export class FolgezettelView extends ItemView {
	/** Live hover popover slot required by Obsidian's page-preview integration. */
	hoverPopover: HoverPopover | null = null;

	/** Active note the current pane state belongs to; state resets when it changes. */
	private currentPath: string | null = null;
	/** Junction keys whose option list is expanded. */
	private expandedBranches = new Set<string>();
	/** Junction key -> chosen option path (overrides the first-link default). */
	private branchSelections = new Map<string, string>();
	/**
	 * Transient hover preview: while the mouse is over an option in an expanded
	 * branch card, the strand continues from that option instead of the stored
	 * selection — without reordering the card. Cleared on mouse-out / action.
	 */
	private previewBranch: { key: string; path: string } | null = null;
	/** Cached graph for the current render, reused by on-hover continuation rebuilds. */
	private graph: FolgezettelGraph | null = null;
	/**
	 * Per-card handle to the DOM container holding **everything below** that card, with
	 * the two things that can go in it: what actually belongs there, and the strand a
	 * hovered option would put there instead. A preview rebuilds only this subtree, so
	 * the card the cursor sits on is never torn down.
	 */
	private branchContinuations = new Map<
		string,
		{
			container: HTMLElement;
			options: TFile[];
			/** Draw what belongs below the card when nothing is being previewed. */
			renderDefault: () => void;
			/** Draw the strand that follows `option` instead, while it is hovered. */
			renderPreview: (option: TFile) => void;
		}
	>();

	constructor(leaf: WorkspaceLeaf, private plugin: FolgezettelPlugin) {
		super(leaf);
	}

	/** Re-render with the current settings (called by the plugin when they change). */
	refresh(): void {
		this.render();
	}

	getViewType(): string {
		return VIEW_TYPE_FOLGEZETTEL;
	}

	getDisplayText(): string {
		return "Folgezettel";
	}

	getIcon(): string {
		return "git-branch";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("folgezettel-view");

		// Re-render when the active note changes. Guard on the file path: merely
		// focusing the pane fires active-leaf-change with the *same* file, and an
		// unconditional re-render there rebuilds the DOM mid-click — destroying the
		// clicked element before `mouseup`, which is what made the pane need two
		// clicks when focus started in the editor.
		const renderIfNoteChanged = () => {
			if (this.activeNotePath() !== this.currentPath) this.render();
		};
		this.registerEvent(this.app.workspace.on("active-leaf-change", renderIfNoteChanged));
		this.registerEvent(this.app.workspace.on("file-open", renderIfNoteChanged));
		// Vault link changes can alter the sequence for the current note.
		this.registerEvent(this.app.metadataCache.on("resolved", () => this.render()));
		this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));

		this.render();
	}

	async onClose(): Promise<void> {
		// Nothing to tear down: all DOM lives inside contentEl.
	}

	/** Path of the active markdown note, or null when the active view has none. */
	private activeNotePath(): string | null {
		const file = this.app.workspace.getActiveFile();
		return file && file.extension === "md" ? file.path : null;
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();

		const active = this.app.workspace.getActiveFile();
		const note = active && active.extension === "md" ? active : null;

		// Reset the per-note branch choices whenever the shown note changes — including
		// to *none* (a non-file view like the graph). Tracking that null keeps the guard
		// honest, so returning to a note tab refreshes the pane instead of leaving the
		// "open a note" message up.
		if ((note?.path ?? null) !== this.currentPath) {
			this.currentPath = note?.path ?? null;
			this.expandedBranches.clear();
			this.branchSelections.clear();
			this.previewBranch = null;
		}
		if (!note) {
			el.createDiv({ cls: "folgezettel-empty", text: "Open a note to see its Folgezettel sequence." });
			return;
		}

		const { propertyName, maxSteps } = this.plugin.settings;
		this.graph = buildGraph(this.app, propertyName);
		this.branchContinuations.clear();

		const list = el.createDiv({ cls: "folgezettel-list" });

		// One strand, anchored at the **top** of the panel and read straight down: where
		// the branch was started, the ancestors, the active note, its continuations, where
		// it ends. Every row's position therefore depends only on what is above it, which
		// is what lets a card own — and a hover preview replace — everything below it,
		// the active note included, without the card ever moving under the cursor.
		const visited = new Set<string>([note.path]);
		const ancestors = this.walkUp(note, visited, maxSteps);

		this.renderStartOfBranch(list, note, visited);
		this.renderChain(list, ancestors, ancestors.length - 1, note, visited, maxSteps);
	}

	/**
	 * The ancestors of `note`, nearest first, up to `budget`. A note should have a single
	 * predecessor; where a vault gives it several this takes `incoming[0]`, the same
	 * deterministic pick the upward walks in `navigate.ts` make. A fork *upward* is
	 * malformed data, not a choice to put to the reader — see the malformed-data note in
	 * CLAUDE.md.
	 */
	private walkUp(note: TFile, visited: Set<string>, budget: number): TFile[] {
		const chain: TFile[] = [];
		let node = note;

		for (let i = 0; i < MAX_ITERATIONS && chain.length < budget; i++) {
			const previous = this.graph?.incoming.get(node.path)?.[0];
			if (!previous || visited.has(previous.path)) break;
			visited.add(previous.path);
			chain.push(previous);
			node = previous;
		}
		return chain;
	}

	/**
	 * Draw from `index` downward: the remaining ancestors, then the active note, then its
	 * continuations. A note that is one of several branches takes a card, and everything
	 * below it goes into that card's continuation container — so hovering one of its
	 * options replaces the lot with that branch, and mouse-out puts the real strand back.
	 */
	private renderChain(
		container: HTMLElement,
		ancestors: TFile[],
		index: number,
		note: TFile,
		visited: Set<string>,
		budget: number
	): void {
		if (index < 0) {
			this.renderActive(container, note, visited, budget);
			return;
		}

		const file = ancestors[index];
		const options = this.siblingOptions(file);
		if (!options) {
			this.renderEntry(container, file, "incoming");
			this.renderChain(container, ancestors, index - 1, note, visited, budget);
			return;
		}

		const key = branchKey("incoming", file);
		this.renderSiblingEntry(container, file, "incoming", options, key);
		const below = container.createDiv({ cls: "folgezettel-continuation" });
		this.branchContinuations.set(key, {
			container: below,
			options,
			renderDefault: () => this.renderChain(below, ancestors, index - 1, note, visited, budget),
			renderPreview: (option) => this.renderBranchPreview(below, option, visited, budget),
		});
		this.renderContinuation(key);
	}

	/** The active note, and below it the strand it continues into. */
	private renderActive(container: HTMLElement, note: TFile, visited: Set<string>, budget: number): void {
		const options = this.siblingOptions(note);
		if (!options) {
			this.renderEntry(container, note, "active");
			this.renderStrand(container, note, new Set(visited), budget);
			return;
		}

		const key = branchKey("active", note);
		this.renderSiblingEntry(container, note, "active", options, key);
		const below = container.createDiv({ cls: "folgezettel-continuation" });
		this.branchContinuations.set(key, {
			container: below,
			options,
			renderDefault: () => this.renderStrand(below, note, new Set(visited), budget),
			renderPreview: (option) => this.renderBranchPreview(below, option, visited, budget),
		});
		this.renderContinuation(key);
	}

	/**
	 * What a hovered sibling would put below its card: the strand following that option,
	 * standing in for the ancestors, the active note and its continuations — every one of
	 * which belongs to the branch the reader is looking away from. Transient: the card's
	 * `renderDefault` puts the real strand back on mouse-out.
	 */
	private renderBranchPreview(container: HTMLElement, option: TFile, visited: Set<string>, budget: number): void {
		const seen = new Set(visited);
		seen.add(option.path);
		this.renderStrand(container, option, seen, budget);
	}

	/**
	 * Walk and render the strand continuing from `from`, downward. At a junction it renders
	 * the branch card, then a continuation container holding the strand beyond it, and
	 * recurses into that container along the chosen (or hover-previewed) option. Where the
	 * walk stops short, `renderEndOfBranch` adds the detached entry for the branch's end.
	 *
	 * Downward only: the ancestors are drawn by `renderChain`, off `walkUp`. Nothing here
	 * ever grows a strand *upward*, which is the property that lets the whole panel hang
	 * from its top edge.
	 */
	private renderStrand(parent: HTMLElement, from: TFile, visited: Set<string>, budget: number): void {
		const edges = this.graph?.outgoing;
		if (!edges) return;
		let node = from;
		let remaining = budget;

		for (let i = 0; i < MAX_ITERATIONS && remaining > 0; i++) {
			const neighbours = edges.get(node.path) ?? [];
			if (neighbours.length === 0) break;

			if (neighbours.length >= 2) {
				const key = branchKey("outgoing", node);
				this.renderBranchEntry(parent, neighbours, key, this.selectedOption(key, neighbours), "outgoing");
				remaining--; // the branch entry occupies a slot

				const container = parent.createDiv({ cls: "folgezettel-continuation" });
				const beyond = remaining;
				this.branchContinuations.set(key, {
					container,
					options: neighbours,
					renderDefault: () => this.continueBeyond(container, this.selectedOption(key, neighbours), visited, beyond),
					renderPreview: (option) => this.continueBeyond(container, option, visited, beyond),
				});
				this.renderContinuation(key);
				return; // the recursion owns the strand beyond the card — its end included
			}

			const next = neighbours[0];
			if (visited.has(next.path)) break;
			visited.add(next.path);
			this.renderEntry(parent, next, "outgoing");
			remaining--;
			node = next;
		}

		this.renderEndOfBranch(parent, node, visited);
	}

	/** The strand past a junction card, from the option that card currently stands for. */
	private continueBeyond(container: HTMLElement, option: TFile, visited: Set<string>, budget: number): void {
		if (visited.has(option.path)) return;
		const seen = new Set(visited);
		seen.add(option.path);
		this.renderStrand(container, option, seen, budget);
	}

	/**
	 * The detached entry at the top: the note the current branch was started from, drawn
	 * past the end of the rendered window so the reader sees where the branch begins
	 * however far short the step cap cuts the walk. Left out when there is no such note
	 * (the active note is itself the beginning) or when it is already on screen.
	 */
	private renderStartOfBranch(parent: HTMLElement, note: TFile, visited: Set<string>): void {
		if (!this.graph) return;
		const start = findParent(this.graph, note);
		if (!start || visited.has(start.path)) return;
		this.renderFarEndParent(parent, start);
	}

	/**
	 * The detached entry at the bottom: the note the strand runs out at, taken from the
	 * **last drawn** note, so a branch the reader picked — or is previewing — ends at
	 * *its* leaf and not the first link's. `findLeaf` returns null exactly when the last
	 * entry already is that leaf, which is when there is nothing to add.
	 */
	private renderEndOfBranch(parent: HTMLElement, node: TFile, visited: Set<string>): void {
		if (!this.graph) return;
		const end = findLeaf(this.graph, node);
		if (!end || visited.has(end.path)) return;
		this.renderEntry(parent, end, "outgoing", true);
	}

	/**
	 * The far-end entry above the strand: the note the current branch was started from.
	 * It carries the junction's numbered circle when that note forks — so the fork it
	 * stands for stays legible from here — and, when it does not, the open circle a leaf
	 * gets at that same size: this is the beginning of the structure, the thread's other
	 * end. Neither is a control: everything between this note and the active one is fixed,
	 * so there is nothing here to choose.
	 * The title still opens the note, as on every entry.
	 */
	private renderFarEndParent(parent: HTMLElement, file: TFile): void {
		const options = this.graph?.outgoing.get(file.path) ?? [];
		const forks = options.length >= 2;

		const row = parent.createDiv({
			cls: `folgezettel-entry is-branch is-incoming is-detached${forks ? "" : " is-root"}`,
		});
		const marker = row.createDiv({ cls: "folgezettel-marker" });
		marker.createDiv({
			cls: "folgezettel-branch-toggle",
			text: forks ? String(options.length) : "",
			attr: { "aria-label": forks ? `Forks into ${options.length} notes` : "Beginning of the structure" },
		});

		this.renderTitleLink(row, file);
	}

	/**
	 * Which option a junction continues along: the reader's pick if they made one, else
	 * the **first declared link**. That default is the same rule the navigation commands
	 * in `navigate.ts` use — the first entry of a note's Folgezettel property continues
	 * the branch, later entries start new ones — so the panel and the jump commands agree
	 * on where the current branch runs.
	 */
	private selectedOption(key: string, options: TFile[]): TFile {
		const stored = this.branchSelections.get(key);
		return options.find((f) => f.path === stored) ?? options[0];
	}

	/**
	 * The branches `file` is one of: its parent's continuations, when the parent forks.
	 * Null when the parent has just this one continuation, or there is no parent — the
	 * entry is then an ordinary note in the strand.
	 *
	 * Which note counts as the parent is the deterministic `incoming[0]`, the same pick
	 * the upward walks in `navigate.ts` make when a vault gives a note two predecessors.
	 */
	private siblingOptions(file: TFile): TFile[] | null {
		if (!this.graph) return null;
		const parent = this.graph.incoming.get(file.path)?.[0];
		if (!parent) return null;
		const options = this.graph.outgoing.get(parent.path) ?? [];
		return options.length >= 2 ? options : null;
	}

	/**
	 * An entry that is one of several branches at a fork, drawn with the same numbered
	 * circle as a junction — because it *is* one: entering a branch must not cost the
	 * reader the fork it came from. Used going up and on the active note; going down the
	 * junction is drawn by `renderBranchEntry` instead.
	 *
	 * Hovering an option previews that branch in place of **everything below the card** —
	 * the rest of the ancestors, the active note and its continuations all belong to the
	 * branch being looked away from, so all of them stand down for the duration. Picking
	 * an option **opens** it, where an outgoing junction's re-roots the strand: from here
	 * the drawn path is the one that leads to the note you are on, so going to the sibling
	 * is the only way to actually switch to it.
	 */
	private renderSiblingEntry(
		parent: HTMLElement,
		file: TFile,
		kind: EntryKind,
		options: TFile[],
		key: string
	): void {
		const expanded = this.expandedBranches.has(key);

		const row = parent.createDiv({ cls: `folgezettel-entry is-branch is-${kind}${expanded ? " is-expanded" : ""}` });
		const marker = row.createDiv({ cls: "folgezettel-marker" });
		const toggle = marker.createDiv({
			cls: "folgezettel-branch-toggle",
			text: String(options.length),
			attr: { "aria-label": `Show ${options.length} branches` },
		});
		toggle.addEventListener("click", (event: MouseEvent) => {
			event.preventDefault();
			this.previewBranch = null;
			if (this.expandedBranches.has(key)) this.expandedBranches.delete(key);
			else this.expandedBranches.add(key);
			this.render();
		});

		if (!expanded) {
			this.renderTitleLink(row, file);
			return;
		}

		// This note leads the list, as the chosen option does on an outgoing junction.
		const ordered = [file, ...options.filter((f) => f.path !== file.path)];
		const optionList = row.createDiv({ cls: "folgezettel-branch-options" });
		for (const option of ordered) {
			const el = optionList.createDiv({ cls: "folgezettel-branch-option", text: option.basename });
			el.addEventListener("click", (event: MouseEvent) => {
				this.previewBranch = null;
				this.expandedBranches.delete(key);
				void this.app.workspace.getLeaf(event.ctrlKey || event.metaKey).openFile(option);
			});
			// Hovering a *sibling* previews it; hovering this entry's own note restores the
			// real strand, since that is what is drawn below anyway. Touch has no hover (and
			// no mouseleave to clear a stuck preview), so mobile relies on tap-to-open above.
			if (!Platform.isMobile) {
				el.addEventListener("mouseenter", () =>
					option.path === file.path ? this.clearPreviewBranch(key) : this.setPreviewBranch(key, option.path)
				);
			}
		}
		if (!Platform.isMobile) {
			optionList.addEventListener("mouseleave", () => this.clearPreviewBranch(key));
		}
	}

	/** (Re)render everything below a card: the hovered option's strand, or the real one. */
	private renderContinuation(key: string): void {
		const info = this.branchContinuations.get(key);
		if (!info) return;
		info.container.empty();

		const preview =
			this.previewBranch?.key === key
				? info.options.find((f) => f.path === this.previewBranch?.path)
				: undefined;
		if (preview) info.renderPreview(preview);
		else info.renderDefault();
	}

	private renderEntry(parent: HTMLElement, file: TFile, kind: EntryKind, detached = false): void {
		// A note nothing continues ends the thread; its dot is drawn hollow (see Styling),
		// so a real ending reads differently from a strand the step cap merely cut short.
		const leaf = (this.graph?.outgoing.get(file.path)?.length ?? 0) === 0;
		const row = parent.createDiv({
			cls: `folgezettel-entry is-${kind}${detached ? " is-detached" : ""}${leaf ? " is-leaf" : ""}`,
		});

		// Left gutter: the indentation guide rail and a dot marking the note — accent for
		// the active note, muted for the rest, hollow when the note is a leaf (colour is
		// set in CSS).
		const marker = row.createDiv({ cls: "folgezettel-marker" });
		marker.createDiv({ cls: "folgezettel-dot" });

		this.renderTitleLink(row, file);
	}

	/**
	 * A junction, rendered inline. Collapsed it is a normal entry for the chosen
	 * option (title opens the note); its gutter shows a filled circle carrying the
	 * number of selectable branches instead of the plain dot. Clicking that circle
	 * expands the entry into the full option list; picking an option collapses it
	 * and re-roots the strand.
	 */
	private renderBranchEntry(
		parent: HTMLElement,
		options: TFile[],
		key: string,
		selected: TFile,
		kind: EntryKind
	): void {
		const expanded = this.expandedBranches.has(key);

		const row = parent.createDiv({ cls: `folgezettel-entry is-branch is-${kind}${expanded ? " is-expanded" : ""}` });
		const marker = row.createDiv({ cls: "folgezettel-marker" });
		const toggle = marker.createDiv({
			cls: "folgezettel-branch-toggle",
			text: String(options.length),
			attr: { "aria-label": `Show ${options.length} branches` },
		});
		toggle.addEventListener("click", (event: MouseEvent) => {
			event.preventDefault();
			this.previewBranch = null;
			if (this.expandedBranches.has(key)) this.expandedBranches.delete(key);
			else this.expandedBranches.add(key);
			this.render();
		});

		if (!expanded) {
			this.renderTitleLink(row, selected);
			return;
		}

		// The current choice leads the list; the rest keep their declared order. Until the
		// reader picks something else the choice *is* the first link, so an untouched card
		// simply reads in the order the property declares.
		const ordered = [selected, ...options.filter((f) => f.path !== selected.path)];
		const optionList = row.createDiv({ cls: "folgezettel-branch-options" });
		for (const file of ordered) {
			const option = optionList.createDiv({ cls: "folgezettel-branch-option", text: file.basename });
			option.addEventListener("click", () => {
				this.previewBranch = null;
				this.branchSelections.set(key, file.path);
				this.expandedBranches.delete(key);
				this.render();
			});
			// Hovering an option previews its continuation. The panel hangs from its top
			// edge, so rebuilding what is below never moves the card under the cursor.
			// Touch has no hover (and no mouseleave to clear a stuck preview), so on
			// mobile we skip it and rely on tap-to-select — the click handler above.
			if (!Platform.isMobile) {
				option.addEventListener("mouseenter", () => this.setPreviewBranch(key, file.path));
			}
		}
		if (!Platform.isMobile) {
			optionList.addEventListener("mouseleave", () => this.clearPreviewBranch(key));
		}
	}

	private setPreviewBranch(key: string, path: string): void {
		if (this.previewBranch?.key === key && this.previewBranch?.path === path) return;
		this.previewBranch = { key, path };
		// Rebuild only the continuation below this card; the card (and the option the
		// cursor is over) stays in place, so no hover thrash.
		this.renderContinuation(key);
	}

	private clearPreviewBranch(key: string): void {
		if (this.previewBranch?.key !== key) return;
		this.previewBranch = null;
		this.renderContinuation(key);
	}

	/** A clickable, hover-previewable note title, as used by every entry. */
	private renderTitleLink(row: HTMLElement, file: TFile): void {
		const link = row.createEl("a", {
			cls: "folgezettel-title",
			text: file.basename,
			href: file.path,
			attr: { "data-path": file.path },
		});
		this.attachNavigation(link, file);
		this.attachHoverPreview(link, file);
	}

	/** Click / modifier-click to open the note, matching Obsidian link behaviour. */
	private attachNavigation(link: HTMLElement, file: TFile): void {
		link.addEventListener("click", (event: MouseEvent) => {
			event.preventDefault();
			const newLeaf = event.ctrlKey || event.metaKey;
			void this.app.workspace.getLeaf(newLeaf).openFile(file);
		});
	}

	/** Trigger Obsidian's native page-preview popover (respects the Ctrl/hover setting). */
	private attachHoverPreview(link: HTMLElement, file: TFile): void {
		// Page preview is a desktop hover affordance; on mobile a tap just opens the note.
		if (Platform.isMobile) return;
		link.addEventListener("mouseover", (event: MouseEvent) => {
			this.app.workspace.trigger("hover-link", {
				event,
				source: VIEW_TYPE_FOLGEZETTEL,
				hoverParent: this,
				targetEl: link,
				linktext: file.path,
				sourcePath: file.path,
			});
		});
	}
}

function branchKey(kind: EntryKind, junction: TFile): string {
	return `${kind}|${junction.path}`;
}
