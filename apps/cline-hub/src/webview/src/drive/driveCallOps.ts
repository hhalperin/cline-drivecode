/**
 * The one writer for Drive call ops (ADR-0006, DRV-CALL-STRIP, DRV-PIP).
 *
 * ADR-0006 accepts PiP as a companion surface on the condition that mute,
 * raise hand, leave, and membership projection are *the same ops* as the call
 * strip's — "no second writer". That clause only holds if there is exactly one
 * place these frames are constructed, so every builder here is pure and every
 * caller (call strip, roster sheet, PiP, Chat recovery) goes through it.
 *
 * The pre-join `driveCommand` fallbacks live here too. They are the branches a
 * second implementation would silently get wrong: a surface that only knows the
 * `call_mute` path drops the mute on the floor before the room exists.
 *
 * `call_set_stage` is deliberately re-exported from `stageSharePin` rather than
 * rebuilt — a second stage payload would be the exact failure this module
 * exists to prevent.
 */

import { postToHost } from "../vscode";
import { DRIVE_DEFAULT_ROOM_ID } from "./types";

export {
	/** The one `call_set_stage` payload; see `stageSharePin`. */
	buildSetStageMessage as buildSetStageFrame,
	postSetStage,
} from "./stageSharePin";
export type { SetStageInput, StageSharer } from "./stageSharePin";

export type CallMuteFrame = {
	type: "call_mute";
	roomId: string;
	participantId: string;
	muted: boolean;
};

export type LegacyMuteFrame = {
	type: "driveCommand";
	command: "drive.participant.mute.set";
	payload: { roomId: string; participantId: string; muted: boolean };
};

export type MuteFrame = CallMuteFrame | LegacyMuteFrame;

export type RaiseHandFrame = {
	type: "call_raise_hand";
	roomId: string;
	participantId: string;
	raised: boolean;
};

export type LeaveFrame = {
	type: "call_leave";
	roomId: string;
	participantId: string;
};

export type CallOpInput = {
	/** `null` (or empty) means "not seated in a hub room yet". */
	roomId: string | null;
	participantId: string;
};

/**
 * Mute for any participant, human or agent.
 *
 * Seated in a room: the authoritative `call_mute` op. Demo / pre-join: the
 * legacy `drive.participant.mute.set` command, which still needs a room id and
 * so falls back to the default room.
 */
export function buildMuteFrame(
	input: CallOpInput & { muted: boolean },
): MuteFrame {
	if (input.roomId) {
		return {
			type: "call_mute",
			roomId: input.roomId,
			participantId: input.participantId,
			muted: input.muted,
		};
	}
	return {
		type: "driveCommand",
		command: "drive.participant.mute.set",
		payload: {
			roomId: input.roomId ?? DRIVE_DEFAULT_ROOM_ID,
			participantId: input.participantId,
			muted: input.muted,
		},
	};
}

/**
 * Raise/lower hand. There is no pre-join fallback: a hand raised at nobody is
 * local-only state, so this returns `null` and the caller posts nothing.
 */
export function buildRaiseHandFrame(
	input: CallOpInput & { raised: boolean },
): RaiseHandFrame | null {
	if (!input.roomId) {
		return null;
	}
	return {
		type: "call_raise_hand",
		roomId: input.roomId,
		participantId: input.participantId,
		raised: input.raised,
	};
}

/** Leave removes one participant; the room and its work survive. */
export function buildLeaveFrame(input: CallOpInput): LeaveFrame {
	return {
		type: "call_leave",
		roomId: input.roomId ?? DRIVE_DEFAULT_ROOM_ID,
		participantId: input.participantId,
	};
}

export function postMute(input: CallOpInput & { muted: boolean }): void {
	postToHost(buildMuteFrame(input));
}

export function postRaiseHand(
	input: CallOpInput & { raised: boolean },
): void {
	const frame = buildRaiseHandFrame(input);
	if (frame) {
		postToHost(frame);
	}
}

export function postLeave(input: CallOpInput): void {
	postToHost(buildLeaveFrame(input));
}
