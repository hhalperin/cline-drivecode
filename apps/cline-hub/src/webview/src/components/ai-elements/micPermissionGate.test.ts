import { describe, expect, it, vi } from "vitest";
import {
	createMicPermissionGate,
	ensureMicPermission,
	type MicPermissionStatusLike,
	micPermissionState,
	noteMicPermissionFailure,
} from "./micPermissionGate";

/** A fake `PermissionStatus`: mutate `state`, then fire `onchange` like a browser. */
function fakeStatus(
	state: string,
): MicPermissionStatusLike & { fire(next: string): void } {
	const status = {
		onchange: null as (() => void) | null,
		state,
		fire(next: string) {
			status.state = next;
			status.onchange?.();
		},
	};
	return status;
}

const DENIAL = { name: "NotAllowedError" };

describe("createMicPermissionGate", () => {
	it("degrades to attempt-based behaviour when the query is unsupported", async () => {
		// Firefox rejects query({ name: "microphone" }). Feature detection must
		// never be the thing that blocks the mic.
		const query = vi.fn(() => Promise.reject(new Error("unsupported")));
		const gate = createMicPermissionGate(query);

		expect(await gate.check()).toBe("unknown");
		expect(await gate.check()).toBe("unknown");
		// One failed probe is enough; it is not retried on every press.
		expect(query).toHaveBeenCalledTimes(1);
	});

	it("blocks the second request after a denial-class rejection", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.reject(new Error("unsupported")),
		);

		expect(await gate.check()).toBe("unknown");
		expect(gate.noteFailure(DENIAL)).toBe(true);
		expect(await gate.check()).toBe("denied");
	});

	it("does not stick on failures that are not a refusal", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.reject(new Error("unsupported")),
		);

		expect(gate.noteFailure({ name: "NotFoundError" })).toBe(false);
		expect(gate.noteFailure({ name: "NotReadableError" })).toBe(false);
		expect(gate.noteFailure(new Error("boom"))).toBe(false);
		expect(await gate.check()).toBe("unknown");
	});

	it("blocks before the first request when the browser already says denied", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.resolve(fakeStatus("denied")),
		);

		expect(await gate.check()).toBe("denied");
	});

	it("keeps a remembered denial when the browser still reports prompt", async () => {
		// The reported bug's surface: the pane blocks capture by policy while
		// PermissionStatus never leaves "prompt". Re-reading it must not forget.
		const status = fakeStatus("prompt");
		const gate = createMicPermissionGate(() => Promise.resolve(status));

		expect(await gate.check()).toBe("unknown");
		gate.noteFailure(DENIAL);
		expect(await gate.check()).toBe("denied");
		expect(await gate.check()).toBe("denied");
	});

	it("clears the denial when PermissionStatus flips to granted", async () => {
		const status = fakeStatus("prompt");
		const gate = createMicPermissionGate(() => Promise.resolve(status));
		const seen: string[] = [];
		gate.subscribe((next) => seen.push(next));

		await gate.check();
		gate.noteFailure(DENIAL);
		expect(gate.state()).toBe("denied");

		status.fire("granted");

		expect(gate.state()).toBe("granted");
		expect(await gate.check()).toBe("granted");
		expect(seen).toEqual(["denied", "granted"]);
	});

	it("clears the denial on an explicit retry even with no query support", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.reject(new Error("unsupported")),
		);

		await gate.check();
		gate.noteFailure(DENIAL);
		expect(await gate.check()).toBe("denied");

		gate.retry();

		// Exactly one more attempt: the browser cannot be asked, so the caller
		// gets to try, and a second refusal re-arms the gate.
		expect(await gate.check()).toBe("unknown");
		gate.noteFailure(DENIAL);
		expect(await gate.check()).toBe("denied");
	});

	it("re-arms after a retry when the browser authoritatively says denied", async () => {
		const status = fakeStatus("denied");
		const gate = createMicPermissionGate(() => Promise.resolve(status));

		expect(await gate.check()).toBe("denied");
		gate.retry();
		// No getUserMedia is spent re-confirming what the browser already answered.
		expect(await gate.check()).toBe("denied");

		status.fire("granted");
		expect(await gate.check()).toBe("granted");
	});

	it("clears the denial when a later request succeeds", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.reject(new Error("unsupported")),
		);

		gate.noteFailure(DENIAL);
		gate.noteGranted();
		expect(await gate.check()).toBe("granted");
	});

	it("stops notifying an unsubscribed listener", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.reject(new Error("unsupported")),
		);
		const listener = vi.fn();

		gate.subscribe(listener)();
		gate.noteFailure(DENIAL);

		expect(listener).not.toHaveBeenCalled();
	});

	it("only notifies on a real transition", async () => {
		const gate = createMicPermissionGate(() =>
			Promise.reject(new Error("unsupported")),
		);
		const listener = vi.fn();
		gate.subscribe(listener);

		gate.noteFailure(DENIAL);
		gate.noteFailure(DENIAL);

		expect(listener).toHaveBeenCalledTimes(1);
	});
});

describe("shared gate singleton", () => {
	it("remembers a denial for every call site in the webview", async () => {
		// No `navigator.permissions` in the node env, so this exercises the
		// attempt-based path the three getUserMedia call sites share.
		expect(await ensureMicPermission()).toBe("unknown");
		expect(noteMicPermissionFailure(DENIAL)).toBe(true);
		expect(micPermissionState()).toBe("denied");
		expect(await ensureMicPermission()).toBe("denied");
	});
});
