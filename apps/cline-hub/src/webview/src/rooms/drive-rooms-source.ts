import type { DriveRoomDirectoryEntry } from "@cline/drive";

/**
 * Port for the Rooms page. Live hub or demo adapter — the view must not read
 * CLINE_DEMO_* or query params itself (same rule as the Status Hub sources;
 * the composition root decides which adapter it gets).
 *
 * Only `stopRoom` writes, and it writes by asking the hub to end the call —
 * the hub stays the single writer of room state (ADR-0000 D2).
 */
export interface DriveRoomsSource {
	listRooms(): Promise<DriveRoomDirectoryEntry[]>;
	/** End the live call. Keeps the room, its config and its history. */
	stopRoom(roomId: string): Promise<void>;
}
