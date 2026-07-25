import { describe, expect, it } from "vitest";
import { AimdController } from "./aimd";
import { CheckpointManager, InMemoryCheckpointStore } from "./checkpoint";
import { failFastGate, memoryPauseGate } from "./gates";
import { SurgeMailbox } from "./mailbox";
import { SurgeMemoryCoordinator } from "./memory";
import { QueuedRateLimiter } from "./rateLimiter";
import { SurgeWorkflowRunner } from "./runner";
import type { SurgeHostPort, SurgeTaskInput } from "./types";

function syncHost(
	handler: SurgeHostPort["runTask"],
): SurgeHostPort {
	return { runTask: handler };
}

describe("AimdController", () => {
	it("increases on success and decreases on failure", () => {
		const aimd = new AimdController({
			initial: 2,
			min: 1,
			max: 4,
			increase: 1,
			decrease: 0.5,
		});
		expect(aimd.onSuccess()).toBe(3);
		expect(aimd.onSuccess()).toBe(4);
		expect(aimd.onSuccess()).toBe(4);
		expect(aimd.onFailure()).toBe(2);
		expect(aimd.onRateLimited()).toBe(1);
		expect(aimd.onFailure()).toBe(1);
	});
});

describe("QueuedRateLimiter", () => {
	it("admits up to maxPerInterval immediately", async () => {
		const limiter = new QueuedRateLimiter({
			maxPerInterval: 2,
			intervalMs: 60_000,
		});
		await limiter.acquire();
		await limiter.acquire();
		limiter.close();
	});
});

describe("SurgeMailbox", () => {
	it("delivers direct and broadcast messages", () => {
		const box = new SurgeMailbox();
		box.send({ from: "a", to: "b", topic: "status", body: { ok: true } });
		box.send({ from: "a", to: "*", topic: "broadcast", body: { n: 1 } });
		expect(box.inbox("b")).toHaveLength(2);
		expect(box.inbox("c", "broadcast")).toHaveLength(1);
		expect(box.inbox("c", "status")).toHaveLength(0);
	});
});

describe("SurgeMemoryCoordinator", () => {
	it("last-write-wins", () => {
		const memory = new SurgeMemoryCoordinator();
		memory.set("k", 1);
		memory.writeAll({ k: 2, other: "x" });
		expect(memory.get("k")).toBe(2);
		expect(memory.toRecord()).toEqual({ k: 2, other: "x" });
	});
});

describe("CheckpointManager", () => {
	it("round-trips surge state", async () => {
		const store = new InMemoryCheckpointStore();
		const manager = new CheckpointManager(store);
		const saved = await manager.save({
			surgeId: "surge_1",
			wave: 2,
			tasks: [],
			memory: { a: 1 },
			mailbox: [],
		});
		const loaded = await manager.load("surge_1");
		expect(loaded?.id).toBe(saved.id);
		expect(loaded?.memory).toEqual({ a: 1 });
		expect(loaded?.wave).toBe(2);
	});
});

