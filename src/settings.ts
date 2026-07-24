import { App, PluginSettingTab, Setting } from "obsidian";
import type FolgezettelPlugin from "./main";
import { FOLGEZETTEL_KEY } from "./graph";

export interface FolgezettelSettings {
	/** Frontmatter property read for Folgezettel links. */
	propertyName: string;
	/** How many notes to show on each side (incoming and outgoing) of the active note. */
	maxSteps: number;
}

export const DEFAULT_SETTINGS: FolgezettelSettings = {
	propertyName: FOLGEZETTEL_KEY,
	maxSteps: 5,
};

export class FolgezettelSettingTab extends PluginSettingTab {
	private plugin: FolgezettelPlugin;

	constructor(app: App, plugin: FolgezettelPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Folgezettel property")
			.setDesc("Frontmatter property that holds the Folgezettel link(s).")
			.addText((text) =>
				text
					.setPlaceholder(FOLGEZETTEL_KEY)
					.setValue(this.plugin.settings.propertyName)
					.onChange(async (value) => {
						// Fall back to the default when the field is cleared.
						this.plugin.settings.propertyName = value.trim() || FOLGEZETTEL_KEY;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Sequence length")
			.setDesc("How many incoming and outgoing notes to show on each side of the active note.")
			.addSlider((slider) =>
				slider
					.setLimits(1, 10, 1)
					.setValue(this.plugin.settings.maxSteps)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxSteps = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
