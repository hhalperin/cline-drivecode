import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

export type DriveArtifactsWebviewFrame = {
	type: "drive_artifacts_list";
	requestId?: string;
	workspaceRoot?: string;
	[key: string]: unknown;
};

/**
 * Bridges the Artifacts page → hub `drive.artifacts.list`. Read-only over the
 * durable artifact family (DRV-ARTIFACTS); the hub stays the single writer, so
 * this never records or mutates an artifact.
 *
 * The workspace root is forwarded rather than defaulted: the hub only reads the
 * corpus of the root it is already bound to, and inventing one here would turn
 * a "not bound yet" state into a read of the wrong project's artifacts.
 */
export async function handleDriveArtifactsWebviewCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: DriveArtifactsWebviewFrame,
): Promise<void> {
	const requestId =
		typeof frame.requestId === "string" ? frame.requestId : undefined;

	if (!ctx.uiClient) {
		ctx.send(peer, {
			type: "drive_artifacts_error",
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
			type: "drive_artifacts_error",
			text: "No workspace yet — the artifact corpus is owned by a workspace.",
			code: "invalid_payload",
			requestId,
		});
		return;
	}

	try {
		const reply = await ctx.uiClient.command("drive.artifacts.list", {
			workspaceRoot,
		});
		if (!reply.ok) {
			ctx.send(peer, {
				type: "drive_artifacts_error",
				text: reply.error?.message ?? "Listing artifacts failed.",
				code: reply.error?.code,
				requestId,
			});
			return;
		}
		ctx.send(peer, {
			type: "drive_artifacts",
			artifacts: Array.isArray(reply.payload?.artifacts)
				? reply.payload.artifacts
				: [],
			requestId,
		});
	} catch (error) {
		ctx.send(peer, {
			type: "drive_artifacts_error",
			text: error instanceof Error ? error.message : String(error),
			code: "drive_artifacts_list_failed",
			requestId,
		});
	}
}
