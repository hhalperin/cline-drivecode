import type { UpdaterBackendEvent } from "@kanban/desktop-bridge";
import { describe, expect, it, vi } from "vitest";

import {
	CMD_CHECK_FOR_UPDATES,
	CMD_RESTART_TO_APPLY_UPDATE,
	CMD_UPDATE_STATUS,
	type HostUpdateStatus,
} from "../src/commands.js";
import {
	CORRELATION_KEY,
	createTauriNotificationBackend,
} from "../src/notification-backend.js";
import type {
	TauriNotificationSurface,
	TauriSurface,
	UnlistenFn,
} from "../src/tauri-surface.js";
import {
	createTauriUpdaterBackend,
	toUpdaterEvent,
} from "../src/updater-backend.js";

// ---------------------------------------------------------------------------

function makeSurface(
	status: () => HostUpdateStatus | Error,
	notifications?: Partial<TauriNotificationSurface>,
): { surface: TauriSurface; invoke: ReturnType<typeof vi.fn> } {
	const invoke = vi.fn(async (command: string) => {
		if (command === CMD_UPDATE_STATUS) {
			const next = status();
			if (next instanceof Error) throw next;
			return next;
		}
		return undefined;
	});

	const surface = {
		isTauri: () => true,
		invoke: invoke as unknown as TauriSurface["invoke"],
		getVersion: async () => "1.0.0",
		currentWindow: () => ({}) as never,
		listen: (async () => (() => {}) as UnlistenFn) as TauriSurface["listen"],
		notifications: () => ({
			isPermissionGranted: async () => true,
			requestPermission: async () => true,
			send: () => {},
			onAction: async () => (() => {}) as UnlistenFn,
			...notifications,
		}),
	} satisfies TauriSurface;

	return { surface, invoke };
}

/** Let the backend's own promise chains settle. */
const settle = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

// ---------------------------------------------------------------------------

describe("toUpdaterEvent", () => {
	it.each<[string, HostUpdateStatus, UpdaterBackendEvent]>([
		[
			"checking",
			{ state: "checking", version: null, error: null },
			{ kind: "checking" },
		],
		[
			"idle",
			{ state: "idle", version: null, error: null },
			{ kind: "up-to-date" },
		],
		[
			"downloading",
			{ state: "downloading", version: "2.0.0", error: null },
			// `available`, not `progress`: the host reports no percentage and a
			// fabricated one would be worse than none.
			{ kind: "available", version: "2.0.0" },
		],
		[
			"ready",
			{ state: "ready", version: "2.0.0", error: null },
			{ kind: "ready", version: "2.0.0" },
		],
		[
			"error",
			{ state: "error", version: null, error: "boom" },
			{ kind: "error", message: "boom" },
		],
	])("maps %s", (_label, status, expected) => {
		expect(toUpdaterEvent(status)).toEqual(expected);
	});

	it("ignores a state this build does not know", () => {
		// A host that grows a state should degrade to silence rather than to a
		// wrong event — the same posture parseBridgeBootstrap takes on unknown
		// capabilities.
		expect(
			toUpdaterEvent({
				state: "rebooting-the-moon",
				version: null,
				error: null,
			}),
		).toBeNull();
	});

	it("still reports an error with no message", () => {
		const event = toUpdaterEvent({
			state: "error",
			version: null,
			error: null,
		});

		expect(event?.kind).toBe("error");
		expect((event as { message: string }).message).not.toBe("");
	});
});

describe("updater backend", () => {
	it("emits only when the status actually changes", async () => {
		// The controller treats every event as a transition, and `ready` →
		// `ready` specifically means "a newer version arrived". Re-emitting an
		// unchanged poll would make that signal meaningless.
		let current: HostUpdateStatus = {
			state: "checking",
			version: null,
			error: null,
		};
		const { surface } = makeSurface(() => current);
		const updater = createTauriUpdaterBackend({ surface, pollIntervalMs: 1 });

		const events: UpdaterBackendEvent[] = [];
		updater.backend.subscribe((event) => events.push(event));
		await settle();

		expect(events).toEqual([{ kind: "checking" }]);

		current = { state: "ready", version: "2.0.0", error: null };
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(events).toContainEqual({ kind: "ready", version: "2.0.0" });
		const readyCount = events.filter((e) => e.kind === "ready").length;
		expect(readyCount, "an unchanged status must not re-emit").toBe(1);

		updater.dispose();
	});

	it("stays quiet when the host command fails", async () => {
		// An update backend that cannot be reached is not something the user
		// can act on. Emitting an error would put a banner in front of them for
		// a fault entirely inside the app.
		const { surface } = makeSurface(() => new Error("command not found"));
		const updater = createTauriUpdaterBackend({ surface, pollIntervalMs: 1 });

		const events: UpdaterBackendEvent[] = [];
		updater.backend.subscribe((event) => events.push(event));
		await settle();

		expect(events).toEqual([]);
		updater.dispose();
	});

	it("asks the host to check rather than starting its own", async () => {
		// The whole point of this backend: one updater for one bundle.
		const { surface, invoke } = makeSurface(() => ({
			state: "idle",
			version: null,
			error: null,
		}));
		const updater = createTauriUpdaterBackend({
			surface,
			pollIntervalMs: 10_000,
		});

		await updater.backend.checkForUpdates();

		expect(invoke).toHaveBeenCalledWith(CMD_CHECK_FOR_UPDATES);
		updater.dispose();
	});

	it("installs by restarting, which is the only action left to a user", async () => {
		const { surface, invoke } = makeSurface(() => ({
			state: "ready",
			version: "2.0.0",
			error: null,
		}));
		const updater = createTauriUpdaterBackend({
			surface,
			pollIntervalMs: 10_000,
		});

		updater.backend.quitAndInstall();

		expect(invoke).toHaveBeenCalledWith(CMD_RESTART_TO_APPLY_UPDATE);
		updater.dispose();
	});

	it("stops polling once disposed", async () => {
		const { surface, invoke } = makeSurface(() => ({
			state: "idle",
			version: null,
			error: null,
		}));
		const updater = createTauriUpdaterBackend({ surface, pollIntervalMs: 1 });
		updater.backend.subscribe(() => {});
		await settle();

		updater.dispose();
		const afterDispose = invoke.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(invoke.mock.calls.length).toBe(afterDispose);
	});
});

