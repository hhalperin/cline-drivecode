/**
 * Sticky microphone-permission state shared by every `getUserMedia` call site
 * in the webview.
 *
 * A surface that blocks the mic — an embedded browser pane, an enterprise
 * policy — raises its own banner on *every* request, so a UI that keeps asking
 * after a refusal spams a prompt the user cannot answer. This remembers the
 * refusal and answers locally instead.
 *
 * It must never make the mic unrecoverable, so the sticky state is deliberately
 * easy to clear: a `PermissionStatus` flip to "granted" clears it with no
 * reload, and an explicit user retry clears it even in browsers that cannot be
 * queried at all. A failed or absent `navigator.permissions.query` degrades to
 * the old attempt-based behaviour — feature detection is never itself a block.
 *
 * No React and no imports beyond the shared classifier, so the webview's
 * node-env tests can drive the real logic through
 * {@link createMicPermissionGate}.
 */

import { isSpeechInputDenial } from "./speechInputSupport";

export type MicPermissionState = "unknown" | "granted" | "denied";

/** The slice of `PermissionStatus` this gate uses. */
export type MicPermissionStatusLike = {
	state: string;
	onchange: (() => void) | null;
};

export type MicPermissionQuery = () => Promise<MicPermissionStatusLike>;

export type MicPermissionGate = {
	/** Last known state. Synchronous, never throws — safe to read in render. */
	state(): MicPermissionState;
	/**
	 * Pre-flight for a `getUserMedia` call. "denied" means: do not ask, the
	 * prompt is known-blocked. Anything else means the caller should try.
	 */
	check(): Promise<MicPermissionState>;
	/** Record a `getUserMedia` that resolved. */
	noteGranted(): void;
	/** Record a rejection. True when it was denial-class and is now sticky. */
	noteFailure(error: unknown): boolean;
	/** Explicit user retry — forget a remembered denial. */
	retry(): void;
	subscribe(listener: (state: MicPermissionState) => void): () => void;
};

function defaultMicPermissionQuery(): Promise<MicPermissionStatusLike> {
	if (typeof navigator === "undefined" || !navigator.permissions?.query) {
		return Promise.reject(new Error("permissions_query_unsupported"));
	}
	// Firefox has historically rejected the "microphone" descriptor. The caller
	// treats that as "cannot know", never as a denial.
	return navigator.permissions.query({
		name: "microphone" as PermissionName,
	}) as unknown as Promise<MicPermissionStatusLike>;
}

export function createMicPermissionGate(
	query: MicPermissionQuery = defaultMicPermissionQuery,
): MicPermissionGate {
	let state: MicPermissionState = "unknown";
	let watched: MicPermissionStatusLike | null = null;
	let watching: Promise<void> | null = null;
	let queryable = true;
	const listeners = new Set<(next: MicPermissionState) => void>();

	function publish(next: MicPermissionState): void {
		if (next === state) {
			return;
		}
		state = next;
		for (const listener of [...listeners]) {
			listener(next);
		}
	}

	function adopt(status: MicPermissionStatusLike): void {
		if (status.state === "granted") {
			publish("granted");
			return;
		}
		if (status.state === "denied") {
			publish("denied");
			return;
		}
		// "prompt": the browser will still ask, which is not evidence the mic
		// works — a surface that blocks capture by policy reports "prompt"
		// forever. It therefore never clears a refusal we actually observed;
		// only a grant, a capture that succeeds, or an explicit retry does.
		if (state !== "denied") {
			publish("unknown");
		}
	}

	function watch(): Promise<void> {
		if (watching) {
			return watching;
		}
		watching = (async () => {
			let status: MicPermissionStatusLike;
			try {
				status = await query();
			} catch {
				queryable = false;
				return;
			}
			if (!status || typeof status.state !== "string") {
				queryable = false;
				return;
			}
			watched = status;
			// A grant made after the denial has to reach us without a reload.
			status.onchange = () => adopt(status);
			adopt(status);
		})();
		return watching;
	}

	return {
		state: () => state,
		async check() {
			// A remembered denial answers without re-reading the browser: a surface
			// that blocks the mic by policy still reports "prompt", and adopting
			// that would forget the denial and re-trigger the very prompt this
			// gate exists to stop.
			if (state === "denied") {
				return "denied";
			}
			if (watched) {
				adopt(watched);
				return state;
			}
			if (queryable) {
				await watch();
			}
			return state;
		},
		noteGranted() {
			publish("granted");
		},
		noteFailure(error) {
			if (!isSpeechInputDenial({ error })) {
				return false;
			}
			publish("denied");
			return true;
		},
		retry() {
			// A browser that still reports "denied" re-arms the gate on the next
			// check without another prompt; one that reports "prompt" — or cannot
			// be queried at all — buys exactly one more attempt.
			publish("unknown");
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

const gate = createMicPermissionGate();

export function micPermissionState(): MicPermissionState {
	return gate.state();
}

export function ensureMicPermission(): Promise<MicPermissionState> {
	return gate.check();
}

export function noteMicPermissionGranted(): void {
	gate.noteGranted();
}

export function noteMicPermissionFailure(error: unknown): boolean {
	return gate.noteFailure(error);
}

export function retryMicPermission(): void {
	gate.retry();
}

export function subscribeMicPermission(
	listener: (state: MicPermissionState) => void,
): () => void {
	return gate.subscribe(listener);
}
