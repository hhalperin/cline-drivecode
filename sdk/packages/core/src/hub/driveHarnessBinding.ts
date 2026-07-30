/**
 * Hub-side DriveHarness binding — single writer via createClineDriveHost.
 */

import { createDriveHarness, type DriveHarness } from "@cline/drive";
import type { DriveEvent, RoomSnapshot } from "@cline/shared";
import { tmpdir } from "node:os";
import { createClineDriveHost } from "./clineDriveHost";
import {
	type DriveRoomStore,
	getDriveRoomStore,
} from "./collaboration";
import { resolvePackFromRegistry } from "./drive-config/driveRegistryStore";

export type HubRoomCommit = {
	event: DriveEvent;
	snapshot: RoomSnapshot;
	seq: number;
};

type HubHarnessBinding = {
	harness: DriveHarness;
	lastCommit: HubRoomCommit | null;
	configParent: string;
};

const bindings = new WeakMap<DriveRoomStore, HubHarnessBinding>();

/**
 * DriveHarness over the process-wide room store (and optional config parent).
 * Room commits update `lastCommit` for hub publishRoomEvent.
 * `resolveRosterPack` reads durable `registry.v1.json` under configParent.
 */
export function getHubDriveHarness(input?: {
	store?: DriveRoomStore;
	configParent?: string;
}): HubHarnessBinding {
	const store = input?.store ?? getDriveRoomStore();
	const existing = bindings.get(store);
	if (existing) {
		const nextParent = input?.configParent?.trim();
		if (nextParent) {
			existing.configParent = nextParent;
		}
		return existing;
	}

	const binding: HubHarnessBinding = {
		harness: null as unknown as DriveHarness,
		lastCommit: null,
		configParent: input?.configParent?.trim() || tmpdir(),
	};

	const host = createClineDriveHost({
		configParent: binding.configParent,
		store,
		broadcastFn: (event) => {
			const snapshot = store.get(event.roomId);
			if (!snapshot) {
				return;
			}
			binding.lastCommit = {
				event,
				snapshot,
				seq: store.lastSeq(event.roomId),
			};
		},
	});

	binding.harness = createDriveHarness({
		host,
		resolveRosterPack: (packId) =>
			resolvePackFromRegistry(binding.configParent, packId),
	});
	bindings.set(store, binding);
	return binding;
}

export function takeHubRoomCommit(store: DriveRoomStore = getDriveRoomStore()): HubRoomCommit | null {
	const binding = bindings.get(store);
	if (!binding?.lastCommit) {
		return null;
	}
	const commit = binding.lastCommit;
	binding.lastCommit = null;
	return commit;
}
