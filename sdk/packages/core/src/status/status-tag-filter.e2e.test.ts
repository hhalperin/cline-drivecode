import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoChangelogSnapshot } from "@cline/drive";
import type { StatusUpdate } from "@cline/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectToHub, type HubConnection } from "../hub/client/connect";
import { createLocalHubScheduleRuntimeHandlers } from "../hub/daemon/runtime-handlers";
import {
	type HubWebSocketServer,
	startHubWebSocketServer,
} from "../hub/server";
import { resolveRepoChangelogSnapshotPath } from "../hub/server/handlers/status-handlers";
import { StatusService, setStatusService } from "./index";

/**
 * The tag filter, driven through a real hub over a real socket.
 *
 * `StatusQuerySchema` is `.strict()`, so a `tags` key on the wire is rejected
 * outright until the schema, the SQL, and the frame all agree. Nothing short of
 * a live `status.query` proves that they do — a store unit test passes happily
 * while the wire returns `invalid_payload`.
 *
 * The rows are the repo's own changelog, seeded by `HubServerTransport.start()`
 * from the committed snapshot before the socket listens. Expectations are
 * derived from that same snapshot rather than hard-coded, so regenerating it
 * cannot rot this test — but the snapshot is asserted to be non-trivially
 * tagged first, because a tag filter that returns nothing over an empty store
 * is indistinguishable from a working one.
 */

const HUB_PORT = 25963;
const DASHBOARD_PORT = 8987;
/** Max rows any single assertion here needs; the schema caps `limit` at 200. */
const PAGE_LIMIT = 200;

let dataDir: string;
let server: HubWebSocketServer;
let connection: HubConnection;
let statusService: StatusService;
/** Tag → how many seeded entries carry it, straight from the snapshot. */
let snapshotTagCounts: Map<string, number>;
/** The most-used tag, and a tag that co-occurs with it on fewer entries. */
let topTag: string;
let narrowingTag: string;
let snapshotEntryCount: number;

async function command(
	name: string,
	payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const reply = await connection.send({
		version: "v1",
		clientId: "status-tag-filter-e2e",
		command: name as never,
		payload,
	});
	if (!reply.ok) {
		throw new Error(
			`${name} failed: ${reply.error?.code} ${reply.error?.message}`,
		);
	}
	return (reply.payload ?? {}) as Record<string, unknown>;
}

/** `status.query` over the socket, returning the rows the hub actually sent. */
async function query(
	payload: Record<string, unknown> = {},
): Promise<StatusUpdate[]> {
	const result = await command("status.query", {
		limit: PAGE_LIMIT,
		...payload,
	});
	expect(Array.isArray(result.updates)).toBe(true);
	return result.updates as StatusUpdate[];
}

function readSnapshot(): RepoChangelogSnapshot {
	const path = resolveRepoChangelogSnapshotPath();
	if (!path) {
		throw new Error(
			"repo changelog snapshot not found; the hub would seed nothing and this suite would prove nothing",
		);
	}
	return JSON.parse(readFileSync(path, "utf8")) as RepoChangelogSnapshot;
}

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-status-tag-e2e-"));
	process.env.CLINE_DATA_DIR = dataDir;
	process.env.CLINE_HUB_PORT = String(HUB_PORT);
	process.env.CLINE_HUB_DASHBOARD_PORT = String(DASHBOARD_PORT);

	const snapshot = readSnapshot();
	snapshotEntryCount = snapshot.entries.length;
	snapshotTagCounts = new Map<string, number>();
	for (const entry of snapshot.entries) {
		for (const tag of entry.tags ?? []) {
			snapshotTagCounts.set(tag, (snapshotTagCounts.get(tag) ?? 0) + 1);
		}
	}
	const ranked = [...snapshotTagCounts.entries()].sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
	);
	topTag = ranked[0]?.[0] ?? "";
	// A tag that some but not all `topTag` entries also carry, so the AND
	// assertion is about narrowing rather than about an accidental subset.
	narrowingTag =
		ranked.find(([tag]) => {
			if (tag === topTag) return false;
			const both = snapshot.entries.filter(
				(entry) =>
					entry.tags?.includes(topTag) === true &&
					entry.tags?.includes(tag) === true,
			).length;
			return both > 0 && both < (snapshotTagCounts.get(topTag) ?? 0);
		})?.[0] ?? "";

	// Built after CLINE_DATA_DIR is set so it resolves status.db under the
	// scratch dir rather than the developer's real ~/.cline.
	statusService = new StatusService();
	setStatusService(statusService);

	server = await startHubWebSocketServer({
		host: "127.0.0.1",
		port: HUB_PORT,
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		scheduleOptions: { dbPath: join(dataDir, "schedule.db") },
		sessionHost: {
			subscribe: vi.fn(),
			startSession: vi.fn(),
			stopSession: vi.fn(),
			runTurn: vi.fn(),
			abort: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			updateSession: vi.fn(),
			dispatchHookEvent: vi.fn(),
			readSessionMessages: vi.fn(),
		} as never,
	});

	const url = new URL(server.url);
	url.searchParams.set("authToken", server.authToken);
	connection = await connectToHub(url.toString());
});

