/**
 * Platform catalog facet IO (ADR-0013 / DRV-PLATFORM-CONFIG).
 * Separate from voice `driveFacetsStore` (facets.v1.json).
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	createFacetStore,
	DRIVE_FACET_CATALOG,
	type DriveFacetKey,
	type FacetStore,
} from "@cline/drive";
import type {
	AgentAppearance,
	AgentProfile,
	AgentRef,
	DriveFacetDiskFile,
	DriveFacetDiskSnapshot,
	DriveSubMode,
} from "@cline/shared";
import {
	agentProfileId,
	DRIVE_FACET_SCHEMA_VERSION,
	mergeFacetScopes,
	parseAgentAppearance,
	parseDriveFacetDiskFile,
	resolveDriveConfigDir,
	toAgentProfile,
} from "@cline/shared";

export const CATALOG_FACETS_FILE_NAME = "catalog-facets.v1.json";

/**
 * Facets whose durable shape is a per-entity map, not a scalar.
 *
 * `putCatalogDurableValues` writes `{ kind: "value" }` entries, so letting one
 * of these through would replace the whole map with a scalar and drop every
 * entity in it — silently, since the reader ignores non-map entries here.
 */
const MAP_FACET_KEYS = new Set<DriveFacetKey>(["agent.appearance"]);

const stores = new Map<string, FacetStore>();

export function resolveCatalogFacetsPath(configParent: string): string {
	return join(resolveDriveConfigDir(configParent), CATALOG_FACETS_FILE_NAME);
}

function readCatalogFile(configParent: string): DriveFacetDiskFile | null {
	const path = resolveCatalogFacetsPath(configParent);
	if (!existsSync(path)) {
		return null;
	}
	const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
	return parseDriveFacetDiskFile(raw);
}

function writeCatalogFileAtomic(
	configParent: string,
	file: DriveFacetDiskFile,
): void {
	const path = resolveCatalogFacetsPath(configParent);
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
	renameSync(tmp, path);
}

/** Load merged user + workspace catalog snapshots into a FacetStore. */
export function loadCatalogFacetStore(input: {
	workspaceRoot: string;
	userRoot?: string | null;
}): FacetStore {
	const key = input.workspaceRoot;
	const existing = stores.get(key);
	const user = input.userRoot ? readCatalogFile(input.userRoot) : null;
	const workspace = readCatalogFile(input.workspaceRoot);
	const merged = mergeFacetScopes(user, workspace);
	if (existing) {
		existing.reload(merged);
		return existing;
	}
	const store = createFacetStore(merged);
	store.seedLiveFromDurable();
	stores.set(key, store);
	return store;
}

export function getCatalogDefaultSubMode(workspaceRoot: string): DriveSubMode {
	const store = loadCatalogFacetStore({ workspaceRoot });
	return store.get("drive.defaults.subMode");
}

const LIVE_KEYS = new Set(
	(Object.keys(DRIVE_FACET_CATALOG) as DriveFacetKey[]).filter(
		(k) => DRIVE_FACET_CATALOG[k].lane === "live",
	),
);

export type PutCatalogDurableResult =
	| { ok: true; snapshot: DriveFacetDiskSnapshot }
	| { ok: false; code: string; message: string };

/**
 * Durable-only put. Rejects live-lane keys (e.g. room.live.subMode).
 */
export function putCatalogDurableValues(input: {
	workspaceRoot: string;
	values: Record<string, unknown>;
}): PutCatalogDurableResult {
	for (const key of Object.keys(input.values)) {
		if (LIVE_KEYS.has(key as DriveFacetKey)) {
			return {
				ok: false,
				code: "live_key_rejected",
				message: `Cannot put live facet "${key}" to disk`,
			};
		}
		if (!(key in DRIVE_FACET_CATALOG)) {
			return {
				ok: false,
				code: "unknown_facet",
				message: `Unknown catalog facet "${key}"`,
			};
		}
		if (DRIVE_FACET_CATALOG[key as DriveFacetKey].lane !== "durable") {
			return {
				ok: false,
				code: "not_durable",
				message: `Facet "${key}" is not durable`,
			};
		}
		if (MAP_FACET_KEYS.has(key as DriveFacetKey)) {
			return {
				ok: false,
				code: "map_facet_rejected",
				message: `Facet "${key}" is a per-entity map; use its dedicated upsert command`,
			};
		}
	}

	const previous = readCatalogFile(input.workspaceRoot) ?? {
		schemaVersion: DRIVE_FACET_SCHEMA_VERSION,
		entries: {},
	};
	const entries = { ...previous.entries };
	for (const [key, value] of Object.entries(input.values)) {
		entries[key] = { kind: "value", value };
	}
	const next: DriveFacetDiskFile = {
		schemaVersion: DRIVE_FACET_SCHEMA_VERSION,
		entries,
	};
	writeCatalogFileAtomic(input.workspaceRoot, next);
	const store = loadCatalogFacetStore({ workspaceRoot: input.workspaceRoot });
	return { ok: true, snapshot: store.snapshot().durable };
}

