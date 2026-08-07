/**
 * Consumer (`?app=1`) call chrome — thin strip + hold-to-talk primacy.
 * Hub desktop keeps the full strip; this list is the one-hand reach set.
 */
export const APP_STRIP_CONTROLS = [
	"mic",
	"hand",
	"captions",
	"leave",
] as const;

export type AppStripControl = (typeof APP_STRIP_CONTROLS)[number];

/**
 * After a hold that temp-unmuted, always remute via toggle — do not trust
 * React `muted` props that may lag the optimistic unmute.
 */
export function muteRestoreAfterHold(input: {
	unmutedByHold: boolean;
}): "mute" | "noop" {
	return input.unmutedByHold ? "mute" : "noop";
}

if (import.meta.main) {
	console.assert(
		APP_STRIP_CONTROLS.length === 4 && APP_STRIP_CONTROLS[0] === "mic",
		"app strip stays four reach targets",
	);
	console.assert(
		muteRestoreAfterHold({ unmutedByHold: true }) === "mute",
		"restore mute after hold unmute",
	);
	console.assert(
		muteRestoreAfterHold({ unmutedByHold: false }) === "noop",
		"skip restore when hold did not unmute",
	);
}
