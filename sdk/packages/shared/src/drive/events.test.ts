import { describe, expect, it } from "vitest";
import {
	assertNeverDriveEventType,
	assertNoForbiddenPayloadKeys,
	DRIVE_EVENT_SCHEMA_VERSION,
	parseDriveEvent,
	type DriveEvent,
} from "./events";

function base(type: DriveEvent["type"], extra: Record<string, unknown>) {
	return {
		schemaVersion: DRIVE_EVENT_SCHEMA_VERSION,
		id: "evt-1",
		at: "2026-07-27T12:00:00.000Z",
		roomId: "room-1",
		type,
		...extra,
	};
}

describe("DriveEventSchema", () => {
	it("parses bank lifecycle events", () => {
		const opened = parseDriveEvent(
			base("drive_task_opened", { taskId: "t1", title: "Fix" }),
		);
		expect(opened.type).toBe("drive_task_opened");

		const bound = parseDriveEvent(
			base("drive_task_bound", { taskId: "t1", planId: "p1" }),
		);
		expect(bound.type).toBe("drive_task_bound");

		const step = parseDriveEvent(
			base("drive_plan_step", {
				planId: "p1",
				taskId: "t1",
				title: "Fix",
				position: 0,
			}),
		);
		expect(step.type).toBe("drive_plan_step");
	});

	it("rejects unversioned payloads", () => {
		expect(() =>
			parseDriveEvent({
				type: "drive_task_opened",
				id: "e",
				at: "2026-07-27T12:00:00.000Z",
				roomId: "r",
				taskId: "t1",
				title: "x",
			}),
		).toThrow();
	});

	it("supports exhaustive switch over event types", () => {
		const event = parseDriveEvent(
			base("drive_plan_archived", { planId: "p1" }),
		);
		switch (event.type) {
			case "drive_task_opened":
			case "drive_task_bound":
			case "drive_task_completed":
			case "drive_task_archived":
			case "drive_plan_activated":
			case "drive_plan_archived":
			case "drive_plan_step":
				break;
			default:
				assertNeverDriveEventType(event.type);
		}
	});
});

describe("privacy assertions", () => {
	it("rejects raw audio / transcript payload keys", () => {
		expect(() =>
			assertNoForbiddenPayloadKeys({
				type: "drive_task_opened",
				audio: "raw",
			}),
		).toThrow(/audio/);

		expect(() =>
			assertNoForbiddenPayloadKeys({
				nested: { transcript: "full" },
			}),
		).toThrow(/transcript/);

		expect(() =>
			assertNoForbiddenPayloadKeys({
				demo: { imageBytes: "abc" },
			}),
		).toThrow(/imageBytes/);
	});

	it("allows structured bank events without media keys", () => {
		expect(() =>
			assertNoForbiddenPayloadKeys(
				base("drive_task_completed", { taskId: "t1" }),
			),
		).not.toThrow();
	});
});
