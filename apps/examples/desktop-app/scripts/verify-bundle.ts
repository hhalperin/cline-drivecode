/**
 * Assertions about the packaged desktop artifact.
 *
 * Nothing in CI has ever inspected a desktop bundle. `desktop-publish.yml`
 * checks that a `.dmg` and a signed updater tarball exist, and that runs only
 * after a release tag is cut — so every packaging regression between
 * "compiles" and "ships" had no gate at all.
 *
 * What this checks is deliberately the staging, not the code: the frontend is
 * embedded into the binary by `tauri::generate_context!`, so a broken frontend
 * fails the build. The parts that can silently go missing from a bundle while
 * the build still succeeds are the `externalBin` sidecar and the `resources`,
 * and those are what a user hits as "the app opens and does nothing".
 *
 * Run with `--versions-only` to check just the version agreement, which needs
 * no bundle and so runs on every PR.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { $ } from "bun";

const APP_ROOT = path.resolve(import.meta.dir, "..");
const BUNDLE_ROOT = path.join(
	APP_ROOT,
	"src-tauri",
	"target",
	"release",
	"bundle",
);

const failures: string[] = [];

const check = (ok: boolean, message: string): void => {
	if (ok) {
		console.log(`  ok    ${message}`);
		return;
	}
	console.log(`  FAIL  ${message}`);
	failures.push(message);
};

const walk = (root: string): string[] => {
	if (!existsSync(root)) {
		return [];
	}
	const found: string[] = [];
	for (const entry of readdirSync(root)) {
		const full = path.join(root, entry);
		// Bundles contain symlinks (deb doc dirs); statSync follows them, and a
		// dangling one would throw mid-walk.
		let stats: ReturnType<typeof statSync>;
		try {
			stats = statSync(full);
		} catch {
			continue;
		}
		if (stats.isDirectory()) {
			found.push(...walk(full));
			continue;
		}
		found.push(full);
	}
	return found;
};

/**
 * `package.json` and `tauri.conf.json` carry the version separately, and
 * `desktop-publish.yml` only notices they disagree once a release tag exists to
 * compare them both against. By then the tag is cut. Checking it here means a
 * PR that bumps one and forgets the other fails at review time.
 */
const verifyVersions = async (): Promise<string> => {
	console.log("versions");
	const pkg = await Bun.file(path.join(APP_ROOT, "package.json")).json();
	const conf = await Bun.file(
		path.join(APP_ROOT, "src-tauri", "tauri.conf.json"),
	).json();

	const pkgVersion = String(pkg.version ?? "");
	const confVersion = String(conf.version ?? "");
	check(pkgVersion.length > 0, "package.json declares a version");
	check(
		pkgVersion === confVersion,
		`package.json (${pkgVersion}) and tauri.conf.json (${confVersion}) agree`,
	);
	return pkgVersion;
};

/**
 * The triple the sidecar must be named for.
 *
 * `build-sidecar-bin.ts` derives it the same way. A sidecar built for the wrong
 * triple is not a build error — Tauri simply cannot find one matching the host
 * and the bundle ships without it.
 */
const hostTriple = async (): Promise<string> => {
	const output = await $`rustc -vV`.text();
	const match = output.match(/^host:\s*(\S+)$/m);
	if (!match) {
		throw new Error("could not read the host triple from `rustc -vV`");
	}
	return match[1];
};

const verifyBundle = async (version: string): Promise<void> => {
	const triple = await hostTriple();

	console.log(`\nstaged sidecar (${triple})`);
	const stagedSidecar = path.join(
		APP_ROOT,
		"src-tauri",
		"bin",
		`code-sidecar-${triple}`,
	);
	check(
		existsSync(stagedSidecar),
		`src-tauri/bin/code-sidecar-${triple} was built for this host`,
	);
	if (existsSync(stagedSidecar)) {
		// A stub is what the fast CI lane writes to satisfy `tauri-build`. If one
		// survives into a packaging run the bundle ships a sidecar that exits 0
		// and serves nothing, which presents as an app that opens to a dead
		// connection.
		check(
			statSync(stagedSidecar).size > 1_000_000,
			"the staged sidecar is a real compiled binary, not a stub",
		);
	}

	console.log("\ndeb bundle");
	const debs = walk(path.join(BUNDLE_ROOT, "deb")).filter((file) =>
		file.endsWith(".deb"),
	);
	check(
		debs.length > 0,
		`a .deb exists under ${path.relative(APP_ROOT, BUNDLE_ROOT)}/deb`,
	);
	if (debs.length === 0) {
		return;
	}

	const deb = debs[0];
	check(
		path.basename(deb).includes(version),
		`${path.basename(deb)} carries version ${version}`,
	);

	const extractRoot = path.join(APP_ROOT, "dist", "bundle-verify");
	await $`rm -rf ${extractRoot}`;
	await $`mkdir -p ${extractRoot}`;
	await $`dpkg-deb -x ${deb} ${extractRoot}`;

	const contents = walk(extractRoot).map((file) =>
		path.relative(extractRoot, file),
	);

	console.log("\nbundle contents");
	check(
		contents.some((file) => /(^|\/)code-sidecar(-|$)/.test(file)),
		"the sidecar is staged inside the bundle (externalBin)",
	);
	check(
		contents.some((file) => file.startsWith("usr/bin/")),
		"an executable is installed under usr/bin",
	);
	check(
		contents.some((file) => /icons\/dock\/.*\.png$/.test(file)),
		"the dock icons are staged inside the bundle (resources)",
	);

	if (failures.length > 0) {
		console.log("\nbundle contained:");
		for (const file of contents.slice(0, 60)) {
			console.log(`  ${file}`);
		}
		if (contents.length > 60) {
			console.log(`  … and ${contents.length - 60} more`);
		}
	}
};

const main = async (): Promise<void> => {
	const version = await verifyVersions();
	if (!process.argv.includes("--versions-only")) {
		await verifyBundle(version);
	}

	if (failures.length > 0) {
		console.error(`\n${failures.length} bundle check(s) failed:`);
		for (const failure of failures) {
			console.error(`  - ${failure}`);
		}
		process.exitCode = 1;
		return;
	}
	console.log("\nall bundle checks passed");
};

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
