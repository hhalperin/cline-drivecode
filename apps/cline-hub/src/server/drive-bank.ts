import type { BankSnapshot, HubCommandName } from "@cline/shared";
import { parseBankSnapshot } from "@cline/shared";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

function asBankSnapshot(value: unknown): BankSnapshot | undefined {
	try {
		return parseBankSnapshot(value);
	} catch {
		return undefined;
	}
}

/**
 * Bridges Chat Drive bank seed/get to hub `drive_bank_*` durable ops.
 */
export async function handleDriveBankWebviewCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: {
		type: "drive_bank_get" | "drive_bank_seed";
		workspaceRoot: string;
		requestId?: string;
		[key: string]: unknown;
	},
): Promise<void> {
	const requestId =
		typeof frame.requestId === "string" ? frame.requestId : undefined;

	if (!ctx.uiClient) {
		ctx.send(peer, {
			type: "drive_bank_error",
			text: "Hub is not connected.",
			code: "hub_disconnected",
			requestId,
		});
		return;
	}

	const workspaceRoot =
		typeof frame.workspaceRoot === "string" ? frame.workspaceRoot.trim() : "";
	if (!workspaceRoot) {
		ctx.send(peer, {
			type: "drive_bank_error",
			text: "workspaceRoot is required.",
			code: "invalid_payload",
			requestId,
		});
		return;
	}

	const command = frame.type as HubCommandName;
	try {
		const reply = await ctx.uiClient.command(command, { workspaceRoot });
		if (!reply.ok) {
			ctx.send(peer, {
				type: "drive_bank_error",
				text: reply.error?.message ?? "Drive bank command failed.",
				code: reply.error?.code,
				requestId,
			});
			return;
		}
		const snapshot = asBankSnapshot(reply.payload?.snapshot);
		if (!snapshot) {
			ctx.send(peer, {
				type: "drive_bank_error",
				text: "Drive bank reply missing snapshot.",
				code: "invalid_reply",
				requestId,
			});
			return;
		}
		ctx.send(peer, {
			type: "drive_bank_snapshot",
			snapshot,
			requestId,
		});
	} catch (error) {
		ctx.send(peer, {
			type: "drive_bank_error",
			text: error instanceof Error ? error.message : String(error),
			code: "drive_bank_command_failed",
			requestId,
		});
	}
}
