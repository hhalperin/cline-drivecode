import { describe, expect, it } from "vitest";
import {
	applyDerivedSubMode,
	clearOverride,
	createDriveModeState,
	enterDrive,
	exitDrive,
	setOverride,
	toNativeAgentMode,
} from "./driveMode.js";

describe("driveMode", () => {
	it("enters and exits Drive", () => {
		let state = createDriveModeState();
		state = enterDrive(state);
		expect(state.active).toBe(true);
		state = exitDrive(state);
		expect(state.active).toBe(false);
		expect(state.override).toBeNull();
	});

	it("applies derived sub-mode unless override is set", () => {
		let state = enterDrive(createDriveModeState());
		state = applyDerivedSubMode(state, "agent");
		expect(state.subMode).toBe("agent");
		state = setOverride(state, "ask");
		expect(state.subMode).toBe("ask");
		state = applyDerivedSubMode(state, "agent");
		expect(state.subMode).toBe("ask");
		state = clearOverride(state, "agent");
		expect(state.override).toBeNull();
		expect(state.subMode).toBe("agent");
	});

	it("maps postures to native modes", () => {
		expect(toNativeAgentMode("plan")).toBe("plan");
		expect(toNativeAgentMode("ask")).toBe("plan");
		expect(toNativeAgentMode("agent")).toBe("act");
		expect(toNativeAgentMode("debug")).toBe("act");
	});
});
