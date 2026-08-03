/**
 * Pure Driveagent home write model (DRV-DRIVEAGENT-HOME, ADR-0001).
 *
 * The read path deliberately strips `systemPrompt`, `promptPath`, `providerId`
 * and `modelId` before anything reaches a browser (DRV-PRIVACY). An editor
 * that round-trips what it was shown therefore sends those fields back as
 * *absent* — and `DriveagentAgentYamlSchema` rejects an agent.yaml carrying
 * neither prompt, so a naive save does not merely lose the prompt, it makes
 * the agent unloadable.
 *
 * Three rules prevent that, and they live here — pure, so the hub handler, the
 * cline-hub bridge and the webview editor all share one definition:
 *
 * 1. A patch is a patch. An absent key means "unchanged", never "delete".
 *    Clearing a field is expressed by sending it empty, never by omitting it.
 * 2. A patch may only name fields the read path actually shows. Anything
 *    stripped on the way out is refused on the way in rather than merged,
 *    because a browser that never saw a value cannot have an opinion on it.
 * 3. The merge target is the on-disk home, which the browser never saw.
 *
 * Value imports from `@cline/shared` are forbidden in this package
 * (`import-boundary.test.ts`), so {@link DRIVE_ENV_FORBIDDEN_SECRET_KEYS} is
 * duplicated from the shared schema module and pinned to it by `write.test.ts`.
 */

import type { DriveagentHome } from "@cline/shared";
import YAML from "yaml";

/**
 * Plaintext secret keys refused in `env.yaml` values.
 *
 * Duplicated from `@cline/shared`'s `DRIVE_ENV_FORBIDDEN_SECRET_KEYS`; the two
 * copies are pinned equal by a cross-package test.
 */
export const DRIVE_ENV_FORBIDDEN_SECRET_KEYS = [
	"apiKey",
	"token",
	"accessToken",
	"secret",
	"password",
	"privateKey",
	"clientSecret",
] as const;

/**
 * `agent.yaml` fields the sanitized read path never sends to a browser.
 *
 * A patch naming one of these is refused outright rather than merged: the
 * value could only have been invented, and an omitted-then-serialised prompt
 * is exactly the failure this module exists to prevent.
 */
export const DRIVEAGENT_AGENT_HIDDEN_FIELDS = [
	"systemPrompt",
	"promptPath",
	"providerId",
	"modelId",
	"maxIterations",
] as const;

const AGENT_PATCH_FIELDS = [
	"name",
	"description",
	"tools",
	"skills",
	"editable",
] as const;
const PERMISSIONS_PATCH_FIELDS = [
	"presetIntent",
	"approvalHooks",
	"notes",
] as const;
const ENV_PATCH_FIELDS = ["values", "secretRefs"] as const;
const HOME_PATCH_FIELDS = ["slug", "agent", "permissions", "env"] as const;

const PRESET_INTENTS = ["readonly", "standard", "full"] as const;

export type DriveagentPermissionPresetIntentPatch =
	(typeof PRESET_INTENTS)[number];

export type DriveagentAgentPatch = {
	readonly name?: string;
	readonly description?: string;
	readonly tools?: readonly string[];
	readonly skills?: readonly string[];
	readonly editable?: boolean;
};

export type DriveagentPermissionsPatch = {
	readonly presetIntent?: DriveagentPermissionPresetIntentPatch;
	readonly approvalHooks?: readonly string[];
	/** Empty or whitespace-only clears the note. */
	readonly notes?: string;
};

export type DriveagentEnvPatch = {
	/** Merged key-by-key onto the on-disk values; absent keys are untouched. */
	readonly values?: Readonly<Record<string, string | number | boolean>>;
	readonly secretRefs?: readonly { key: string; secretRef: string }[];
};

export type DriveagentHomePatch = {
	readonly slug?: string;
	readonly agent?: DriveagentAgentPatch;
	readonly permissions?: DriveagentPermissionsPatch;
	readonly env?: DriveagentEnvPatch;
};

export type DriveagentHomeWriteErrorCode =
	| "not_editable"
	| "hidden_field_write"
	| "unknown_field"
	| "slug_mismatch"
	| "immutable_field"
	| "plaintext_secret"
	| "invalid_patch";

