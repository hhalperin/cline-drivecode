import { AimdController } from "./aimd";
import { evaluateGates } from "./gates";
import type { SurgeMailbox } from "./mailbox";
import type { SurgeMemoryCoordinator } from "./memory";
import { QueuedRateLimiter } from "./rateLimiter";
import {
	createTask,
	nowIso,
	type SurgeGate,
	type SurgeGateDecision,
	type SurgeHostPort,
	type SurgeLogEntry,
	type SurgeTask,
	type SurgeTaskInput,
} from "./types";

export type SurgeExecutorOptions = {
	host: SurgeHostPort;
	aimd: AimdController;
	rateLimiter: QueuedRateLimiter;
	memory: SurgeMemoryCoordinator;
	mailbox: SurgeMailbox;
	gates: SurgeGate[];
	logs: SurgeLogEntry[];
	signal?: AbortSignal;
};

export type WaveExecution = {
	tasks: SurgeTask[];
	spawned: SurgeTaskInput[];
	gate: SurgeGateDecision;
	hadFailure: boolean;
};

function depsSatisfied(task: SurgeTask, byId: Map<string, SurgeTask>): boolean {
	return task.dependsOn.every((depId) => {
		const dep = byId.get(depId);
		return dep?.status === "succeeded";
	});
}

function selectReady(tasks: SurgeTask[], limit: number): SurgeTask[] {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	return tasks
		.filter(
			(task) => task.status === "pending" && depsSatisfied(task, byId),
		)
		.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))
		.slice(0, limit);
}

function log(
	logs: SurgeLogEntry[],
	level: SurgeLogEntry["level"],
	message: string,
	data?: Record<string, unknown>,
): void {
	logs.push({ at: nowIso(), level, message, data });
}

/**
 * Runs one surge wave: emergency/pre gates → parallel batch → post gate.
 */
export class SurgeExecutor {
	constructor(private readonly options: SurgeExecutorOptions) {}

	async runWave(input: {
		wave: number;
		tasks: SurgeTask[];
	}): Promise<WaveExecution> {
		const { host, aimd, rateLimiter, memory, mailbox, gates, logs, signal } =
			this.options;
		const tasks = input.tasks;

		const emergency = await evaluateGates(gates, {
			kind: "emergency",
			wave: input.wave,
			tasks,
			memory: memory.snapshot(),
			mailbox: mailbox.messages,
		});
		if (emergency.action !== "continue") {
			return {
				tasks,
				spawned: emergency.inject ?? [],
				gate: emergency,
				hadFailure: false,
			};
		}

		const pre = await evaluateGates(gates, {
			kind: "pre",
			wave: input.wave,
			tasks,
			memory: memory.snapshot(),
			mailbox: mailbox.messages,
		});
		if (pre.action !== "continue") {
			return {
				tasks,
				spawned: pre.inject ?? [],
				gate: pre,
				hadFailure: false,
			};
		}

		const ready = selectReady(tasks, aimd.window);
		log(logs, "info", `wave ${input.wave}: running ${ready.length} task(s)`, {
			window: aimd.window,
			readyIds: ready.map((task) => task.id),
		});

		const spawned: SurgeTaskInput[] = [];
		let hadFailure = false;

		await Promise.all(
			ready.map(async (task) => {
				if (signal?.aborted) {
					task.status = "cancelled";
					task.updatedAt = nowIso();
					return;
				}
				await rateLimiter.acquire(signal);
				task.status = "running";
				task.attempts += 1;
				task.updatedAt = nowIso();
				try {
					const outcome = await host.runTask({
						task,
						memory: memory.snapshot(),
						mailbox: mailbox.messages,
						signal,
					});
					if (outcome.memoryWrites) {
						memory.writeAll(outcome.memoryWrites);
					}
					if (outcome.messages) {
						for (const message of outcome.messages) {
							mailbox.send({
								from: message.from ?? task.id,
								to: message.to,
								topic: message.topic,
								body: message.body,
							});
						}
					}
					if (outcome.spawn?.length) {
						spawned.push(...outcome.spawn);
						for (const child of outcome.spawn) {
							const childTask = createTask(child);
							task.spawnedIds.push(childTask.id);
							tasks.push(childTask);
						}
					}
					if (outcome.ok) {
						task.status = "succeeded";
						task.result = outcome.result;
						aimd.onSuccess();
					} else {
						task.status = "failed";
						task.error = outcome.error ?? "task failed";
						hadFailure = true;
						aimd.onFailure();
					}
				} catch (error) {
					task.status = "failed";
					task.error =
						error instanceof Error ? error.message : String(error);
					hadFailure = true;
					if (/429|rate.?limit/i.test(task.error)) {
						aimd.onRateLimited();
					} else {
						aimd.onFailure();
					}
					log(logs, "error", `task ${task.id} threw`, { error: task.error });
				}
				task.updatedAt = nowIso();
			}),
		);

		const post = await evaluateGates(gates, {
			kind: "post",
			wave: input.wave,
			tasks,
			memory: memory.snapshot(),
			mailbox: mailbox.messages,
		});

		if (post.action === "inject" && post.inject?.length) {
			spawned.push(...post.inject);
			for (const item of post.inject) {
				tasks.push(createTask(item));
			}
		}
		if (post.action === "redirect" && post.redirect?.length) {
			for (const task of tasks) {
				if (task.status === "pending") {
					task.status = "cancelled";
					task.updatedAt = nowIso();
				}
			}
			for (const item of post.redirect) {
				tasks.push(createTask(item));
			}
		}

		return { tasks, spawned, gate: post, hadFailure };
	}
}
