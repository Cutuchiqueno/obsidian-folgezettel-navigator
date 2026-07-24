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

import { ItemView, Platform, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { buildGraph, FolgezettelGraph } from "./graph";
import type FolgezettelPlugin from "./main";

export const VIEW_TYPE_FOLGEZETTEL = "folgezettel-navigator-view";

/** Safety bound on strand-walk iterations (cycles are already guarded by `visited`). */
const MAX_ITERATIONS = 100;

type Direction = "incoming" | "outgoing";

export class FolgezettelView extends ItemView {
	/** Live hover popover slot required by Obsidian's page-preview integration. */
	hoverPopover: HTMLElement | null = null;

	/** Active note the current pane state belongs to; state resets when it changes. */
	private currentPath: string | null = null;
	/** Junction keys whose option list is expanded. */
	private expandedBranches = new Set<string>();
	/** Junction key -> chosen option path (overrides the mtime default). */
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

		this.renderEntry(list, note, "active");

		const outgoingEl = list.createDiv({ cls: "folgezettel-region is-outgoing" });
		this.renderStrand(outgoingEl, note, "outgoing", new Set<string>([note.path]), maxSteps);
	}

	/**
	 * Walk and render a strand from `from` in `direction`. At a junction it renders the
	 * branch card, then a continuation container holding the strand beyond it, and
	 * recurses into that container along the chosen (or hover-previewed) option.
	 * Entries are emitted nearest -> farthest; CSS flips the incoming region visually.
	 */
	private renderStrand(parent: HTMLElement, from: TFile, direction: Direction, visited: Set<string>, budget: number): void {
		const edges = this.graph?.[direction];
		if (!edges) return;
		let node = from;
		let remaining = budget;

		for (let i = 0; i < MAX_ITERATIONS && remaining > 0; i++) {
			const neighbours = edges.get(node.path) ?? [];
			if (neighbours.length === 0) return;

			if (neighbours.length >= 2) {
				const key = branchKey(direction, node);
				const stored = this.branchSelections.get(key);
				const selected = neighbours.find((f) => f.path === stored) ?? mostRecent(neighbours);
				this.renderBranchEntry(parent, neighbours, key, selected, direction);
				remaining--; // the branch entry occupies a slot

				const container = parent.createDiv({ cls: "folgezettel-continuation" });
				this.branchContinuations.set(key, { container, options: neighbours, direction, visited: new Set(visited), budget: remaining });
				this.renderContinuation(key);
				return; // the recursion owns the strand beyond the card
			}

			const next = neighbours[0];
			if (visited.has(next.path)) return;
			visited.add(next.path);
			this.renderEntry(parent, next, direction);
			remaining--;
			node = next;
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
		const stored = this.branchSelections.get(key);
		const selected = options.find((f) => f.path === stored) ?? mostRecent(options);
		const continueFrom = preview ?? selected;
		if (visited.has(continueFrom.path)) return;

		const nextVisited = new Set(visited);
		nextVisited.add(continueFrom.path);
		this.renderStrand(container, continueFrom, direction, nextVisited, budget);
	}

	private renderEntry(parent: HTMLElement, file: TFile, kind: Direction | "active"): void {
		const row = parent.createDiv({ cls: `folgezettel-entry is-${kind}` });

		// Left gutter: the indentation guide rail and a dot marking the note — accent
		// for the active note, muted for the rest (colour is set in CSS).
		const marker = row.createDiv({ cls: "folgezettel-marker" });
		marker.createDiv({ cls: "folgezettel-dot" });

		this.renderTitleLink(row, file);
	}

	/**
	 * A junction, rendered inline. Collapsed it is a normal entry for the chosen
	 * option (title opens the note); its gutter shows a branch icon instead of the
	 * direction arrow. Clicking the branch icon expands the entry into the full
	 * option list; picking an option collapses it and re-roots the strand.
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
		const toggle = marker.createDiv({ cls: "folgezettel-branch-toggle", attr: { "aria-label": "Show branches" } });
		setIcon(toggle, "git-fork");
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

		// The current choice leads the list; the rest keep their declared order.
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
			this.app.workspace.getLeaf(newLeaf).openFile(file);
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

function branchKey(direction: Direction, junction: TFile): string {
	return `${direction}|${junction.path}`;
}

/** The option whose note was modified most recently — the default chosen strand. */
function mostRecent(files: TFile[]): TFile {
	return files.reduce((a, b) => (b.stat.mtime > a.stat.mtime ? b : a));
}