export class DriveagentHomeWriteError extends Error {
	readonly code: DriveagentHomeWriteErrorCode;

	constructor(code: DriveagentHomeWriteErrorCode, message: string) {
		super(message);
		this.name = "DriveagentHomeWriteError";
		this.code = code;
	}
}

function fail(code: DriveagentHomeWriteErrorCode, message: string): never {
	throw new DriveagentHomeWriteError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) {
		fail("invalid_patch", `${label} must be an object`);
	}
	return value;
}

function assertKnownKeys(
	record: Record<string, unknown>,
	allowed: readonly string[],
	label: string,
): void {
	for (const key of Object.keys(record)) {
		if (!allowed.includes(key)) {
			fail("unknown_field", `${label}.${key} is not a writable field`);
		}
	}
}

function assertNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		fail("invalid_patch", `${label} must be a non-empty string`);
	}
	return value.trim();
}

function assertStringList(value: unknown, label: string): string[] {
	if (!Array.isArray(value)) {
		fail("invalid_patch", `${label} must be an array of strings`);
	}
	return value.map((entry, index) =>
		assertNonEmptyString(entry, `${label}[${index}]`),
	);
}

function assertAgentPatch(value: unknown): DriveagentAgentPatch {
	const record = assertRecord(value, "agent");
	for (const hidden of DRIVEAGENT_AGENT_HIDDEN_FIELDS) {
		if (hidden in record) {
			fail(
				"hidden_field_write",
				`agent.${hidden} is never sent to the editor and cannot be written back; ` +
					"omit it so the on-disk value is preserved",
			);
		}
	}
	assertKnownKeys(record, AGENT_PATCH_FIELDS, "agent");

	const patch: {
		name?: string;
		description?: string;
		tools?: string[];
		skills?: string[];
		editable?: boolean;
	} = {};
	if (record.name !== undefined) {
		patch.name = assertNonEmptyString(record.name, "agent.name");
	}
	if (record.description !== undefined) {
		patch.description = assertNonEmptyString(
			record.description,
			"agent.description",
		);
	}
	if (record.tools !== undefined) {
		patch.tools = assertStringList(record.tools, "agent.tools");
	}
	if (record.skills !== undefined) {
		patch.skills = assertStringList(record.skills, "agent.skills");
	}
	if (record.editable !== undefined) {
		if (typeof record.editable !== "boolean") {
			fail("invalid_patch", "agent.editable must be a boolean");
		}
		patch.editable = record.editable;
	}
	return patch;
}

function assertPermissionsPatch(value: unknown): DriveagentPermissionsPatch {
	const record = assertRecord(value, "permissions");
	assertKnownKeys(record, PERMISSIONS_PATCH_FIELDS, "permissions");

	const patch: {
		presetIntent?: DriveagentPermissionPresetIntentPatch;
		approvalHooks?: string[];
		notes?: string;
	} = {};
	if (record.presetIntent !== undefined) {
		const intent = record.presetIntent;
		if (
			typeof intent !== "string" ||
			!(PRESET_INTENTS as readonly string[]).includes(intent)
		) {
			fail(
				"invalid_patch",
				`permissions.presetIntent must be one of ${PRESET_INTENTS.join(", ")}`,
			);
		}
		patch.presetIntent = intent as DriveagentPermissionPresetIntentPatch;
	}
	if (record.approvalHooks !== undefined) {
		patch.approvalHooks = assertStringList(
			record.approvalHooks,
			"permissions.approvalHooks",
		);
	}
	if (record.notes !== undefined) {
		if (typeof record.notes !== "string") {
			fail("invalid_patch", "permissions.notes must be a string");
		}
		patch.notes = record.notes;
	}
	return patch;
}

