/**
 * Tauri implementation of the bridge's `DesktopHost`.
 *
 * Thin by design: every method translates one call and returns. All the policy
 * — update transitions, notification dedupe, badge rules — lives in
 * `@kanban/desktop-bridge` and runs unchanged here, which is what made
 * swapping Electron for Tauri a matter of replacing this layer rather than
 * rewriting the feature set.
 *
 * ## Updates and notifications
 *
 * Both used to resolve to `null` — the notification plugin was not a
 * dependency, and the updater plugin was linked but reachable only from Rust.
 * They are wired now, in deliberately different ways.
 *
 * `notification-backend.ts` drives `@tauri-apps/plugin-notification` directly:
 * notifications are per-call and nothing else owns them.
 *
 * `updater-backend.ts` does *not* drive the updater plugin, because the host
 * already does. `main.rs` checks and installs on a two-hour loop, so a second
 * updater would mean two writers racing to replace one bundle. It reads the
 * host's status instead. See that file for what the choice costs.
 *
 * Both are *derived* capabilities: supplying the object is the proof, so
 * `createDesktopBridge` adds `updates` / `notifications` on seeing them and
 * `kanban.rs`'s CAPABILITIES list is not involved.
 */

import {
	type DeepLinkTarget,
	type DesktopCapability,
	type DesktopHost,
	type DesktopMenuAction,
	isDesktopCapability,
	toDesktopPlatform,
} from "@kanban/desktop-bridge";

import {
	CMD_HANDSHAKE,
	CMD_OPEN_PROJECT_WINDOW,
	CMD_PICK_DIRECTORY,
	CMD_PUBLISH_MENU_ACTIONS,
	CMD_RESTART_RUNTIME,
	EVENT_MENU_ACTION_INVOKED,
	type KanbanHandshakePayload,
} from "./commands.js";
import { createFocusTracker, type FocusTracker } from "./focus-tracker.js";
import { createTauriNotificationBackend } from "./notification-backend.js";
import { createTauriPresenceView } from "./presence-view.js";
import type { TauriSurface, UnlistenFn } from "./tauri-surface.js";
import { createTauriUpdaterBackend } from "./updater-backend.js";

export interface TauriDesktopHost extends DesktopHost {
	/** Releases the focus subscription. Call on window teardown. */
	dispose(): void;
}

export interface CreateTauriHostOptions {
	surface: TauriSurface;
	/**
	 * Navigate the current window to a deep-link target. Supplied by the
	 * renderer because routing is the web UI's concern, not the host's.
	 */
	navigate: (target: DeepLinkTarget) => void;
}

function parseHandshake(payload: unknown): KanbanHandshakePayload | null {
	if (typeof payload !== "object" || payload === null) return null;
	const record = payload as Record<string, unknown>;
	if (typeof record.appVersion !== "string") return null;
	if (typeof record.platform !== "string") return null;
	if (typeof record.isPackaged !== "boolean") return null;
	if (!Array.isArray(record.capabilities)) return null;

	return {
		appVersion: record.appVersion,
		platform: record.platform,
		isPackaged: record.isPackaged,
		capabilities: record.capabilities.filter(
			(value): value is string => typeof value === "string",
		),
	};
}

/**
 * Build a host, or return `null` when this isn't a Tauri window at all.
 *
 * A null here is the normal path in a browser tab and in tests — the web UI
 * falls back to browser mode, which is always safe.
 */
