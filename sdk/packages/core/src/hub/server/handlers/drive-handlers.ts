import {
	advanceScriptBeat,
	assertDeliveryAllowed,
	DEFAULT_SHOW_PLANNER_COOLDOWN_MS,
	normalizeEnqueuedShowStatus,
	planShowIntents,
	setParticipantDeafened,
	setParticipantMuted,
	type ShowPlannerMode,
	workCategoryFromKind,
} from "@cline/drive";
import type {
	HubCommandEnvelope,
	HubReplyEnvelope,
	StageSharer,
} from "@cline/shared";
import {
	DirectorScriptSchema,
	DoBacklogItemSchema,
	type ShowBacklogItem,
	ShowBacklogItemSchema,
} from "@cline/shared";
import {
	getDriveRoomStore,
	resetDriveRoomStoreForTests,
} from "../../collaboration";
import { getHubDriveHarness } from "../../driveHarnessBinding";
import {
	applyPresentedShow,
	type DriveLiveRoom,
	runShowDirectorTick,
} from "../../driveShowRuntime";
import { errorReply, type HubTransportContext, okReply } from "./context";

export {
	addressedParticipantIdsFromAddressSet,
	materializeShowItem,
	runShowDirectorTick,
	type MaterializeShowOptions,
} from "../../driveShowRuntime";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(
	payload: Record<string, unknown> | undefined,
	key: string,
): boolean | undefined {
	const value = payload?.[key];
	return typeof value === "boolean" ? value : undefined;
}

type ShowExtraEvent =
	| {
			event: "drive.spotlight.changed";
			payload: Record<string, unknown>;
	  }
	| {
			event: "drive.show.presented";
			payload: Record<string, unknown>;
	  }
	| {
			event: "drive.show.planned";
			payload: Record<string, unknown>;
	  }
	| {
			event: "drive.script.beat";
			payload: Record<string, unknown>;
	  };

function publishRoom(
	ctx: HubTransportContext,
	room: DriveLiveRoom,
	extraEvent?: ShowExtraEvent,
): void {
	ctx.publish(
		ctx.buildEvent("drive.room.changed", {
			room: room as unknown as Record<string, unknown>,
		}),
	);
	if (extraEvent) {
		ctx.publish(ctx.buildEvent(extraEvent.event, extraEvent.payload));
	}
}

function asLiveRoom(liveRoom: unknown): DriveLiveRoom {
	return liveRoom as DriveLiveRoom;
}

/**
 * Heuristic show planner: enqueue template intents from a work signal.
 * Optionally ticks the show director when tickOnWork is enabled (default).
 */