describe("notification backend", () => {
	it("routes a click back to the notification that was clicked", async () => {
		// `sendNotification` returns no handle, so `extra` is the only channel
		// that can say which notification an action belongs to.
		// Held in an object rather than a `let`: TypeScript does not track an
		// assignment made inside a callback, so a `let` initialised to null
		// narrows to `never` and the call below fails to compile while vitest
		// passes — the exact split AGENTS.md warns about.
		const action: {
			fire: ((payload: { extra?: Record<string, unknown> }) => void) | null;
		} = { fire: null };
		const sent: Array<{ extra?: Record<string, unknown> }> = [];

		const { surface } = makeSurface(
			() => ({ state: "idle", version: null, error: null }),
			{
				send: (options) => sent.push(options),
				onAction: async (handler) => {
					action.fire = handler;
					return (() => {}) as UnlistenFn;
				},
			},
		);
		const notifications = createTauriNotificationBackend({ surface });
		await settle();

		const first = notifications.backend.create({ title: "A", body: "a" });
		const second = notifications.backend.create({ title: "B", body: "b" });
		const firstClicked = vi.fn();
		const secondClicked = vi.fn();
		first.onClick(firstClicked);
		second.onClick(secondClicked);
		first.show();
		second.show();

		expect(sent).toHaveLength(2);
		const secondId = sent[1].extra?.[CORRELATION_KEY];
		action.fire?.({ extra: { [CORRELATION_KEY]: secondId } });

		expect(secondClicked).toHaveBeenCalledTimes(1);
		expect(
			firstClicked,
			"a click must not fan out to every notification",
		).not.toHaveBeenCalled();

		notifications.dispose();
	});

	it("ignores an action with no correlation id", async () => {
		const action: {
			fire: ((payload: { extra?: Record<string, unknown> }) => void) | null;
		} = { fire: null };
		const { surface } = makeSurface(
			() => ({ state: "idle", version: null, error: null }),
			{
				onAction: async (handler) => {
					action.fire = handler;
					return (() => {}) as UnlistenFn;
				},
			},
		);
		const notifications = createTauriNotificationBackend({ surface });
		await settle();

		const handle = notifications.backend.create({ title: "A", body: "a" });
		const clicked = vi.fn();
		handle.onClick(clicked);
		handle.show();

		// Another part of the app — or another window — raising its own
		// notification must not trip Kanban's listener.
		action.fire?.({ extra: { somethingElse: "x" } });
		action.fire?.({});

		expect(clicked).not.toHaveBeenCalled();
		notifications.dispose();
	});

	it("reports unsupported when permission is refused", async () => {
		const { surface } = makeSurface(
			() => ({ state: "idle", version: null, error: null }),
			{
				isPermissionGranted: async () => false,
				requestPermission: async () => false,
			},
		);
		const notifications = createTauriNotificationBackend({ surface });
		await settle();

		// The controller checks this first and declines to notify, which is the
		// documented no-op rather than a failed send.
		expect(notifications.backend.isSupported()).toBe(false);
		notifications.dispose();
	});

	it("reports unsupported when the permission check throws", async () => {
		// A Linux box with no notification daemon. Never let that take down the
		// caller.
		const { surface } = makeSurface(
			() => ({ state: "idle", version: null, error: null }),
			{
				isPermissionGranted: async () => {
					throw new Error("no session bus");
				},
			},
		);
		const notifications = createTauriNotificationBackend({ surface });
		await settle();

		expect(notifications.backend.isSupported()).toBe(false);
		notifications.dispose();
	});
});
