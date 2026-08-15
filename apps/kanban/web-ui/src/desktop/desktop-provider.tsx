import {
	createDesktopBridge,
	DESKTOP_BRIDGE_GLOBAL,
	type DesktopApi,
} from "@kanban/desktop-bridge";
import {
	createRealTauriSurface,
	createTauriDesktopHost,
} from "@kanban/desktop-tauri";
import { type ReactNode, useEffect, useState } from "react";

import { DesktopContext } from "./desktop-context";
import { navigateToDeepLink } from "./navigate-to-deep-link";

/**
 * Mounts the desktop bridge, if this window has a host behind it.
 *
 * Until this existed the bridge had no production caller at all —
 * `createDesktopBridge` and `createTauriDesktopHost` were reachable only from
 * their own tests, so every namespace was inert in the running product no
 * matter which capabilities the host advertised. This is the composition root
 * that makes the handshake actually happen.
 *
 * In a browser tab `createTauriDesktopHost` returns `null` and the context
 * stays `null`, which is the normal path: Kanban runs in a browser far more
 * often than in the desktop host.
 */
export function DesktopProvider({
	children,
}: {
	children: ReactNode;
}): ReactNode {
	const [api, setApi] = useState<DesktopApi | null>(null);

	useEffect(() => {
		let cancelled = false;
		let teardown: (() => void) | null = null;

		void (async () => {
			const host = await createTauriDesktopHost({
				surface: createRealTauriSurface(),
				navigate: navigateToDeepLink,
			});
			// Browser mode, or a host whose handshake failed. Either way the
			// adapter has already logged and there is nothing to mount.
			if (!host) return;

			// The effect can be torn down before the handshake resolves — React
			// StrictMode mounts and unmounts once before the real mount — and a
			// host built after that would leak its focus subscription.
			if (cancelled) {
				host.dispose();
				return;
			}

			const bridge = createDesktopBridge(host);

			// The contract names this global, and non-React code (and anyone at a
			// devtools console trying to work out whether the bridge is live)
			// reaches it here rather than through the context.
			(window as unknown as Record<string, unknown>)[DESKTOP_BRIDGE_GLOBAL] =
				bridge.api;
			setApi(bridge.api);

			teardown = () => {
				bridge.dispose();
				host.dispose();
				delete (window as unknown as Record<string, unknown>)[
					DESKTOP_BRIDGE_GLOBAL
				];
			};
		})();

		return () => {
			cancelled = true;
			teardown?.();
			teardown = null;
			setApi(null);
		};
	}, []);

	return (
		<DesktopContext.Provider value={api}>{children}</DesktopContext.Provider>
	);
}
