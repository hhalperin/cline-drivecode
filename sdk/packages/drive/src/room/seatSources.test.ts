import { describe, expect, it } from "vitest";
import { applySeatSourceDelta, seatSourcesEqual } from "./seatSources.js";

describe("applySeatSourceDelta", () => {
	it("adds a pack source once", () => {
		const first = applySeatSourceDelta([], {
			type: "add",
			source: { kind: "pack", packId: "p1" },
		});
		expect(first.next).toEqual([{ kind: "pack", packId: "p1" }]);
		expect(first.shouldLeave).toBe(false);

		const second = applySeatSourceDelta(first.next, {
			type: "add",
			source: { kind: "pack", packId: "p1" },
		});
		expect(second.next).toEqual([{ kind: "pack", packId: "p1" }]);
	});

	it("removes one of two packs without leaving", () => {
		const current = [
			{ kind: "pack" as const, packId: "p1" },
			{ kind: "pack" as const, packId: "p2" },
		];
		const result = applySeatSourceDelta(current, {
			type: "remove",
			source: { kind: "pack", packId: "p1" },
		});
		expect(result.next).toEqual([{ kind: "pack", packId: "p2" }]);
		expect(result.shouldLeave).toBe(false);
	});

	it("leaves when the last source is removed or cleared", () => {
		const removeLast = applySeatSourceDelta(
			[{ kind: "manual" }],
			{ type: "remove", source: { kind: "manual" } },
		);
		expect(removeLast.shouldLeave).toBe(true);
		expect(removeLast.next).toEqual([]);

		const cleared = applySeatSourceDelta(
			[{ kind: "pack", packId: "p1" }],
			{ type: "clear" },
		);
		expect(cleared.shouldLeave).toBe(true);
	});
});

describe("seatSourcesEqual", () => {
	it("compares kind-specific identity", () => {
		expect(
			seatSourcesEqual(
				{ kind: "pack", packId: "a" },
				{ kind: "pack", packId: "a" },
			),
		).toBe(true);
		expect(
			seatSourcesEqual(
				{ kind: "pack", packId: "a" },
				{ kind: "pack", packId: "b" },
			),
		).toBe(false);
		expect(seatSourcesEqual({ kind: "manual" }, { kind: "manual" })).toBe(
			true,
		);
	});
});
