/**
 * Pure seat-source set deltas (DRV-ROSTER-PACK refcount).
 */

import type { SeatSource } from "@cline/shared";

export type SeatSourceDelta =
	| { readonly type: "add"; readonly source: SeatSource }
	| { readonly type: "remove"; readonly source: SeatSource }
	| { readonly type: "clear" };

export function seatSourcesEqual(a: SeatSource, b: SeatSource): boolean {
	if (a.kind !== b.kind) {
		return false;
	}
	switch (a.kind) {
		case "manual":
			return b.kind === "manual";
		case "pack":
			return b.kind === "pack" && a.packId === b.packId;
		case "spawn":
			return b.kind === "spawn" && a.parentId === b.parentId;
		default: {
			const _never: never = a;
			return _never;
		}
	}
}

export function applySeatSourceDelta(
	current: readonly SeatSource[],
	delta: SeatSourceDelta,
): {
	next: SeatSource[];
	/** True when next is empty — host should leave the participant. */
	shouldLeave: boolean;
} {
	switch (delta.type) {
		case "clear":
			return { next: [], shouldLeave: true };
		case "add": {
			if (current.some((source) => seatSourcesEqual(source, delta.source))) {
				return { next: [...current], shouldLeave: current.length === 0 };
			}
			const next = [...current, delta.source];
			return { next, shouldLeave: next.length === 0 };
		}
		case "remove": {
			const next = current.filter(
				(source) => !seatSourcesEqual(source, delta.source),
			);
			return { next, shouldLeave: next.length === 0 };
		}
		default: {
			const _never: never = delta;
			return _never;
		}
	}
}
