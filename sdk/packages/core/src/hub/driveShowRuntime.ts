/**
 * Show materialize + director tick (neutral module).
 * Shared by hub wire handlers and driveDirectorOps so neither imports the other.
 */

import { pickNextShowToPresent, resolveAddress } from "@cline/drive";
import type { AddressSet, Participant, ShowBacklogItem } from "@cline/shared";
import {
	getDriveRoomStore,
	type DriveRoomStore,
} from "./collaboration";
import { produceBrowserSnapshotShowArtifact } from "./drive-producers/produceBrowserSnapshot";
import { produceCodeWalkthroughShowArtifact } from "./drive-producers/produceCodeWalkthrough";
import { produceMermaidShowArtifact } from "./drive-producers/produceMermaid";
import { producePlanCardShowArtifact } from "./drive-producers/producePlanCard";

export type DriveLiveRoom = ReturnType<DriveRoomStore["getOrCreateLive"]>;

export type MaterializeShowOptions = {
	demoCapture?: boolean;
};

/**
 * Materialize show artifacts that still need production.
 * Unknown tools leave the item unchanged (caller may keep planned).
 */
export function materializeShowItem(
	showItem: ShowBacklogItem,
	options?: MaterializeShowOptions,
): ShowBacklogItem {
	if (showItem.uri) {
		return showItem;
	}
	const tool = showItem.produce.tool;
	switch (tool) {
		case "render_mermaid": {
			const mermaidSource = showItem.produce.args.mermaidSource;
			if (typeof mermaidSource !== "string" || !mermaidSource.trim()) {
				return showItem;
			}
			const produced = produceMermaidShowArtifact({
				mermaidSource,
				ownerParticipantId: showItem.ownerParticipantId,
				title: showItem.title,
				caption: showItem.caption,
				templateId: showItem.produce.templateId,
			});
			return {
				...showItem,
				uri: produced.item.uri,
				status: "ready",
				scoreReasons: [
					...new Set([
						...showItem.scoreReasons,
						...produced.item.scoreReasons,
					]),
				],
			};
		}
		case "render_plan_card": {
			const stepsRaw = showItem.produce.args.steps;
			const steps = Array.isArray(stepsRaw)
				? stepsRaw.filter((step): step is string => typeof step === "string")
				: undefined;
			const planTitle =
				typeof showItem.produce.args.planTitle === "string"
					? showItem.produce.args.planTitle
					: showItem.title;
			const produced = producePlanCardShowArtifact({
				ownerParticipantId: showItem.ownerParticipantId,
				title: showItem.title,
				caption: showItem.caption,
				templateId: showItem.produce.templateId,
				planTitle,
				steps,
			});
			return {
				...showItem,
				uri: produced.item.uri,
				status: "ready",
				scoreReasons: [
					...new Set([
						...showItem.scoreReasons,
						...produced.item.scoreReasons,
					]),
				],
			};
		}
		case "render_code_walkthrough": {
			const path =
				typeof showItem.produce.args.path === "string" &&
				showItem.produce.args.path.trim()
					? showItem.produce.args.path.trim()
					: "src/unknown.ts";
			const startLine =
				typeof showItem.produce.args.startLine === "number"
					? showItem.produce.args.startLine
					: undefined;
			const endLine =
				typeof showItem.produce.args.endLine === "number"
					? showItem.produce.args.endLine
					: undefined;
			const snippet =
				typeof showItem.produce.args.snippet === "string"
					? showItem.produce.args.snippet
					: undefined;
			const produced = produceCodeWalkthroughShowArtifact({
				ownerParticipantId: showItem.ownerParticipantId,
				title: showItem.title,
				caption: showItem.caption,
				templateId: showItem.produce.templateId,
				path,
				startLine,
				endLine,
				snippet,
			});
			return {
				...showItem,
				uri: produced.item.uri,
				status: "ready",
				scoreReasons: [
					...new Set([
						...showItem.scoreReasons,
						...produced.item.scoreReasons,
					]),
				],
			};
		}
		case "drive_browser_snapshot": {
			const produced = produceBrowserSnapshotShowArtifact({
				ownerParticipantId: showItem.ownerParticipantId,
				title: showItem.title,
				caption: showItem.caption,
				templateId: showItem.produce.templateId,
				url:
					typeof showItem.produce.args.url === "string"
						? showItem.produce.args.url
						: undefined,
				demoCapture: options?.demoCapture === true,
			});
			if (!produced.ok) {
				return {
					...showItem,
					status: "planned",
					scoreReasons: [
						...new Set([
							...showItem.scoreReasons,
							...produced.item.scoreReasons,
						]),
					],
				};
			}
			return {
				...showItem,
				uri: produced.item.uri,
				status: "ready",
				scoreReasons: [
					...new Set([
						...showItem.scoreReasons,
						...produced.item.scoreReasons,
					]),
				],
			};
		}
		default:
			return {
				...showItem,
				scoreReasons: [
					...new Set([...showItem.scoreReasons, `unknown_produce_tool:${tool}`]),
				],
			};
	}
}

