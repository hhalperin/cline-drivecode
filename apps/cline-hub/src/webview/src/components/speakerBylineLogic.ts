import type { Participant } from "@cline/shared";

/**
 * Resolve the byline shown above a feed message.
 *
 * Returns null whenever the speaker is unknown, and the caller must then
 * render no byline element at all — not an empty one, not a placeholder.
 *
 * Most messages land here with no `speakerId`. Seating an agent creates no
 * runtime (`call_seat` commits room metadata only, and exactly one Cline
 * runtime sits behind the feed), so attribution exists only for a turn the
 * hub could tie to a single addressed agent. Defaulting the rest to the
 * partner — or to "Cline", which is usually right — would be a guess that
 * reads as a working feature, so it is not done here.
 *
 * An id that no longer matches a seated participant also returns null: the
 * raw id is not a name, and printing `drive:partner` is not attribution.
 */
export function resolveSpeakerByline(
	speakerId: string | undefined,
	participants: readonly Participant[] | undefined,
): string | null {
	const id = speakerId?.trim();
	if (!id || !participants?.length) {
		return null;
	}
	const displayName = participants
		.find((participant) => participant.id === id)
		?.displayName?.trim();
	return displayName ? displayName : null;
}
