import { beforeEach, describe, expect, it, vi } from "vitest";

import { navigateToDeepLink } from "@/desktop/navigate-to-deep-link";

describe("navigateToDeepLink", () => {
	beforeEach(() => {
		window.history.replaceState(null, "", "/");
		vi.restoreAllMocks();
	});

	it("navigates to the target's path and search", () => {
		navigateToDeepLink({
			projectId: "acme",
			pathname: "/acme",
			search: "?task=t-1",
		});

		expect(window.location.pathname).toBe("/acme");
		expect(window.location.search).toBe("?task=t-1");
	});

	it("announces the navigation so the app's hooks react", () => {
		// `pushState` deliberately does not fire `popstate`, and both
		// `use-project-navigation` and `use-detail-task-navigation` listen for
		// exactly that. Without the dispatch the URL changes and the UI does
		// not — a deep link that looks like it did nothing.
		const listener = vi.fn();
		window.addEventListener("popstate", listener);

		navigateToDeepLink({
			projectId: "acme",
			pathname: "/acme",
			search: "",
		});

		expect(listener).toHaveBeenCalledTimes(1);
		window.removeEventListener("popstate", listener);
	});

	it("does nothing when already at the target", () => {
		// A notification clicked while its task is already open should not push
		// a duplicate history entry, or Back stops going anywhere.
		window.history.replaceState(null, "", "/acme?task=t-1");
		const listener = vi.fn();
		window.addEventListener("popstate", listener);

		navigateToDeepLink({
			projectId: "acme",
			pathname: "/acme",
			search: "?task=t-1",
		});

		expect(listener).not.toHaveBeenCalled();
		window.removeEventListener("popstate", listener);
	});
});
