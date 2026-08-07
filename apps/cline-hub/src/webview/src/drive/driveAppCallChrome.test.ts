import { describe, expect, it } from "vitest";
import {
	APP_STRIP_CONTROLS,
	muteRestoreAfterHold,
} from "./driveAppCallChrome";

describe("driveAppCallChrome", () => {
	it("keeps the one-hand strip to four controls", () => {
		expect([...APP_STRIP_CONTROLS]).toEqual([
			"mic",
			"hand",
			"captions",
			"leave",
		]);
	});

	it("restores mute only when hold temporarily unmuted", () => {
		expect(muteRestoreAfterHold({ unmutedByHold: true })).toBe("mute");
		expect(muteRestoreAfterHold({ unmutedByHold: false })).toBe("noop");
	});
});
