/**
 * `UpdaterBackend` backed by the host app's own updater.
 *
 * ## Why not `@tauri-apps/plugin-updater` directly
 *
 * The host already updates itself: `main.rs` runs `check_and_install_update`
 * on a two-hour loop and installs what it finds. Driving the plugin from here
 * as well would put two updaters on one bundle, racing to download and replace
 * the same file — the same "one resource, two writers" shape as the tray
 * conflict in ADR-0036, but with a worse failure mode than a stale number.
 *
 * So this reads the host's status instead of running a second updater, and
 * `check()` asks the host to run *its* check now rather than starting a
 * parallel one.
 *
 * ## What that costs
 *
 * The host installs without asking, so the bridge's `available` → user
 * consents → `install()` flow does not exist here: by the time anything is
 * observable the download is usually already underway. `install()` therefore
 * means "restart to apply", which is the only action actually left to a user.
 * The controller's state machine copes with this unchanged — it is written for
 * backends that emit on their own timers.
 *
 * There is no progress callback either. The host passes `|_, _| {}` to
 * `download_and_install`, so `downloading` maps to `available` rather than
 * inventing a percentage.
 */

import type {
	UpdaterBackend,
	UpdaterBackendEvent,
} from "@kanban/desktop-bridge";

import {
	CMD_CHECK_FOR_UPDATES,
	CMD_RESTART_TO_APPLY_UPDATE,
	CMD_UPDATE_STATUS,
	type HostUpdateStatus,
} from "./commands.js";
import type { TauriSurface } from "./tauri-surface.js";

/**
 * Matches the tray poll in the host's own webview. The host has no update
 * event to subscribe to — its webview polls too — so this is the same
 * trade-off made in the same place, not a new one.
 */
export const UPDATE_POLL_INTERVAL_MS = 5_000;

export interface CreateUpdaterBackendOptions {
	surface: TauriSurface;
	/** Overridden in tests; defaults to {@link UPDATE_POLL_INTERVAL_MS}. */
	pollIntervalMs?: number;
}

export interface TauriUpdaterBackend {
	backend: UpdaterBackend;
	/** Stops polling. Called from the host's `dispose`. */
	dispose(): void;
}

/**
 * Map the host's status onto a backend event.
 *
 * Returns `null` for a state this build does not know, so a host that grows a
 * new one degrades to silence rather than to a wrong event.
 */
export function toUpdaterEvent(
	status: HostUpdateStatus,
): UpdaterBackendEvent | null {
	switch (status.state) {
		case "checking":
			return { kind: "checking" };
		case "idle":
			return { kind: "up-to-date" };
		case "downloading":
			// `available` rather than `progress`: the host reports no percentage,
			// and a fabricated one would be worse than none.
			return status.version
				? { kind: "available", version: status.version }
				: null;
		case "ready":
			return status.version ? { kind: "ready", version: status.version } : null;
		case "error":
			return {
				kind: "error",
				message: status.error ?? "The update check failed.",
			};
		default:
			return null;
	}
}

function isHostUpdateStatus(value: unknown): value is HostUpdateStatus {
	if (typeof value !== "object" || value === null) return false;
	return typeof (value as { state?: unknown }).state === "string";
}

export function createTauriUpdaterBackend(
	opts: CreateUpdaterBackendOptions,
): TauriUpdaterBackend {
	const { surface } = opts;
	const pollIntervalMs = opts.pollIntervalMs ?? UPDATE_POLL_INTERVAL_MS;

	let timer: ReturnType<typeof setInterval> | null = null;
	// The controller treats a repeat as a real transition — `ready` → `ready`
	// is how it learns about a newer version — so a poll must only speak when
	// something actually changed.
	let lastSerialised: string | null = null;

	const readStatus = async (): Promise<HostUpdateStatus | null> => {
		try {
			const raw = await surface.invoke<unknown>(CMD_UPDATE_STATUS);
			return isHostUpdateStatus(raw) ? raw : null;
		} catch {
			// The host command is missing or failed. Reporting an error event
			// here would put an error banner in front of the user for something
			// they cannot act on; staying quiet leaves the status `idle`.
			return null;
		}
	};

	const backend: UpdaterBackend = {
		subscribe(emit) {
			const tick = async (): Promise<void> => {
				const status = await readStatus();
				if (!status) return;

				const serialised = `${status.state}:${status.version ?? ""}:${status.error ?? ""}`;
				if (serialised === lastSerialised) return;
				lastSerialised = serialised;

				const event = toUpdaterEvent(status);
				if (event) emit(event);
			};

			void tick();
			timer = setInterval(() => {
				void tick();
			}, pollIntervalMs);
		},

		async checkForUpdates() {
			// Resolves when the host's check finishes, which is what lets the
			// controller clear its in-flight latch even if no event followed.
			await surface.invoke(CMD_CHECK_FOR_UPDATES);
		},

		quitAndInstall() {
			// Never returns on success: the host restarts the process.
			void surface.invoke(CMD_RESTART_TO_APPLY_UPDATE).catch((err: unknown) => {
				console.warn(
					"[desktop] Failed to restart for update:",
					err instanceof Error ? err.message : err,
				);
			});
		},
	};

	return {
		backend,
		dispose() {
			if (timer !== null) {
				clearInterval(timer);
				timer = null;
			}
		},
	};
}
