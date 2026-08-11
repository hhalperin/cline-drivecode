import { defineConfig } from "vitest/config";

/**
 * The packaged suite: launches a real built bundle and observes it.
 *
 * Separate from `vitest.config.ts` for the same reason `apps/cli` splits its
 * e2e configs out — these need an artifact that only a packaging run produces,
 * so sweeping them into the default suite would make `bun -F @cline/code test`
 * fail on any machine that has not built one.
 */
export default defineConfig({
	test: {
		environment: "node",
		include: ["**/*.packaged.e2e.test.ts"],
		exclude: ["**/node_modules/**"],
		// A bundle launch waits on a real webview, a sidecar and a Node runtime
		// coming up, then on a shutdown grace period.
		testTimeout: 120_000,
		hookTimeout: 120_000,
		// One app at a time. Two bundles racing would contend for ports and make
		// the descendant-process assertions ambiguous about which app owns what.
		pool: "forks",
		maxWorkers: 1,
		fileParallelism: false,
	},
});
