import type { DriveArtifactDirectoryEntry } from "@cline/drive";

/**
 * Port for the Artifacts page. Live hub or demo adapter — the view must not
 * read CLINE_DEMO_* or query params itself (same rule as the Rooms and Status
 * Hub sources; the composition root decides which adapter it gets).
 *
 * The workspace root is passed per call rather than captured at construction,
 * for the same reason the Rooms source does it: the hub learns the root
 * asynchronously, so a source that closed over it would bind whatever was known
 * at mount and never retry.
 *
 * Read-only by design. The corpus is written by the hub as the director
 * presents, and it is bytes-free — the entries carry a produce recipe, never a
 * rendered image (DRV-PRIVACY).
 */
export interface DriveArtifactsSource {
	listArtifacts(workspaceRoot: string): Promise<DriveArtifactDirectoryEntry[]>;
}
