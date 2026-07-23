import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { buildGraph, FolgezettelGraph } from "./graph";

export const VIEW_TYPE_FOLGEZETTEL = "folgezettel-navigator-view";

/** How many notes to show above and below the active note. */
const MAX_STEPS = 5;
/** Safety bound on strand-walk iterations (cycles are already guarded by `visited`). */
const MAX_ITERATIONS = 100;

type Direction = "incoming" | "outgoing";

/**
 * One rendered element of a strand: a plain note, or a junction. A junction is
 * shown inline as a normal entry for the currently-chosen option (`selected`),
 * marked with a branch icon; expanding it lets the reader pick another option.
 */
type StrandItem =
	| { kind: "note"; file: TFile }
	| { kind: "branch"; options: TFile[]; key: string; selected: TFile };

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
	 * (outgoing) branch card, the strand continues from that option instead of the
	 * stored selection — without reordering the card. Cleared on mouse-out / action.
	 */
	private previewBranch: { key: string; path: string } | null = null;
	/** Cached graph for the current render, reused by on-hover continuation rebuilds. */
	private graph: FolgezettelGraph | null = null;
	/**
	 * Per outgoing-junction handle to the DOM container holding everything below its
	 * card, plus the state needed to re-walk it — so a hover preview rebuilds only
	 * that subtree and never the card the cursor sits on.
	 */
	private branchContinuations = new Map<
		string,
		{ container: HTMLElement; options: TFile[]; visited: Set<string>; budget: number }
	>();

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
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

		// Re-render whenever the active note or the vault's links change.
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.render()));
		this.registerEvent(this.app.metadataCache.on("resolved", () => this.render()));
		this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));

		this.render();
	}

	async onClose(): Promise<void> {
		// Nothing to tear down: all DOM lives inside contentEl.
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();

		const active = this.app.workspace.getActiveFile();
		if (!active || active.extension !== "md") {
			el.createDiv({ cls: "folgezettel-empty", text: "Open a note to see its Folgezettel sequence." });
			return;
		}

		// Navigating to a different note resets the per-note branch choices.
		if (active.path !== this.currentPath) {
			this.currentPath = active.path;
			this.expandedBranches.clear();
			this.branchSelections.clear();
			this.previewBranch = null;
		}

		this.graph = buildGraph(this.app);
		this.branchContinuations.clear();
		const upItems = this.buildStrand(this.graph, active, "incoming");

		const list = el.createDiv({ cls: "folgezettel-list" });

		// Ancestors above, ordered farthest -> nearest so top-to-bottom follows the sequence.
		this.renderStrand(list, upItems, "incoming", true);
		this.renderEntry(list, active, "active");
		// Descendants below — walked and rendered together so each junction's
		// continuation gets its own container that hover previews can rebuild in place.
		this.renderOutgoing(list, active, new Set<string>([active.path]), MAX_STEPS);
	}

	/**
	 * Walk and render the outgoing strand from `from`. At a junction it renders the
	 * branch card, then a continuation container holding everything below it, and
	 * recurses into that container along the chosen (or hover-previewed) option.
	 */
	private renderOutgoing(parent: HTMLElement, from: TFile, visited: Set<string>, budget: number): void {
		const edges = this.graph?.outgoing;
		if (!edges) return;
		let node = from;
		let remaining = budget;

		for (let i = 0; i < MAX_ITERATIONS && remaining > 0; i++) {
			const neighbours = edges.get(node.path) ?? [];
			if (neighbours.length === 0) return;

			if (neighbours.length >= 2) {
				const key = branchKey("outgoing", node);
				const stored = this.branchSelections.get(key);
				const selected = neighbours.find((f) => f.path === stored) ?? mostRecent(neighbours);
				this.renderBranchEntry(parent, { kind: "branch", options: neighbours, key, selected }, "outgoing");
				remaining--; // the branch entry occupies a slot

				const container = parent.createDiv({ cls: "folgezettel-continuation" });
				this.branchContinuations.set(key, { container, options: neighbours, visited: new Set(visited), budget: remaining });
				this.renderContinuation(key);
				return; // the recursion owns everything below the card
			}

			const next = neighbours[0];
			if (visited.has(next.path)) return;
			visited.add(next.path);
			this.renderEntry(parent, next, "outgoing");
			remaining--;
			node = next;
		}
	}

	/** (Re)render a junction's continuation container from its current/previewed choice. */
	private renderContinuation(key: string): void {
		const info = this.branchContinuations.get(key);
		if (!info) return;
		info.container.empty();

		const { options, visited, budget, container } = info;
		const preview =
			this.previewBranch?.key === key ? options.find((f) => f.path === this.previewBranch?.path) : undefined;
		const stored = this.branchSelections.get(key);
		const selected = options.find((f) => f.path === stored) ?? mostRecent(options);
		const continueFrom = preview ?? selected;
		if (visited.has(continueFrom.path)) return;

		const nextVisited = new Set(visited);
		nextVisited.add(continueFrom.path);
		this.renderOutgoing(container, continueFrom, nextVisited, budget);
	}

	/**
	 * Walk the graph in one direction, following single edges and, at a junction,
	 * the chosen option (reader's pick, else most recent mtime). Used for the
	 * incoming side; the outgoing side is walked-and-rendered by `renderOutgoing`.
	 * Returns items ordered from nearest the active note to farthest.
	 */
	private buildStrand(graph: FolgezettelGraph, active: TFile, direction: Direction): StrandItem[] {
		const edges = graph[direction];
		const items: StrandItem[] = [];
		const visited = new Set<string>([active.path]);
		let node = active;
		let notes = 0;

		for (let i = 0; i < MAX_ITERATIONS && notes < MAX_STEPS; i++) {
			const neighbours = edges.get(node.path) ?? [];
			if (neighbours.length === 0) break;

			let next: TFile;
			if (neighbours.length >= 2) {
				const key = branchKey(direction, node);
				const stored = this.branchSelections.get(key);
				const selected = neighbours.find((f) => f.path === stored) ?? mostRecent(neighbours);
				items.push({ kind: "branch", options: neighbours, key, selected });
				next = selected;
			} else {
				items.push({ kind: "note", file: neighbours[0] });
				next = neighbours[0];
			}

			if (visited.has(next.path)) break;
			visited.add(next.path);
			notes++;
			node = next;
		}

		return items;
	}

	private renderStrand(parent: HTMLElement, items: StrandItem[], direction: Direction, reverse: boolean): void {
		const ordered = reverse ? [...items].reverse() : items;
		for (const item of ordered) {
			if (item.kind === "note") this.renderEntry(parent, item.file, direction);
			else this.renderBranchEntry(parent, item, direction);
		}
	}

	private renderEntry(parent: HTMLElement, file: TFile, kind: Direction | "active"): void {
		const row = parent.createDiv({ cls: `folgezettel-entry is-${kind}` });

		// Left gutter carries the indentation guide rail and a direction arrow,
		// mirroring the File Explorer's collapse-triangle column.
		const marker = row.createDiv({ cls: "folgezettel-marker" });
		if (kind !== "active") {
			const arrow = marker.createDiv({ cls: `folgezettel-arrow is-${kind === "incoming" ? "up" : "down"}` });
			this.createChevron(arrow);
		}

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
		item: Extract<StrandItem, { kind: "branch" }>,
		direction: Direction
	): void {
		const { options, key, selected } = item;
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
			// Outgoing only (for now): hovering an option previews its continuation below.
			if (direction === "outgoing") {
				option.addEventListener("mouseenter", () => this.setPreviewBranch(key, file.path));
			}
		}
		if (direction === "outgoing") {
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

	/** Recreate the File Explorer's `right-triangle` collapse icon (rotated via CSS). */
	private createChevron(parent: HTMLElement): void {
		const svg = parent.createSvg("svg", {
			cls: ["svg-icon", "right-triangle"],
			attr: {
				viewBox: "0 0 24 24",
				width: "24",
				height: "24",
				fill: "none",
				stroke: "currentColor",
				"stroke-width": "2",
				"stroke-linecap": "round",
				"stroke-linejoin": "round",
			},
		});
		svg.createSvg("path", { attr: { d: "M3 8L12 17L21 8" } });
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