function assertEnvPatch(value: unknown): DriveagentEnvPatch {
	const record = assertRecord(value, "env");
	assertKnownKeys(record, ENV_PATCH_FIELDS, "env");

	const patch: {
		values?: Record<string, string | number | boolean>;
		secretRefs?: { key: string; secretRef: string }[];
	} = {};
	if (record.values !== undefined) {
		const values = assertRecord(record.values, "env.values");
		const next: Record<string, string | number | boolean> = {};
		for (const [key, entry] of Object.entries(values)) {
			if (
				(DRIVE_ENV_FORBIDDEN_SECRET_KEYS as readonly string[]).includes(key)
			) {
				fail(
					"plaintext_secret",
					`plaintext secret key '${key}' is forbidden in env.yaml values; use secretRefs`,
				);
			}
			if (
				typeof entry !== "string" &&
				typeof entry !== "number" &&
				typeof entry !== "boolean"
			) {
				fail(
					"invalid_patch",
					`env.values.${key} must be a string, number, or boolean`,
				);
			}
			next[key] = entry;
		}
		patch.values = next;
	}
	if (record.secretRefs !== undefined) {
		if (!Array.isArray(record.secretRefs)) {
			fail("invalid_patch", "env.secretRefs must be an array");
		}
		patch.secretRefs = record.secretRefs.map((entry, index) => {
			const ref = assertRecord(entry, `env.secretRefs[${index}]`);
			assertKnownKeys(ref, ["key", "secretRef"], `env.secretRefs[${index}]`);
			return {
				key: assertNonEmptyString(ref.key, `env.secretRefs[${index}].key`),
				secretRef: assertNonEmptyString(
					ref.secretRef,
					`env.secretRefs[${index}].secretRef`,
				),
			};
		});
	}
	return patch;
}

/**
 * Structurally validate an untrusted patch without needing the on-disk home.
 *
 * Refuses every field the read path strips, every field outside the schema,
 * and every plaintext secret — so the editor can reject a bad draft before it
 * reaches the hub, and the hub can reject one that skipped the editor.
 */
export function assertDriveagentHomePatch(input: unknown): DriveagentHomePatch {
	const record = assertRecord(input, "patch");
	assertKnownKeys(record, HOME_PATCH_FIELDS, "patch");

	const patch: {
		slug?: string;
		agent?: DriveagentAgentPatch;
		permissions?: DriveagentPermissionsPatch;
		env?: DriveagentEnvPatch;
	} = {};
	if (record.slug !== undefined) {
		patch.slug = assertNonEmptyString(record.slug, "patch.slug");
	}
	if (record.agent !== undefined) {
		patch.agent = assertAgentPatch(record.agent);
	}
	if (record.permissions !== undefined) {
		patch.permissions = assertPermissionsPatch(record.permissions);
	}
	if (record.env !== undefined) {
		patch.env = assertEnvPatch(record.env);
	}
	return patch;
}

/** An agent is writable unless its home opts out with `editable: false`. */
export function driveagentHomeIsEditable(home: DriveagentHome): boolean {
	return home.agent.editable !== false;
}

/**
 * Merge a validated patch onto the home loaded from disk.
 *
 * The result is a complete home: every field the patch did not name keeps the
 * value that was on disk, including the prompt fields the browser never saw.
 */
export function mergeDriveagentHomePatch(input: {
	current: DriveagentHome;
	patch: unknown;
}): DriveagentHome {
	const { current } = input;
	if (!driveagentHomeIsEditable(current)) {
		fail(
			"not_editable",
			`Driveagent '${current.slug}' is marked editable: false and cannot be edited`,
		);
	}
	const patch = assertDriveagentHomePatch(input.patch);

	if (patch.slug !== undefined && patch.slug !== current.slug) {
		fail(
			"slug_mismatch",
			`patch.slug '${patch.slug}' does not match the home slug '${current.slug}'`,
		);
	}
	if (patch.agent?.name !== undefined && patch.agent.name !== current.slug) {
		fail(
			"slug_mismatch",
			`agent.name '${patch.agent.name}' must match the home slug '${current.slug}'`,
		);
	}
	if (
		patch.agent?.editable !== undefined &&
		patch.agent.editable !== driveagentHomeIsEditable(current)
	) {
		fail(
			"immutable_field",
			"agent.editable is the gate on this write path and cannot be changed through it",
		);
	}

	const agent: DriveagentHome["agent"] = {
		...current.agent,
		...(patch.agent?.description !== undefined
			? { description: patch.agent.description }
			: {}),
		...(patch.agent?.tools !== undefined
			? { tools: [...patch.agent.tools] }
			: {}),
		...(patch.agent?.skills !== undefined
			? { skills: [...patch.agent.skills] }
			: {}),
	};

	const nextNotes =
		patch.permissions?.notes !== undefined
			? patch.permissions.notes.trim()
			: current.permissions.notes;
	const permissions: DriveagentHome["permissions"] = {
		presetIntent:
			patch.permissions?.presetIntent ?? current.permissions.presetIntent,
		approvalHooks:
			patch.permissions?.approvalHooks !== undefined
				? [...patch.permissions.approvalHooks]
				: [...current.permissions.approvalHooks],
		...(nextNotes ? { notes: nextNotes } : {}),
	};

	const env: DriveagentHome["env"] = {
		values:
			patch.env?.values !== undefined
				? { ...current.env.values, ...patch.env.values }
				: { ...current.env.values },
		secretRefs:
			patch.env?.secretRefs !== undefined
				? patch.env.secretRefs.map((entry) => ({ ...entry }))
				: current.env.secretRefs.map((entry) => ({ ...entry })),
	};

	return { slug: current.slug, agent, permissions, env };
}

