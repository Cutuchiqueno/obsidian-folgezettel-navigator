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

import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { activeNote, NotePicker } from "./commands";
import { folgezettelTargets } from "./graph";
import type FolgezettelPlugin from "./main";
import { NewNoteModal } from "./new-note-modal";

/*
 * The two commands that *write* the sequence: create a note and hang it off the active
 * one, or hang an existing note off it. Both end in the same place — one more entry at
 * the end of the active note's Folgezettel property — which is what makes the new note
 * a further continuation rather than the current branch (that is the *first* entry; see
 * "current branch" in CLAUDE.md).
 */

/** Characters Obsidian refuses in a file name. */
const ILLEGAL_NAME_CHARS = /[*"\\/<>:|?]/;

export function registerAuthoringCommands(plugin: FolgezettelPlugin): void {
	// checkCallback, like the navigation commands: there is nothing to link *from*
	// without an active note, so the commands hide themselves and their hotkeys go inert.
	plugin.addCommand({
		id: "create-next",
		name: "Create following note",
		checkCallback: (checking: boolean) => {
			const source = activeNote(plugin.app);
			if (!source) return false;
			if (!checking) askForNewNote(plugin, source);
			return true;
		},
	});

	plugin.addCommand({
		id: "link-next",
		name: "Link following note",
		checkCallback: (checking: boolean) => {
			const source = activeNote(plugin.app);
			if (!source) return false;
			if (!checking) pickNoteToLink(plugin, source);
			return true;
		},
	});
}

/**
 * Ask for a name, then create the note there and link it.
 *
 * Exported because the panel's context menu offers the same thing on the note that was
 * right-clicked, which is not necessarily the active one — hence `source` as a parameter
 * rather than a lookup in here.
 */
export function askForNewNote(plugin: FolgezettelPlugin, source: TFile): void {
	// Resolved once, before the dialog opens, so the name check and the creation agree.
	const folder = targetFolder(plugin, source);

	new NewNoteModal(plugin.app, {
		title: "New Folgezettel note",
		cta: "Create",
		placeholder: "Note name",
		validate: (name) => nameError(plugin.app, folder, name),
		onSubmit: (name) => void createAndLink(plugin, source, folder, name),
	}).open();
}

/** Let the reader pick any other note, then link it. Exported like `askForNewNote`. */
export function pickNoteToLink(plugin: FolgezettelPlugin, source: TFile): void {
	const { app } = plugin;
	const linked = new Set(
		folgezettelTargets(app, source, plugin.settings.propertyName).map((file) => file.path)
	);
	// A note cannot continue itself, and one already listed would only be a duplicate.
	const candidates = app.vault
		.getMarkdownFiles()
		.filter((file) => file.path !== source.path && !linked.has(file.path));

	if (candidates.length === 0) {
		new Notice("There is no other note to link.");
		return;
	}

	new NotePicker(app, candidates, "Link as a following note", (file) => {
		void linkExisting(plugin, source, file);
	}).open();
}

async function createAndLink(
	plugin: FolgezettelPlugin,
	source: TFile,
	folder: string,
	name: string
): Promise<void> {
	const { app } = plugin;
	try {
		await ensureFolder(app, folder);
		const file = await app.vault.create(notePath(folder, name), "");
		// The note is created to be written in, so go there — which is also why `source`
		// is the note that was active when the command ran, not whatever is active by now.
		//
		// **Open before writing the link, not after.** Writing `source`'s frontmatter
		// schedules a re-render in every view showing that note — the Properties pane
		// most visibly. Opening the new note in between rebinds that pane to the new
		// file, and the pending update then paints the *source's* rows into it; nothing
		// re-renders it again until the new note itself changes, so the reader sees the
		// note they just left described as the note they are on. Opening first keeps the
		// pane's rebind and the source's update from crossing.
		//
		// `active: true` for the same class of reason: the name dialog took focus off the
		// editor, so without it the file opens in a pane that never becomes active, and
		// the views that follow the active file stay behind.
		await app.workspace.getLeaf(false).openFile(file, { active: true });
		await appendFolgezettel(app, source, file, plugin.settings.propertyName);
	} catch (error) {
		new Notice(`Could not create the note: ${describe(error)}`);
	}
}

async function linkExisting(
	plugin: FolgezettelPlugin,
	source: TFile,
	target: TFile
): Promise<void> {
	try {
		await appendFolgezettel(plugin.app, source, target, plugin.settings.propertyName);
		// Nothing else on screen changes unless the panel is open, so confirm the write.
		new Notice(`Linked "${target.basename}" as a following note.`);
	} catch (error) {
		new Notice(`Could not link the note: ${describe(error)}`);
	}
}

/**
 * Append a link to `target` at the end of `source`'s Folgezettel property.
 *
 * The value is always written as a list: order carries meaning here, and a scalar has
 * no room for the second entry the next call adds. Existing entries are kept as they
 * are — only blanks (an empty list item Obsidian leaves behind) are dropped, since
 * writing one back out would produce a broken link.
 */
async function appendFolgezettel(
	app: App,
	source: TFile,
	target: TFile,
	propertyName: string
): Promise<void> {
	// Wikilink, shortened as far as the vault's link settings allow — the form
	// Obsidian's own property editor writes, and the one `graph.ts` reads back.
	const link = `[[${app.metadataCache.fileToLinktext(target, source.path, true)}]]`;

	await app.fileManager.processFrontMatter(source, (frontmatter: Record<string, unknown>) => {
		const current: unknown = frontmatter[propertyName];
		const entries: unknown[] = Array.isArray(current) ? current : current == null ? [] : [current];
		const kept = entries.filter(
			(entry) => entry != null && (typeof entry !== "string" || entry.trim().length > 0)
		);
		frontmatter[propertyName] = [...kept, link];
	});
}

/** Where a new note goes: the configured folder, or the source note's own folder. */
function targetFolder(plugin: FolgezettelPlugin, source: TFile): string {
	const configured = plugin.settings.newNoteFolder.trim();
	const folder = configured === "" ? source.parent?.path ?? "" : configured;
	// Both the folder picker and `TFolder.path` write the vault root as "/", while the
	// vault addresses it as "" — so a note in the root resolves to the root either way.
	const path = normalizePath(folder);
	return path === "/" ? "" : path;
}

function notePath(folder: string, name: string): string {
	return normalizePath(folder === "" ? `${name}.md` : `${folder}/${name}.md`);
}

/** Why this name cannot be used, or null when it can. Shown inside the dialog. */
function nameError(app: App, folder: string, name: string): string | null {
	if (name === "") return "Enter a name for the new note.";
	if (ILLEGAL_NAME_CHARS.test(name)) return 'A name cannot contain: * " \\ / < > : | ?';
	if (app.vault.getAbstractFileByPath(notePath(folder, name))) {
		return `"${name}" already exists in ${folder === "" ? "the vault root" : folder}.`;
	}
	return null;
}

/** Create the configured folder if the vault does not have it yet. */
async function ensureFolder(app: App, folder: string): Promise<void> {
	if (folder === "") return;
	if (app.vault.getAbstractFileByPath(folder) instanceof TFolder) return;
	await app.vault.createFolder(folder);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
