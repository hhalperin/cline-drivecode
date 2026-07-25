import { AimdController } from "./aimd";
import { CheckpointManager } from "./checkpoint";
import { SurgeExecutor } from "./executor";
import { alwaysContinueGate } from "./gates";
import { SurgeMailbox } from "./mailbox";
import { SurgeMemoryCoordinator } from "./memory";
import { QueuedRateLimiter } from "./rateLimiter";
import {
	createSurgeResult,
	createTask,
	newId,
	nowIso,
	type SurgeGate,
	type SurgeLogEntry,
	type SurgeResult,
	type SurgeRunnerOptions,
	type SurgeTask,
	type SurgeTaskInput,
} from "./types";

function hasPendingWork(tasks: readonly SurgeTask[]): boolean {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	return tasks.some((task) => {
		if (task.status !== "pending") {
			return false;
		}
		return task.dependsOn.every((depId) => byId.get(depId)?.status === "succeeded");
	});
}

/**
 * Multi-wave surge runner.
 * Initialize memory → gates → parallel batch → spawn/inject → checkpoint → repeat.
 */
export class SurgeWorkflowRunner {
	readonly surgeId: string;
	readonly memory = new SurgeMemoryCoordinator();
	readonly mailbox = new SurgeMailbox();
	readonly logs: SurgeLogEntry[] = [];
	#tasks: SurgeTask[] = [];
	#wave = 0;
	#aimd: AimdController;
	#rateLimiter: QueuedRateLimiter;
	#gates: SurgeGate[];
	#checkpoint: CheckpointManager;
	#options: SurgeRunnerOptions;

	constructor(options: SurgeRunnerOptions) {
		this.#options = options;
		this.surgeId = options.surgeId ?? newId("surge");
		this.#aimd = new AimdController(options.aimd);
		this.#rateLimiter = new QueuedRateLimiter(options.rateLimit);
		this.#gates =
			options.gates && options.gates.length > 0
				? options.gates
				: [alwaysContinueGate];
		this.#checkpoint = new CheckpointManager(options.checkpointStore);
	}

	get tasks(): readonly SurgeTask[] {
		return this.#tasks;
	}

	get wave(): number {
		return this.#wave;
	}

	enqueue(inputs: SurgeTaskInput[]): SurgeTask[] {
		const created = inputs.map((input) => createTask(input));
		this.#tasks.push(...created);
		return created;
	}

	async resumeFromCheckpoint(): Promise<boolean> {
		const checkpoint = await this.#checkpoint.load(this.surgeId);
		if (!checkpoint) {
			return false;
		}
		this.#tasks = checkpoint.tasks;
		this.#wave = checkpoint.wave;
		this.memory.restore(checkpoint.memory);
		this.mailbox.restore(checkpoint.mailbox);
		this.logs.push({
			at: nowIso(),
			level: "info",
			message: `resumed from checkpoint ${checkpoint.id}`,
			data: { wave: checkpoint.wave },
		});
		return true;
	}

	async run(initial: SurgeTaskInput[] = []): Promise<SurgeResult> {
		try {
			if (initial.length > 0) {
				this.enqueue(initial);
			}

			const maxWaves = this.#options.maxWaves ?? 32;
			const executor = new SurgeExecutor({
				host: this.#options.host,
				aimd: this.#aimd,
				rateLimiter: this.#rateLimiter,
				memory: this.memory,
				mailbox: this.mailbox,
				gates: this.#gates,
				logs: this.logs,
				signal: this.#options.signal,
			});

			while (hasPendingWork(this.#tasks)) {
				if (this.#options.signal?.aborted) {
					return this.#finish("aborted", "surge aborted by signal");
				}
				if (this.#wave >= maxWaves) {
					return this.#finish(
						"failure",
						`exceeded maxWaves=${maxWaves} with pending work remaining`,
					);
				}

				this.#wave += 1;
				const waveResult = await executor.runWave({
					wave: this.#wave,
					tasks: this.#tasks,
				});
				this.#tasks = waveResult.tasks;

				await this.#checkpoint.save({
					surgeId: this.surgeId,
					wave: this.#wave,
					tasks: this.#tasks,
					memory: this.memory.toRecord(),
					mailbox: this.mailbox.snapshot(),
				});

				switch (waveResult.gate.action) {
					case "continue":
					case "inject":
					case "redirect":
						break;
					case "pause":
						return this.#finish(
							"paused",
							waveResult.gate.reason ?? "paused by gate",
						);
					case "abort":
						return this.#finish(
							"aborted",
							waveResult.gate.reason ?? "aborted by gate",
						);
					default: {
						const _exhaustive: never = waveResult.gate.action;
						return _exhaustive;
					}
				}
			}

			const failed = this.#tasks.filter((task) => task.status === "failed");
			if (failed.length === 0) {
				return this.#finish("success", "surge completed");
			}
			const succeeded = this.#tasks.some((task) => task.status === "succeeded");
			if (succeeded) {
				return this.#finish(
					"partial",
					`${failed.length} task(s) failed; others succeeded`,
				);
			}
			return this.#finish("failure", "all executed tasks failed");
		} finally {
			this.#rateLimiter.close();
		}
	}

	#finish(
		status: SurgeResult["status"],
		message: string,
	): SurgeResult {
		const errors = this.#tasks
			.filter((task) => task.status === "failed" && task.error)
			.map((task) => `${task.id}: ${task.error}`);
		return createSurgeResult({
			status,
			surgeId: this.surgeId,
			wave: this.#wave,
			tasks: this.#tasks,
			logs: this.logs,
			errors,
			metadata: {
				aimdWindow: this.#aimd.window,
				memoryKeys: Object.keys(this.memory.toRecord()),
				mailboxSize: this.mailbox.messages.length,
			},
			message,
		});
	}
}
