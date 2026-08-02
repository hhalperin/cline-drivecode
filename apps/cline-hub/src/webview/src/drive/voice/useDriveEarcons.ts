/**
 * Fires Drive earcons from call-state transitions (drive-audio slice 3).
 *
 * The hook holds no policy: it snapshots the signals, asks
 * `detectDriveEarcons()` what the transition earned, filters with
 * `shouldPlayDriveEarcon()`, and plays. Leaving the call drops the snapshot so
 * a rejoin re-hydrates silently instead of firing a burst.
 */

import type { DriveFacetValues } from "@cline/shared";
import { useEffect, useRef } from "react";
import {
	type DriveEarconSignals,
	detectDriveEarcons,
	driveEarconVolume,
	shouldPlayDriveEarcon,
} from "./driveEarcons";
import { playDriveEarcon, prefersReducedMotion } from "./playDriveEarcon";

/**
 * Id lists reach the effect as serialized keys, so a fresh-but-equal array from
 * the caller's render is not mistaken for a transition. Chat re-renders on
 * every streaming delta; only a real change may wake the effect.
 */
function toSignalKey(ids: readonly string[]): string {
	return JSON.stringify(ids);
}

function fromSignalKey(key: string): string[] {
	return JSON.parse(key) as string[];
}

export function useDriveEarcons(input: {
	active: boolean;
	facets: DriveFacetValues;
	/** True when Drive audio output is silenced (mute today, deafen later). */
	outputSilenced: boolean;
	outputVolume: number;
	speakerDeviceId: string | undefined;
	planId: string | null;
	openTaskIds: readonly string[];
	pendingApprovalIds: readonly string[];
	participantIds: readonly string[];
}): void {
	const previousRef = useRef<DriveEarconSignals | null>(null);
	/** Latest gate + playback settings, so only the signals retrigger. */
	const settingsRef = useRef(input);
	settingsRef.current = input;

	const active = input.active;
	const planId = input.planId;
	const openTaskKey = toSignalKey(input.openTaskIds);
	const approvalKey = toSignalKey(input.pendingApprovalIds);
	const participantKey = toSignalKey(input.participantIds);

	useEffect(() => {
		if (!active) {
			previousRef.current = null;
			return;
		}
		const next: DriveEarconSignals = {
			planId,
			openTaskIds: fromSignalKey(openTaskKey),
			pendingApprovalIds: fromSignalKey(approvalKey),
			participantIds: fromSignalKey(participantKey),
		};
		const kinds = detectDriveEarcons(previousRef.current, next);
		previousRef.current = next;
		if (kinds.length === 0) {
			return;
		}
		const settings = settingsRef.current;
		const reducedMotion = prefersReducedMotion();
		const allowed = kinds.filter((kind) =>
			shouldPlayDriveEarcon({
				kind,
				facets: settings.facets,
				outputSilenced: settings.outputSilenced,
				reducedMotion,
			}),
		);
		if (allowed.length === 0) {
			return;
		}
		const volume = driveEarconVolume(settings.outputVolume);
		void (async () => {
			// Sequential so a rare double transition reads as two tones, not a chord.
			for (const kind of allowed) {
				await playDriveEarcon({
					kind,
					volume,
					sinkId: settings.speakerDeviceId,
				});
			}
		})();
	}, [active, planId, openTaskKey, approvalKey, participantKey]);
}
