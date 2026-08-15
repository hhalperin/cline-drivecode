import type { DesktopApi } from "@kanban/desktop-bridge";
import { createContext, useContext } from "react";

/**
 * The desktop bridge, or `null` in a browser tab.
 *
 * `null` is the ordinary case, not an error: Kanban runs in a browser far more
 * often than in the desktop host, and every consumer has to handle its absence
 * anyway. Callers should branch on it rather than assert.
 */
export const DesktopContext = createContext<DesktopApi | null>(null);

/**
 * The desktop bridge for this window, or `null` when there isn't one.
 *
 * Prefer `desktop?.capabilities.includes("windows")` over checking the
 * platform: a host can be present and still not implement a namespace, and the
 * capability model is what encodes that. Every namespace method already no-ops
 * when its capability is absent, so a missed check degrades to silence rather
 * than a crash.
 */
export function useDesktop(): DesktopApi | null {
	return useContext(DesktopContext);
}
