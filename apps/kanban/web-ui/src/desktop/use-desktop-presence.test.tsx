import type { DesktopApi } from "@kanban/desktop-bridge";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopContext } from "@/desktop/desktop-context";
import {
	boardTaskIds,
	countPresence,
	useDesktopPresence,
} from "@/desktop/use-desktop-presence";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardCard, BoardData } from "@/types";

type SessionState = RuntimeTaskSessionSummary["state"];

/** Only `state` is read; the rest of the summary is noise for this hook. */
function sessions(
	...states: SessionState[]
): Record<string, RuntimeTaskSessionSummary> {
	return Object.fromEntries(
		states.map((state, index) => [
			`task-${index}`,
			{ state } as RuntimeTaskSessionSummary,
		]),
	);
}

/** A board owning exactly the given task ids, in one column. */
function board(...taskIds: string[]): BoardData {
	return {
		columns: [
			{
				id: "in_progress",
				title: "In progress",
				cards: taskIds.map((id) => ({ id }) as BoardCard),
			},
		],
		dependencies: [],
	};
}

/** A board owning `task-0 … task-(n-1)`, matching `sessions(...)` above. */
const boardFor = (count: number): BoardData =>
	board(...Array.from({ length: count }, (_, index) => `task-${index}`));

describe("countPresence", () => {
	it("counts the two states the contract names, and nothing else", () => {
		expect(
			countPresence(
				sessions(
					"running",
					"running",
					"awaiting_review",
					"idle",
					"failed",
					"interrupted",
				),
				boardTaskIds(boardFor(6)),
			),
		).toEqual({ running: 2, readyForReview: 1 });
	});

	it("does not treat a failed session as ready for review", () => {
		// Nothing finished. Counting it would put a number on the dock and
		// bounce it for work that did not complete, which is how a signal
		// becomes noise.
		expect(
			countPresence(
				sessions("failed", "interrupted"),
				boardTaskIds(boardFor(2)),
			),
		).toEqual({ running: 0, readyForReview: 0 });
	});

	it("reports zero for an empty workspace", () => {
		expect(countPresence({}, boardTaskIds(board()))).toEqual({
			running: 0,
			readyForReview: 0,
		});
	});

	it("ignores sessions from a project that is no longer on the board", () => {
		// App's `sessions` map is merged across project switches rather than
		// replaced — `applyWorkspaceState` calls
		// `mergeTaskSessionSummaries(current, incoming)` and only clears when
		// there is no workspace at all. That merge is deliberate and guards a
		// terminal-clearing regression, so the scoping has to happen here.
		//
		// Without it, switching projects leaves the previous project's running
		// sessions in the count forever: the wake lock never releases and the
		// dock badge counts work that is not on screen.
		const merged = {
			...sessions("running", "awaiting_review"),
			"stale-running": { state: "running" } as RuntimeTaskSessionSummary,
			"stale-review": {
				state: "awaiting_review",
			} as RuntimeTaskSessionSummary,
		};

		expect(countPresence(merged, boardTaskIds(boardFor(2)))).toEqual({
			running: 1,
			readyForReview: 1,
		});
	});

	it("collects task ids from every column, not just one", () => {
		const twoColumns: BoardData = {
			columns: [
				{
					id: "in_progress",
					title: "In progress",
					cards: [{ id: "a" } as BoardCard],
				},
				{ id: "review", title: "Review", cards: [{ id: "b" } as BoardCard] },
			],
			dependencies: [],
		};

		expect(boardTaskIds(twoColumns)).toEqual(new Set(["a", "b"]));
	});
});

describe("useDesktopPresence", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;
	let setCounts: ReturnType<typeof vi.fn>;
	let api: DesktopApi;

	const globals = globalThis as typeof globalThis & {
		IS_REACT_ACT_ENVIRONMENT?: boolean;
	};

	beforeEach(() => {
		previousActEnvironment = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		setCounts = vi.fn();
		// The hook reaches for `presence.setCounts` and nothing else.
		api = { presence: { setCounts } } as unknown as DesktopApi;
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		globals.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
	});

	function Probe({
		taskSessions,
		boardData,
	}: {
		taskSessions: Record<string, RuntimeTaskSessionSummary>;
		boardData: BoardData;
	}): null {
		useDesktopPresence(taskSessions, boardData);
		return null;
	}

	function render(
		taskSessions: Record<string, RuntimeTaskSessionSummary>,
		desktop: DesktopApi | null = api,
		boardData: BoardData = boardFor(Object.keys(taskSessions).length),
	): void {
		act(() => {
			root.render(
				<DesktopContext.Provider value={desktop}>
					<Probe taskSessions={taskSessions} boardData={boardData} />
				</DesktopContext.Provider>,
			);
		});
	}

	it("reports the window's counts to the host", () => {
		render(sessions("running", "awaiting_review", "idle"));

		expect(setCounts).toHaveBeenCalledWith({ running: 1, readyForReview: 1 });
	});

	it("stays silent in a browser tab", () => {
		// `useDesktop()` is null there, which is the ordinary case rather than
		// an error.
		render(sessions("running"), null);

		expect(setCounts).not.toHaveBeenCalled();
	});

	it("does not re-send counts that have not changed", () => {
		// The counts object is freshly allocated every render, so an effect
		// keyed on it would re-send on renders that changed nothing — and
		// PresenceController.update invokes IPC for the badge and the tray on
		// every call.
		render(sessions("running"));
		expect(setCounts).toHaveBeenCalledTimes(1);

		render(sessions("running"));
		render(sessions("running"));

		expect(
			setCounts,
			"an unchanged count must not reach the host again",
		).toHaveBeenCalledTimes(1);
	});

	it("sends again once a count actually moves", () => {
		render(sessions("running"));
		setCounts.mockClear();

		render(sessions("running", "awaiting_review"));

		expect(setCounts).toHaveBeenCalledWith({ running: 1, readyForReview: 1 });
	});

	it("stops claiming work when the renderer goes away", () => {
		// `running` is what the host turns into an OS wake lock. The host drops
		// a window's claim on WindowEvent::Destroyed, so a closed window is
		// covered; this is the case that event does not see — the renderer
		// unmounting while its window lives on. Without it the machine keeps
		// itself awake for a session nobody is watching.
		render(sessions("running", "running"));
		setCounts.mockClear();

		act(() => root.unmount());

		expect(setCounts).toHaveBeenLastCalledWith({
			running: 0,
			readyForReview: 0,
		});
	});
});
