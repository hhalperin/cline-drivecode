import { resolveAddress } from "@cline/drive";
import type { RoomSnapshot } from "@cline/shared";
import type { HubContext } from "./state";

export type SpeakerAttributionSnapshot = Pick<
	RoomSnapshot,
	"addressSet" | "participants"
>;

/** The slice of {@link HubContext} the turn-speaker lifecycle touches. */
export type TurnSpeakerStore = Pick<HubContext, "turnSpeakerBySessionId">;

/**
 * The seated agent an assistant turn can honestly be attributed to.
 *
 * Only an address that resolves to exactly one seated agent yields an id.
 * Seating creates no runtime — `call_seat` commits room metadata and a single
 * Cline runtime sits behind the feed — so once two or more agents are
 * addressed there is no signal saying which one produced the reply. Returning
 * undefined there leaves the byline absent instead of guessing.
 */
export function resolveAddressedSpeakerId(
	snapshot: SpeakerAttributionSnapshot | undefined | null,
): string | undefined {
	if (!snapshot?.addressSet || !Array.isArray(snapshot.participants)) {
		return undefined;
	}
	const resolved = resolveAddress({
		addressSet: snapshot.addressSet,
		participants: snapshot.participants,
	});
	if (!resolved.ok || resolved.participantIds.length !== 1) {
		return undefined;
	}
	return resolved.participantIds[0];
}

/**
 * Look up the addressed speaker for a session's linked Drive room.
 *
 * Mirrors the `call_get_room` round trip the voice mute gate already uses —
 * the hub keeps no roster of its own, participants only ever pass through it.
 * Any failure (no room, no UI client, malformed reply) resolves to undefined
 * so an unattributed turn stays unattributed.
 */
export async function readAddressedSpeakerId(
	ctx: HubContext,
	sessionId: string | undefined,
): Promise<string | undefined> {
	if (!sessionId || !ctx.uiClient) {
		return undefined;
	}
	try {
		const reply = await ctx.uiClient.command("call_get_room", { sessionId });
		if (!reply.ok) {
			return undefined;
		}
		const snapshot = reply.payload?.snapshot as
			| SpeakerAttributionSnapshot
			| undefined;
		if (!snapshot || typeof snapshot !== "object") {
			return undefined;
		}
		return resolveAddressedSpeakerId(snapshot);
	} catch {
		return undefined;
	}
}

/**
 * Record (or clear) who the assistant turn about to start belongs to.
 * Clearing on an unresolved address is deliberate: a stale id from the
 * previous turn would attribute this reply to the wrong agent.
 */
export function setTurnSpeaker(
	ctx: TurnSpeakerStore,
	sessionId: string,
	speakerId: string | undefined,
): void {
	if (speakerId) {
		ctx.turnSpeakerBySessionId.set(sessionId, speakerId);
		return;
	}
	ctx.turnSpeakerBySessionId.delete(sessionId);
}

/**
 * Drop the attribution when the turn ends.
 *
 * Attribution is only valid for the turn it was resolved for. A turn that
 * starts by some other route — a queued prompt, a resumed session — would
 * otherwise inherit the previous turn's agent and be labelled with a name
 * nothing verified. Also keeps the map bounded to in-flight turns.
 */
export function clearTurnSpeaker(
	ctx: TurnSpeakerStore,
	sessionId: string,
): void {
	ctx.turnSpeakerBySessionId.delete(sessionId);
}