export type UpsertAgentProfileResult =
	| { ok: true; profile: AgentProfile }
	| { ok: false; code: string; message: string };

/**
 * Persist one agent's appearance into the `agent.appearance` map.
 *
 * Merge-preserving on both axes: `...previous.entries` keeps every other facet
 * in the file, and `...existing.entries` keeps every other agent's appearance.
 * Neither is optional — the write is an atomic whole-file replace, so anything
 * not carried forward here is gone with no error and no warning.
 *
 * The voice lane (`facets.v1.json`, `drive_config_put`) is a different file
 * entirely, so a TTS change cannot reach these bytes.
 */
export function upsertAgentProfile(input: {
	workspaceRoot: string;
	ref: AgentRef;
	appearance: AgentAppearance;
}): UpsertAgentProfileResult {
	let appearance: AgentAppearance;
	try {
		appearance = parseAgentAppearance(input.appearance);
	} catch (error) {
		return {
			ok: false,
			code: "invalid_payload",
			message: error instanceof Error ? error.message : String(error),
		};
	}

	const id = agentProfileId(input.ref);
	const previous = readCatalogFile(input.workspaceRoot) ?? {
		schemaVersion: DRIVE_FACET_SCHEMA_VERSION,
		entries: {},
	};
	const existing = previous.entries["agent.appearance"];
	const mapEntries = existing?.kind === "map" ? { ...existing.entries } : {};
	mapEntries[id] = { kind: "value", value: appearance };

	const next: DriveFacetDiskFile = {
		schemaVersion: DRIVE_FACET_SCHEMA_VERSION,
		entries: {
			...previous.entries,
			"agent.appearance": { kind: "map", entries: mapEntries },
		},
	};
	writeCatalogFileAtomic(input.workspaceRoot, next);
	loadCatalogFacetStore({ workspaceRoot: input.workspaceRoot });
	return { ok: true, profile: { id, ref: input.ref, ...appearance } };
}

/** One agent's appearance, read back through the facet store's map lane. */
export function getAgentAppearance(input: {
	workspaceRoot: string;
	ref: AgentRef;
}): AgentAppearance {
	const store = loadCatalogFacetStore({ workspaceRoot: input.workspaceRoot });
	return store.get("agent.appearance", agentProfileId(input.ref));
}

/** Every stored agent profile, keyed back into full `AgentProfile` records. */
export function listAgentProfiles(workspaceRoot: string): AgentProfile[] {
	const store = loadCatalogFacetStore({ workspaceRoot });
	const ids = Object.keys(
		store.snapshot().durable.maps["agent.appearance"] ?? {},
	);
	const profiles: AgentProfile[] = [];
	for (const id of ids.sort()) {
		const profile = toAgentProfile(id, store.get("agent.appearance", id));
		// An id that is not a canonical ref key names no agent; skip rather than
		// invent a ref for it.
		if (profile) {
			profiles.push(profile);
		}
	}
	return profiles;
}

export function catalogSnapshotView(workspaceRoot: string): {
	durable: DriveFacetDiskSnapshot;
	live: Readonly<Partial<Record<DriveFacetKey, unknown>>>;
	defs: ReturnType<FacetStore["listDefs"]>;
} {
	const store = loadCatalogFacetStore({ workspaceRoot });
	const snap = store.snapshot();
	return {
		durable: snap.durable,
		live: snap.live,
		defs: store.listDefs(),
	};
}

/** @internal */
export function __resetCatalogFacetStoresForTests(): void {
	stores.clear();
}
