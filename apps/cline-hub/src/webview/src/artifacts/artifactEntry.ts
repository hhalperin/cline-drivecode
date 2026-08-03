/**
 * Wire shape guard for the artifact corpus.
 *
 * The hub already validates every record against the `media.artifact` schema,
 * so this is not a second parser — it is the boundary that stops anything not
 * of the entry shape reaching UI state. Unknown fields are dropped rather than
 * spread through, which matters more here than for rooms: the corpus is
 * bytes-free by construction (DRV-PRIVACY), and passing an entry through
 * verbatim is exactly how a future `uri` or `svg` key would end up held in
 * memory and painted.
 */

import type { DriveArtifactDirectoryEntry } from "@cline/drive";
import type { MediaArtifactStatus, MediaClass } from "@cline/shared";
import { isShowArtifactKind } from "../components/views/artifact-filters";

const MEDIA_CLASSES: readonly MediaClass[] = [
	"still",
	"animation",
	"video",
	"document",
	"structured",
	"work",
];

const ARTIFACT_STATUSES: readonly MediaArtifactStatus[] = [
	"planned",
	"ready",
	"showing",
	"shown",
	"cancelled",
];

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

/** The produce recipe, minus its args — the card never reads them. */
function produceFromUnknown(
	value: unknown,
): DriveArtifactDirectoryEntry["produce"] | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const raw = value as Record<string, unknown>;
	const tool = nonEmptyString(raw.tool);
	if (!tool) {
		return null;
	}
	const templateId = nonEmptyString(raw.templateId);
	return {
		tool,
		...(templateId ? { templateId } : {}),
		args: {},
	};
}

export function artifactDirectoryEntryFromUnknown(
	value: unknown,
): DriveArtifactDirectoryEntry | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const raw = value as Record<string, unknown>;
	const showItemId = nonEmptyString(raw.showItemId);
	const roomId = nonEmptyString(raw.roomId);
	const title = nonEmptyString(raw.title);
	const ownerParticipantId = nonEmptyString(raw.ownerParticipantId);
	if (!showItemId || !roomId || !title || !ownerParticipantId) {
		return null;
	}
	if (!isShowArtifactKind(raw.artifactKind)) {
		return null;
	}
	const mediaClass = MEDIA_CLASSES.find((item) => item === raw.mediaClass);
	const status = ARTIFACT_STATUSES.find((item) => item === raw.status);
	if (!mediaClass || !status) {
		return null;
	}
	const produce = produceFromUnknown(raw.produce);
	if (!produce) {
		return null;
	}
	return {
		showItemId,
		roomId,
		artifactKind: raw.artifactKind,
		mediaClass,
		title,
		ownerParticipantId,
		produce,
		tags: Array.isArray(raw.tags)
			? raw.tags.filter(
					(tag): tag is string => typeof tag === "string" && tag.trim() !== "",
				)
			: [],
		status,
		createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
		updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
	};
}
