/** Drive Layer UI state for hub Chat (wireframe A → B staging). */

import type {
	BankSnapshot,
	Participant,
	RoomSnapshot,
	StageCard,
	StagePin,
} from "@cline/shared";
import {
	allowWorkspaceMutation,
	resolveDriveLoop,
	type DrivePostureOverride,
} from "@cline/drive";

export type DriveSubMode = "plan" | "agent" | "ask" | "debug";

/** Projection of hub stage.sharer for strip/Stage chrome. */
export type DriveStageSharerLocal = "agent" | "you";

export type DriveUiState = {
	active: boolean;
	/** Call Stage split layout (wireframe B). Off = Drive Layer only (A). */
	stageLayout: boolean;
	subMode: DriveSubMode;
	/** Explicit Ask/Debug override; null means bank-derived Plan/Agent. */
	postureOverride: DrivePostureOverride | null;
	partnerName: string;
	/** Human mic mute (DRV-MIC). */
	muted: boolean;
	handRaised: boolean;
	bankSnapshot: BankSnapshot;
	/**
	 * Spotlight owner participant id.
	 * Use {@link DRIVE_PARTICIPANT_HUMAN} / {@link DRIVE_PARTICIPANT_PARTNER} until
	 * full roster ids are wired from the hub.
	 */
	spotlightParticipantId: string;
	/** Partner agent cannot speak (TTS/narration). */
	partnerMuted: boolean;
	/** Partner agent cannot hear (inbound context). */
	partnerDeafened: boolean;
	/**
	 * Offline fixture cards when demo and no live session tools yet.
	 * Room ownership still goes through hub call_* when connected.
	 */
	demo: boolean;
	/**
	 * Mirror of hub room stage.sharer (agent|you). Updated from room_snapshot.
	 * Authority is hub call_set_stage — not this field alone.
	 */
	stageSharer: DriveStageSharerLocal;
	/** Hub stage.cards projected for Spotlight (last-event-wins work deck). */
	stageCards: StageCard[];
	/** Hub stage.pin projected for human share Spotlight. */
	stagePin: StagePin | null;
	/** Hub room id when Join has attached a call. */
	roomId: string | null;
	/**
	 * Hub roster projection (DRV-ROSTER). Read-only copy from room_snapshot.
	 * Empty until a snapshot arrives — UI may synthesize human+partner.
	 */
	participants: Participant[];
	/**
	 * Participant whose transcript stream is focused (DRV-PARTICIPANT-SHEET /
	 * DRV-TRANSCRIPT). Null = room / everyone thread.
	 */
	focusedParticipantId: string | null;
	/**
	 * Stub for DRV-ADDRESS: set when Transcript is chosen on an agent;
	 * cleared (everyone) when focusing self. Profile does not touch this.
	 */
	addressFollowsFocusParticipantId: string | null;
};

/** Stable ids until hub roster provides real participant UUIDs. */
export const DRIVE_PARTICIPANT_HUMAN = "drive:human";
export const DRIVE_PARTICIPANT_PARTNER = "drive:partner";

/** Stable Chat Drive room id (matches legacy driveCommand roomId default). */
export const DRIVE_DEFAULT_ROOM_ID = "default";

export const EMPTY_BANK_SNAPSHOT: BankSnapshot = {
	activePlanId: null,
	openTaskIds: [],
	nowTaskId: null,
	nextTaskId: null,
	nowTitle: null,
	nextTitle: null,
};

export const DEFAULT_DRIVE_UI: DriveUiState = {
	active: false,
	stageLayout: false,
	subMode: "plan",
	postureOverride: null,
	partnerName: "Adam",
	muted: false,
	handRaised: false,
	bankSnapshot: EMPTY_BANK_SNAPSHOT,
	spotlightParticipantId: DRIVE_PARTICIPANT_PARTNER,
	partnerMuted: false,
	partnerDeafened: false,
	demo: true,
	stageSharer: "agent",
	stageCards: [],
	stagePin: null,
	roomId: null,
	participants: [],
	focusedParticipantId: null,
	addressFollowsFocusParticipantId: null,
};

/** Map Drive sub-mode onto native Cline plan|act for send config. */
export function toNativeMode(subMode: DriveSubMode): "act" | "plan" {
	switch (subMode) {
		case "plan":
		case "ask":
			return "plan";
		case "agent":
		case "debug":
			return "act";
		default: {
			const _exhaustive: never = subMode;
			return _exhaustive;
		}
	}
}

/** Map UI sub-mode onto shared DriveSubMode for call_set_mode. */
export function toSharedDriveSubMode(
	subMode: DriveSubMode,
): "plan" | "act" | "ask" | "debug" {
	switch (subMode) {
		case "agent":
			return "act";
		case "plan":
		case "ask":
		case "debug":
			return subMode;
		default: {
			const _exhaustive: never = subMode;
			return _exhaustive;
		}
	}
}

export function fromSharedDriveSubMode(
	subMode: "plan" | "act" | "ask" | "debug",
): DriveSubMode {
	switch (subMode) {
		case "act":
			return "agent";
		case "plan":
		case "ask":
		case "debug":
			return subMode;
		default: {
			const _exhaustive: never = subMode;
			return _exhaustive;
		}
	}
}