describe("SurgeWorkflowRunner", () => {
	it("runs independent tasks in parallel waves", async () => {
		const seen: string[] = [];
		const host = syncHost(async ({ task }) => {
			seen.push(task.id);
			return { ok: true, result: { kind: task.kind } };
		});
		const runner = new SurgeWorkflowRunner({
			host,
			aimd: { initial: 4, max: 4 },
			rateLimit: { maxPerInterval: 10, intervalMs: 60_000 },
		});
		const result = await runner.run([
			{ id: "t1", kind: "edit", payload: { file: "a.ts" } },
			{ id: "t2", kind: "edit", payload: { file: "b.ts" } },
			{ id: "t3", kind: "test", dependsOn: ["t1", "t2"] },
		]);
		expect(result.success).toBe(true);
		expect(result.tasks.map((task) => task.status)).toEqual([
			"succeeded",
			"succeeded",
			"succeeded",
		]);
		expect(seen.slice(0, 2).sort()).toEqual(["t1", "t2"]);
		expect(seen[2]).toBe("t3");
		expect(result.wave).toBeGreaterThanOrEqual(2);
	});

	it("spawns dynamic tasks and records mailbox traffic", async () => {
		const host = syncHost(async ({ task }) => {
			if (task.kind === "plan") {
				return {
					ok: true,
					spawn: [{ id: "child", kind: "implement", payload: { from: "plan" } }],
					messages: [
						{ to: "*", topic: "plan.done", body: { taskId: task.id } },
					],
					memoryWrites: { lastPlan: task.id },
				};
			}
			return { ok: true };
		});
		const runner = new SurgeWorkflowRunner({ host, surgeId: "surge_spawn" });
		const result = await runner.run([{ id: "plan", kind: "plan" }]);
		expect(result.success).toBe(true);
		expect(result.tasks.some((task) => task.id === "child")).toBe(true);
		expect(runner.mailbox.inbox("anyone", "plan.done")).toHaveLength(1);
		expect(runner.memory.get("lastPlan")).toBe("plan");
	});

	it("pauses when memory-pause gate fires", async () => {
		const host = syncHost(async () => {
			return { ok: true, memoryWrites: { "surge.pause": true } };
		});
		const runner = new SurgeWorkflowRunner({
			host,
			gates: [memoryPauseGate()],
			aimd: { initial: 1, max: 1 },
		});
		const first: SurgeTaskInput[] = [
			{ id: "a", kind: "work" },
			{ id: "b", kind: "work" },
		];
		const result = await runner.run(first);
		expect(result.status).toBe("paused");
		expect(result.tasks.filter((task) => task.status === "succeeded")).toHaveLength(
			1,
		);
		expect(result.tasks.filter((task) => task.status === "pending")).toHaveLength(1);
	});

	it("aborts remaining work with fail-fast gate", async () => {
		const host = syncHost(async ({ task }) => {
			if (task.id === "bad") {
				return { ok: false, error: "boom" };
			}
			return { ok: true };
		});
		const runner = new SurgeWorkflowRunner({
			host,
			gates: [failFastGate()],
			aimd: { initial: 1, max: 1 },
		});
		const result = await runner.run([
			{ id: "bad", kind: "work" },
			{ id: "later", kind: "work" },
		]);
		expect(result.status).toBe("aborted");
		expect(result.tasks.find((task) => task.id === "later")?.status).toBe(
			"pending",
		);
	});

	it("resumes from checkpoint", async () => {
		const store = new InMemoryCheckpointStore();
		let calls = 0;
		const host = syncHost(async ({ task }) => {
			calls += 1;
			if (task.id === "a" && calls === 1) {
				return { ok: true };
			}
			if (task.id === "b") {
				return { ok: true };
			}
			return { ok: true };
		});
		const first = new SurgeWorkflowRunner({
			host,
			surgeId: "surge_resume",
			checkpointStore: store,
			aimd: { initial: 1, max: 1 },
			gates: [memoryPauseGate()],
		});
		// Force pause after first task by writing pause in host after success —
		// use a custom gate via memory set on first completion.
		const pausingHost = syncHost(async ({ task }) => {
			if (task.id === "a") {
				return { ok: true, memoryWrites: { "surge.pause": true } };
			}
			return { ok: true };
		});
		const pausing = new SurgeWorkflowRunner({
			host: pausingHost,
			surgeId: "surge_resume",
			checkpointStore: store,
			aimd: { initial: 1, max: 1 },
			gates: [memoryPauseGate()],
		});
		const paused = await pausing.run([
			{ id: "a", kind: "work" },
			{ id: "b", kind: "work" },
		]);
		expect(paused.status).toBe("paused");

		const resumed = new SurgeWorkflowRunner({
			host: syncHost(async () => ({ ok: true })),
			surgeId: "surge_resume",
			checkpointStore: store,
			gates: [],
		});
		const didResume = await resumed.resumeFromCheckpoint();
		expect(didResume).toBe(true);
		resumed.memory.delete("surge.pause");
		const done = await resumed.run();
		expect(done.success).toBe(true);
		expect(done.tasks.every((task) => task.status === "succeeded")).toBe(true);
	});
});
