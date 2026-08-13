/**
 * `NotificationBackend` on top of `@tauri-apps/plugin-notification`.
 *
 * Two things about the plugin shape the design here.
 *
 * `sendNotification` is fire-and-forget: it returns no handle, so there is
 * nothing to hang a per-notification click listener off. `onAction` is a
 * single global subscription that hands back the notification's own `extra`
 * bag, so a correlation id put there on the way out is what routes a click
 * back to the right listener on the way in.
 *
 * Permission is async but `isSupported()` is not, so permission is primed once
 * at construction and the answer cached. Before it resolves the backend
 * reports unsupported, which the controller treats as "do not notify" — the
 * right way round, since notifying without permission fails anyway.
 *
 * Click delivery is best-effort. Notification actions are chiefly a mobile
 * affordance in Tauri, and on several Linux desktops `onAction` never fires.
 * The notification still shows; only the deep-link-on-click is lost. Saying so
 * is better than implying a reveal that may never happen.
 */

import type {
	NotificationBackend,
	NotificationHandle,
} from "@kanban/desktop-bridge";

import type { TauriSurface } from "./tauri-surface.js";

/** Key under which the correlation id rides in the notification's `extra`. */
export const CORRELATION_KEY = "kanbanNotificationId";

/**
 * Bounds the click-listener map.
 *
 * Notifications the user never clicks would otherwise accumulate for the life
 * of the process, and this app is built for sessions measured in days — the
 * same reasoning as `MAX_REMEMBERED_KEYS` in the controller.
 */
const MAX_PENDING_LISTENERS = 200;

export interface CreateNotificationBackendOptions {
	surface: TauriSurface;
}

export interface TauriNotificationBackend {
	backend: NotificationBackend;
	/** Releases the action subscription. Called from the host's `dispose`. */
	dispose(): void;
}

export function createTauriNotificationBackend(
	opts: CreateNotificationBackendOptions,
): TauriNotificationBackend {
	const notifications = opts.surface.notifications();

	let granted = false;
	let nextId = 0;
	let disposed = false;
	let unlisten: (() => void) | null = null;

	const listeners = new Map<string, () => void>();

	// Ask once, up front. `requestPermission` is a no-op when already granted,
	// and on desktop it resolves without prompting.
	void (async () => {
		try {
			granted =
				(await notifications.isPermissionGranted()) ||
				(await notifications.requestPermission());
		} catch {
			// No notification daemon, or a platform that refuses outright. The
			// controller degrades to not notifying, which is the documented
			// no-op rather than an error the user can act on.
			granted = false;
		}
	})();

	void notifications
		.onAction((payload) => {
			const id = payload.extra?.[CORRELATION_KEY];
			if (typeof id !== "string") return;
			const listener = listeners.get(id);
			listeners.delete(id);
			listener?.();
		})
		.then((fn) => {
			// Disposing before the subscription resolves is normal under React
			// StrictMode, which mounts and unmounts once before the real mount.
			if (disposed) {
				fn();
				return;
			}
			unlisten = fn;
		})
		.catch(() => {
			// Actions are unsupported here. Notifications still send.
		});

	const remember = (id: string, listener: () => void): void => {
		listeners.set(id, listener);
		if (listeners.size <= MAX_PENDING_LISTENERS) return;
		// Maps iterate in insertion order, so this evicts oldest-first.
		const oldest = listeners.keys().next();
		if (!oldest.done) listeners.delete(oldest.value);
	};

	const backend: NotificationBackend = {
		isSupported: () => granted,

		create(input): NotificationHandle {
			const id = `kanban-${nextId++}`;
			let onClick: (() => void) | null = null;

			return {
				onClick(listener) {
					onClick = listener;
				},
				show() {
					if (onClick) remember(id, onClick);
					notifications.send({
						title: input.title,
						body: input.body,
						extra: { [CORRELATION_KEY]: id },
					});
				},
			};
		},
	};

	return {
		backend,
		dispose() {
			disposed = true;
			unlisten?.();
			unlisten = null;
			listeners.clear();
		},
	};
}
