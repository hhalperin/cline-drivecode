/**
 * Filter logic for the Status Hub view, kept out of the component so it can be
 * tested under the node environment the webview suite runs in.
 *
 * A live `status.updated` broadcast is not necessarily part of the view being
 * shown: the server applied the filters to the page, but the broadcast bypasses
 * that path entirely. The same predicate has to run client-side before a live
 * row is prepended, or the list shows rows that contradict its own filters.
 */

import type { StatusState, StatusUpdate } from "@cline/shared";

export interface StatusFilters {
	stateFilter: StatusState[];
	agentFilter: string | null;
	/** Tags a row must carry — all of them, not any. See `StatusQuerySchema`. */
	tagFilter: string[];
	search: string;
}

export const EMPTY_STATUS_FILTERS: StatusFilters = {
	stateFilter: [],
	agentFilter: null,
	tagFilter: [],
	search: "",
};

/** True when any filter narrows the view away from "everything". */
export function hasActiveFilters(filters: StatusFilters): boolean {
	return (
		filters.stateFilter.length > 0 ||
		filters.agentFilter !== null ||
		filters.tagFilter.length > 0 ||
		filters.search !== ""
	);
}

/** Mirrors the server-side query so a live row is held to the same test. */
export function matchesStatusFilters(
	update: StatusUpdate,
	filters: StatusFilters,
): boolean {
	if (
		filters.stateFilter.length > 0 &&
		!filters.stateFilter.includes(update.state)
	) {
		return false;
	}
	if (filters.agentFilter && update.agentId !== filters.agentFilter) {
		return false;
	}
	if (
		filters.tagFilter.length > 0 &&
		!filters.tagFilter.every((tag) => update.tags.includes(tag))
	) {
		return false;
	}
	if (filters.search) {
		const haystack = `${update.headline} ${update.detail ?? ""}`.toLowerCase();
		if (!haystack.includes(filters.search.toLowerCase())) return false;
	}
	return true;
}

export interface StatusTagFacet {
	tag: string;
	count: number;
	/** Whether this tag is one of the ones currently narrowing the view. */
	selected: boolean;
}

/**
 * Tag chips to offer, counted over the rows the query already returned.
 *
 * Counting the page rather than the whole table is deliberate: the rows on
 * screen are what the chip narrows, so a chip promising 40 hits above a page
 * that can only yield 6 would be a lie in the same way an unfiltered board
 * heading is. A tag with no hits is dropped entirely rather than rendered at
 * zero — a chip that cannot change anything is noise.
 *
 * Selected tags survive a zero count so the chip you just clicked does not
 * vanish out from under the pointer, leaving the filter on with nothing to
 * turn it off.
 */
export function statusTagFacets(
	updates: readonly StatusUpdate[],
	selected: readonly string[],
): StatusTagFacet[] {
	const counts = new Map<string, number>();
	for (const tag of selected) counts.set(tag, 0);
	for (const update of updates) {
		for (const tag of update.tags) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	const selectedSet = new Set(selected);
	return [...counts.entries()]
		.filter(([tag, count]) => count > 0 || selectedSet.has(tag))
		.map(([tag, count]) => ({ tag, count, selected: selectedSet.has(tag) }))
		.sort(
			(a, b) =>
				Number(b.selected) - Number(a.selected) ||
				b.count - a.count ||
				a.tag.localeCompare(b.tag),
		);
}

/** Add or remove one tag, keeping the list stable for the request payload. */
export function toggleTagFilter(
	current: readonly string[],
	tag: string,
): string[] {
	return current.includes(tag)
		? current.filter((entry) => entry !== tag)
		: [...current, tag];
}

/**
 * What a board section heading should claim.
 *
 * Unfiltered, the whole-table count is the honest number — a board that says
 * "3 blocked" when 40 are blocked is worse than no board. Filtered, the rows
 * below the heading are a subset the summary knows nothing about, so the
 * heading has to describe them instead or it contradicts what is on screen.
 */
export function sectionHeadingCount(
	rowCount: number,
	summaryCount: number | undefined,
	filtersActive: boolean,
): number {
	if (filtersActive) return rowCount;
	return summaryCount ?? rowCount;
}