/** Recompute Plan/Agent from bank unless Ask/Debug override is set. */
export function syncDrivePostureFromBank(state: DriveUiState): DriveUiState {
	if (!state.active) {
		return state;
	}
	const loop = resolveDriveLoop({
		driveActive: true,
		snapshot: state.bankSnapshot,
		override: state.postureOverride,
	});
	return {
		...state,
		subMode: loop.posture,
	};
}

export function applyBankSnapshot(
	state: DriveUiState,
	snapshot: BankSnapshot,
): DriveUiState {
	return syncDrivePostureFromBank({ ...state, bankSnapshot: snapshot });
}

/**
 * Project a hub-owned RoomSnapshot into Drive chrome state.
 * Hub is the single writer — callers must not invent room authority locally.
 * Chat Drive `active` means the local human is seated; leave removes the seat
 * while the room (and driveActive) may persist for drop-in rejoin.
 */
export function applyRoomSnapshot(
	drive: DriveUiState,
	snapshot: RoomSnapshot,
): DriveUiState {
	const human = snapshot.participants.find(
		(participant) => participant.kind === "human",
	);
	const agent = snapshot.participants.find(
		(participant) => participant.kind === "agent",
	);
	const humanSeated = snapshot.participants.some(
		(participant) =>
			participant.kind === "human" &&
			participant.id === DRIVE_PARTICIPANT_HUMAN,
	);
	const sharer = snapshot.stage.sharer;
	let stageSharer = drive.stageSharer;
	if (sharer?.kind === "human") {
		stageSharer = "you";
	} else if (sharer?.kind === "agent") {
		stageSharer = "agent";
	}

	const muteMap = snapshot.muteByParticipantId;
	const humanId = human?.id ?? DRIVE_PARTICIPANT_HUMAN;
	const agentId = agent?.id ?? DRIVE_PARTICIPANT_PARTNER;
	const muted =
		typeof muteMap[humanId] === "boolean" ? muteMap[humanId] : drive.muted;
	const partnerMuted =
		typeof muteMap[agentId] === "boolean"
			? muteMap[agentId]
			: drive.partnerMuted;

	const raisedMap = snapshot.raisedHandByParticipantId;
	const handRaised =
		typeof raisedMap[humanId] === "boolean"
			? raisedMap[humanId]
			: drive.handRaised;

	return {
		...drive,
		active: Boolean(snapshot.driveActive && humanSeated),
		roomId: humanSeated ? snapshot.roomId : null,
		partnerName: agent?.displayName ?? drive.partnerName,
		stageSharer,
		spotlightParticipantId:
			sharer?.participantId ?? drive.spotlightParticipantId,
		stageCards: [...snapshot.stage.cards],
		stagePin: snapshot.stage.pin,
		muted,
		partnerMuted,
		handRaised,
		subMode: fromSharedDriveSubMode(snapshot.subMode),
		demo: false,
		participants: [...snapshot.participants],
	};
}

export function applySubModeIntent(
	state: DriveUiState,
	subMode: DriveSubMode,
): DriveUiState {
	if (!state.active) {
		return state;
	}
	if (subMode === "ask" || subMode === "debug") {
		return {
			...state,
			postureOverride: subMode,
			subMode,
		};
	}
	// Plan/Agent while override is set: ignore (override clears only explicitly).
	if (state.postureOverride) {
		return state;
	}
	return syncDrivePostureFromBank({ ...state, subMode });
}

export function clearPostureOverride(state: DriveUiState): DriveUiState {
	if (!state.active || !state.postureOverride) {
		return state;
	}
	return syncDrivePostureFromBank({ ...state, postureOverride: null });
}

export function canMutateWorkspace(state: DriveUiState): boolean {
	const loop = resolveDriveLoop({
		driveActive: state.active,
		snapshot: state.bankSnapshot,
		override: state.postureOverride,
	});
	return allowWorkspaceMutation(loop).allowed;
}

export function drivePersonaSystemHint(state: DriveUiState): string {
	if (!state.active) {
		return "";
	}
	const bound = state.bankSnapshot.nowTaskId;
	return [
		"You are in Cline Drive mode: a senior engineer pair-programming on a call.",
		`Partner name: ${state.partnerName}.`,
		`Drive sub-mode: ${state.subMode} (maps to native ${toNativeMode(state.subMode)}).`,
		state.postureOverride
			? `Posture override active: ${state.postureOverride} (clear explicitly to return to bank-derived posture).`
			: "Posture is derived from the task bank (Plan when empty, Agent when open tasks exist).",
		bound
			? `Bound DriveTask: ${bound}${state.bankSnapshot.nowTitle ? ` (${state.bankSnapshot.nowTitle})` : ""}.`
			: "No open DriveTask. Prefer Plan posture: author plan + task files under .drive/bank/.",
		"Narrate decisions briefly and transparently, like a colleague sharing their screen.",
		"Prefer short spoken-style explanations before and after meaningful tool work.",
		"Do not invent a parallel chat participant. Work in this session.",
	].join(" ");
}
