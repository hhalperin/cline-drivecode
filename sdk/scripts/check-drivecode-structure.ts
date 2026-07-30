#!/usr/bin/env bun
/**
 * Enforce the docs/drivecode/ directory skeleton (see STRUCTURE.md).
 *
 * Fails when agents drop docs in the wrong place: loose files under product
 * plans, flat assets, revived legacy paths, or unknown nest-root siblings.
 *
 * Usage:
 *   bun sdk/scripts/check-drivecode-structure.ts
 *   bun run check:drivecode-docs
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const nest = join(repoRoot, "docs", "drivecode");

type Issue = { path: string; message: string };

const issues: Issue[] = [];

function fail(relPath: string, message: string): void {
	issues.push({ path: relPath, message });
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function list(dir: string): Promise<{ name: string; isDir: boolean }[]> {
	if (!(await exists(dir))) return [];
	const entries = await readdir(dir, { withFileTypes: true });
	return entries
		.filter((e) => e.name !== ".DS_Store")
		.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
}

function nestRel(abs: string): string {
	return relative(repoRoot, abs).split("\\").join("/");
}

/** Required directories that must exist after migration. */
const REQUIRED_DIRS = [
	"reference",
	"plans",
	"plans/cline-drivemode",
	"plans/cline-drivemode/foundation",
	"plans/cline-drivemode/research",
	"plans/cline-drivemode/leadership",
	"plans/cline-drivemode/delivery",
	"plans/cline-drivemode/decisions",
	"plans/cline-drivemode/ard",
	"plans/cline-drivemode/prd",
	"plans/cline-drivemode/features",
	"plans/cline-drivemode/initiatives",
	"plans/cline-drivemode/schemas",
	"plans/cline-drivemode/examples",
	"plans/cline-drivemode/ops",
	"plans/cline-drivemode/archive",
	"plans/drivecode-sdk",
	"plans/drivecode-sdk/foundation",
	"plans/drivecode-sdk/delivery",
	"design",
	"design/brand",
	"design/wireframes",
	"design/canvases",
	"assets",
	"assets/logos",
	"assets/hub",
	"assets/tui",
	"assets/demos",
	"meta",
	"meta/reviews",
];

/** Nest root may only contain these files and directories. */
const NEST_ROOT_FILES = new Set([
	"README.md",
	"AGENTS.md",
	"HANDOFF.md",
	"CI.md",
	"STRUCTURE.md",
]);
const NEST_ROOT_DIRS = new Set([
	"reference",
	"plans",
	"design",
	"assets",
	"meta",
]);

/** Product plan track root: README + role folders only. */
const PRODUCT_ROLE_DIRS = new Set([
	"foundation",
	"research",
	"leadership",
	"delivery",
	"decisions",
	"ard",
	"prd",
	"features",
	"initiatives",
	"schemas",
	"examples",
	"ops",
	"archive",
]);

const HARNESS_ROOT_FILES = new Set(["README.md", "decisions.tsv"]);
const HARNESS_ROOT_DIRS = new Set(["foundation", "delivery"]);

const ASSET_BUCKETS = new Set(["logos", "hub", "tui", "demos"]);
const DESIGN_DIRS = new Set(["brand", "wireframes", "canvases"]);

/** Legacy paths that must stay gone. */
const FORBIDDEN_PATHS = [
	"design/drive-wireframes",
	"reviews",
	"plans/cline-drivemode/show-backlog-director",
	"plans/cline-drivemode/task-bank-drive-loop",
	"plans/cline-drivemode/share-and-router",
	"plans/cline-drivemode/share-screen-canvas",
];

async function checkRequiredDirs(): Promise<void> {
	for (const dir of REQUIRED_DIRS) {
		const abs = join(nest, dir);
		if (!(await exists(abs))) {
			fail(`docs/drivecode/${dir}`, "required directory missing");
		}
	}
}

async function checkForbidden(): Promise<void> {
	for (const dir of FORBIDDEN_PATHS) {
		const abs = join(nest, dir);
		if (await exists(abs)) {
			fail(
				`docs/drivecode/${dir}`,
				"legacy path must not exist — see STRUCTURE.md placement matrix",
			);
		}
	}
}

async function checkNestRoot(): Promise<void> {
	for (const entry of await list(nest)) {
		const rel = `docs/drivecode/${entry.name}`;
		if (entry.isDir) {
			if (!NEST_ROOT_DIRS.has(entry.name)) {
				fail(rel, `unknown nest-root directory (allowed: ${[...NEST_ROOT_DIRS].join(", ")})`);
			}
		} else if (!NEST_ROOT_FILES.has(entry.name)) {
			fail(
				rel,
				`loose file at nest root — put reference pages in reference/, process docs are limited to ${[...NEST_ROOT_FILES].join(", ")}`,
			);
		}
	}
}

async function checkProductPlanRoot(): Promise<void> {
	const root = join(nest, "plans", "cline-drivemode");
	for (const entry of await list(root)) {
		const rel = `docs/drivecode/plans/cline-drivemode/${entry.name}`;
		if (entry.isDir) {
			if (!PRODUCT_ROLE_DIRS.has(entry.name)) {
				fail(
					rel,
					`unknown product-plan role directory — multi-file tracks go under initiatives/<slug>/`,
				);
			}
		} else if (entry.name !== "README.md") {
			fail(
				rel,
				"no loose markdown at product-plan root — use foundation/, research/, leadership/, delivery/, ops/, archive/, or initiatives/",
			);
		}
	}
}

