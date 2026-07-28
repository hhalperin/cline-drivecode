import { cn } from "@/lib/utils";
import type { DriveUiState } from "../types";

export function StickyStagePane({
	drive,
	title,
	caption,
	className,
}: {
	drive: DriveUiState;
	title?: string;
	caption?: string;
	className?: string;
}) {
	if (!drive.active || !drive.stageLayout) {
		return null;
	}

	const spotlightLabel =
		drive.spotlightParticipantId === "human" ? "You" : drive.partnerName;

	return (
		<div
			className={cn(
				"flex min-h-[12rem] flex-col rounded-md border border-amber-500/30 bg-amber-500/5 p-3",
				className,
			)}
		>
			<div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
				<span>
					Spotlight · <span className="font-medium text-foreground">{spotlightLabel}</span>
				</span>
				<span>
					{drive.partnerMuted ? "partner muted · " : ""}
					{drive.partnerDeafened ? "partner deafened · " : ""}
					sticky stage
				</span>
			</div>
			<div className="flex flex-1 flex-col justify-center gap-2">
				<p className="text-sm font-medium">
					{title ?? "No sticky artifact yet"}
				</p>
				<p className="text-xs text-muted-foreground">
					{caption ??
						"Planner/screen manager will mount diagrams, walkthroughs, and demos here. Artifacts stay sticky across narration beats."}
				</p>
			</div>
		</div>
	);
}
