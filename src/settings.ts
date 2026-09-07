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

import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFolder } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type FolgezettelPlugin from "./main";
import { FOLGEZETTEL_KEY } from "./graph";

export interface FolgezettelSettings {
	/** Frontmatter property read for Folgezettel links. */
	propertyName: string;
	/** How many notes to show on each side (incoming and outgoing) of the active note. */
	maxSteps: number;
	/**
	 * Folder that `Create following note` puts new notes in. Empty means "wherever the
	 * note being continued lives"; "/" is the vault root.
	 */
	newNoteFolder: string;
}

export const DEFAULT_SETTINGS: FolgezettelSettings = {
	propertyName: FOLGEZETTEL_KEY,
	maxSteps: 5,
	newNoteFolder: "",
};

/**
 * Name and description of each setting, in one place: the declarative definitions and
 * the `display()` fallback below both render them, and a wording change should not have
 * to be made twice.
 */
const LABELS: Record<keyof FolgezettelSettings, { name: string; desc: string }> = {
	propertyName: {
		name: "Folgezettel property",
		desc: "Frontmatter property that holds the Folgezettel link(s).",
	},
	newNoteFolder: {
		name: "New note location",
		desc:
			"Folder that new Folgezettel notes are created in. Leave empty to create them " +
			"next to the note they continue.",
	},
	maxSteps: {
		name: "Sequence length",
		desc: "How many incoming and outgoing notes to show on each side of the active note.",
	},
};

const NEW_NOTE_FOLDER_PLACEHOLDER = "Same folder as the current note";
const MAX_STEPS_RANGE = { min: 1, max: 10, step: 1 };

export class FolgezettelSettingTab extends PluginSettingTab {
	private plugin: FolgezettelPlugin;

	constructor(app: App, plugin: FolgezettelPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * The settings, declared rather than built (Obsidian 1.13+). Declaring them is what
	 * puts them in Obsidian's settings **search**; a tab that only renders itself in
	 * `display()` cannot be found there. It also gets the folder field its type-ahead
	 * from Obsidian itself, instead of the `FolderSuggest` below.
	 *
	 * Typed by `keyof FolgezettelSettings`, so a `key` that is not a real setting fails
	 * the build rather than silently reading and writing nothing.
	 */
	getSettingDefinitions(): SettingDefinitionItem<keyof FolgezettelSettings>[] {
		return [
			{
				...LABELS.propertyName,
				control: {
					type: "text",
					key: "propertyName",
					placeholder: FOLGEZETTEL_KEY,
					defaultValue: DEFAULT_SETTINGS.propertyName,
				},
			},
			{
				...LABELS.newNoteFolder,
				control: {
					type: "folder",
					key: "newNoteFolder",
					placeholder: NEW_NOTE_FOLDER_PLACEHOLDER,
					defaultValue: DEFAULT_SETTINGS.newNoteFolder,
					// The vault root is a legitimate answer here — `authoring.ts` maps the
					// "/" it yields onto the root.
					includeRoot: true,
				},
			},
			{
				...LABELS.maxSteps,
				control: {
					type: "slider",
					key: "maxSteps",
					...MAX_STEPS_RANGE,
					defaultValue: DEFAULT_SETTINGS.maxSteps,
				},
			},
		];
	}

	/**
	 * Persist what a declarative control changed. Overridden for two reasons: the
	 * inherited version only writes the data file, while `saveSettings()` also re-renders
	 * every open panel so a change shows immediately; and the two text fields need the
	 * same normalizing the fallback below gives them.
	 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		const { settings } = this.plugin;
		switch (key as keyof FolgezettelSettings) {
			case "propertyName":
				// Fall back to the default when the field is cleared.
				settings.propertyName = text(value).trim() || FOLGEZETTEL_KEY;
				break;
			case "newNoteFolder":
				settings.newNoteFolder = text(value).trim();
				break;
			case "maxSteps":
				settings.maxSteps = Number(value);
				break;
			default:
				return;
		}
		await this.plugin.saveSettings();
	}

	/**
	 * Imperative fallback for Obsidian before 1.13, which has no declarative settings.
	 * Obsidian ignores this whenever `getSettingDefinitions()` returns anything, so the
	 * two never both run — keep them saying the same thing, or drop this (and
	 * `FolderSuggest`) once `manifest.json` requires 1.13.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(LABELS.propertyName.name)
			.setDesc(LABELS.propertyName.desc)
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
			.setName(LABELS.newNoteFolder.name)
			.setDesc(LABELS.newNoteFolder.desc)
			.addSearch((search) => {
				search
					.setPlaceholder(NEW_NOTE_FOLDER_PLACEHOLDER)
					.setValue(this.plugin.settings.newNoteFolder)
					.onChange(async (value) => {
						this.plugin.settings.newNoteFolder = value.trim();
						await this.plugin.saveSettings();
					});
				// Type-ahead over the vault's folders, as Obsidian's own path settings have.
				new FolderSuggest(this.app, search.inputEl);
			});

		new Setting(containerEl)
			.setName(LABELS.maxSteps.name)
			.setDesc(LABELS.maxSteps.desc)
			.addSlider((slider) =>
				slider
					.setLimits(MAX_STEPS_RANGE.min, MAX_STEPS_RANGE.max, MAX_STEPS_RANGE.step)
					.setValue(this.plugin.settings.maxSteps)
					.onChange(async (value) => {
						this.plugin.settings.maxSteps = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

/** What a control handed us, as text. */
function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** Folder type-ahead for a path text field, for the pre-1.13 `display()` fallback. */
class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, private input: HTMLInputElement) {
		super(app, input);
	}

	protected getSuggestions(query: string): TFolder[] {
		const needle = query.toLowerCase();
		return this.app.vault
			.getAllFolders(true)
			.filter((folder) => folder.path.toLowerCase().includes(needle));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		// The component's onChange listens for `input`; setValue alone does not fire it.
		this.input.trigger("input");
		this.close();
	}
}
