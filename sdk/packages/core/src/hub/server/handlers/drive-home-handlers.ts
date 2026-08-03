/**
 * Hub drive_agent_home_get / drive_agent_home_put over `.driveagent/<slug>/`.
 *
 * The put lane never receives a whole home — only a patch, merged server-side
 * against the file on disk (see `../../drive-home/write`). A payload that
 * names a field the read path strips is refused rather than merged, because
 * the browser it came from was never shown that field's value.
 */

import {
	compileDriveagentHome,
	DriveagentHomeCompileError,
	DriveagentHomeWriteError,
} from "@cline/drive";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	DriveagentHomeLoadError,
	loadDriveagentHome,
	writeDriveagentHome,
} from "../../drive-home";
import { errorReply, type HubTransportContext, okReply } from "./context";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function handleDriveHomeCommand(
	_ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	switch (envelope.command) {
		case "drive_agent_home_get":
			return handleDriveAgentHomeGet(envelope);
		case "drive_agent_home_put":
			return handleDriveAgentHomePut(envelope);
		default:
			return errorReply(
				envelope,
				"not_implemented",
				`Unknown drive home command: ${envelope.command}`,
			);
	}
}

function handleDriveAgentHomeGet(
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const workspaceRoot = readString(envelope.payload, "workspaceRoot");
	const slug = readString(envelope.payload, "slug");
	if (!workspaceRoot) {
		return errorReply(
			envelope,
			"invalid_payload",
			"workspaceRoot is required",
		);
	}
	if (!slug) {
		return errorReply(envelope, "invalid_payload", "slug is required");
	}

	try {
		const loaded = loadDriveagentHome({ workspaceRoot, slug });
		const compiled = compileDriveagentHome(loaded.home);
		return okReply(envelope, {
			home: loaded.home,
			compiled,
		});
	} catch (error) {
		return homeErrorReply(envelope, error);
	}
}

function handleDriveAgentHomePut(
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const workspaceRoot = readString(envelope.payload, "workspaceRoot");
	const slug = readString(envelope.payload, "slug");
	if (!workspaceRoot) {
		return errorReply(
			envelope,
			"invalid_payload",
			"workspaceRoot is required",
		);
	}
	if (!slug) {
		return errorReply(envelope, "invalid_payload", "slug is required");
	}
	const patch = envelope.payload?.patch;
	if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
		return errorReply(envelope, "invalid_payload", "patch object is required");
	}

	try {
		const written = writeDriveagentHome({ workspaceRoot, slug, patch });
		const compiled = compileDriveagentHome(written.home);
		return okReply(envelope, {
			home: written.home,
			compiled,
			changedFiles: written.changedFiles,
		});
	} catch (error) {
		return homeErrorReply(envelope, error);
	}
}

function homeErrorReply(
	envelope: HubCommandEnvelope,
	error: unknown,
): HubReplyEnvelope {
	if (
		error instanceof DriveagentHomeLoadError ||
		error instanceof DriveagentHomeCompileError ||
		error instanceof DriveagentHomeWriteError
	) {
		return errorReply(envelope, error.code, error.message);
	}
	return errorReply(
		envelope,
		"invalid_home",
		error instanceof Error ? error.message : String(error),
	);
}
