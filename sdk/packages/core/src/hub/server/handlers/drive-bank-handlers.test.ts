import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HubTransportContext } from "./context";
import { handleDriveBankCommand } from "./drive-bank-handlers";

function command(
	name: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		requestId: "req_bank",
		clientId: "test",
		command: name,
		payload,
	};
}

function ctx(): HubTransportContext {
	return {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		sessionHost: {} as HubTransportContext["sessionHost"],
		publish: () => {},
		buildEvent: (
			event: HubEventEnvelope["event"],
			payload?: Record<string, unknown>,
		) =>
			({
				version: "v1",
				event,
				payload,
			}) as unknown as HubEventEnvelope,
		requestCapability: vi.fn(),
	} as unknown as HubTransportContext;
}

describe("handleDriveBankCommand", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		for (const dir of dirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("requires workspaceRoot", async () => {
		const reply = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_get"),
		);
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("invalid_payload");
	});

	it("get returns empty snapshot then seed persists for get", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-bank-hub-"));
		dirs.push(root);

		const empty = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_get", { workspaceRoot: root }),
		);
		expect(empty.ok).toBe(true);
		expect(empty.payload?.snapshot).toMatchObject({
			activePlanId: null,
			nowTaskId: null,
		});

		const seeded = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_seed", { workspaceRoot: root }),
		);
		expect(seeded.ok).toBe(true);
		expect(seeded.payload?.snapshot).toMatchObject({
			activePlanId: "p-active",
			nowTaskId: "t-parse",
			nextTaskId: "t-tests",
		});

		const again = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_get", { workspaceRoot: root }),
		);
		expect(again.ok).toBe(true);
		expect(again.payload?.snapshot).toEqual(seeded.payload?.snapshot);

		const reseed = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_seed", { workspaceRoot: root }),
		);
		expect(reseed.payload?.snapshot).toEqual(seeded.payload?.snapshot);
	});
});
