import {
	DESKTOP_BRIDGE_GLOBAL,
	type DesktopApi,
	type DesktopHost,
} from "@kanban/desktop-bridge";
import { createTauriDesktopHost } from "@kanban/desktop-tauri";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDesktop } from "@/desktop/desktop-context";
import { DesktopProvider } from "@/desktop/desktop-provider";

// The adapter is the seam: everything below it is the real bridge, so the
// capability derivation under test is the production one rather than a double.
vi.mock("@kanban/desktop-tauri", () => ({
	createRealTauriSurface: () => ({}),
	createTauriDesktopHost: vi.fn(),
}));

const mockCreateHost = vi.mocked(createTauriDesktopHost);

const dispose = vi.fn();

function fakeHost(overrides: Partial<DesktopHost> = {}): DesktopHost & {
	dispose(): void;
} {
	return {
		platform: "darwin",
		appVersion: "1.4.0",
		isPackaged: true,
		declaredCapabilities: ["windows", "runtime", "dialogs"],
		openProjectWindow: vi.fn(),
		restartRuntime: vi.fn(),
		reveal: vi.fn(),
		isAppFocused: () => false,
		pickDirectory: vi.fn(async () => null),
		publishMenuActions: vi.fn(),
		onMenuActionInvoked: () => () => {},
		updater: null,
		notifications: null,
		presence: null,
		dispose,
		...overrides,
	};
}

let seen: DesktopApi | null = null;

function Probe(): null {
	seen = useDesktop();
	return null;
}

describe("DesktopProvider", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	const globals = globalThis as typeof globalThis & {
		IS_REACT_ACT_ENVIRONMENT?: boolean;
	};

	beforeEach(() => {
		previousActEnvironment = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		seen = null;
		dispose.mockClear();
		mockCreateHost.mockReset();
		delete (window as unknown as Record<string, unknown>)[
			DESKTOP_BRIDGE_GLOBAL
		];
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		globals.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
	});

	async function mount(): Promise<void> {
		await act(async () => {
			root.render(
				<DesktopProvider>
					<Probe />
				</DesktopProvider>,
			);
		});
	}

	it("stays inert in a browser tab", async () => {
		// The ordinary case: Kanban runs in a browser far more often than in
		// the desktop host, and the adapter returns null there.
		mockCreateHost.mockResolvedValue(null);
		await mount();

		expect(seen).toBeNull();
		expect(
			(window as unknown as Record<string, unknown>)[DESKTOP_BRIDGE_GLOBAL],
			"a browser tab must not grow a window.desktop",
		).toBeUndefined();
	});

	it("mounts the bridge when a host answers the handshake", async () => {
		// Before this provider existed, `createDesktopBridge` had no production
		// caller at all — the handshake never ran and every namespace was inert
		// no matter what the host advertised.
		mockCreateHost.mockResolvedValue(fakeHost());
		await mount();

		expect(seen).not.toBeNull();
		expect(seen?.capabilities).toContain("windows");
		expect(
			(window as unknown as Record<string, unknown>)[DESKTOP_BRIDGE_GLOBAL],
		).toBe(seen);
	});

	it("derives capabilities from the backends the host supplies", async () => {
		// `updates` and `notifications` are derived rather than declared, so a
		// host that supplies neither must not advertise them even though it
		// declares the command-backed ones.
		mockCreateHost.mockResolvedValue(fakeHost());
		await mount();

		expect(seen?.capabilities).not.toContain("updates");
		expect(seen?.capabilities).not.toContain("notifications");
		expect(seen?.capabilities).not.toContain("presence");
	});

	it("releases the host and the global on unmount", async () => {
		// A reloaded renderer would otherwise leave menu-action listeners
		// stacked on the host and a stale bridge on `window`.
		mockCreateHost.mockResolvedValue(fakeHost());
		await mount();

		await act(async () => root.unmount());

		expect(dispose).toHaveBeenCalled();
		expect(
			(window as unknown as Record<string, unknown>)[DESKTOP_BRIDGE_GLOBAL],
		).toBeUndefined();
	});

	it("disposes a host that arrives after teardown", async () => {
		// The handshake is async, so an unmount can land before it resolves —
		// which is exactly what React StrictMode does on every mount. Without
		// the cancelled check the host would leak its focus subscription.
		let settle: ((host: DesktopHost | null) => void) | null = null;
		mockCreateHost.mockReturnValue(
			new Promise((resolve) => {
				settle = resolve as (host: DesktopHost | null) => void;
			}) as ReturnType<typeof createTauriDesktopHost>,
		);

		await mount();
		await act(async () => root.unmount());
		await act(async () => {
			settle?.(fakeHost());
		});

		expect(dispose).toHaveBeenCalled();
		expect(
			(window as unknown as Record<string, unknown>)[DESKTOP_BRIDGE_GLOBAL],
			"a late host must not install itself on a torn-down window",
		).toBeUndefined();
	});
});
