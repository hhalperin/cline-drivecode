import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type Dispatch,
	type SetStateAction,
} from "react";
import {
	applyBankSnapshot,
	applySubModeIntent,
	clearPostureOverride,
	DEFAULT_DRIVE_UI,
	toNativeMode,
	type DriveUiState,
} from "./types";
import {
	createDriveBankSession,
	listPlanTasks,
	seedDemoBank,
	type DriveBankSession,
} from "./bankSession";
import {
	applyVoiceFacetPatch,
	applyVoiceProfile,
	createDefaultDriveVoiceUi,
	resolveDriveVoiceTopology,
	type DriveVoiceUi,
} from "./voice/driveVoiceUi";
import { getVsCodeApi } from "../vscode";

function readPersistedDriveUi(): DriveUiState {
	try {
		const state = getVsCodeApi()?.getState() as
			| { driveUi?: DriveUiState }
			| undefined;
		if (state?.driveUi) {
			return {
				...DEFAULT_DRIVE_UI,
				...state.driveUi,
				bankSnapshot:
					state.driveUi.bankSnapshot ?? DEFAULT_DRIVE_UI.bankSnapshot,
				postureOverride: state.driveUi.postureOverride ?? null,
				spotlightParticipantId:
					state.driveUi.spotlightParticipantId ??
					DEFAULT_DRIVE_UI.spotlightParticipantId,
				partnerMuted:
					state.driveUi.partnerMuted ?? DEFAULT_DRIVE_UI.partnerMuted,
				partnerDeafened:
					state.driveUi.partnerDeafened ?? DEFAULT_DRIVE_UI.partnerDeafened,
			};
		}
	} catch {
		// ignore
	}
	return DEFAULT_DRIVE_UI;
}

function readPersistedDriveVoice(): DriveVoiceUi {
	try {
		const state = getVsCodeApi()?.getState() as
			| { driveVoice?: DriveVoiceUi }
			| undefined;
		if (state?.driveVoice?.facets && state.driveVoice.profile) {
			const defaults = createDefaultDriveVoiceUi(state.driveVoice.profile);
			return {
				...defaults,
				...state.driveVoice,
				facets: {
					...defaults.facets,
					...state.driveVoice.facets,
				},
			};
		}
	} catch {
		// ignore
	}
	return createDefaultDriveVoiceUi("cloud");
}

export type UseDriveSessionArgs = {
	providerId: string;
	sending: boolean;
	disabled: boolean;
	onModeChange: (mode: "act" | "plan") => void;
	onAbort: () => void;
	onStatus: (text: string) => void;
};

export type UseDriveSessionResult = {
	drive: DriveUiState;
	setDrive: Dispatch<SetStateAction<DriveUiState>>;
	driveVoice: DriveVoiceUi;
	setDriveVoice: Dispatch<SetStateAction<DriveVoiceUi>>;
	driveJoinNote: string | null;
	setDriveJoinNote: Dispatch<SetStateAction<string | null>>;
	voiceCaption: string;
	setVoiceCaption: Dispatch<SetStateAction<string>>;
	planEditorTasks: Array<{ id: string; title: string }>;
	setPlanEditorTasks: Dispatch<
		SetStateAction<Array<{ id: string; title: string }>>
	>;
	bankSessionRef: React.RefObject<DriveBankSession>;
	driveVoiceResolved: ReturnType<typeof resolveDriveVoiceTopology>;
	toggleDrive: () => void;
	toggleStage: () => void;
	stripHandlers: {
		onClearOverride: () => void;
		onHandToggle: () => void;
		onMuteToggle: () => void;
		onOpenSettings: () => void;
		onTogglePartnerDeafen: () => void;
		onTogglePartnerMute: () => void;
		onToggleSpotlight: () => void;
		onSubModeChange: (mode: DriveUiState["subMode"]) => void;
	};
};

