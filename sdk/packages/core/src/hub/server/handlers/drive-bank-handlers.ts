/**
 * Hub drive_bank_get / drive_bank_seed (durable task bank under .drive/bank/).
 */

import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { openWorkspaceBankStore } from "../../collaboration/workspaceBankStore";
import { errorReply, type HubTransportContext, okReply } from "./context";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function seedDemoIfEmpty(workspaceRoot: string) {
	const store = openWorkspaceBankStore(workspaceRoot);
	const existing = await store.getSnapshot();
	if (existing.activePlanId) {
		return existing;
	}
	await store.createTask({
		id: "t-parse",
		title: "Fix parser",
		body: "Make the failing parser test green.",
	});
	await store.createTask({
		id: "t-tests",
		title: "Rerun tests",
		body: "Confirm the suite is green.",
	});
	await store.createPlan({
		id: "p-active",
		title: "Current work",
		taskIds: ["t-parse", "t-tests"],
	});
	return store.getSnapshot();
}

export async function handleDriveBankCommand(
	_ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const workspaceRoot =
		readString(envelope.payload, "workspaceRoot") ??
		readString(envelope.payload, "configParent");
	if (!workspaceRoot) {
		return errorReply(
			envelope,
			"invalid_payload",
			"workspaceRoot or configParent is required",
		);
	}

	switch (envelope.command) {
		case "drive_bank_get": {
			const store = openWorkspaceBankStore(workspaceRoot);
			const snapshot = await store.getSnapshot();
			return okReply(envelope, { snapshot });
		}
		case "drive_bank_seed": {
			const snapshot = await seedDemoIfEmpty(workspaceRoot);
			return okReply(envelope, { snapshot });
		}
		default:
			return errorReply(
				envelope,
				"not_implemented",
				`Unknown drive bank command: ${envelope.command}`,
			);
	}
}
