/**
 * Persist a Driveagent home patch to disk (FS boundary for DRV-DRIVEAGENT-HOME).
 *
 * The merge target is always the home re-read from disk here, never anything
 * the caller supplied. That is the whole point: the browser is shown a home
 * with its prompt, provider and model stripped (DRV-PRIVACY), so a payload
 * built from what the browser saw is missing fields whose absence would make
 * `agent.yaml` fail its own schema on the next read. Merging server-side
 * against the real file is what turns "the editor did not send it" back into
 * "it did not change".
 *
 * The merged home is re-parsed through the shared zod schemas before a single
 * byte is written, so a save can never leave a home the loader will refuse.
 */

import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type DriveagentHomeFileTexts,
	DriveagentHomeWriteError,
	mergeDriveagentHomePatch,
	serializeDriveagentHome,
} from "@cline/drive";
import { type DriveagentHome, parseDriveagentHome } from "@cline/shared";
import { DriveagentHomeLoadError, loadDriveagentHome } from "./load";
import {
	DRIVEAGENT_AGENT_YAML,
	DRIVEAGENT_ENV_YAML,
	DRIVEAGENT_PERMISSIONS_YAML,
	type DriveagentHomeTier,
} from "./resolve";

export type WrittenDriveagentHome = {
	readonly home: DriveagentHome;
	readonly homePath: string;
	readonly tier: DriveagentHomeTier;
	/** File names actually rewritten; unchanged files are left alone. */
	readonly changedFiles: readonly string[];
};

function readTextOrUndefined(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

/**
 * Stage every changed file, then swap them all in.
 *
 * A home is three files that have to agree, so the risky moment is the gap
 * between the first write and the last. Staging every file first shrinks that
 * gap to a run of renames — the operations least likely to fail once the
 * content is already on the volume — and a failure while staging aborts before
 * anything user-visible has moved. Temp files are cleaned up on both paths, so
 * a failed save does not leave litter inside `.driveagent/`.
 */
function commitFiles(files: readonly { path: string; text: string }[]): void {
	const staged: { tempPath: string; path: string }[] = [];
	try {
		for (const file of files) {
			const tempPath = `${file.path}.tmp-${process.pid}-${Date.now()}-${staged.length}`;
			writeFileSync(tempPath, file.text, "utf8");
			staged.push({ tempPath, path: file.path });
		}
	} catch (error) {
		for (const entry of staged) {
			try {
				rmSync(entry.tempPath, { force: true });
			} catch {
				// best-effort
			}
		}
		throw error;
	}
	for (const entry of staged) {
		renameSync(entry.tempPath, entry.path);
	}
}

/**
 * Merge `patch` onto the on-disk home for `slug` and persist the result.
 *
 * Throws {@link DriveagentHomeLoadError} when the home is missing or already
 * invalid, and {@link DriveagentHomeWriteError} when the patch is refused —
 * a non-editable agent, a field the read path never showed, or a plaintext
 * secret. Nothing is written on either path.
 */
export function writeDriveagentHome(input: {
	workspaceRoot: string;
	slug: string;
	patch: unknown;
	userHomeDir?: string;
}): WrittenDriveagentHome {
	const loaded = loadDriveagentHome({
		workspaceRoot: input.workspaceRoot,
		slug: input.slug,
		userHomeDir: input.userHomeDir,
	});

	const merged = mergeDriveagentHomePatch({
		current: loaded.home,
		patch: input.patch,
	});

	// Re-parse through the shared schemas rather than trusting the merge: this
	// is the assertion that the bytes about to be written will load again,
	// including the `systemPrompt || promptPath` refinement and the plaintext
	// secret ban in env.yaml.
	let validated: DriveagentHome;
	try {
		validated = parseDriveagentHome(merged);
	} catch (error) {
		throw new DriveagentHomeWriteError(
			"invalid_patch",
			`merged home is not a valid Driveagent home: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	const paths = {
		agentYaml: join(loaded.homePath, DRIVEAGENT_AGENT_YAML),
		permissionsYaml: join(loaded.homePath, DRIVEAGENT_PERMISSIONS_YAML),
		envYaml: join(loaded.homePath, DRIVEAGENT_ENV_YAML),
	} as const;
	const previous = {
		agentYaml: readTextOrUndefined(paths.agentYaml),
		permissionsYaml: readTextOrUndefined(paths.permissionsYaml),
		envYaml: readTextOrUndefined(paths.envYaml),
	};

	const next = serializeDriveagentHome(validated, previous);

	// Render all three before writing any, so a serialisation failure leaves
	// disk exactly as it was rather than half-updated. Files whose bytes did
	// not change are skipped, which is what lets a comment in an untouched
	// permissions.yaml survive an agent.yaml edit.
	const changedFiles: string[] = [];
	const pending: { path: string; text: string }[] = [];
	const files: [keyof DriveagentHomeFileTexts, string, string][] = [
		["agentYaml", paths.agentYaml, DRIVEAGENT_AGENT_YAML],
		["permissionsYaml", paths.permissionsYaml, DRIVEAGENT_PERMISSIONS_YAML],
		["envYaml", paths.envYaml, DRIVEAGENT_ENV_YAML],
	];
	for (const [key, path, fileName] of files) {
		const text = next[key];
		if (previous[key] === text) {
			continue;
		}
		pending.push({ path, text });
		changedFiles.push(fileName);
	}
	commitFiles(pending);

	return {
		home: validated,
		homePath: loaded.homePath,
		tier: loaded.tier,
		changedFiles,
	};
}