export function runShowPlannerFromWork(input: {
	room: DriveLiveRoom;
	workKind: "edit" | "command" | "test_result";
	ownerParticipantId: string;
	nowMs?: number;
}): {
	room: DriveLiveRoom;
	planned: ShowBacklogItem[];
	reasons: string[];
	presented: ShowBacklogItem | null;
} {
	const mode: ShowPlannerMode =
		input.room.director.showPlannerMode === "off" ? "off" : "heuristic";
	const cooldownMs =
		input.room.director.showPlannerCooldownMs ??
		DEFAULT_SHOW_PLANNER_COOLDOWN_MS;
	const nowMs = input.nowMs ?? Date.now();
	const plannedResult = planShowIntents({
		signal: {
			kind: "work",
			category: workCategoryFromKind(input.workKind),
		},
		ownerParticipantId: input.ownerParticipantId,
		existingShowBacklog: input.room.director.showBacklog,
		nowMs,
		lastEnqueuedAtByTemplate:
			input.room.director.showPlannerLastAtByTemplate ?? {},
		cooldownMs,
		mode,
	});
	if (plannedResult.items.length === 0) {
		return {
			room: input.room,
			planned: [],
			reasons: plannedResult.reasons,
			presented: null,
		};
	}

	const enqueuedAt = new Date(nowMs).toISOString();
	const lastAt = {
		...(input.room.director.showPlannerLastAtByTemplate ?? {}),
	};
	for (const item of plannedResult.items) {
		const templateId = item.produce.templateId;
		if (templateId) {
			lastAt[templateId] = enqueuedAt;
		}
	}

	const showBacklog = [
		...plannedResult.items,
		...input.room.director.showBacklog.filter(
			(existing) =>
				!plannedResult.items.some((item) => item.id === existing.id),
		),
	];
	let room: DriveLiveRoom = {
		...input.room,
		director: {
			...input.room.director,
			showBacklog,
			showPlannerLastAtByTemplate: lastAt,
		},
	};

	const archItem = plannedResult.items.find(
		(item) => item.produce.templateId === "arch.overview",
	);
	if (archItem && !room.director.activeScript) {
		const script = {
			scriptId: `planner_${archItem.id}`,
			ownerParticipantId: input.ownerParticipantId,
			title: "Architecture walkthrough",
			stickyShowIds: [archItem.id],
			beats: [
				{
					beatId: "planner-arch-1",
					say: "Here is the architecture overview.",
					showItemId: archItem.id,
					sticky: { mode: "hold" as const },
					advance: "on_human" as const,
				},
				{
					beatId: "planner-arch-2",
					say: "Still on the architecture diagram — advance when ready.",
					showItemId: archItem.id,
					sticky: { mode: "hold" as const },
					advance: "on_human" as const,
				},
			],
		};
		room = {
			...room,
			director: {
				...room.director,
				activeScript: script,
				activeBeatId: "planner-arch-1",
				activeShowId: archItem.id,
				stickyShowIds: [
					archItem.id,
					...room.director.stickyShowIds.filter((id) => id !== archItem.id),
				],
			},
		};
	}

	const tickOnWork = input.room.director.tickOnWork !== false;
	let presented: ShowBacklogItem | null = null;
	if (tickOnWork) {
		const tick = runShowDirectorTick({
			room,
			preferShowId: plannedResult.items[0]?.id,
		});
		room = tick.room;
		presented = tick.presented;
	}

	return {
		room,
		planned: plannedResult.items,
		reasons: plannedResult.reasons,
		presented,
	};
}

export async function handleDriveCommand(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	switch (envelope.command) {
		case "drive.room.get":
			return handleRoomGet(envelope);
		case "drive.spotlight.set":
			return handleSpotlightSet(ctx, envelope);
		case "drive.participant.mute.set":
			return handleMuteSet(ctx, envelope);
		case "drive.participant.deafen.set":
			return handleDeafenSet(ctx, envelope);
		case "drive.show.present":
			return await handleShowPresent(ctx, envelope);
		case "drive.show.enqueue":
			return await handleShowEnqueue(ctx, envelope);
		case "drive.show.tick":
			return await handleShowTick(ctx, envelope);
		case "drive.do.enqueue":
			return handleDoEnqueue(ctx, envelope);
		case "drive.planner.set":
			return handlePlannerSet(ctx, envelope);
		case "drive.script.attach":
			return handleScriptAttach(ctx, envelope);
		case "drive.script.advance":
			return handleScriptAdvance(ctx, envelope);
		default:
			return errorReply(envelope, "not_implemented", "Unknown drive command");
	}
}

function handleRoomGet(envelope: HubCommandEnvelope): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const store = getDriveRoomStore();
	store.create(roomId);
	return okReply(envelope, { room: store.getOrCreateLive(roomId) });
}

function handleSpotlightSet(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const participantId = readString(envelope.payload, "participantId");
	const reason = readString(envelope.payload, "reason") ?? "human";
	if (!participantId) {
		return errorReply(envelope, "invalid_payload", "participantId is required");
	}
	const store = getDriveRoomStore();
	store.create(roomId);
	const snapshot = store.get(roomId);
	const live = store.getOrCreateLive(roomId);
	const seated = new Set(
		snapshot?.participants.map((p) => p.id) ?? live.seatedParticipantIds,
	);
	if (seated.size === 0) {
		seated.add(participantId);
	} else if (!seated.has(participantId)) {
		return errorReply(
			envelope,
			"not_seated",
			`Participant ${participantId} is not seated`,
		);
	}

	const fromSnapshot = snapshot?.participants.find((p) => p.id === participantId);
	const kind: StageSharer["kind"] =
		fromSnapshot?.kind === "human" ||
		participantId === "drive:human" ||
		participantId === "human" ||
		participantId === "you"
			? "human"
			: "agent";
	const sharer: StageSharer = { kind, participantId };
	const from = live.spotlightParticipantId;

	const committed = store.setStage({
		roomId,
		sharer,
		pin: null,
		actorId: participantId,
	});
	const next = store.getOrCreateLive(roomId);
	publishRoom(ctx, next, {
		event: "drive.spotlight.changed",
		payload: {
			from,
			to: next.spotlightParticipantId,
			reason,
			via: "call_set_stage",
		},
	});
	ctx.publish(
		ctx.buildEvent("room.event", {
			roomId,
			seq: committed.seq,
			event: committed.event,
		}),
	);
	ctx.publish(
		ctx.buildEvent("room.snapshot", {
			roomId,
			snapshot: committed.snapshot,
			seq: committed.seq,
		}),
	);
	return okReply(envelope, {
		room: next,
		snapshot: committed.snapshot,
		seq: committed.seq,
	});
}

