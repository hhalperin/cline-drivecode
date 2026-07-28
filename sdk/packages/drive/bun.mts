/// <reference types="@types/bun" />
export {};

const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";
const minify = Bun.env.CLINE_SOURCEMAPS !== "1";

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "node",
	minify,
	sourcemap,
	packages: "bundle",
	external: ["@cline/shared"],
});

if (result.logs.length > 0) {
	for (const log of result.logs) {
		console.warn(log);
	}
}

if (!result.success) {
	throw new Error("Failed @cline/drive build");
}
