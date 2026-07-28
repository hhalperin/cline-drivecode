import type { DrivePosture, DrivePostureOverride } from "./driveLoop.js";

export interface DriveModeState {
	active: boolean;
	subMode: DrivePosture;
	override: DrivePostureOverride | null;
}

export class DriveModeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DriveModeError";
	}
}

export function createDriveModeState(
	partial?: Partial<DriveModeState>,
): DriveModeState {
	return {
		active: partial?.active ?? false,
		subMode: partial?.subMode ?? "plan",
		override: partial?.override ?? null,
	};
}

export function enterDrive(state: DriveModeState): DriveModeState {
	return { ...state, active: true };
}

export function exitDrive(_state: DriveModeState): DriveModeState {
	return { active: false, subMode: "plan", override: null };
}

export function applyDerivedSubMode(
	state: DriveModeState,
	derived: DrivePosture,
): DriveModeState {
	if (!state.active) {
		throw new DriveModeError("Cannot set sub-mode while Drive is off");
	}
	if (state.override) {
		return state;
	}
	return { ...state, subMode: derived };
}

export function setOverride(
	state: DriveModeState,
	override: DrivePostureOverride,
): DriveModeState {
	if (!state.active) {
		throw new DriveModeError("Cannot set override while Drive is off");
	}
	return { ...state, override, subMode: override };
}

export function clearOverride(
	state: DriveModeState,
	derived: DrivePosture,
): DriveModeState {
	if (!state.active) {
		throw new DriveModeError("Cannot clear override while Drive is off");
	}
	return { ...state, override: null, subMode: derived };
}

/** Map Drive posture onto native Cline plan|act. */
export function toNativeAgentMode(
	posture: DrivePosture,
): "act" | "plan" {
	switch (posture) {
		case "plan":
		case "ask":
			return "plan";
		case "agent":
		case "debug":
			return "act";
		default: {
			const _exhaustive: never = posture;
			return _exhaustive;
		}
	}
}