afterAll(async () => {
	connection?.close();
	await server?.close();
	setStatusService(undefined);
	statusService?.close();
	rmSync(dataDir, { recursive: true, force: true });
});

describe("status tag filter over a live hub", () => {
	it("has tagged rows to filter in the first place", async () => {
		// Guards every assertion below: over an empty or untagged store a broken
		// tag predicate and a working one return the same thing.
		expect(snapshotEntryCount).toBeGreaterThan(0);
		expect(snapshotTagCounts.size).toBeGreaterThan(1);
		expect(topTag).not.toBe("");
		expect(narrowingTag).not.toBe("");

		const seeded = await query();
		expect(seeded).toHaveLength(snapshotEntryCount);
		expect(seeded.some((row) => row.tags.length > 0)).toBe(true);
	});

	it("returns rows for a tag, not an empty page", async () => {
		const rows = await query({ tags: [topTag] });
		expect(rows.length).toBeGreaterThan(0);
		expect(rows).toHaveLength(snapshotTagCounts.get(topTag) ?? 0);
		for (const row of rows) {
			expect(row.tags).toContain(topTag);
		}
	});

	it("narrows rather than widens as tags are added", async () => {
		const oneTag = await query({ tags: [topTag] });
		const twoTags = await query({ tags: [topTag, narrowingTag] });

		expect(twoTags.length).toBeGreaterThan(0);
		expect(twoTags.length).toBeLessThan(oneTag.length);
		for (const row of twoTags) {
			expect(row.tags).toContain(topTag);
			expect(row.tags).toContain(narrowingTag);
		}
		// AND, not OR: every two-tag hit is also a one-tag hit.
		const oneTagIds = new Set(oneTag.map((row) => row.updateId));
		for (const row of twoTags) {
			expect(oneTagIds.has(row.updateId)).toBe(true);
		}
	});

	it("actually filters — an unknown tag returns nothing", async () => {
		// The counterpart to the assertions above: without this, a `tags` key the
		// server quietly dropped would still look like a passing filter.
		expect(await query({ tags: ["scope:no-such-tag"] })).toHaveLength(0);
	});

	it("matches a tag exactly rather than as a prefix", async () => {
		expect(await query({ tags: [topTag.slice(0, -1)] })).toHaveLength(0);
	});

	it("composes with the other filters instead of replacing them", async () => {
		const tagged = await query({ tags: [topTag] });
		const headline = tagged[0]?.headline ?? "";
		expect(headline).not.toBe("");

		const withText = await query({ tags: [topTag], text: headline });
		expect(withText.length).toBeGreaterThan(0);
		for (const row of withText) {
			expect(row.tags).toContain(topTag);
		}
		expect(withText.length).toBeLessThanOrEqual(tagged.length);

		// Seeded entries are terminal history, so no tag has a blocked row.
		expect(await query({ tags: [topTag], state: ["blocked"] })).toHaveLength(0);
	});

	it("applies the tag filter to the board too", async () => {
		const board = await command("status.board", {
			limit: PAGE_LIMIT,
			tags: [topTag],
		});
		const rows = board.updates as StatusUpdate[];
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(row.tags).toContain(topTag);
		}
	});

	it("reflects a tag published after the hub started", async () => {
		// The seeder is not the only writer: a live `report_status` publish has to
		// be reachable by the same filter without a restart.
		await command("status.publish", {
			subject: "migration/auth",
			state: "blocked",
			headline: "Waiting on the KMS rotation",
			source: "agent",
			tags: ["auth", "p0"],
		});

		const rows = await query({ tags: ["auth", "p0"] });
		expect(rows.map((row) => row.subject)).toEqual(["migration/auth"]);
	});

	it("rejects a malformed tag list at the schema boundary", async () => {
		const reply = await connection.send({
			version: "v1",
			clientId: "status-tag-filter-e2e",
			command: "status.query" as never,
			payload: { tags: [""] },
		});
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("invalid_payload");
	});
});
