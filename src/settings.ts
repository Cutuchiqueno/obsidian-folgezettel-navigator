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
					.onChange(async (value) => {
						this.plugin.settings.maxSteps = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
