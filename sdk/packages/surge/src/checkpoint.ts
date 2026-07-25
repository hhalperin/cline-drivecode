import {
	newId,
	nowIso,
	type SurgeCheckpoint,
	type SurgeCheckpointStore,
	type SurgeMailboxMessage,
	type SurgeTask,
} from "./types";

/** In-memory checkpoint store. Swap for disk/hub persistence at the host. */
export class InMemoryCheckpointStore implements SurgeCheckpointStore {
	#bySurge = new Map<string, SurgeCheckpoint>();

	save(checkpoint: SurgeCheckpoint): void {
		this.#bySurge.set(checkpoint.surgeId, structuredClone(checkpoint));
	}

	load(surgeId: string): SurgeCheckpoint | null {
		const found = this.#bySurge.get(surgeId);
		return found ? structuredClone(found) : null;
	}
}

export class CheckpointManager {
	constructor(private readonly store: SurgeCheckpointStore = new InMemoryCheckpointStore()) {}

	async save(input: {
		surgeId: string;
		wave: number;
		tasks: SurgeTask[];
		memory: Record<string, unknown>;
		mailbox: SurgeMailboxMessage[];
	}): Promise<SurgeCheckpoint> {
		const checkpoint: SurgeCheckpoint = {
			id: newId("ckpt"),
			surgeId: input.surgeId,
			wave: input.wave,
			tasks: structuredClone(input.tasks),
			memory: structuredClone(input.memory),
			mailbox: structuredClone(input.mailbox),
			createdAt: nowIso(),
		};
		await this.store.save(checkpoint);
		return checkpoint;
	}

	async load(surgeId: string): Promise<SurgeCheckpoint | null> {
		return this.store.load(surgeId);
	}
}