export function useDriveSession(
	args: UseDriveSessionArgs,
): UseDriveSessionResult {
	const [drive, setDrive] = useState<DriveUiState>(readPersistedDriveUi);
	const [driveJoinNote, setDriveJoinNote] = useState<string | null>(null);
	const [driveVoice, setDriveVoice] = useState<DriveVoiceUi>(
		readPersistedDriveVoice,
	);
	const [voiceCaption, setVoiceCaption] = useState("");
	const bankSessionRef = useRef<DriveBankSession>(createDriveBankSession());
	const [planEditorTasks, setPlanEditorTasks] = useState<
		Array<{ id: string; title: string }>
	>([]);

	useEffect(() => {
		try {
			const api = getVsCodeApi();
			if (!api) {
				return;
			}
			const state = (api.getState() as Record<string, unknown>) ?? {};
			api.setState({ ...state, driveUi: drive, driveVoice });
		} catch {
			// ignore
		}
	}, [drive, driveVoice]);

	const driveVoiceResolved = useMemo(
		() =>
			resolveDriveVoiceTopology({
				voice: driveVoice,
				providerId: args.providerId,
			}),
		[driveVoice, args.providerId],
	);

	const toggleDrive = useCallback(() => {
		void (async () => {
			const current = drive;
			const nextActive = !current.active;
			if (nextActive) {
				const snapshot = await seedDemoBank(bankSessionRef.current);
				const tasks = snapshot.activePlanId
					? await listPlanTasks(
							bankSessionRef.current,
							snapshot.activePlanId,
						)
					: [];
				setPlanEditorTasks(tasks);
				setDriveJoinNote(
					`On the call. I am ${current.partnerName}. Share what you want to work on and I will drive.`,
				);
				const next = applyBankSnapshot(
					{ ...current, active: true },
					snapshot,
				);
				setDrive(next);
				args.onModeChange(toNativeMode(next.subMode));
				return;
			}
			setDriveJoinNote(null);
			setPlanEditorTasks([]);
			setDrive({
				...DEFAULT_DRIVE_UI,
				partnerName: current.partnerName,
			});
			args.onModeChange("act");
		})();
	}, [args, drive]);

	const toggleStage = useCallback(() => {
		setDrive((current) => ({
			...current,
			stageLayout: !current.stageLayout,
		}));
	}, []);

	const stripHandlers = useMemo(
		() => ({
			onClearOverride: () => {
				setDrive((current) => {
					const next = clearPostureOverride(current);
					args.onModeChange(toNativeMode(next.subMode));
					return next;
				});
			},
			onHandToggle: () => {
				setDrive((current) => {
					const handRaised = !current.handRaised;
					if (handRaised && args.sending) {
						args.onAbort();
						args.onStatus("Drive hand-raise: abort requested...");
					}
					return { ...current, handRaised };
				});
			},
			onMuteToggle: () => {
				setDrive((current) => ({ ...current, muted: !current.muted }));
			},
			onOpenSettings: () => {
				setDriveVoice((current) => ({
					...current,
					settingsOpen: !current.settingsOpen,
				}));
			},
			onTogglePartnerDeafen: () => {
				setDrive((current) => ({
					...current,
					partnerDeafened: !current.partnerDeafened,
				}));
			},
			onTogglePartnerMute: () => {
				setDrive((current) => ({
					...current,
					partnerMuted: !current.partnerMuted,
				}));
			},
			onToggleSpotlight: () => {
				setDrive((current) => ({
					...current,
					spotlightParticipantId:
						current.spotlightParticipantId === "partner"
							? "human"
							: "partner",
				}));
			},
			onSubModeChange: (subMode: DriveUiState["subMode"]) => {
				setDrive((current) => {
					const next = applySubModeIntent(current, subMode);
					args.onModeChange(toNativeMode(next.subMode));
					return next;
				});
			},
		}),
		[args],
	);

	return {
		drive,
		setDrive,
		driveVoice,
		setDriveVoice,
		driveJoinNote,
		setDriveJoinNote,
		voiceCaption,
		setVoiceCaption,
		planEditorTasks,
		setPlanEditorTasks,
		bankSessionRef,
		driveVoiceResolved,
		toggleDrive,
		toggleStage,
		stripHandlers,
	};
}

// Re-export for settings panel wiring without Chat knowing voice helpers.
export { applyVoiceFacetPatch, applyVoiceProfile };