function handleMuteSet(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	return handleAudioFlag(ctx, envelope, "muted");
}

function handleDeafenSet(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	return handleAudioFlag(ctx, envelope, "deafened");
}

function handleAudioFlag(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	flag: "muted" | "deafened",
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const participantId = readString(envelope.payload, "participantId");
	const value = readBoolean(envelope.payload, flag);
	if (!participantId || value === undefined) {
		return errorReply(
			envelope,
			"invalid_payload",
			`participantId and ${flag} are required`,
		);
	}
	const store = getDriveRoomStore();
	store.create(roomId);
	if (
		flag === "muted" &&
		store.get(roomId)?.participants.some((p) => p.id === participantId)
	) {
		store.mute({ roomId, participantId, muted: value });
	}
	const room = store.getOrCreateLive(roomId);
	const participantAudio =
		flag === "muted"
			? setParticipantMuted(room.participantAudio, participantId, value)
			: setParticipantDeafened(room.participantAudio, participantId, value);
	const next = store.setLive({ ...room, participantAudio });
	publishRoom(ctx, next);
	return okReply(envelope, { room: next });
}

async function handleShowPresent(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const parsedShow = ShowBacklogItemSchema.safeParse(
		envelope.payload?.showItem,
	);
	if (!parsedShow.success) {
		return errorReply(
			envelope,
			"invalid_payload",
			"showItem must be a valid ShowBacklogItem",
		);
	}
	const store = getDriveRoomStore();
	const { harness } = getHubDriveHarness({ store });
	const result = await harness.shows.present(roomId, parsedShow.data);
	const next = asLiveRoom(result.liveRoom);
	const presented = result.presented;
	publishRoom(ctx, next, {
		event: "drive.show.presented",
		payload: {
			showItemId: presented?.id ?? parsedShow.data.id,
			ownerParticipantId:
				presented?.ownerParticipantId ?? parsedShow.data.ownerParticipantId,
			uri: presented?.uri,
			caption: presented?.caption ?? parsedShow.data.caption,
			title: presented?.title ?? parsedShow.data.title,
		},
	});
	return okReply(envelope, { room: next });
}

async function handleShowEnqueue(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const parsedShow = ShowBacklogItemSchema.safeParse(
		envelope.payload?.showItem,
	);
	if (!parsedShow.success) {
		return errorReply(
			envelope,
			"invalid_payload",
			"showItem must be a valid ShowBacklogItem",
		);
	}
	const presentNow = readBoolean(envelope.payload, "presentNow") === true;
	const store = getDriveRoomStore();
	const { harness } = getHubDriveHarness({ store });
	const result = await harness.shows.enqueue(roomId, parsedShow.data, {
		presentNow,
	});
	const next = asLiveRoom(result.liveRoom);
	const planned = result.planned ?? parsedShow.data;
	publishRoom(ctx, next, {
		event: "drive.show.planned",
		payload: {
			showItemId: planned.id,
			ownerParticipantId: planned.ownerParticipantId,
			status: planned.status,
			title: planned.title,
			priority: planned.priority,
		},
	});
	if (result.presented) {
		publishRoom(ctx, next, {
			event: "drive.show.presented",
			payload: {
				showItemId: result.presented.id,
				ownerParticipantId: result.presented.ownerParticipantId,
				uri: result.presented.uri,
				caption: result.presented.caption,
				title: result.presented.title,
			},
		});
	}
	return okReply(envelope, { room: next });
}

