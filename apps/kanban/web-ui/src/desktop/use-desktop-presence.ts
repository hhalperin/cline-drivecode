import type { DesktopPresenceCounts } from "@kanban/desktop-bridge";
import { useEffect, useMemo } from "react";

import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardData } from "@/types";

import { useDesktop } from "./desktop-context";

/**
 * Counts drawn from session *state*, restricted to the tasks on the *current*
 * board.
 *
 * Two separate constraints, and both are load-bearing.
 *
 * **Why state, not columns.** `running` is what the host turns into an OS wake
 * lock, so it has to mean "an agent is executing right now" — counting cards in
 * the `in_progress` column would keep the machine awake all night over a card
 * someone left there on Friday. The session states say exactly what the bridge
 * contract asks for: `running` is "agent sessions currently working",
 * `awaiting_review` is "tasks finished and waiting on a human". Everything else
 * — `idle`, `failed`, `interrupted` — is neither. A failed session in
 * particular is *not* ready for review: nothing finished, and bouncing the dock
 * for it would train people to ignore the signal.
 *
 * **Why restricted to the board.** App's `sessions` map is merged across
 * project switches, not replaced: `applyWorkspaceState` runs
 * `mergeTaskSessionSummaries(current, incoming)` and only clears outright when
 * there is no workspace at all. That merge is deliberate — it is monotonic on
 * purpose, guarding a regression where a replayed stale summary overwrote a
 * newer running one and the terminal appeared to clear itself. Every other
 * consumer indexes it by task id, so a merged map costs them nothing. This is
 * the first consumer that *aggregates* over it, and for an aggregate the merge
 * means a previous project's running sessions linger forever — holding the wake
 * lock and inflating the badge for work that is not on screen. The board is
 * replaced per project, so its task ids are what scope the count.
 */
export function countPresence(
	taskSessions: Record<string, RuntimeTaskSessionSummary>,
	currentTaskIds: ReadonlySet<string>,
): DesktopPresenceCounts {
	let running = 0;
	let readyForReview = 0;
	for (const [taskId, session] of Object.entries(taskSessions)) {
		if (!currentTaskIds.has(taskId)) {
			continue;
		}
		if (session.state === "running") {
			running += 1;
		} else if (session.state === "awaiting_review") {
			readyForReview += 1;
		}
	}
	return { running, readyForReview };
}

/** Every task id on the board, across all columns. */
export function boardTaskIds(board: BoardData): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			ids.add(card.id);
		}
	}
	return ids;
}

/**
 * Reports this window's activity to the desktop host.
 *
 * This is the producer the presence namespace was waiting for. Until it
 * existed `presence.setCounts` had no caller anywhere in the product, so the
 * dock badge, the attention signal and the tray summary were all dead —
 * ADR-0036 names that as the gate on advertising `tray` at all.
 *
 * A no-op in a browser tab, where `useDesktop()` is `null`.
 */
export function useDesktopPresence(
	taskSessions: Record<string, RuntimeTaskSessionSummary>,
	board: BoardData,
): void {
	const desktop = useDesktop();
	const currentTaskIds = useMemo(() => boardTaskIds(board), [board]);
	const { running, readyForReview } = countPresence(
		taskSessions,
		currentTaskIds,
	);

	// Depends on the two numbers rather than on the counts object, which is
	// freshly allocated every render. `PresenceController.update` invokes IPC
	// for the badge and the tray on every call, so an effect keyed on object
	// identity would re-send them on renders that changed nothing.
	useEffect(() => {
		desktop?.presence.setCounts({ running, readyForReview });
	}, [desktop, running, readyForReview]);

	// Stop claiming work when this window stops reporting it.
	//
	// The host already drops a window's wake-lock claim on
	// `WindowEvent::Destroyed`, so a closed window is covered. This handles the
	// case that event does not: the renderer unmounting while its window lives
	// on. Kept in its own effect so it runs on teardown only — folding it into
	// the cleanup above would fire on every count change, releasing and
	// re-taking the wake lock and re-bouncing the dock each time.
	useEffect(() => {
		if (!desktop) return;
		return () => {
			desktop.presence.setCounts({ running: 0, readyForReview: 0 });
		};
	}, [desktop]);
}