export function applyPresentedShow(
	room: DriveLiveRoom,
	showItem: ShowBacklogItem,
	options?: MaterializeShowOptions,
): DriveLiveRoom {
	const materialized =
		showItem.uri && showItem.status === "showing"
			? showItem
			: materializeShowItem(showItem, options);
	if (!materialized.uri) {
		return room;
	}
	const showBacklog = [
		{ ...materialized, status: "showing" as const },
		...room.director.showBacklog.filter((item) => item.id !== materialized.id),
	];
	return {
		...room,
		director: {
			...room.director,
			showBacklog,
			activeShowId: materialized.id,
			stickyShowIds: [materialized.id, ...room.director.stickyShowIds].filter(
				(id, index, all) => all.indexOf(id) === index,
			),
			lastPresentedAt: new Date().toISOString(),
			spotlightParticipantId:
				room.spotlightParticipantId ?? materialized.ownerParticipantId,
		},
		spotlightParticipantId:
			room.spotlightParticipantId ?? materialized.ownerParticipantId,
	};
}

export function addressedParticipantIdsFromAddressSet(
	addressSet: AddressSet | undefined | null,
	participants?: readonly Participant[],
): Set<string> {
	if (!addressSet) {
		return new Set();
	}
	if (addressSet.mode === "everyone") {
		// Legacy show ranking: everyone means no address filter.
		return new Set();
	}
	if (addressSet.mode === "agents") {
		return new Set(addressSet.agentIds);
	}
	if (!participants) {
		return new Set();
	}
	const resolved = resolveAddress({ addressSet, participants });
	return resolved.ok ? new Set(resolved.participantIds) : new Set();
}

/**
 * Rank planned/ready shows and present the winner (materialize + activeShowId).
 * No-op when backlog has nothing presentable.
 */
export function runShowDirectorTick(input: {
	room: DriveLiveRoom;
	preferShowId?: string | null;
	demoCapture?: boolean;
	addressedParticipantIds?: ReadonlySet<string>;
}): { room: DriveLiveRoom; presented: ShowBacklogItem | null } {
	const snapshot = getDriveRoomStore().get(input.room.roomId);
	/** Prefer stage.sharer (authoritative) over live spotlight (S1.3). */
	const spotlightParticipantId =
		snapshot?.stage.sharer?.participantId ??
		input.room.director.spotlightParticipantId ??
		input.room.spotlightParticipantId;
	const addressedParticipantIds =
		input.addressedParticipantIds ??
		addressedParticipantIdsFromAddressSet(
			snapshot?.addressSet,
			snapshot?.participants,
		);
	const ranked = pickNextShowToPresent({
		items: input.room.director.showBacklog,
		spotlightParticipantId,
		addressedParticipantIds,
		preferShowId: input.preferShowId,
	});
	if (!ranked) {
		return { room: input.room, presented: null };
	}

	// Prefer ranked winner; if it cannot materialize, try remaining ready/planned.
	const ordered = [
		ranked,
		...input.room.director.showBacklog.filter(
			(item) =>
				item.id !== ranked.id &&
				(item.status === "planned" || item.status === "ready"),
		),
	];
	for (const candidate of ordered) {
		const materialized = materializeShowItem(candidate, {
			demoCapture: input.demoCapture,
		});
		if (!materialized.uri) {
			continue;
		}
		const next = applyPresentedShow(input.room, materialized, {
			demoCapture: input.demoCapture,
		});
		const presented =
			next.director.showBacklog.find((item) => item.id === materialized.id) ??
			null;
		return { room: next, presented };
	}
	return { room: input.room, presented: null };
}
