import {
	createBankStore,
	createMemoryBankFs,
	type BankStore,
} from "@cline/drive";
import type { BankSnapshot } from "@cline/shared";
import { postToHost } from "../vscode";

const WORKSPACE = "/hub-drive-bank";
const HUB_BANK_TIMEOUT_MS = 3_000;

export type DriveBankSession = {
	store: BankStore;
	refresh: () => Promise<BankSnapshot>;
};

/**
 * Browser projection of the task bank.
 *
 * Join seed prefers hub durable ops (`drive_bank_seed`) when a workspaceRoot
 * is available; the memory FS is only a fallback / local edit buffer.
 *
 * PlanEditor mutations still write the in-memory store only (no hub
 * write-through yet). Hub snapshot initializes Now/Next chrome; local edits
 * may diverge until durable bank mutations are bridged.
 */
export function createDriveBankSession(): DriveBankSession {
	const fs = createMemoryBankFs();
	const store = createBankStore(fs, WORKSPACE);
	return {
		store,
		refresh: () => store.getSnapshot(),
	};
}

export async function seedDemoBank(
	session: DriveBankSession,
): Promise<BankSnapshot> {
	const existing = await session.store.getSnapshot();
	if (existing.activePlanId) {
		return existing;
	}
	await session.store.createTask({
		id: "t-parse",
		title: "Fix parser",
		body: "Make the failing parser test green.",
	});
	await session.store.createTask({
		id: "t-tests",
		title: "Rerun tests",
		body: "Confirm the suite is green.",
	});
	await session.store.createPlan({
		id: "p-active",
		title: "Current work",
		taskIds: ["t-parse", "t-tests"],
	});
	return session.refresh();
}

/**
 * Mirror a hub BankSnapshot into the local memory store so PlanEditor can
 * mutate plan refs locally. Idempotent when the active plan already exists.
 */
export async function hydrateLocalBankFromHubSnapshot(
	session: DriveBankSession,
	snapshot: BankSnapshot,
): Promise<void> {
	if (!snapshot.activePlanId) {
		return;
	}
	const existing = await session.store.getPlan(snapshot.activePlanId);
	if (existing) {
		return;
	}
	for (const taskId of snapshot.openTaskIds) {
		const title =
			taskId === snapshot.nowTaskId
				? (snapshot.nowTitle ?? taskId)
				: taskId === snapshot.nextTaskId
					? (snapshot.nextTitle ?? taskId)
					: taskId;
		await session.store.createTask({
			id: taskId,
			title,
			body: "",
		});
	}
	await session.store.createPlan({
		id: snapshot.activePlanId,
		title: "Current work",
		taskIds: [...snapshot.openTaskIds],
	});
}

export function planTasksFromSnapshot(
	snapshot: BankSnapshot,
): Array<{ id: string; title: string }> {
	return snapshot.openTaskIds.map((taskId) => {
		const title =
			taskId === snapshot.nowTaskId
				? (snapshot.nowTitle ?? taskId)
				: taskId === snapshot.nextTaskId
					? (snapshot.nextTitle ?? taskId)
					: taskId;
		return { id: taskId, title };
	});
}

/**
 * Request hub `drive_bank_seed` and resolve with the snapshot reply.
 * Rejects on error reply or timeout (~3s).
 */
export function requestHubBankSeed(
	workspaceRoot: string,
	options?: { timeoutMs?: number },
): Promise<BankSnapshot> {
	const timeoutMs = options?.timeoutMs ?? HUB_BANK_TIMEOUT_MS;
	const requestId = `drive-bank-${Date.now()}-${Math.random().toString(36).slice(2)}`;

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			window.removeEventListener("message", onMessage);
			reject(new Error("drive_bank_seed timed out"));
		}, timeoutMs);

		function onMessage(event: MessageEvent) {
			const message = event.data as {
				type?: string;
				requestId?: string;
				snapshot?: BankSnapshot;
				text?: string;
			};
			if (
				message.type !== "drive_bank_snapshot" &&
				message.type !== "drive_bank_error"
			) {
				return;
			}
			if (message.requestId !== requestId) {
				return;
			}
			clearTimeout(timer);
			window.removeEventListener("message", onMessage);
			if (message.type === "drive_bank_error") {
				reject(new Error(message.text?.trim() || "drive_bank_seed failed"));
				return;
			}
			if (!message.snapshot) {
				reject(new Error("drive_bank_snapshot missing snapshot"));
				return;
			}
			resolve(message.snapshot);
		}

		window.addEventListener("message", onMessage);
		postToHost({
			type: "drive_bank_seed",
			workspaceRoot,
			requestId,
		});
	});
}

/**
 * Prefer hub durable seed when workspaceRoot is set; fall back to in-memory
 * demo seed on missing root, hub error, or timeout.
 */
export async function seedBankForJoin(
	session: DriveBankSession,
	workspaceRoot: string | undefined,
): Promise<{ snapshot: BankSnapshot; fromHub: boolean }> {
	const root = workspaceRoot?.trim();
	if (root) {
		try {
			const snapshot = await requestHubBankSeed(root);
			await hydrateLocalBankFromHubSnapshot(session, snapshot);
			return { snapshot, fromHub: true };
		} catch {
			// Hub unavailable / timed out — memory fallback below.
		}
	}
	const snapshot = await seedDemoBank(session);
	return { snapshot, fromHub: false };
}

export async function listPlanTasks(
	session: DriveBankSession,
	planId: string,
): Promise<Array<{ id: string; title: string }>> {
	const plan = await session.store.getPlan(planId);
	if (!plan) {
		return [];
	}
	const tasks: Array<{ id: string; title: string }> = [];
	for (const taskId of plan.taskIds) {
		const task = await session.store.getTask(taskId);
		if (task && task.status !== "done") {
			tasks.push({ id: task.id, title: task.title });
		}
	}
	return tasks;
}
