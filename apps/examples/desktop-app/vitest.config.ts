import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./webview", import.meta.url)),
		},
	},
	test: {
		environment: "node",
		// Scoped rather than left to vitest's default glob, because this package
		// runs two test runners. Everything under `webview/` and `sidecar/`
		// imports from `vitest`; `scripts/generate-update-manifest.test.ts`
		// imports from `bun:test` and is run by `bun test` (see `test:scripts`).
		// The default glob sweeps the bun:test file in and fails on its import.
		include: ["webview/**/*.test.{ts,tsx}", "sidecar/**/*.test.ts"],
		// The packaged suite needs a built bundle that only the `ci/desktop`
		// lane produces, so it carries its own config and stays out of the
		// default run. Same suffix-plus-separate-config split as apps/cli.
		exclude: ["**/node_modules/**", "**/*.packaged.e2e.test.ts"],
		// Above vitest's 5s default because several sidecar tests `await
		// import(...)` the module under test from inside the test body, so the
		// transform cost lands on the test's own clock. Locally that only bites
		// on a cold cache; in CI every run is a cold cache, which is why these
		// two passed for whoever ran them by hand and would have failed on the
		// first CI run. Not an e2e-sized budget — just headroom over a
		// transform.
		testTimeout: 20_000,
	},
});
