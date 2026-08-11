/**
 * Launch the packaged desktop app and watch it from outside.
 *
 * Every other test in this repo runs against source. This one runs the artifact
 * a user installs, which is where a specific class of defect lives: the
 * capability manifest, the staged sidecar, the shutdown signal, and the PATH a
 * GUI-launched process inherits. All four were named in #237 and #235 as
 * uncovered, and all four are invisible to a unit test because they are
 * properties of the bundle and its environment rather than of any function.
 *
 * Nothing here reaches into the app. The bridge that `window.desktop` would
 * expose has no production caller yet, so there is no in-page surface to drive;
 * instead every assertion is made from the process table, which is available
 * whether or not the renderer ever mounts anything.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(import.meta.dirname);
const REPO_ROOT = path.resolve(APP_ROOT, "..", "..", "..");

/**
 * The PATH a double-clicked `.app` inherits from launchd. Reproduced exactly,
 * because the bug this guards against is that a bare `Command::new("bun")`
 * resolves against *this* and fails with nothing but "No such file or
 * directory" — while a shell-launched dev run works perfectly.
 */
const LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

// ---------------------------------------------------------------------------
// Locating the artifact

/**
 * The built `.deb`, or a thrown error naming the command that produces one.
 *
 * Deliberately refuses to fall back to a dev build or a bare `cargo` binary:
 * a packaged test that silently runs something other than the package is a
 * test that reports coverage it does not have. Same stance as
 * `apps/cli/src/tests/helpers/constants.ts`.
 */
const resolveBundle = (): string => {
	const debDir = path.join(
		APP_ROOT,
		"src-tauri",
		"target",
		"release",
		"bundle",
		"deb",
	);
	const debs = existsSync(debDir)
		? readdirSync(debDir).filter((entry) => entry.endsWith(".deb"))
		: [];
	if (debs.length === 0) {
		throw new Error(
			`no .deb found under ${debDir}.\n` +
				"Build one first:\n" +
				"  bunx tauri build --config src-tauri/tauri.citest.conf.json\n" +
				"(run from apps/examples/desktop-app)",
		);
	}
	return path.join(debDir, debs[0]);
};

/** Extract the package and return the executable a user would actually run. */
const installBundle = async (deb: string, into: string): Promise<string> => {
	await run("dpkg-deb", ["-x", deb, into]);

	const binDir = path.join(into, "usr", "bin");
	const entries = existsSync(binDir) ? readdirSync(binDir) : [];
	const executable = entries
		.map((entry) => path.join(binDir, entry))
		.find((candidate) => {
			try {
				const stats = statSync(candidate);
				return stats.isFile() && (stats.mode & 0o111) !== 0;
			} catch {
				return false;
			}
		});

	if (!executable) {
		throw new Error(
			`the package installed no executable under usr/bin; found: ${entries.join(", ") || "(nothing)"}`,
		);
	}
	return executable;
};

const run = (command: string, args: string[]): Promise<void> =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "ignore" });
		child.on("error", reject);
		child.on("exit", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`${command} exited with ${code}`)),
		);
	});

// ---------------------------------------------------------------------------
// Reading the process table
//
// /proc rather than `ps`, so the assertions do not depend on a particular
// procps output format.

const procCmdline = (pid: number): string | null => {
	try {
		// argv is NUL-separated; spaces keep it readable in failure output.
		return readFileSync(`/proc/${pid}/cmdline`, "utf8")
			.replace(/\0+$/, "")
			.split("\0")
			.join(" ");
	} catch {
		return null;
	}
};

const procParent = (pid: number): number | null => {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		// The comm field can contain spaces and parentheses, so index from the
		// last ')' rather than splitting the whole line.
		const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
		return Number(fields[1]);
	} catch {
		return null;
	}
};

const livePids = (): number[] =>
	readdirSync("/proc")
		.filter((entry) => /^\d+$/.test(entry))
		.map(Number);

/** Every live descendant of `root`, transitively. */
const descendantsOf = (root: number): number[] => {
	const byParent = new Map<number, number[]>();
	for (const pid of livePids()) {
		const parent = procParent(pid);
		if (parent === null) {
			continue;
		}
		byParent.set(parent, [...(byParent.get(parent) ?? []), pid]);
	}

	const found: number[] = [];
	const queue = [root];
	while (queue.length > 0) {
		const current = queue.shift() as number;
		for (const child of byParent.get(current) ?? []) {
			found.push(child);
			queue.push(child);
		}
	}
	return found;
};

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const describeTree = (pids: number[]): string =>
	pids.map((pid) => `  ${pid}  ${procCmdline(pid) ?? "(gone)"}`).join("\n") ||
	"  (no descendants)";

const waitFor = async (
	predicate: () => boolean,
	timeoutMs: number,
): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	return predicate();
};

