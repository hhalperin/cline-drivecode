import { afterEach, describe, expect, it } from "vitest";
import {
	clearDrivePauseAfterTool,
	resetDrivePauseAfterToolForTests,
	setDrivePauseAfterTool,
	shouldDrivePauseAfterTool,
} from "./drivePauseAfterTool";

describe("drivePauseAfterTool", () => {
	afterEach(() => {
		resetDrivePauseAfterToolForTests();
	});

	it("defaults to false for unknown sessions", () => {
		expect(shouldDrivePauseAfterTool("sess_missing")).toBe(false);
	});

	it("set true enables pause; clear and set false disable", () => {
		setDrivePauseAfterTool("sess_1", true);
		expect(shouldDrivePauseAfterTool("sess_1")).toBe(true);

		clearDrivePauseAfterTool("sess_1");
		expect(shouldDrivePauseAfterTool("sess_1")).toBe(false);

		setDrivePauseAfterTool("sess_1", true);
		setDrivePauseAfterTool("sess_1", false);
		expect(shouldDrivePauseAfterTool("sess_1")).toBe(false);
	});

	it("tracks sessions independently", () => {
		setDrivePauseAfterTool("a", true);
		setDrivePauseAfterTool("b", false);
		expect(shouldDrivePauseAfterTool("a")).toBe(true);
		expect(shouldDrivePauseAfterTool("b")).toBe(false);
	});
});
