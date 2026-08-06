/**
 * Power cockpit sheet — roster task lines + chrome density (PU0).
 * Stop-one / spend land in later roadmap slices.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	readDrivePowerChrome,
	writeDrivePowerChrome,
} from "../lib/drive-power-chrome";
import { AgentAvatar } from "./AgentAvatar";
import { resolveParticipantNameInk, useDriveInkTheme } from "./agentInk";
import {
	participantStatusLabel,
	resolveRosterParticipants,
} from "./rosterHelpers";
import { rosterParticipantTaskLine } from "./rosterTaskLine";
import type { DriveUiState } from "./types";

export function DrivePowerSheet({
	drive,
	open,
	onOpenChange,
	powerChrome,
	onPowerChromeChange,
}: {
	drive: DriveUiState;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	powerChrome: boolean;
	onPowerChromeChange: (enabled: boolean) => void;
}) {
	const participants = resolveRosterParticipants(drive);
	const inkTheme = useDriveInkTheme();
	const nowTitle = drive.bankSnapshot.nowTitle?.trim() || null;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-w-md gap-0 p-0 sm:max-w-md">
				<DialogHeader className="border-b px-4 py-3 text-left">
					<DialogTitle>Power</DialogTitle>
					<DialogDescription>
						Cockpit density for phone pilots. Spotlight stays full-bleed —
						instruments live here.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center justify-between gap-3 border-b px-4 py-3">
					<div className="min-w-0">
						<Label className="text-sm font-medium" htmlFor="power-chrome">
							Power chrome
						</Label>
						<p className="text-xs text-muted-foreground">
							Remember denser roster lines on this device.
						</p>
					</div>
					<Switch
						checked={powerChrome}
						id="power-chrome"
						onCheckedChange={onPowerChromeChange}
					/>
				</div>

				<div className="border-b px-4 py-3">
					<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						Session spend
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{/* Honest empty — usage not wired into call chrome yet (PU4). */}
						Spend appears here when this call has measured usage.
					</p>
				</div>

				{nowTitle ? (
					<div className="border-b px-4 py-3">
						<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
							Now
						</p>
						<p className="mt-1 text-sm font-medium">{nowTitle}</p>
					</div>
				) : null}

				<ul aria-label="Roster task lines" className="max-h-64 overflow-y-auto">
					{participants.map((participant) => {
						const task = rosterParticipantTaskLine(drive, participant);
						const ink = resolveParticipantNameInk({
							drive,
							participant,
							theme: inkTheme,
						});
						return (
							<li
								className="flex items-start gap-2.5 border-b border-border/60 px-4 py-2.5 last:border-b-0"
								key={participant.id}
							>
								<AgentAvatar
									className="mt-0.5"
									ink={ink}
									participant={participant}
									size="sm"
								/>
								<div className="min-w-0 flex-1">
									<div className="flex min-w-0 items-baseline gap-2">
										<span
											className="truncate text-sm font-medium"
											style={ink ? { color: ink } : undefined}
										>
											{participant.displayName}
										</span>
										<span className="shrink-0 text-[10px] capitalize text-muted-foreground">
											{participantStatusLabel(participant.status)}
										</span>
									</div>
									{task ? (
										<p className="mt-0.5 truncate text-xs text-foreground/80">
											{task}
										</p>
									) : (
										<p className="mt-0.5 text-xs text-muted-foreground">
											No task line
										</p>
									)}
								</div>
								{/* PU3: Stop / Redirect — not wired yet */}
								{participant.kind === "agent" && powerChrome ? (
									<Button
										className="shrink-0 text-destructive"
										disabled
										size="sm"
										title="Stop one worker — coming in PU3"
										type="button"
										variant="ghost"
									>
										Stop
									</Button>
								) : null}
							</li>
						);
					})}
				</ul>
			</DialogContent>
		</Dialog>
	);
}

/** Hook-friendly helpers for strip dock without forcing Dialog into every parent. */
export function useDrivePowerChromePref(): {
	powerChrome: boolean;
	setPowerChrome: (enabled: boolean) => void;
} {
	const [powerChrome, setPowerChromeState] = useState(readDrivePowerChrome);
	return {
		powerChrome,
		setPowerChrome: (enabled: boolean) => {
			writeDrivePowerChrome(enabled);
			setPowerChromeState(enabled);
		},
	};
}
