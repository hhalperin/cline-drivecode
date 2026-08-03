import { describe, expect, it } from "vitest";
import chatSource from "../Chat.tsx?raw";
import {
	buildLeaveFrame,
	buildMuteFrame,
	buildRaiseHandFrame,
	buildSetStageFrame,
} from "./driveCallOps";
import driveCallOpsSource from "./driveCallOps.ts?raw";
import participantSheetSource from "./ParticipantSheet.tsx?raw";
import { buildSetStageMessage } from "./stageSharePin";
import {
	DRIVE_DEFAULT_ROOM_ID,
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
} from "./types";
import useDriveSessionSource from "./useDriveSession.ts?raw";

describe("buildMuteFrame", () => {
	it("uses the authoritative call_mute op once seated in a room", () => {
		expect(
			buildMuteFrame({
				roomId: "room-7",
				participantId: DRIVE_PARTICIPANT_HUMAN,
				muted: true,
			}),
		).toEqual({
			type: "call_mute",
			roomId: "room-7",
			participantId: DRIVE_PARTICIPANT_HUMAN,
			muted: true,
		});
	});

	it("falls back to the legacy driveCommand before a room exists", () => {
		// The pre-join branch is exactly what a second implementation drops:
		// without it the demo/pre-join mute silently goes nowhere.
		expect(
			buildMuteFrame({
				roomId: null,
				participantId: DRIVE_PARTICIPANT_HUMAN,
				muted: false,
			}),
		).toEqual({
			type: "driveCommand",
			command: "drive.participant.mute.set",
			payload: {
				roomId: DRIVE_DEFAULT_ROOM_ID,
				participantId: DRIVE_PARTICIPANT_HUMAN,
				muted: false,
			},
		});
	});

	it("is the same op for the partner as for the human", () => {
		const partner = buildMuteFrame({
			roomId: "room-7",
			participantId: DRIVE_PARTICIPANT_PARTNER,
			muted: true,
		});
		expect(partner.type).toBe("call_mute");
		expect(partner).toMatchObject({
			participantId: DRIVE_PARTICIPANT_PARTNER,
		});
	});
});

describe("buildRaiseHandFrame", () => {
	it("builds call_raise_hand for a seated participant", () => {
		expect(
			buildRaiseHandFrame({
				roomId: "room-7",
				participantId: DRIVE_PARTICIPANT_HUMAN,
				raised: true,
			}),
		).toEqual({
			type: "call_raise_hand",
			roomId: "room-7",
			participantId: DRIVE_PARTICIPANT_HUMAN,
			raised: true,
		});
	});

	it("posts nothing before a room exists", () => {
		expect(
			buildRaiseHandFrame({
				roomId: null,
				participantId: DRIVE_PARTICIPANT_HUMAN,
				raised: true,
			}),
		).toBeNull();
	});
});

describe("buildLeaveFrame", () => {
	it("leaves the current room", () => {
		expect(
			buildLeaveFrame({
				roomId: "room-7",
				participantId: DRIVE_PARTICIPANT_HUMAN,
			}),
		).toEqual({
			type: "call_leave",
			roomId: "room-7",
			participantId: DRIVE_PARTICIPANT_HUMAN,
		});
	});

	it("falls back to the default room id when unseated", () => {
		expect(
			buildLeaveFrame({
				roomId: null,
				participantId: DRIVE_PARTICIPANT_HUMAN,
			}).roomId,
		).toBe(DRIVE_DEFAULT_ROOM_ID);
	});
});

describe("buildSetStageFrame", () => {
	it("is the existing share-pin builder, not a second stage payload", () => {
		// ADR-0006 "no second writer" fails the moment call_set_stage has two
		// sources. The ops module re-exports; it does not reimplement.
		expect(buildSetStageFrame).toBe(buildSetStageMessage);
		expect(
			buildSetStageFrame({
				roomId: "room-7",
				sharer: { kind: "human", participantId: DRIVE_PARTICIPANT_HUMAN },
				pin: null,
			}),
		).toEqual({
			type: "call_set_stage",
			roomId: "room-7",
			sharer: { kind: "human", participantId: DRIVE_PARTICIPANT_HUMAN },
			pin: null,
		});
	});
});

/**
 * A call-ops module that nothing calls is worse than none — the next surface
 * (PiP) would believe the constraint is enforced and quietly grow its own
 * frames. These assertions run against the real source of the real callers, so
 * re-inlining a frame fails the suite rather than merely being impolite.
 */
describe("call ops have exactly one writer", () => {
	const inlineFrameMarkers = [
		`type: "call_mute"`,
		`type: "call_raise_hand"`,
		`type: "call_leave"`,
		`type: "call_set_stage"`,
		`command: "drive.participant.mute.set"`,
	];

	// Report the offending lines rather than diffing whole files, so a
	// re-inlined frame points straight at itself.
	function inlineFrameLines(source: string): string[] {
		return source
			.split("\n")
			.map((line) => line.trim())
			.filter((line) =>
				inlineFrameMarkers.some((marker) => line.includes(marker)),
			);
	}

	const callers = [
		["useDriveSession.ts", useDriveSessionSource, /driveCallOps"/],
		["Chat.tsx", chatSource, /driveCallOps"/],
		// The roster sheet reaches call_set_stage through the shared builder in
		// stageSharePin, which driveCallOps re-exports rather than duplicating.
		["ParticipantSheet.tsx", participantSheetSource, /stageSharePin"/],
	] as const;

	for (const [label, source, importPattern] of callers) {
		it(`${label} uses the shared builders instead of building frames inline`, () => {
			expect(source).toMatch(importPattern);
			expect(inlineFrameLines(source)).toEqual([]);
		});
	}

	it("keeps the ops module itself as the single place those frames are built", () => {
		expect(driveCallOpsSource).toContain(`type: "call_mute"`);
		expect(driveCallOpsSource).toContain(`type: "call_raise_hand"`);
		expect(driveCallOpsSource).toContain(`type: "call_leave"`);
		expect(driveCallOpsSource).toContain(
			`command: "drive.participant.mute.set"`,
		);
		// call_set_stage stays in stageSharePin; the ops module only re-exports.
		expect(driveCallOpsSource).not.toContain(`type: "call_set_stage"`);
	});
});
