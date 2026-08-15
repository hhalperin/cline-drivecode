import type { DeepLinkTarget } from "@kanban/desktop-bridge";

/**
 * Navigate the current window to a deep-link target.
 *
 * Routing is the web UI's concern rather than the host's, which is why the
 * bridge takes this as a callback instead of owning it.
 *
 * `pathname` is already `/<projectId>` and `search` already carries its
 * leading `?`, so the two concatenate directly — see `resolveDeepLinkRoute`,
 * which builds them for exactly this.
 */
export function navigateToDeepLink(target: DeepLinkTarget): void {
	if (typeof window === "undefined") return;

	const url = `${target.pathname}${target.search}`;
	const current = `${window.location.pathname}${window.location.search}`;
	if (url === current) return;

	window.history.pushState(window.history.state, "", url);
	// `pushState` deliberately does not fire `popstate`, and this app's
	// navigation hooks (`use-project-navigation`, `use-detail-task-navigation`)
	// listen for exactly that. A programmatic navigation therefore has to
	// announce itself, or the URL changes while the UI stays where it was.
	window.dispatchEvent(new PopStateEvent("popstate"));
}
