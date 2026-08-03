import type { StatusUpdate } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	EMPTY_STATUS_FILTERS,
	hasActiveFilters,
	matchesStatusFilters,
	type StatusFilters,
	sectionHeadingCount,
	statusTagFacets,
	toggleTagFilter,
} from "./status-filters";

function update(overrides: Partial<StatusUpdate> = {}): StatusUpdate {
	return {
		schemaVersion: 1,
		updateId: "u1",
		seq: 1,
		subject: "migration/auth",
		state: "running",
		headline: "Rewriting the token exchange",
		priority: "normal",
		source: "agent",
		tags: [],
		supersededAt: null,
		createdAt: new Date(0).toISOString(),
		...overrides,
	} as StatusUpdate;
}

function filters(overrides: Partial<StatusFilters> = {}): StatusFilters {
	return { ...EMPTY_STATUS_FILTERS, ...overrides };
}

describe("hasActiveFilters", () => {
	it("is false for the empty filter set", () => {
		expect(hasActiveFilters(EMPTY_STATUS_FILTERS)).toBe(false);
	});

	it("is true for any single filter", () => {
		expect(hasActiveFilters(filters({ stateFilter: ["blocked"] }))).toBe(true);
		expect(hasActiveFilters(filters({ agentFilter: "adam" }))).toBe(true);
		expect(hasActiveFilters(filters({ tagFilter: ["auth"] }))).toBe(true);
		expect(hasActiveFilters(filters({ search: "token" }))).toBe(true);
	});
});

describe("matchesStatusFilters", () => {
	it("admits everything when nothing is filtered", () => {
		expect(matchesStatusFilters(update(), EMPTY_STATUS_FILTERS)).toBe(true);
	});

	it("rejects a row outside the selected states", () => {
		const blockedOnly = filters({ stateFilter: ["blocked"] });
		expect(
			matchesStatusFilters(update({ state: "running" }), blockedOnly),
		).toBe(false);
		expect(
			matchesStatusFilters(update({ state: "blocked" }), blockedOnly),
		).toBe(true);
	});

	it("accepts a row in any of several selected states", () => {
		const f = filters({ stateFilter: ["blocked", "failed"] });
		expect(matchesStatusFilters(update({ state: "failed" }), f)).toBe(true);
		expect(matchesStatusFilters(update({ state: "done" }), f)).toBe(false);
	});

	it("rejects another agent's row", () => {
		const f = filters({ agentFilter: "adam" });
		expect(matchesStatusFilters(update({ agentId: "adam" }), f)).toBe(true);
		expect(matchesStatusFilters(update({ agentId: "beth" }), f)).toBe(false);
		// An unattributed row is not Adam's either.
		expect(matchesStatusFilters(update(), f)).toBe(false);
	});

	it("searches the headline and the detail, case-insensitively", () => {
		expect(
			matchesStatusFilters(update(), filters({ search: "TOKEN exchange" })),
		).toBe(true);
		expect(
			matchesStatusFilters(
				update({ detail: "Blocked on the KMS rotation" }),
				filters({ search: "kms" }),
			),
		).toBe(true);
		expect(matchesStatusFilters(update(), filters({ search: "kms" }))).toBe(
			false,
		);
	});

	it("rejects a row missing the filtered tag", () => {
		const f = filters({ tagFilter: ["auth"] });
		expect(matchesStatusFilters(update({ tags: ["auth", "p0"] }), f)).toBe(
			true,
		);
		expect(matchesStatusFilters(update({ tags: ["docs"] }), f)).toBe(false);
		// An untagged row carries no tag, so it is not `auth` either.
		expect(matchesStatusFilters(update(), f)).toBe(false);
	});

	it("requires all filtered tags, not any of them", () => {
		const f = filters({ tagFilter: ["auth", "p0"] });
		expect(matchesStatusFilters(update({ tags: ["auth", "p0"] }), f)).toBe(
			true,
		);
		expect(matchesStatusFilters(update({ tags: ["auth"] }), f)).toBe(false);
		expect(matchesStatusFilters(update({ tags: ["p0"] }), f)).toBe(false);
	});

	it("matches a tag exactly, not as a prefix of another tag", () => {
		expect(
			matchesStatusFilters(
				update({ tags: ["authz"] }),
				filters({ tagFilter: ["auth"] }),
			),
		).toBe(false);
	});

	it("requires every active filter to pass, not just one", () => {
		const f = filters({ stateFilter: ["blocked"], agentFilter: "adam" });
		expect(
			matchesStatusFilters(update({ state: "blocked", agentId: "beth" }), f),
		).toBe(false);
		expect(
			matchesStatusFilters(update({ state: "running", agentId: "adam" }), f),
		).toBe(false);
		expect(
			matchesStatusFilters(update({ state: "blocked", agentId: "adam" }), f),
		).toBe(true);
	});
});

describe("statusTagFacets", () => {
	it("counts each tag over the rows it was given", () => {
		const facets = statusTagFacets(
			[
				update({ updateId: "a", tags: ["auth", "p0"] }),
				update({ updateId: "b", tags: ["auth"] }),
				update({ updateId: "c", tags: ["docs"] }),
			],
			[],
		);
		expect(facets).toEqual([
			{ tag: "auth", count: 2, selected: false },
			{ tag: "docs", count: 1, selected: false },
			{ tag: "p0", count: 1, selected: false },
		]);
	});

	it("offers no chip for a tag no row on screen carries", () => {
		const facets = statusTagFacets([update({ tags: ["auth"] })], []);
		expect(facets.map((facet) => facet.tag)).toEqual(["auth"]);
	});

	it("returns nothing when no row is tagged", () => {
		expect(statusTagFacets([update(), update({ updateId: "b" })], [])).toEqual(
			[],
		);
	});

	it("keeps a selected tag first, and keeps it even at zero", () => {
		const facets = statusTagFacets(
			[update({ tags: ["docs"] }), update({ updateId: "b", tags: ["docs"] })],
			["auth"],
		);
		// `auth` matched nothing on this page, but dropping its chip would leave
		// the filter on with no way to switch it back off.
		expect(facets).toEqual([
			{ tag: "auth", count: 0, selected: true },
			{ tag: "docs", count: 2, selected: false },
		]);
	});
});

describe("toggleTagFilter", () => {
	it("adds a tag it does not have and removes one it does", () => {
		expect(toggleTagFilter([], "auth")).toEqual(["auth"]);
		expect(toggleTagFilter(["auth"], "p0")).toEqual(["auth", "p0"]);
		expect(toggleTagFilter(["auth", "p0"], "auth")).toEqual(["p0"]);
	});
});

describe("sectionHeadingCount", () => {
	it("prefers the whole-table count when unfiltered", () => {
		expect(sectionHeadingCount(3, 40, false)).toBe(40);
	});

	it("falls back to the row count when the summary has not arrived", () => {
		expect(sectionHeadingCount(3, undefined, false)).toBe(3);
	});

	it("describes the rows on screen once a filter is on", () => {
		// The summary counts every live row; the rows came from a filtered
		// query. Showing 40 above 3 rows contradicts the page.
		expect(sectionHeadingCount(3, 40, true)).toBe(3);
	});
});