export type DriveagentHomeFileTexts = {
	readonly agentYaml: string;
	readonly permissionsYaml: string;
	readonly envYaml: string;
};

/** Previous file texts, so untouched comments survive a save. */
export type DriveagentHomePreviousTexts = {
	readonly agentYaml?: string;
	readonly permissionsYaml?: string;
	readonly envYaml?: string;
};

function orderedAgent(home: DriveagentHome): Record<string, unknown> {
	const { agent } = home;
	return {
		name: agent.name,
		description: agent.description,
		...(agent.tools !== undefined ? { tools: agent.tools } : {}),
		...(agent.skills !== undefined ? { skills: agent.skills } : {}),
		...(agent.systemPrompt !== undefined
			? { systemPrompt: agent.systemPrompt }
			: {}),
		...(agent.promptPath !== undefined ? { promptPath: agent.promptPath } : {}),
		...(agent.providerId !== undefined ? { providerId: agent.providerId } : {}),
		...(agent.modelId !== undefined ? { modelId: agent.modelId } : {}),
		...(agent.maxIterations !== undefined
			? { maxIterations: agent.maxIterations }
			: {}),
		...(agent.editable !== undefined ? { editable: agent.editable } : {}),
	};
}

function orderedPermissions(home: DriveagentHome): Record<string, unknown> {
	const { permissions } = home;
	return {
		presetIntent: permissions.presetIntent,
		approvalHooks: permissions.approvalHooks,
		...(permissions.notes !== undefined ? { notes: permissions.notes } : {}),
	};
}

function orderedEnv(home: DriveagentHome): Record<string, unknown> {
	return { values: home.env.values, secretRefs: home.env.secretRefs };
}

/**
 * Render one home file, reusing the previous text's document when there is one
 * so comments on keys this save did not touch are not silently discarded.
 */
export function serializeDriveagentHomeFile(input: {
	section: Record<string, unknown>;
	previousText?: string;
}): string {
	const previous = input.previousText;
	if (previous !== undefined && previous.trim().length > 0) {
		try {
			const doc = YAML.parseDocument(previous);
			if (!doc.errors.length && YAML.isMap(doc.contents)) {
				const keep = new Set(Object.keys(input.section));
				for (const key of Object.keys(doc.toJS() as object)) {
					if (!keep.has(key)) {
						doc.delete(key);
					}
				}
				for (const [key, value] of Object.entries(input.section)) {
					doc.set(key, value);
				}
				return String(doc);
			}
		} catch {
			// Unparseable previous text falls through to a clean render.
		}
	}
	return YAML.stringify(input.section, { lineWidth: 0 });
}

/**
 * Serialize a merged home back to its three canonical YAML files.
 *
 * Pass {@link DriveagentHomePreviousTexts} — the bytes just read from disk —
 * so comments survive; without them the files are rendered from scratch.
 */
export function serializeDriveagentHome(
	home: DriveagentHome,
	previous?: DriveagentHomePreviousTexts,
): DriveagentHomeFileTexts {
	return {
		agentYaml: serializeDriveagentHomeFile({
			section: orderedAgent(home),
			previousText: previous?.agentYaml,
		}),
		permissionsYaml: serializeDriveagentHomeFile({
			section: orderedPermissions(home),
			previousText: previous?.permissionsYaml,
		}),
		envYaml: serializeDriveagentHomeFile({
			section: orderedEnv(home),
			previousText: previous?.envYaml,
		}),
	};
}
