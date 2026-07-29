import { describe, expect, it, vi, afterEach } from "vitest";
import type { BankSnapshot } from "@cline/shared";
import {
	createDriveBankSession,
	hydrateLocalBankFromHubSnapshot,
	planTasksFromSnapshot,
	seedBankForJoin,
	seedDemoBank,
} from "./bankSession";

const sampleSnapshot: BankSnapshot = {
	activePlanId: "p-active",
	openTaskIds: ["t-parse", "t-tests"],
	nowTaskId: "t-parse",
	nextTaskId: "t-tests",
	nowTitle: "Fix parser",
	nextTitle: "Rerun tests",
};

describe("bankSession hub seed helpers", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("planTasksFromSnapshot projects open task titles", () => {
		expect(planTasksFromSnapshot(sampleSnapshot)).toEqual([
			{ id: "t-parse", title: "Fix parser" },
			{ id: "t-tests", title: "Rerun tests" },
		]);
	});

	it("hydrateLocalBankFromHubSnapshot creates plan + tasks once", async () => {
		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const plan = await session.store.getPlan("p-active");
		expect(plan?.taskIds).toEqual(["t-parse", "t-tests"]);
		const task = await session.store.getTask("t-parse");
		expect(task?.title).toBe("Fix parser");

		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const again = await session.store.getPlan("p-active");
		expect(again?.taskIds).toEqual(["t-parse", "t-tests"]);
	});

	it("seedBankForJoin falls back to memory when workspaceRoot is empty", async () => {
		const session = createDriveBankSession();
		const result = await seedBankForJoin(session, "  ");
		expect(result.fromHub).toBe(false);
		expect(result.snapshot.activePlanId).toBe("p-active");
	});

	it("seedBankForJoin uses hub snapshot when drive_bank_snapshot arrives", async () => {
		const listeners = new Set<(event: MessageEvent) => void>();
		vi.stubGlobal("window", {
			addEventListener: (
				_type: string,
				listener: EventListenerOrEventListenerObject,
			) => {
				if (typeof listener === "function") {
					listeners.add(listener as (event: MessageEvent) => void);
				}
			},
			removeEventListener: (
				_type: string,
				listener: EventListenerOrEventListenerObject,
			) => {
				listeners.delete(listener as (event: MessageEvent) => void);
			},
		});

		const postSpy = vi
			.spyOn(await import("../vscode"), "postToHost")
			.mockImplementation((message) => {
				const requestId =
					typeof message === "object" &&
					message &&
					"requestId" in message &&
					typeof message.requestId === "string"
						? message.requestId
						: undefined;
				queueMicrotask(() => {
					const event = {
						data: {
							type: "drive_bank_snapshot",
							requestId,
							snapshot: sampleSnapshot,
						},
					} as MessageEvent;
					for (const listener of [...listeners]) {
						listener(event);
					}
				});
			});

		const session = createDriveBankSession();
		const result = await seedBankForJoin(session, "/tmp/workspace");
		expect(result.fromHub).toBe(true);
		expect(result.snapshot).toEqual(sampleSnapshot);
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "drive_bank_seed",
				workspaceRoot: "/tmp/workspace",
			}),
		);
		const plan = await session.store.getPlan("p-active");
		expect(plan).not.toBeNull();
	});

	it("seedBankForJoin falls back after hub error reply", async () => {
		const listeners = new Set<(event: MessageEvent) => void>();
		vi.stubGlobal("window", {
			addEventListener: (
				_type: string,
				listener: EventListenerOrEventListenerObject,
			) => {
				if (typeof listener === "function") {
					listeners.add(listener as (event: MessageEvent) => void);
				}
			},
			removeEventListener: (
				_type: string,
				listener: EventListenerOrEventListenerObject,
			) => {
				listeners.delete(listener as (event: MessageEvent) => void);
			},
		});

		vi.spyOn(await import("../vscode"), "postToHost").mockImplementation(
			(message) => {
				const requestId =
					typeof message === "object" &&
					message &&
					"requestId" in message &&
					typeof message.requestId === "string"
						? message.requestId
						: undefined;
				queueMicrotask(() => {
					const event = {
						data: {
							type: "drive_bank_error",
							requestId,
							text: "Hub is not connected.",
						},
					} as MessageEvent;
					for (const listener of [...listeners]) {
						listener(event);
					}
				});
			},
		);

		const session = createDriveBankSession();
		const result = await seedBankForJoin(session, "/tmp/workspace");
		expect(result.fromHub).toBe(false);
		expect(result.snapshot.activePlanId).toBe("p-active");
	});

	it("seedDemoBank is idempotent", async () => {
		const session = createDriveBankSession();
		const first = await seedDemoBank(session);
		const second = await seedDemoBank(session);
		expect(second).toEqual(first);
	});
});
