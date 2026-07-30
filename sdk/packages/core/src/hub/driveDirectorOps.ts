/**
 * Director show ops over DriveRoomStore (host commit path).
 * Show runtime lives in driveShowRuntime (handlers must not import this file).
 */

import { normalizeEnqueuedShowStatus } from "@cline/drive";
import type { ShowBacklogItem } from "@cline/shared";
import {
	getDriveRoomStore,
	type DriveRoomStore,
} from "./collaboration";
import {
	applyPresentedShow,
	materializeShowItem,
	runShowDirectorTick,
} from "./driveShowRuntime";

type DriveLiveRoom = ReturnType<DriveRoomStore["getOrCreateLive"]>;

export type DirectorCommitResult = {
	room: DriveLiveRoom;
	presented: ShowBacklogItem | null;
	planned: ShowBacklogItem | null;
};

export function enqueueShowOnStore(input: {
	roomId: string;
	showItem: ShowBacklogItem;
	presentNow?: boolean;
	demoCapture?: boolean;
	store?: DriveRoomStore;
}): DirectorCommitResult {
	const store = input.store ?? getDriveRoomStore();
	store.create(input.roomId);
	const room = store.getOrCreateLive(input.roomId);
	const status = normalizeEnqueuedShowStatus(input.showItem.status);
	const enqueued: ShowBacklogItem = {
		...input.showItem,
		status,
	};
	const showBacklog = [
		enqueued,
		...room.director.showBacklog.filter((item) => item.id !== enqueued.id),
	];
	let next = store.setLive({
		...room,
		director: {
			...room.director,
			showBacklog,
		},
	});
	let presented: ShowBacklogItem | null = null;
	if (input.presentNow) {
		const tick = runShowDirectorTick({
			room: next,
			preferShowId: enqueued.id,
			demoCapture: input.demoCapture,
		});
		next = store.setLive(tick.room);
		presented = tick.presented;
	}
	return { room: next, presented, planned: enqueued };
}

export function presentShowOnStore(input: {
	roomId: string;
	showItem: ShowBacklogItem;
	demoCapture?: boolean;
	store?: DriveRoomStore;
}): DirectorCommitResult {
	const store = input.store ?? getDriveRoomStore();
	store.create(input.roomId);
	const room = store.getOrCreateLive(input.roomId);
	const materialized =
		input.showItem.uri && input.showItem.status === "showing"
			? input.showItem
			: materializeShowItem(input.showItem, {
					demoCapture: input.demoCapture,
				});
	if (!materialized.uri) {
		return { room, presented: null, planned: null };
	}
	const next = store.setLive(
		applyPresentedShow(room, { ...materialized, status: "showing" }, {
			demoCapture: input.demoCapture,
		}),
	);
	const presented =
		next.director.showBacklog.find((item) => item.id === materialized.id) ??
		null;
	return { room: next, presented, planned: null };
}

export function tickShowOnStore(input: {
	roomId: string;
	preferShowId?: string | null;
	demoCapture?: boolean;
	store?: DriveRoomStore;
}): DirectorCommitResult {
	const store = input.store ?? getDriveRoomStore();
	store.create(input.roomId);
	const room = store.getOrCreateLive(input.roomId);
	const tick = runShowDirectorTick({
		room,
		preferShowId: input.preferShowId,
		demoCapture: input.demoCapture,
	});
	if (!tick.presented) {
		return { room, presented: null, planned: null };
	}
	const next = store.setLive(tick.room);
	return { room: next, presented: tick.presented, planned: null };
}
