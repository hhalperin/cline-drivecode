import type { DesktopApi } from "@kanban/desktop-bridge";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopContext } from "@/desktop/desktop-context";
import {
	countPresence,
	useDesktopPresence,
} from "@/desktop/use-desktop-presence";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";

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
			),
		).toEqual({ running: 2, readyForReview: 1 });
	});

	it("does not treat a failed session as ready for review", () => {
		// Nothing finished. Counting it would put a number on the dock and
		// bounce it for work that did not complete, which is how a signal
		// becomes noise.
		expect(countPresence(sessions("failed", "interrupted"))).toEqual({
			running: 0,
			readyForReview: 0,
		});
	});

	it("reports zero for an empty workspace", () => {
		expect(countPresence({})).toEqual({ running: 0, readyForReview: 0 });
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
	}: {
		taskSessions: Record<string, RuntimeTaskSessionSummary>;
	}): null {
		useDesktopPresence(taskSessions);
		return null;
	}

	function render(
		taskSessions: Record<string, RuntimeTaskSessionSummary>,
		desktop: DesktopApi | null = api,
	): void {
		act(() => {
			root.render(
				<DesktopContext.Provider value={desktop}>
					<Probe taskSessions={taskSessions} />
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
