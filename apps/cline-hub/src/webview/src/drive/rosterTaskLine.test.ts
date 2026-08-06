import { describe, expect, it } from "vitest";
import { rosterParticipantTaskLine } from "./rosterTaskLine";
import {
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
	type DriveUiState,
} from "./types";

function driveWithNow(nowTitle: string | null): DriveUiState {
	return {
		active: true,
		roomId: "default",
		partnerName: "Coder",
		subMode: "act",
		muted: true,
		deafened: false,
		partnerMuted: false,
		partnerDeafened: false,
		handRaised: false,
		stageLayout: true,
		spotlightParticipantId: DRIVE_PARTICIPANT_PARTNER,
		stageSharer: "partner",
		stagePin: null,
		focusedParticipantId: null,
		speakingParticipantId: null,
		participants: [],
		addressSet: { mode: "everyone" },
		postureOverride: null,
		bankSnapshot: {
			nowTaskId: nowTitle ? "t1" : null,
			nowTitle,
			nextTaskId: null,
			nextTitle: null,
			posture: null,
			updatedAt: null,
		},
	} as DriveUiState;
}

describe("rosterParticipantTaskLine", () => {
	it("returns nowTitle for working agents", () => {
		const drive = driveWithNow("Gate JWT refresh");
		expect(
			rosterParticipantTaskLine(drive, {
				id: DRIVE_PARTICIPANT_PARTNER,
				kind: "agent",
				displayName: "Coder",
				role: "partner",
				status: "working",
				seatSources: [],
			}),
		).toBe("Gate JWT refresh");
	});

	it("returns null for humans and idle agents", () => {
		const drive = driveWithNow("Gate JWT refresh");
		expect(
			rosterParticipantTaskLine(drive, {
				id: DRIVE_PARTICIPANT_HUMAN,
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			}),
		).toBeNull();
		expect(
			rosterParticipantTaskLine(drive, {
				id: DRIVE_PARTICIPANT_PARTNER,
				kind: "agent",
				displayName: "Coder",
				role: "partner",
				status: "idle",
				seatSources: [],
			}),
		).toBeNull();
	});

	it("returns null when bank has no title", () => {
		const drive = driveWithNow(null);
		expect(
			rosterParticipantTaskLine(drive, {
				id: DRIVE_PARTICIPANT_PARTNER,
				kind: "agent",
				displayName: "Coder",
				role: "partner",
				status: "working",
				seatSources: [],
			}),
		).toBeNull();
	});
});
