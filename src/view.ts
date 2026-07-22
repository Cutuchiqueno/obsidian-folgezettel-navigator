import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { buildGraph, walk } from "./graph";

export const VIEW_TYPE_FOLGEZETTEL = "folgezettel-navigator-view";

/** How many notes to show above and below the active note. */
const MAX_STEPS = 5;

type Direction = "incoming" | "outgoing";

export class FolgezettelView extends ItemView {
	/** Live hover popover slot required by Obsidian's page-preview integration. */
	hoverPopover: HTMLElement | null = null;
	/** Custom hover popup used by branch indicators. */
	private branchPopup: HTMLElement | null = null;
	private hidePopupTimer: number | null = null;

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
		this.clearBranchPopup();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		this.clearBranchPopup();

		const active = this.app.workspace.getActiveFile();
		if (!active || active.extension !== "md") {
			el.createDiv({ cls: "folgezettel-empty", text: "Open a note to see its Folgezettel sequence." });
			return;
		}

		const graph = buildGraph(this.app);
		const up = walk(graph, active, "incoming", MAX_STEPS);
		const down = walk(graph, active, "outgoing", MAX_STEPS);

		const list = el.createDiv({ cls: "folgezettel-list" });

		// Top: branch indicator (if the incoming sequence forks), then ancestors
		// ordered farthest -> nearest so reading top-to-bottom follows the sequence.
		if (up.terminator.kind === "branch") this.renderBranch(list, up.terminator.targets, "up");
		for (let i = up.chain.length - 1; i >= 0; i--) this.renderEntry(list, up.chain[i], "incoming");

		// Center: the active note.
		this.renderEntry(list, active, "active");

		// Bottom: descendants nearest -> farthest, then a branch indicator if it forks.
		for (const file of down.chain) this.renderEntry(list, file, "outgoing");
		if (down.terminator.kind === "branch") this.renderBranch(list, down.terminator.targets, "down");
	}

	private renderEntry(parent: HTMLElement, file: TFile, kind: Direction | "active"): void {
		const row = parent.createDiv({ cls: `folgezettel-entry is-${kind}` });
		const link = row.createEl("a", {
			cls: "folgezettel-link",
			text: file.basename,
			href: file.path,
			attr: { "data-path": file.path },
		});

		this.attachNavigation(link, file);
		this.attachHoverPreview(link, file);
	}

	private renderBranch(parent: HTMLElement, targets: TFile[], direction: "up" | "down"): void {
		const row = parent.createDiv({ cls: `folgezettel-branch is-${direction}` });
		setIcon(row.createSpan({ cls: "folgezettel-branch-icon" }), "git-fork");
		row.createSpan({
			cls: "folgezettel-branch-label",
			text: `${targets.length} ${direction === "up" ? "incoming" : "outgoing"} branches`,
		});

		row.addEventListener("mouseenter", () => this.showBranchPopup(row, targets, direction));
		row.addEventListener("mouseleave", () => this.scheduleHidePopup());
		// Also open the picker on click for keyboard/touch users.
		row.addEventListener("click", () => this.showBranchPopup(row, targets, direction));
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

	private showBranchPopup(anchor: HTMLElement, targets: TFile[], direction: "up" | "down"): void {
		this.clearBranchPopup();

		const popup = document.body.createDiv({ cls: "menu folgezettel-branch-popup" });
		for (const file of targets) {
			const item = popup.createDiv({ cls: "menu-item" });
			const titleEl = item.createDiv({ cls: "menu-item-title", text: file.basename });
			item.addEventListener("click", () => {
				this.app.workspace.getLeaf(false).openFile(file);
				this.clearBranchPopup();
			});
			// Ctrl-hovering an option previews it, just like the sequence entries.
			titleEl.addEventListener("mouseover", (event: MouseEvent) => {
				this.app.workspace.trigger("hover-link", {
					event,
					source: VIEW_TYPE_FOLGEZETTEL,
					hoverParent: this,
					targetEl: titleEl,
					linktext: file.path,
					sourcePath: file.path,
				});
			});
		}

		// Position adjacent to the indicator, on the side the sequence continues.
		const rect = anchor.getBoundingClientRect();
		popup.style.left = `${rect.left}px`;
		if (direction === "up") {
			popup.style.top = `${rect.bottom + 2}px`;
		} else {
			popup.style.top = `${rect.top - popup.offsetHeight - 2}px`;
		}

		popup.addEventListener("mouseenter", () => this.cancelHidePopup());
		popup.addEventListener("mouseleave", () => this.scheduleHidePopup());
		this.branchPopup = popup;
	}

	private scheduleHidePopup(): void {
		this.cancelHidePopup();
		this.hidePopupTimer = window.setTimeout(() => this.clearBranchPopup(), 150);
	}

	private cancelHidePopup(): void {
		if (this.hidePopupTimer !== null) {
			window.clearTimeout(this.hidePopupTimer);
			this.hidePopupTimer = null;
		}
	}

	private clearBranchPopup(): void {
		this.cancelHidePopup();
		this.branchPopup?.remove();
		this.branchPopup = null;
	}
}
