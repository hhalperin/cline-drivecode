import { describe, expect, it, beforeEach, vi } from "vitest";
import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import type { HubTransportContext } from "./context";
import {
	__resetDriveRoomsForTests,
	handleDriveCommand,
} from "./drive-handlers";

function envelope(
	command: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: 1 as HubCommandEnvelope["version"],
		command,
		requestId: "req-1",
		payload,
	};
}

function createCtx() {
	const published: HubEventEnvelope[] = [];
	const ctx = {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		sessionHost: {} as HubTransportContext["sessionHost"],
		publish: (event: HubEventEnvelope) => {
			published.push(event);
		},
		buildEvent: (
			event: HubEventEnvelope["event"],
			payload?: Record<string, unknown>,
		) =>
			({
				version: 1,
				event,
				payload,
			}) as HubEventEnvelope,
		requestCapability: vi.fn(),
	} as unknown as HubTransportContext;
	return { ctx, published };
}

describe("handleDriveCommand", () => {
	beforeEach(() => {
		__resetDriveRoomsForTests();
	});

	it("gets an empty room", () => {
		const { ctx } = createCtx();
		const reply = handleDriveCommand(
			ctx,
			envelope("drive.room.get", { roomId: "r1" }),
		);
		expect(reply.ok).toBe(true);
		expect(reply.payload?.room).toMatchObject({
			roomId: "r1",
			version: 0,
		});
	});

	it("sets spotlight and broadcasts", () => {
		const { ctx, published } = createCtx();
		const reply = handleDriveCommand(
			ctx,
			envelope("drive.spotlight.set", {
				roomId: "r1",
				participantId: "agent-1",
				reason: "human",
			}),
		);
		expect(reply.ok).toBe(true);
		expect(published.some((event) => event.event === "drive.room.changed")).toBe(
			true,
		);
		expect(
			published.some((event) => event.event === "drive.spotlight.changed"),
		).toBe(true);
	});

	it("toggles mute independently of deafen", () => {
		const { ctx } = createCtx();
		handleDriveCommand(
			ctx,
			envelope("drive.participant.mute.set", {
				roomId: "r1",
				participantId: "agent-1",
				muted: true,
			}),
		);
		const reply = handleDriveCommand(
			ctx,
			envelope("drive.participant.deafen.set", {
				roomId: "r1",
				participantId: "agent-1",
				deafened: true,
			}),
		);
		expect(reply.ok).toBe(true);
		const room = reply.payload?.room as {
			participantAudio: Array<{ muted: boolean; deafened: boolean }>;
		};
		expect(room.participantAudio[0]).toMatchObject({
			muted: true,
			deafened: true,
		});
	});
});