export async function createTauriDesktopHost(
	opts: CreateTauriHostOptions,
): Promise<TauriDesktopHost | null> {
	const { surface } = opts;
	if (!surface.isTauri()) return null;

	let handshake: KanbanHandshakePayload | null = null;
	try {
		handshake = parseHandshake(await surface.invoke(CMD_HANDSHAKE));
	} catch (err) {
		// A host too old to know the command, or one that failed to start its
		// Kanban half. Browser mode is the honest fallback — better than a
		// window whose desktop features all silently fail.
		console.warn(
			"[desktop] Kanban handshake failed; running without a desktop bridge:",
			err instanceof Error ? err.message : err,
		);
		return null;
	}
	if (!handshake) {
		console.warn("[desktop] Kanban handshake returned an unusable payload.");
		return null;
	}

	// Anything this build doesn't recognise is dropped rather than failing
	// the handshake, matching parseBridgeBootstrap: a newer host advertising
	// an unknown capability should stay usable for the ones we do know.
	const declaredCapabilities: DesktopCapability[] =
		handshake.capabilities.filter(isDesktopCapability);
	const hostCapabilities = new Set(handshake.capabilities);
	const window = surface.currentWindow();
	const focus: FocusTracker = createFocusTracker(window);

	const presence = hostCapabilities.has("presence")
		? createTauriPresenceView({
				surface,
				window,
				hasTray: hostCapabilities.has("tray"),
			})
		: null;

	// Derived, not declared: supplying these objects is itself the proof, so
	// `createDesktopBridge` pushes `updates` / `notifications` on seeing them
	// and `kanban.rs`'s CAPABILITIES list stays out of it. That is why linking
	// these needed no change on the Rust capability list — only the plugin and
	// its manifest permission.
	const updater = createTauriUpdaterBackend({ surface });
	const notifications = createTauriNotificationBackend({ surface });

	return {
		platform: toDesktopPlatform(handshake.platform),
		appVersion: handshake.appVersion,
		isPackaged: handshake.isPackaged,
		declaredCapabilities,

		openProjectWindow(projectId) {
			void surface
				.invoke(CMD_OPEN_PROJECT_WINDOW, { projectId })
				.catch((err: unknown) => {
					console.warn(
						"[desktop] Failed to open project window:",
						err instanceof Error ? err.message : err,
					);
				});
		},

		restartRuntime() {
			void surface.invoke(CMD_RESTART_RUNTIME).catch((err: unknown) => {
				console.warn(
					"[desktop] Failed to restart the runtime:",
					err instanceof Error ? err.message : err,
				);
			});
		},

		reveal(target) {
			// Bring the window forward first: a deep link clicked from a
			// notification while the app is hidden would otherwise navigate a
			// window the user never sees.
			void window.unminimize().catch(() => {});
			void window.show().catch(() => {});
			void window.setFocus().catch(() => {});
			opts.navigate(target);
		},

		isAppFocused: () => focus.isFocused(),

		async pickDirectory(options) {
			try {
				const chosen = await surface.invoke<string | null>(CMD_PICK_DIRECTORY, {
					title: options?.title ?? null,
				});
				return typeof chosen === "string" && chosen.length > 0 ? chosen : null;
			} catch (err) {
				// A cancelled picker and a broken one both mean "no directory",
				// and the caller has one branch for that.
				console.warn(
					"[desktop] Directory picker failed:",
					err instanceof Error ? err.message : err,
				);
				return null;
			}
		},

		publishMenuActions(actions: readonly DesktopMenuAction[]) {
			void surface
				.invoke(CMD_PUBLISH_MENU_ACTIONS, { actions })
				.catch((err: unknown) => {
					console.warn(
						"[desktop] Failed to publish menu actions:",
						err instanceof Error ? err.message : err,
					);
				});
		},

		onMenuActionInvoked(listener) {
			let unlisten: UnlistenFn | null = null;
			let cancelled = false;

			void surface
				.listen<string>(EVENT_MENU_ACTION_INVOKED, (event) => {
					if (!cancelled) listener(event.payload);
				})
				.then((fn) => {
					// Unsubscribing before the listener is even registered is
					// normal in React StrictMode, which mounts and unmounts once
					// before the real mount.
					if (cancelled) {
						fn();
						return;
					}
					unlisten = fn;
				})
				.catch(() => {});

			return () => {
				cancelled = true;
				unlisten?.();
				unlisten = null;
			};
		},

		updater: updater.backend,
		notifications: notifications.backend,
		presence,

		dispose() {
			focus.dispose();
			updater.dispose();
			notifications.dispose();
		},
	};
}
