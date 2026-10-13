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
 * Where the native page-preview popover goes when this panel is docked in a sidebar.
 *
 * Obsidian's own positioner only ever puts a popover *above or below* its target, so a
 * preview opened from a panel entry lands on top of the entries beneath it — the strand
 * the reader is previewing along is exactly what it covers. Docked in a sidebar the panel
 * has somewhere to send it: the sidebar is a fixed strip at the window's edge, so beside it
 * is both free space and always the same place. This module puts it there, vertically
 * centred on the entry.
 *
 * Pure geometry — no `App`, and the only DOM it touches is the popover's own box.
 */

/** Gap left between the popover and the sidebar it is placed beside. */
const SIDEBAR_GAP_PX = 10;
/** How far inside the window's edges the popover is kept. Obsidian uses the same 10. */
const WINDOW_MARGIN_PX = 10;

/** The side of the sidebar the popover is placed on. */
type Side = "left" | "right";

/** The sidebar the popover has to clear, and which way round it goes. */
export interface PreviewSidebar {
	el: HTMLElement;
	side: Side;
}

/**
 * The sidebar whose edge the popover lines up against, or `null` when the view is not in
 * one — which is the caller's signal to leave the placement to Obsidian entirely.
 *
 * A sidebar is taken whole: the preview should finish *on the sidebar*, not on the leaf
 * inside it, and a sidebar split into columns would otherwise let the popover land on top of
 * its own neighbour.
 *
 * The main area is deliberately not a case here. A tab group has no fixed place — it can be
 * anywhere across the window, split however the reader likes, and as wide as all of it — so
 * there is no "beside" that is reliably free, and moving the preview out of a pane that fills
 * the window would only put it over the editor instead. Obsidian's own placement is the right
 * one there, and it stays untouched.
 *
 * Matching is by Obsidian's layout classes, which are structural and not localised.
 */
export function previewSidebar(viewEl: HTMLElement): PreviewSidebar | null {
	const right = viewEl.closest<HTMLElement>(".mod-right-split");
	if (right) return { el: right, side: "left" };

	const left = viewEl.closest<HTMLElement>(".mod-left-split");
	return left ? { el: left, side: "right" } : null;
}

/**
 * Place `popoverEl` beside the sidebar holding `viewEl`, vertically centred on `itemEl`.
 *
 * Does nothing when the view is not in a sidebar, or when the entry has been re-rendered out
 * of the document while the popover was still opening — in both cases whatever Obsidian
 * already decided stands, rather than a popover pinned to the corner.
 */
export function positionPreview(popoverEl: HTMLElement, itemEl: HTMLElement, viewEl: HTMLElement): void {
	const sidebar = previewSidebar(viewEl);
	if (!sidebar || !itemEl.isConnected) return;

	// Obsidian's positioner caps the height to the room left where *it* was aiming, and
	// pins the box by whichever edges suited it. We aim elsewhere, so drop those inline
	// values — back to the popover's own natural size — and drive it from top/left alone.
	popoverEl.style.removeProperty("max-height");
	popoverEl.style.removeProperty("right");
	popoverEl.style.removeProperty("bottom");

	const win = popoverEl.win;
	const bar = sidebar.el.getBoundingClientRect();
	const item = itemEl.getBoundingClientRect();
	const width = popoverEl.offsetWidth;
	const height = popoverEl.offsetHeight;

	const left =
		sidebar.side === "left" ? bar.left - SIDEBAR_GAP_PX - width : bar.right + SIDEBAR_GAP_PX;
	const top = item.top + item.height / 2 - height / 2;

	popoverEl.style.left = `${clamp(left, WINDOW_MARGIN_PX, win.innerWidth - width - WINDOW_MARGIN_PX)}px`;
	popoverEl.style.top = `${clamp(top, WINDOW_MARGIN_PX, win.innerHeight - height - WINDOW_MARGIN_PX)}px`;
}

/** `value` held within the range; the lower bound wins when the range is empty. */
function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}
