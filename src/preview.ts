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

/**
 * Where the native page-preview popover goes when it is opened from this panel.
 *
 * Obsidian's own positioner only ever puts a popover *above or below* its target, so a
 * preview opened from a panel entry lands on top of the entries beneath it — the strand
 * the reader is previewing along is exactly what it covers. This module places it beside
 * the whole pane instead: clear of the pane, and vertically centred on the entry.
 *
 * Pure geometry — no `App`, and the only DOM it touches is the popover's own box.
 */

/** Gap left between the popover and the pane it is placed beside. */
const PANE_GAP_PX = 10;
/** How far inside the window's edges the popover is kept. Obsidian uses the same 10. */
const WINDOW_MARGIN_PX = 10;

/** The side of the pane the popover is placed on. */
type Side = "left" | "right";

/** The pane the popover has to clear, and which way round it goes. */
interface Pane {
	el: HTMLElement;
	side: Side;
}

/**
 * Place `popoverEl` beside the pane holding `viewEl`, vertically centred on `itemEl`.
 *
 * Does nothing when the pane is not one of the three known layouts, or when the entry has
 * been re-rendered out of the document while the popover was still opening — in both cases
 * whatever Obsidian already decided stands, which is the old behaviour rather than a
 * popover pinned to the corner.
 */
export function positionPreview(popoverEl: HTMLElement, itemEl: HTMLElement, viewEl: HTMLElement): void {
	const pane = findPane(viewEl);
	if (!pane || !itemEl.isConnected) return;

	// Obsidian's positioner caps the height to the room left where *it* was aiming, and
	// pins the box by whichever edges suited it. We aim elsewhere, so start from the
	// popover's own natural size and drive it from top/left alone.
	popoverEl.style.maxHeight = "";
	popoverEl.style.right = "";
	popoverEl.style.bottom = "";

	const win = popoverEl.win;
	const paneRect = pane.el.getBoundingClientRect();
	const item = itemEl.getBoundingClientRect();
	const width = popoverEl.offsetWidth;
	const height = popoverEl.offsetHeight;

	const left =
		pane.side === "left" ? paneRect.left - PANE_GAP_PX - width : paneRect.right + PANE_GAP_PX;
	const top = item.top + item.height / 2 - height / 2;

	popoverEl.style.left = `${clamp(left, WINDOW_MARGIN_PX, win.innerWidth - width - WINDOW_MARGIN_PX)}px`;
	popoverEl.style.top = `${clamp(top, WINDOW_MARGIN_PX, win.innerHeight - height - WINDOW_MARGIN_PX)}px`;
}

/**
 * The pane whose edge the popover lines up against, from the view's own container.
 *
 * A sidebar is taken whole — the reader asked for the preview to finish *on the sidebar*,
 * not on the leaf inside it, and a sidebar that is split into columns would otherwise let
 * the popover land on top of its neighbour. In the main area there is no such enclosure, so
 * the tab group the view sits in is the pane. Both sidebar checks come first, because a
 * sidebar leaf is inside a `.workspace-tabs` of its own as well.
 *
 * Matching is by Obsidian's layout classes, which are structural and not localised.
 */
function findPane(viewEl: HTMLElement): Pane | null {
	const right = viewEl.closest<HTMLElement>(".mod-right-split");
	if (right) return { el: right, side: "left" };

	const left = viewEl.closest<HTMLElement>(".mod-left-split");
	if (left) return { el: left, side: "right" };

	const tabs = viewEl.closest<HTMLElement>(".workspace-tabs");
	return tabs ? { el: tabs, side: "left" } : null;
}

/** `value` held within the range; the lower bound wins when the range is empty. */
function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}
