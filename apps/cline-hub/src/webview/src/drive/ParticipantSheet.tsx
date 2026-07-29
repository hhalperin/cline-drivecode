/** Participant sheet chooser + profile strip (DRV-PARTICIPANT-SHEET MVP). */

import type { Participant } from "@cline/shared";
import { HandIcon, MicOffIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	isRosterParticipantHandRaised,
	isRosterParticipantMuted,
	participantStatusLabel,
} from "./rosterHelpers";
import type { DriveUiState } from "./types";

export type ParticipantSheetMode = "chooser" | "profile";

export function ParticipantSheet({
	open,
	mode,
	participant,
	drive,
	onOpenChange,
	onChooseTranscript,
	onChooseProfile,
}: {
	open: boolean;
	mode: ParticipantSheetMode;
	participant: Participant | null;
	drive: DriveUiState;
	onOpenChange: (open: boolean) => void;
	onChooseTranscript: () => void;
	onChooseProfile: () => void;
}) {
	if (!participant) {
		return null;
	}

	const muted = isRosterParticipantMuted(drive, participant);
	const handRaised = isRosterParticipantHandRaised(drive, participant);
	const title =
		mode === "chooser"
			? participant.displayName
			: `${participant.displayName} · Profile`;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					{mode === "chooser" ? (
						<DialogDescription>
							Choose Transcript to focus this stream, or Profile to
							inspect without changing address.
						</DialogDescription>
					) : (
						<DialogDescription>
							Read-only projection of hub roster state.
						</DialogDescription>
					)}
				</DialogHeader>

				{mode === "chooser" ? (
					<div className="flex flex-col gap-2">
						<Button
							className="justify-start"
							onClick={onChooseTranscript}
							type="button"
							variant="outline"
						>
							Transcript
						</Button>
						<Button
							className="justify-start"
							onClick={onChooseProfile}
							type="button"
							variant="outline"
						>
							Profile
						</Button>
					</div>
				) : (
					<ParticipantProfileBody
						drive={drive}
						handRaised={handRaised}
						muted={muted}
						participant={participant}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function ParticipantProfileBody({
	participant,
	drive,
	muted,
	handRaised,
}: {
	participant: Participant;
	drive: DriveUiState;
	muted: boolean;
	handRaised: boolean;
}) {
	const liveBits: string[] = [participantStatusLabel(participant.status)];
	if (muted) {
		liveBits.push("muted");
	}
	if (handRaised) {
		liveBits.push("hand raised");
	}
	if (
		participant.kind === "agent" &&
		drive.focusedParticipantId === participant.id
	) {
		liveBits.push("transcript focused");
	}

	return (
		<div className="space-y-3">
			{/* Classifier strip */}
			<div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-2">
				<Badge className="capitalize" variant="outline">
					{participant.kind}
				</Badge>
				<Badge className="capitalize" variant="secondary">
					{participant.role}
				</Badge>
				{muted ? (
					<Badge className="gap-1" variant="destructive">
						<MicOffIcon className="size-3" />
						muted
					</Badge>
				) : null}
				{handRaised ? (
					<Badge className="gap-1" variant="outline">
						<HandIcon className="size-3" />
						hand
					</Badge>
				) : null}
				<span className="text-xs text-muted-foreground">
					{liveBits.join(" · ")}
				</span>
			</div>
			<div>
				<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
					Display name
				</div>
				<div className="text-sm font-medium">{participant.displayName}</div>
			</div>
		</div>
	);
}
