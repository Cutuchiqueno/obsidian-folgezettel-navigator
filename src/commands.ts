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

import { App, FuzzySuggestModal, Notice, TFile } from "obsidian";
import { buildGraph, FolgezettelGraph } from "./graph";
import type FolgezettelPlugin from "./main";
import {
	findLeaf,
	findNextJunction,
	findParent,
	findPreviousJunction,
	nextNotes,
	previousNotes,
} from "./navigate";

/**
 * A jump along the Folgezettel structure, exposed as an Obsidian command.
 *
 * Every command reduces to the same shape — a list of candidate notes — so the three
 * outcomes are handled once, in `run`: nothing to go to (a notice), exactly one target
 * (open it), or several (let the reader pick). Only the axis commands can ever yield
 * several; the derived jumps resolve to a single note by construction.
 */
interface NavigationCommand {
	id: string;
	name: string;
	targets: (graph: FolgezettelGraph, from: TFile) => TFile[];
	/** Shown when the walk finds nowhere to go. */
	empty: string;
	/** Placeholder for the picker, on the commands that can produce several targets. */
	prompt?: string;
}

/** Adapt a walk that resolves to a single note to the common candidate-list shape. */
function one(walk: (graph: FolgezettelGraph, from: TFile) => TFile | null) {
	return (graph: FolgezettelGraph, from: TFile): TFile[] => {
		const target = walk(graph, from);
		return target ? [target] : [];
	};
}

const NAVIGATION_COMMANDS: NavigationCommand[] = [
	{
		id: "open-previous",
		name: "Open previous note",
		targets: previousNotes,
		empty: "No note leads to this one.",
		prompt: "Previous notes",
	},
	{
		id: "open-next",
		name: "Open following note",
		targets: nextNotes,
		empty: "This note has no continuation.",
		prompt: "Following notes",
	},
	{
		id: "open-parent",
		name: "Open parent note",
		targets: one(findParent),
		empty: "This note is the beginning of its Folgezettel structure.",
	},
	{
		id: "open-leaf",
		name: "Open leaf note",
		targets: one(findLeaf),
		empty: "This note is already the end of its branch.",
	},
	{
		id: "open-next-junction",
		name: "Open next junction note",
		targets: one(findNextJunction),
		empty: "No junction follows on this branch.",
	},
	{
		id: "open-previous-junction",
		name: "Open previous junction note",
		targets: one(findPreviousJunction),
		empty: "No junction precedes this note.",
	},
];

export function registerNavigationCommands(plugin: FolgezettelPlugin): void {
	for (const command of NAVIGATION_COMMANDS) {
		plugin.addCommand({
			id: command.id,
			name: command.name,
			// checkCallback so the command hides itself (and its hotkey stays inert)
			// when there is no note to navigate from. The graph is only built once the
			// command actually runs — the check must stay cheap.
			checkCallback: (checking: boolean) => {
				const from = activeNote(plugin.app);
				if (!from) return false;
				if (!checking) run(plugin, command, from);
				return true;
			},
		});
	}
}

function run(plugin: FolgezettelPlugin, command: NavigationCommand, from: TFile): void {
	const graph = buildGraph(plugin.app, plugin.settings.propertyName);
	const targets = command.targets(graph, from);

	if (targets.length === 0) {
		new Notice(command.empty);
		return;
	}
	if (targets.length === 1) {
		void open(plugin.app, targets[0]);
		return;
	}
	// Declared order is meaningful (the first link is the current branch), so the
	// picker lists the options as the property does.
	new NotePicker(plugin.app, targets, command.prompt ?? command.name, (file) =>
		void open(plugin.app, file)
	).open();
}

/**
 * The note a command acts from: the active markdown file, if there is one. Shared with
 * the authoring commands, which start from the same note.
 */
export function activeNote(app: App): TFile | null {
	const file = app.workspace.getActiveFile();
	return file && file.extension === "md" ? file : null;
}

/**
 * Open in the current editor, matching what a plain link click does.
 *
 * `active: true` because a command can run with the editor unfocused — from the command
 * palette, which is itself a modal, or with a sidebar in focus. The file would open
 * either way, but the pane would not become active, and the sidebar views that follow
 * the active file (Properties, Outline, Backlinks) would keep showing the note we just
 * left.
 */
async function open(app: App, file: TFile): Promise<void> {
	await app.workspace.getLeaf(false).openFile(file, { active: true });
}

/** Fuzzy picker over a fixed set of notes, used whenever a command has several. */
export class NotePicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private files: TFile[],
		placeholder: string,
		private choose: (file: TFile) => void
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): TFile[] {
		return this.files;
	}

	getItemText(file: TFile): string {
		return file.basename;
	}

	onChooseItem(file: TFile): void {
		this.choose(file);
	}
}
