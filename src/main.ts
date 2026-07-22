import { Plugin, WorkspaceLeaf } from "obsidian";
import { FolgezettelView, VIEW_TYPE_FOLGEZETTEL } from "./view";

export default class FolgezettelPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerView(VIEW_TYPE_FOLGEZETTEL, (leaf) => new FolgezettelView(leaf));

		this.addRibbonIcon("git-branch", "Open Folgezettel navigator", () => this.activateView());

		this.addCommand({
			id: "open-folgezettel-navigator",
			name: "Open Folgezettel navigator",
			callback: () => this.activateView(),
		});
	}

	async onunload(): Promise<void> {
		// Obsidian detaches views of registered types automatically on unload.
	}

	/** Reveal the Folgezettel view, reusing an existing leaf or opening one on the right. */
	private async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_FOLGEZETTEL)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE_FOLGEZETTEL, active: true });
		}

		workspace.revealLeaf(leaf);
	}
}
