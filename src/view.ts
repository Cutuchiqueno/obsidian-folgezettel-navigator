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

type Direction = "incoming" | "outgoing";

export class FolgezettelView extends ItemView {
	/** Live hover popover slot required by Obsidian's page-preview integration. */
	hoverPopover: HoverPopover | null = null;

	/** Active note the current pane state belongs to; state resets when it changes. */
	private currentPath: string | null = null;
	/** The active note itself — the walk `findParent` starts from (see `renderFarEnd`). */
	private activeNote: TFile | null = null;
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
	 * Per-junction handle to the DOM container holding the strand beyond its card,
	 * plus the state needed to re-walk it — so a hover preview rebuilds only that
	 * subtree and never the card the cursor sits on.
	 */
	private branchContinuations = new Map<
		string,
		{ container: HTMLElement; options: TFile[]; direction: Direction; visited: Set<string>; budget: number }
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
		this.activeNote = note;

		if (!note) {
			el.createDiv({ cls: "folgezettel-empty", text: "Open a note to see its Folgezettel sequence." });
			return;
		}

		const { propertyName, maxSteps } = this.plugin.settings;
		this.graph = buildGraph(this.app, propertyName);
		this.branchContinuations.clear();

		const list = el.createDiv({ cls: "folgezettel-list" });

		// Active note pinned to the vertical centre; each side grows outward from it
		// (incoming upward, outgoing downward). Because a junction's continuation always
		// grows away from the active note, a hover preview never shifts the card the
		// cursor sits on. Both sides are walked-and-rendered by `renderStrand` in
		// nearest -> farthest order; the incoming region is flipped by CSS
		// (`column-reverse`) so that reads bottom -> top.
		const incomingEl = list.createDiv({ cls: "folgezettel-region is-incoming" });
		this.renderStrand(incomingEl, note, "incoming", new Set<string>([note.path]), maxSteps);

		const activeSiblings = this.siblingOptions(note);
		if (activeSiblings) this.renderSiblingEntry(list, note, "active", activeSiblings);
		else this.renderEntry(list, note, "active");

