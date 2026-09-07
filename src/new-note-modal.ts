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

import { App, Modal } from "obsidian";

export interface NewNoteModalOptions {
	title: string;
	/** Label of the confirming button. */
	cta: string;
	placeholder?: string;
	/**
	 * Checked on submit: a message keeps the modal open and shows it under the field,
	 * `null` accepts the name. The caller owns the rules, since only it knows where the
	 * note would land.
	 */
	validate: (name: string) => string | null;
	onSubmit: (name: string) => void;
}

/**
 * Ask for a note name, modeled on Obsidian's own rename dialog: one text field, Enter
 * or the button confirms, Escape closes. Rejected names keep the dialog open with the
 * reason under the field, so the typed name is never lost to a notice.
 */
export class NewNoteModal extends Modal {
	private inputEl!: HTMLInputElement;
	private errorEl!: HTMLElement;

	constructor(app: App, private options: NewNoteModalOptions) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.options.title);
		const { contentEl } = this;

		this.inputEl = contentEl.createEl("input", {
			type: "text",
			cls: "folgezettel-name-input",
			attr: { placeholder: this.options.placeholder ?? "" },
		});
		this.errorEl = contentEl.createDiv({ cls: "folgezettel-name-error" });

		// Typing is an answer to the complaint, so clear it.
		this.inputEl.addEventListener("input", () => this.errorEl.setText(""));
		this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
			if (event.key !== "Enter" || event.isComposing) return;
			event.preventDefault();
			this.submit();
		});

		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		buttons
			.createEl("button", { text: this.options.cta, cls: "mod-cta" })
			.addEventListener("click", () => this.submit());

		this.inputEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const name = this.inputEl.value.trim();
		const error = this.options.validate(name);
		if (error) {
			this.errorEl.setText(error);
			return;
		}
		this.close();
		this.options.onSubmit(name);
	}
}
