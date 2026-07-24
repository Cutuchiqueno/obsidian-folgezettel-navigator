import { Plugin, WorkspaceLeaf } from "obsidian";
import { FolgezettelView, VIEW_TYPE_FOLGEZETTEL } from "./view";
import { DEFAULT_SETTINGS, FolgezettelSettings, FolgezettelSettingTab } from "./settings";

export default class FolgezettelPlugin extends Plugin {
	settings!: FolgezettelSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_FOLGEZETTEL, (leaf) => new FolgezettelView(leaf, this));

		this.addRibbonIcon("git-branch", "Open Folgezettel navigator", () => this.activateView());

		this.addCommand({
			id: "open-folgezettel-navigator",
			name: "Open Folgezettel navigator",
			callback: () => this.activateView(),
		});

		this.addSettingTab(new FolgezettelSettingTab(this.app, this));
	}

	async onunload(): Promise<void> {
		// Obsidian detaches views of registered types automatically on unload.
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/** Persist settings and re-render any open panes so changes take effect immediately. */
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_FOLGEZETTEL)) {
			if (leaf.view instanceof FolgezettelView) leaf.view.refresh();
		}
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
