/** Domain model for the Surge parallel orchestration layer. */

export type SurgeTaskStatus =
	| "pending"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "skipped";

export type SurgeResultStatus =
	| "success"
	| "failure"
	| "partial"
	| "paused"
	| "aborted"
	| "skipped";

export type SurgeGateKind = "pre" | "post" | "emergency";

export type SurgeGateAction =
	| "continue"
	| "pause"
	| "abort"
	| "redirect"
	| "inject";

export type SurgeTask = {
	id: string;
	kind: string;
	payload: Record<string, unknown>;
	/** Task ids that must succeed before this task may run. */
	dependsOn: string[];
	priority: number;
	status: SurgeTaskStatus;
	attempts: number;
	error?: string;
	result?: Record<string, unknown>;
	/** Tasks spawned by this task during execution. */
	spawnedIds: string[];
	createdAt: string;
	updatedAt: string;
};

export type SurgeTaskInput = {
	id?: string;
	kind: string;
	payload?: Record<string, unknown>;
	dependsOn?: string[];
	priority?: number;
};

export type SurgeGateDecision = {
	action: SurgeGateAction;
	reason?: string;
	/** When action is inject, tasks to enqueue for the next wave. */
	inject?: SurgeTaskInput[];
	/** When action is redirect, replace remaining pending work with these. */
	redirect?: SurgeTaskInput[];
};

export type SurgeGateContext = {
	kind: SurgeGateKind;
	wave: number;
	tasks: readonly SurgeTask[];
	memory: ReadonlyMap<string, unknown>;
	mailbox: readonly SurgeMailboxMessage[];
};

export type SurgeGate = {
	name: string;
	kinds: readonly SurgeGateKind[];
	evaluate: (ctx: SurgeGateContext) => SurgeGateDecision | Promise<SurgeGateDecision>;
};

export type SurgeMailboxMessage = {
	id: string;
	from: string;
	to: string | "*";
	topic: string;
	body: Record<string, unknown>;
	createdAt: string;
};

export type SurgeCheckpoint = {
	id: string;
	surgeId: string;
	wave: number;
	tasks: SurgeTask[];
	memory: Record<string, unknown>;
	mailbox: SurgeMailboxMessage[];
	createdAt: string;
};

export type SurgeLogEntry = {
	at: string;
	level: "info" | "warn" | "error";
	message: string;
	data?: Record<string, unknown>;
};

export type SurgeResult = {
	status: SurgeResultStatus;
	surgeId: string;
	wave: number;
	tasks: SurgeTask[];
	logs: SurgeLogEntry[];
	errors: string[];
	metadata: Record<string, unknown>;
	message: string;
	readonly success: boolean;
	readonly failed: boolean;
};

export type AimdConfig = {
	/** Starting concurrency window. */
	initial: number;
	/** Floor for concurrency. */
	min: number;
	/** Ceiling for concurrency. */
	max: number;
	/** Additive increase per successful window. */
	increase: number;
	/** Multiplicative decrease factor on failure / rate limit. */
	decrease: number;
};

export type RateLimiterConfig = {
	/** Max starts per interval. */
	maxPerInterval: number;
	/** Interval length in ms. */
	intervalMs: number;
};

export type SurgeHostInvocation = {
	task: SurgeTask;
	memory: ReadonlyMap<string, unknown>;
	mailbox: readonly SurgeMailboxMessage[];
	signal?: AbortSignal;
};

export type SurgeHostOutcome = {
	ok: boolean;
	result?: Record<string, unknown>;
	error?: string;
	/** Dynamic work discovered during the task. */
	spawn?: SurgeTaskInput[];
	/** Memory writes (last-write-wins per key). */
	memoryWrites?: Record<string, unknown>;
	/** Outbound mailbox messages. */
	messages?: Array<Omit<SurgeMailboxMessage, "id" | "createdAt" | "from"> & { from?: string }>;
};

/** Host port: run one surge task. Core stays free of agent/session deps. */
export type SurgeHostPort = {
	runTask: (invocation: SurgeHostInvocation) => Promise<SurgeHostOutcome>;
};

export type SurgeRunnerOptions = {
	surgeId?: string;
	host: SurgeHostPort;
	gates?: SurgeGate[];
	aimd?: Partial<AimdConfig>;
	rateLimit?: Partial<RateLimiterConfig>;
	/** Hard stop after this many waves. */
	maxWaves?: number;
	/** Persist checkpoints through this port when provided. */
	checkpointStore?: SurgeCheckpointStore;
	signal?: AbortSignal;
};

export type SurgeCheckpointStore = {
	save: (checkpoint: SurgeCheckpoint) => Promise<void> | void;
	load: (surgeId: string) => Promise<SurgeCheckpoint | null> | SurgeCheckpoint | null;
};

export function nowIso(): string {
	return new Date().toISOString();
}

export function newId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function createSurgeResult(input: {
	status: SurgeResultStatus;
	surgeId: string;
	wave: number;
	tasks: SurgeTask[];
	logs?: SurgeLogEntry[];
	errors?: string[];
	metadata?: Record<string, unknown>;
	message: string;
}): SurgeResult {
	const status = input.status;
	return {
		status,
		surgeId: input.surgeId,
		wave: input.wave,
		tasks: input.tasks,
		logs: input.logs ?? [],
		errors: input.errors ?? [],
		metadata: input.metadata ?? {},
		message: input.message,
		get success() {
			return status === "success";
		},
		get failed() {
			return status === "failure" || status === "aborted";
		},
	};
}

export function createTask(input: SurgeTaskInput): SurgeTask {
	const at = nowIso();
	return {
		id: input.id ?? newId("task"),
		kind: input.kind,
		payload: input.payload ?? {},
		dependsOn: input.dependsOn ?? [],
		priority: input.priority ?? 0,
		status: "pending",
		attempts: 0,
		spawnedIds: [],
		createdAt: at,
		updatedAt: at,
	};
}