function handleDoEnqueue(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const parsedDo = DoBacklogItemSchema.safeParse(envelope.payload?.doItem);
	if (!parsedDo.success) {
		return errorReply(
			envelope,
			"invalid_payload",
			"doItem must be a valid DoBacklogItem",
		);
	}
	const enqueued = {
		...parsedDo.data,
		status:
			parsedDo.data.status === "done" || parsedDo.data.status === "blocked"
				? parsedDo.data.status
				: ("queued" as const),
	};
	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	const doBacklog = [
		enqueued,
		...room.director.doBacklog.filter((item) => item.id !== enqueued.id),
	];
	const next = store.setLive({
		...room,
		director: {
			...room.director,
			doBacklog,
		},
	});
	publishRoom(ctx, next);
	return okReply(envelope, { room: next, doItem: enqueued });
}

function handlePlannerSet(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const modeRaw = readString(envelope.payload, "showPlannerMode");
	const mode =
		modeRaw === "off" || modeRaw === "heuristic" ? modeRaw : undefined;
	const tickOnWork = readBoolean(envelope.payload, "tickOnWork");
	const cooldownRaw = envelope.payload?.showPlannerCooldownMs;
	const cooldownMs =
		typeof cooldownRaw === "number" &&
		Number.isFinite(cooldownRaw) &&
		cooldownRaw >= 0
			? Math.floor(cooldownRaw)
			: undefined;
	if (mode === undefined && tickOnWork === undefined && cooldownMs === undefined) {
		return errorReply(
			envelope,
			"invalid_payload",
			"showPlannerMode, tickOnWork, or showPlannerCooldownMs required",
		);
	}
	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	const next = store.setLive({
		...room,
		director: {
			...room.director,
			...(mode !== undefined ? { showPlannerMode: mode } : {}),
			...(tickOnWork !== undefined ? { tickOnWork } : {}),
			...(cooldownMs !== undefined
				? { showPlannerCooldownMs: cooldownMs }
				: {}),
		},
	});
	publishRoom(ctx, next);
	return okReply(envelope, { room: next });
}

async function handleShowTick(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const preferShowId = readString(envelope.payload, "preferShowId");
	const store = getDriveRoomStore();
	const { harness } = getHubDriveHarness({ store });
	const result = await harness.shows.tick(roomId, { preferShowId });
	const room = asLiveRoom(result.liveRoom);
	if (!result.presented) {
		return okReply(envelope, { room, presented: null });
	}
	publishRoom(ctx, room, {
		event: "drive.show.presented",
		payload: {
			showItemId: result.presented.id,
			ownerParticipantId: result.presented.ownerParticipantId,
			uri: result.presented.uri,
			caption: result.presented.caption,
			title: result.presented.title,
		},
	});
	return okReply(envelope, { room, presented: result.presented });
}

function publishBeat(
	ctx: HubTransportContext,
	room: DriveLiveRoom,
	beatId: string | null,
	say: string,
	showItemId: string | null,
): void {
	const speakerId =
		room.director.activeScript?.ownerParticipantId ??
		room.spotlightParticipantId ??
		"system";
	if (say.trim().length > 0) {
		const delivery = assertDeliveryAllowed({
			senderId: speakerId,
			receiverId: speakerId,
			flags: room.participantAudio,
			channel: "room",
			requireSpeak: true,
		});
		if (!delivery.ok) {
			publishRoom(ctx, room, {
				event: "drive.script.beat",
				payload: {
					beatId,
					say: "",
					showItemId,
					stickyShowIds: room.director.stickyShowIds,
					activeScriptId: room.director.activeScript?.scriptId ?? null,
					deliveryBlocked: delivery.code,
					deliveryMessage: delivery.message,
				},
			});
			return;
		}
	}
	publishRoom(ctx, room, {
		event: "drive.script.beat",
		payload: {
			beatId,
			say,
			showItemId,
			stickyShowIds: room.director.stickyShowIds,
			activeScriptId: room.director.activeScript?.scriptId ?? null,
		},
	});
}