async function checkHarnessRoot(): Promise<void> {
	const root = join(nest, "plans", "drivecode-sdk");
	for (const entry of await list(root)) {
		const rel = `docs/drivecode/plans/drivecode-sdk/${entry.name}`;
		if (entry.isDir) {
			if (!HARNESS_ROOT_DIRS.has(entry.name)) {
				fail(rel, `unknown harness directory (allowed: ${[...HARNESS_ROOT_DIRS].join(", ")})`);
			}
		} else if (!HARNESS_ROOT_FILES.has(entry.name)) {
			fail(
				rel,
				"loose file at harness root — numbered series live in foundation/ or delivery/",
			);
		}
	}
}

async function checkAssets(): Promise<void> {
	const root = join(nest, "assets");
	for (const entry of await list(root)) {
		const rel = `docs/drivecode/assets/${entry.name}`;
		if (!entry.isDir) {
			fail(rel, "no loose files in assets/ — use logos/, hub/, tui/, or demos/");
			continue;
		}
		if (!ASSET_BUCKETS.has(entry.name)) {
			fail(rel, `unknown asset bucket (allowed: ${[...ASSET_BUCKETS].join(", ")})`);
		}
	}
}

async function checkDesign(): Promise<void> {
	const root = join(nest, "design");
	for (const entry of await list(root)) {
		const rel = `docs/drivecode/design/${entry.name}`;
		if (entry.isDir) {
			if (!DESIGN_DIRS.has(entry.name)) {
				fail(rel, `unknown design directory (allowed: ${[...DESIGN_DIRS].join(", ")})`);
			}
		} else if (entry.name !== "README.md") {
			fail(rel, "loose design file — use brand/, wireframes/, or canvases/");
		}
	}
}

async function checkMeta(): Promise<void> {
	const root = join(nest, "meta");
	for (const entry of await list(root)) {
		const rel = `docs/drivecode/meta/${entry.name}`;
		if (entry.isDir) {
			if (entry.name !== "reviews") {
				fail(rel, "unknown meta directory (allowed: reviews/)");
			}
		} else if (entry.name !== "glossary.md" && entry.name !== "README.md") {
			fail(rel, "meta root only allows glossary.md (and optional README.md)");
		}
	}
}

async function checkFeatureNames(): Promise<void> {
	const root = join(nest, "plans", "cline-drivemode", "features");
	for (const entry of await list(root)) {
		if (entry.isDir) {
			fail(
				`docs/drivecode/plans/cline-drivemode/features/${entry.name}`,
				"features/ holds DRV-*.md one-pagers only — multi-file plans go in initiatives/",
			);
			continue;
		}
		if (entry.name === "README.md") continue;
		if (!/^DRV-[A-Z0-9-]+\.md$/.test(entry.name)) {
			fail(
				`docs/drivecode/plans/cline-drivemode/features/${entry.name}`,
				"feature files must match DRV-*.md",
			);
		}
	}
}

async function checkArdNames(): Promise<void> {
	const root = join(nest, "plans", "cline-drivemode", "ard");
	for (const entry of await list(root)) {
		if (entry.isDir) {
			fail(
				`docs/drivecode/plans/cline-drivemode/ard/${entry.name}`,
				"ard/ holds ARD-*.md files only",
			);
			continue;
		}
		if (entry.name === "README.md") continue;
		if (!/^ARD-\d{4}-[a-z0-9-]+\.md$/.test(entry.name)) {
			fail(
				`docs/drivecode/plans/cline-drivemode/ard/${entry.name}`,
				"ARD files must match ARD-NNNN-slug.md",
			);
		}
	}
}

async function checkInitiativesHaveReadme(): Promise<void> {
	const root = join(nest, "plans", "cline-drivemode", "initiatives");
	for (const entry of await list(root)) {
		if (!entry.isDir) {
			if (entry.name !== "README.md") {
				fail(
					`docs/drivecode/plans/cline-drivemode/initiatives/${entry.name}`,
					"initiatives/ root only allows README.md and slug directories",
				);
			}
			continue;
		}
		const readme = join(root, entry.name, "README.md");
		if (!(await exists(readme))) {
			fail(
				`docs/drivecode/plans/cline-drivemode/initiatives/${entry.name}`,
				"each initiative must have a README.md (purpose, DRV links, status)",
			);
		}
	}
}

async function checkPlansIndex(): Promise<void> {
	const root = join(nest, "plans");
	for (const entry of await list(root)) {
		const rel = `docs/drivecode/plans/${entry.name}`;
		if (entry.isDir) {
			if (entry.name !== "cline-drivemode" && entry.name !== "drivecode-sdk") {
				fail(rel, "plans/ only hosts cline-drivemode/ and drivecode-sdk/");
			}
		} else if (entry.name !== "README.md") {
			fail(rel, "plans/ root only allows README.md");
		}
	}
}

async function main(): Promise<void> {
	if (!(await exists(nest))) {
		console.error("docs/drivecode/ is missing");
		process.exit(1);
	}

	await checkRequiredDirs();
	await checkForbidden();
	await checkNestRoot();
	await checkPlansIndex();
	await checkProductPlanRoot();
	await checkHarnessRoot();
	await checkAssets();
	await checkDesign();
	await checkMeta();
	await checkFeatureNames();
	await checkArdNames();
	await checkInitiativesHaveReadme();

	if (issues.length === 0) {
		console.log("docs/drivecode structure OK");
		return;
	}

	console.error(`docs/drivecode structure check failed (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n`);
	for (const issue of issues) {
		console.error(`  ${issue.path}`);
		console.error(`    ${issue.message}\n`);
	}
	console.error("See docs/drivecode/STRUCTURE.md placement matrix and docs/drivecode/AGENTS.md.");
	process.exit(1);
}

await main();