		const outgoingEl = list.createDiv({ cls: "folgezettel-region is-outgoing" });
		this.renderStrand(outgoingEl, note, "outgoing", new Set<string>([note.path]), maxSteps);
	}

	/**
	 * Walk and render a strand from `from` in `direction`. At a junction it renders the
	 * branch card, then a continuation container holding the strand beyond it, and
	 * recurses into that container along the chosen (or hover-previewed) option.
	 * Entries are emitted nearest -> farthest; CSS flips the incoming region visually.
	 * Wherever the walk stops short, `renderFarEnd` adds the detached far-end entry.
	 */
	private renderStrand(
		parent: HTMLElement,
		from: TFile,
		direction: Direction,
		visited: Set<string>,
		budget: number,
		afterJunction = false
	): void {
		const edges = this.graph?.[direction];
		if (!edges) return;
		let node = from;
		let remaining = budget;
		// Is the farthest entry drawn so far a junction card? True only while this segment
		// has drawn nothing of its own and the entry it continues from was one.
		let lastIsJunction = afterJunction;

		for (let i = 0; i < MAX_ITERATIONS && remaining > 0; i++) {
			const neighbours = edges.get(node.path) ?? [];
			if (neighbours.length === 0) break;

			if (neighbours.length >= 2) {
				const key = branchKey(direction, node);
				const selected = this.selectedOption(key, neighbours);
				this.renderBranchEntry(parent, neighbours, key, selected, direction);
				remaining--; // the branch entry occupies a slot

				const container = parent.createDiv({ cls: "folgezettel-continuation" });
				this.branchContinuations.set(key, { container, options: neighbours, direction, visited: new Set(visited), budget: remaining });
				this.renderContinuation(key);
				return; // the recursion owns the strand beyond the card — far end included
			}

			const next = neighbours[0];
			if (visited.has(next.path)) break;
			visited.add(next.path);
			// Walking up, `neighbours` counts predecessors, which says nothing about whether
			// this note is one of several *branches* — that is a property of its parent's
			// fork, so ask for it separately. Downward the junction case above already
			// covers it: there the branch entry *is* the chosen sibling.
			const siblings = direction === "incoming" ? this.siblingOptions(next) : null;
			if (siblings) this.renderSiblingEntry(parent, next, direction, siblings);
			else this.renderEntry(parent, next, direction);
			remaining--;
			lastIsJunction = false;
			node = next;
		}

		this.renderFarEnd(parent, node, direction, visited, lastIsJunction);
	}

	/**
	 * The far end of the strand, drawn detached (set apart by a gap, with no guide rail
	 * running to it) past the end of the rendered window: upward the note the current
	 * branch was started from, downward the note it runs out at. So the reader sees where
	 * the branch begins and ends however far short the per-direction cap cuts the walk.
	 *
	 * It is left out when that note is already on screen — downward `findLeaf` returns
	 * null exactly when the farthest entry *is* the leaf, and the `visited` guard covers
	 * the rest — and, upward, when the farthest entry is a junction card: the fork is
	 * already the branching point on show, so a parent above it only doubles up.
	 */
	private renderFarEnd(
		parent: HTMLElement,
		node: TFile,
		direction: Direction,
		visited: Set<string>,
		lastIsJunction: boolean
	): void {
		if (!this.graph) return;

		// Upward the parent is the *active* note's own — it is that note's branch we are
		// placing. Downward the leaf is the end of the strand **as drawn**, so a branch the
		// reader picked (or is previewing) ends at its own leaf, not the first link's.
		let target: TFile | null;
		if (direction === "incoming") {
			if (lastIsJunction || !this.activeNote) return;
			target = findParent(this.graph, this.activeNote);
		} else {
			target = findLeaf(this.graph, node);
		}

		if (!target || visited.has(target.path)) return;
		this.renderEntry(parent, target, direction, true);
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
	 * Picking an option **opens** it, where an outgoing junction's re-roots the strand.
	 * That is forced by the geometry, not a whim: everything from this fork down to the
	 * active note is fixed — it is the path to the note you are on — so a sibling's strand
	 * cannot be drawn here without drawing something the vault does not say. Going to it
	 * is the only way to switch. For the same reason there is no continuation to preview,
	 * so the card has no hover behaviour.
	 */
	private renderSiblingEntry(parent: HTMLElement, file: TFile, kind: Direction | "active", options: TFile[]): void {
		const key = branchKey(kind, file);
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
				this.expandedBranches.delete(key);
				void this.app.workspace.getLeaf(event.ctrlKey || event.metaKey).openFile(option);
			});
		}
	}

	/** (Re)render a junction's continuation container from its current/previewed choice. */
	private renderContinuation(key: string): void {
		const info = this.branchContinuations.get(key);
		if (!info) return;
		info.container.empty();

		const { options, direction, visited, budget, container } = info;
		const preview =
			this.previewBranch?.key === key ? options.find((f) => f.path === this.previewBranch?.path) : undefined;
		const continueFrom = preview ?? this.selectedOption(key, options);
		if (visited.has(continueFrom.path)) return;

		const nextVisited = new Set(visited);
		nextVisited.add(continueFrom.path);
		this.renderStrand(container, continueFrom, direction, nextVisited, budget, true);
	}

	private renderEntry(parent: HTMLElement, file: TFile, kind: Direction | "active", detached = false): void {
		const row = parent.createDiv({ cls: `folgezettel-entry is-${kind}${detached ? " is-detached" : ""}` });

		// Left gutter: the indentation guide rail and a dot marking the note — accent
		// for the active note, muted for the rest (colour is set in CSS).
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
		direction: Direction
	): void {
		const expanded = this.expandedBranches.has(key);

		const row = parent.createDiv({ cls: `folgezettel-entry is-branch is-${direction}${expanded ? " is-expanded" : ""}` });
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
			// Hovering an option previews its continuation. Works in both directions
			// because each region grows away from the active note (see the centred
			// layout), so the card never shifts under the cursor. Touch has no hover
			// (and no mouseleave to clear a stuck preview), so on mobile we skip it and
			// rely on tap-to-select — the click handler above.
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

function branchKey(direction: Direction | "active", junction: TFile): string {
	return `${direction}|${junction.path}`;
}
