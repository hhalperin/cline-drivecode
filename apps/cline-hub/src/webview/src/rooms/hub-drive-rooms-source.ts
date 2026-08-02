import type { DriveRoomDirectoryEntry } from "@cline/drive";
import { DRIVE_PARTICIPANT_HUMAN } from "../drive/types";
import {
	type HostMessage,
	isOptionalString,
	subscribeToHostMessages,
} from "../lib/host-message-gateway";
import { postToHost } from "../vscode";
import type { DriveRoomsSource } from "./drive-rooms-source";
import { roomDirectoryEntryFromUnknown } from "./roomCardModel";

const TIMEOUT_MS = 5_000;

const ROOMS_REPLY_TYPES = ["drive_rooms", "drive_rooms_error"] as const;

type RoomsReply = HostMessage & {
	type: "drive_rooms" | "drive_rooms_error";
	requestId?: string;
	rooms?: unknown[];
	text?: string;
};

function isRoomsReply(message: HostMessage): message is RoomsReply {
	return (
		(message.type === "drive_rooms" || message.type === "drive_rooms_error") &&
		isOptionalString(message.requestId) &&
		(message.rooms === undefined || Array.isArray(message.rooms)) &&
		isOptionalString(message.text)
	);
}

const STOP_REPLY_TYPES = ["room_snapshot", "call_error"] as const;

type StopReply = HostMessage & {
	type: "room_snapshot" | "call_error";
	roomId?: string;
	command?: string;
	text?: string;
};

/**
 * `call_end` has no requestId on the wire; `room_snapshot` correlates by
 * roomId and `call_error` by the command that failed.
 */
export function isRoomStopReply(message: HostMessage): message is StopReply {
	return (
		(message.type === "room_snapshot" || message.type === "call_error") &&
		isOptionalString(message.roomId) &&
		isOptionalString(message.command) &&
		isOptionalString(message.text)
	);
}

export function roomStopReplyMatches(
	message: StopReply,
	roomId: string,
): boolean {
	if (message.type === "call_error") {
		return message.command === "call_end";
	}
	return message.roomId === roomId;
}

/**
 * Live hub adapter: reads the durable room directory via `call_list_rooms`.
 * Read-only — Stop and Start are separate call_end / call_join ops so the hub
 * stays the single writer of room state (ADR-0000 D2).
 */
export class HubDriveRoomsSource implements DriveRoomsSource {
	private readonly getWorkspaceRoot: () => string | undefined;

	constructor(getWorkspaceRoot: () => string | undefined) {
		this.getWorkspaceRoot = getWorkspaceRoot;
	}

	listRooms(): Promise<DriveRoomDirectoryEntry[]> {
		const requestId = `drive-rooms-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const workspaceRoot = this.getWorkspaceRoot()?.trim();

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				unsubscribe();
				reject(new Error("call_list_rooms timed out"));
			}, TIMEOUT_MS);

			const unsubscribe = subscribeToHostMessages({
				types: ROOMS_REPLY_TYPES,
				guard: isRoomsReply,
				onMessage: (message) => {
					if (message.requestId !== requestId) {
						return;
					}
					clearTimeout(timer);
					unsubscribe();
					if (message.type === "drive_rooms_error") {
						reject(new Error(message.text?.trim() || "call_list_rooms failed"));
						return;
					}
					const entries: DriveRoomDirectoryEntry[] = [];
					for (const raw of message.rooms ?? []) {
						const entry = roomDirectoryEntryFromUnknown(raw);
						if (entry) {
							entries.push(entry);
						}
					}
					resolve(entries);
				},
			});

			postToHost({
				type: "call_list_rooms",
				requestId,
				...(workspaceRoot ? { workspaceRoot } : {}),
			});
		});
	}

	stopRoom(roomId: string): Promise<void> {
		const workspaceRoot = this.getWorkspaceRoot()?.trim();

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				unsubscribe();
				reject(new Error("call_end timed out"));
			}, TIMEOUT_MS);

			const unsubscribe = subscribeToHostMessages({
				types: STOP_REPLY_TYPES,
				guard: isRoomStopReply,
				onMessage: (message) => {
					if (!roomStopReplyMatches(message, roomId)) {
						return;
					}
					clearTimeout(timer);
					unsubscribe();
					if (message.type === "call_error") {
						reject(new Error(message.text?.trim() || "call_end failed"));
						return;
					}
					resolve();
				},
			});

			postToHost({
				type: "call_end",
				roomId,
				actorId: DRIVE_PARTICIPANT_HUMAN,
				...(workspaceRoot ? { workspaceRoot } : {}),
			});
		});
	}
}