function presentDirectorActiveShow(
	room: DriveLiveRoom,
): { room: DriveLiveRoom; presented: ShowBacklogItem | null } {
	const showId = room.director.activeShowId;
	if (!showId) {
		return { room, presented: null };
	}
	const item = room.director.showBacklog.find((entry) => entry.id === showId);
	if (!item) {
		return { room, presented: null };
	}
	const next = applyPresentedShow(room, item);
	const presented =
		next.director.showBacklog.find((entry) => entry.id === showId) ?? null;
	return { room: next, presented };
}

function handleScriptAttach(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const parsedScript = DirectorScriptSchema.safeParse(envelope.payload?.script);
	if (!parsedScript.success) {
		return errorReply(
			envelope,
			"invalid_payload",
			"script must be a valid DirectorScript",
		);
	}
	const script = parsedScript.data;
	const extraShows = Array.isArray(envelope.payload?.showItems)
		? envelope.payload.showItems
				.map((entry) => ShowBacklogItemSchema.safeParse(entry))
				.filter((entry) => entry.success)
				.map((entry) => entry.data)
		: [];

	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	let showBacklog = [...room.director.showBacklog];
	for (const show of extraShows) {
		showBacklog = [
			{ ...show, status: normalizeEnqueuedShowStatus(show.status) },
			...showBacklog.filter((item) => item.id !== show.id),
		];
	}

	const seeded = advanceScriptBeat({
		state: {
			...room.director,
			showBacklog,
			activeScript: script,
			activeBeatId: null,
			activeShowId: null,
			stickyShowIds: [],
		},
		script,
	});
	let next = store.setLive({
		...room,
		director: seeded,
		spotlightParticipantId:
			room.spotlightParticipantId ?? seeded.spotlightParticipantId,
	});
	const presented = presentDirectorActiveShow(next);
	next = store.setLive(presented.room);
	const beat = script.beats.find((entry) => entry.beatId === seeded.activeBeatId);
	if (presented.presented) {
		publishRoom(ctx, next, {
			event: "drive.show.presented",
			payload: {
				showItemId: presented.presented.id,
				ownerParticipantId: presented.presented.ownerParticipantId,
				uri: presented.presented.uri,
				caption: beat?.say ?? presented.presented.caption,
				title: presented.presented.title,
			},
		});
	} else {
		publishRoom(ctx, next);
	}
	publishBeat(
		ctx,
		next,
		seeded.activeBeatId,
		beat?.say ?? "",
		seeded.activeShowId,
	);
	return okReply(envelope, { room: next, beatId: seeded.activeBeatId });
}

function handleScriptAdvance(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	const script = room.director.activeScript;
	if (!script) {
		return errorReply(
			envelope,
			"no_active_script",
			"No active DirectorScript on this room",
		);
	}
	const previousShowId = room.director.activeShowId;
	const advanced = advanceScriptBeat({
		state: room.director,
		script,
	});
	let next = store.setLive({
		...room,
		director: advanced,
	});
	const beat = script.beats.find(
		(entry) => entry.beatId === advanced.activeBeatId,
	);
	const showChanged = advanced.activeShowId !== previousShowId;
	if (showChanged && advanced.activeShowId) {
		const presented = presentDirectorActiveShow(next);
		next = store.setLive(presented.room);
		if (presented.presented) {
			publishRoom(ctx, next, {
				event: "drive.show.presented",
				payload: {
					showItemId: presented.presented.id,
					ownerParticipantId: presented.presented.ownerParticipantId,
					uri: presented.presented.uri,
					caption: beat?.say ?? presented.presented.caption,
					title: presented.presented.title,
				},
			});
		} else {
			publishRoom(ctx, next);
		}
	} else {
		publishRoom(ctx, next);
	}
	publishBeat(
		ctx,
		next,
		advanced.activeBeatId,
		beat?.say ?? "",
		advanced.activeShowId,
	);
	return okReply(envelope, {
		room: next,
		beatId: advanced.activeBeatId,
		say: beat?.say ?? "",
	});
}

/** @internal test helper — clears collaboration store (single live Map). */
export function __resetDriveRoomsForTests(): void {
	resetDriveRoomStoreForTests();
}