// ---------------------------------------------------------------------------

describe("packaged desktop app", () => {
	let workdir = "";
	let launcher: ChildProcess | null = null;
	let appPid = 0;
	let stderr = "";

	beforeAll(async () => {
		workdir = await mkdtemp(path.join(os.tmpdir(), "cline-packaged-"));
		const executable = await installBundle(resolveBundle(), workdir);

		// `xvfb-run` supplies a display; `env -i` inside it strips everything
		// else, so the app starts with the environment launchd would give it and
		// not the one this test process happens to have.
		//
		// HOME is kept because launchd sets it, and two things need it:
		// `resolve_workspace_root` shells out to git, and the GUI PATH policy
		// appends $HOME/.bun/bin.
		//
		// cwd is the repo checkout on purpose. `resolve_workspace_root` runs
		// `git rev-parse --show-toplevel` from the launch directory and
		// `resolve_kanban_runtime_entry` then looks for apps/kanban/src/cli.ts
		// under it. Launched anywhere else the runtime is skipped by design —
		// a packaged bundle ships no Kanban runtime, which #228 recorded as an
		// open question — so this exercises the source-checkout configuration,
		// which is the only one where that spawn path is reachable at all.
		launcher = spawn(
			"xvfb-run",
			[
				"-a",
				"--server-args=-screen 0 1280x800x24",
				"sh",
				"-c",
				`exec env -i HOME="$HOME" DISPLAY="$DISPLAY" PATH="${LAUNCHD_PATH}" ${JSON.stringify(executable)}`,
			],
			{ cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
		);
		launcher.stdout?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		launcher.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});

		// Find the app itself among xvfb-run's descendants — the tree is
		// xvfb-run → sh → Xvfb and the app, and only the app matters here.
		const launcherPid = launcher.pid as number;
		await waitFor(() => {
			const match = descendantsOf(launcherPid).find((pid) =>
				(procCmdline(pid) ?? "").includes(executable),
			);
			if (match) {
				appPid = match;
			}
			return appPid !== 0;
		}, 30_000);
	}, 120_000);

	afterAll(async () => {
		if (launcher && !launcher.killed) {
			for (const pid of [...descendantsOf(launcher.pid as number)].reverse()) {
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					// Already gone.
				}
			}
			launcher.kill("SIGKILL");
		}
		if (workdir) {
			await rm(workdir, { force: true, recursive: true });
		}
	});

	it("starts and stays running", async () => {
		// The broadest signal there is, and the one no unit test can give: the
		// bundle's shared-library graph resolves, the embedded frontend loads,
		// and the webview comes up. A bundle that is wrong in any of those ways
		// exits within a second or two of launch.
		expect(appPid, `the app never appeared.\n${stderr}`).not.toBe(0);

		await new Promise((resolve) => setTimeout(resolve, 5_000));

		expect(
			isAlive(appPid),
			`the packaged app exited within 5s of launch.\n${stderr}`,
		).toBe(true);
	});

	it("starts the sidecar staged inside the bundle", async () => {
		// `externalBin` staging has no other gate. If the sidecar is missing
		// from the bundle or named for the wrong target triple, the build still
		// succeeds and the app still launches — it just never gets a backend,
		// which the user sees as a window that never connects.
		const started = await waitFor(
			() =>
				descendantsOf(appPid).some((pid) =>
					(procCmdline(pid) ?? "").includes("code-sidecar"),
				),
			45_000,
		);

		expect(
			started,
			`no code-sidecar child appeared under the packaged app.\n` +
				`process tree:\n${describeTree(descendantsOf(appPid))}\n\n${stderr}`,
		).toBe(true);
	});

	it("finds bun on a launchd PATH and starts the Kanban runtime", async () => {
		// The end-to-end half of the GUI-launch PATH policy. `enriched_path` is
		// unit-tested, but only a real launch proves the enrichment is actually
		// applied at spawn and actually reaches a real bun.
		//
		// This assertion is the reason $HOME/.bun/bin is in the policy: bun's
		// own installer puts it there, none of the system directories cover it,
		// and under the PATH above nothing else would find it.
		const started = await waitFor(
			() =>
				descendantsOf(appPid).some((pid) => {
					const cmdline = procCmdline(pid) ?? "";
					return cmdline.includes("bun") && cmdline.includes("cli.ts");
				}),
			60_000,
		);

		expect(
			started,
			`the Kanban runtime never started under PATH="${LAUNCHD_PATH}".\n` +
				`That is the double-clicked-app failure: bun resolved against ` +
				`launchd's PATH and was not found.\n` +
				`process tree:\n${describeTree(descendantsOf(appPid))}\n\n${stderr}`,
		).toBe(true);
	});
});
