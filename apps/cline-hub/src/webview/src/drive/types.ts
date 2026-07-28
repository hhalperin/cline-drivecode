/** Drive Layer UI state for hub Chat (wireframe A → B staging). */

import type { BankSnapshot } from "@cline/shared";
import {
	allowWorkspaceMutation,
	resolveDriveLoop,
	setOverride as setDriveOverride,
	type DrivePostureOverride,
} from "@cline/drive";

export type DriveSubMode = "plan" | "agent" | "ask" | "debug";

export type DriveUiState = {
	active: boolean;
	/** Call Stage split layout (wireframe B). Off = Drive Layer only (A). */
	stageLayout: boolean;
	subMode: DriveSubMode;
	/** Explicit Ask/Debug override; null means bank-derived Plan/Agent. */
	postureOverride: DrivePostureOverride | null;
	partnerName: string;
	muted: boolean;
	handRaised: boolean;
	bankSnapshot: BankSnapshot;
};

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

export function applySubModeIntent(
	state: DriveUiState,
	subMode: DriveSubMode,
): DriveUiState {
	if (!state.active) {
		return state;
	}
	if (subMode === "ask" || subMode === "debug") {
		const next = setDriveOverride(
			{
				active: state.active,
				subMode: state.subMode,
				override: state.postureOverride,
			},
			subMode,
		);
		return {
			...state,
			postureOverride: next.override,
			subMode: next.subMode,
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
