/**
 * Bank family log envelope (ARD-0013 phase 6).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBankStore, createMemoryBankFs } from "@cline/drive";
import { appendBankLogEvent, readBankLogSince } from "./bankEventLog";

describe("bankEventLog", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("appends bank mutations and reads gaps by seq", async () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-bank-log-"));
		dirs.push(dir);
		const fs = createMemoryBankFs();
		const store = createBankStore(fs, dir, {
			onBankEvent: (event) => {
				appendBankLogEvent(dir, event);
			},
		});
		await store.createTask({
			id: "t1",
			title: "One",
			body: "body",
		});
		await store.createPlan({
			id: "p1",
			title: "Plan",
			taskIds: ["t1"],
			activate: true,
		});
		const gaps = readBankLogSince(dir, 0);
		expect(gaps.length).toBeGreaterThanOrEqual(1);
		expect(gaps[0]!.family).toBe("bank");
		expect(gaps[0]!.seq).toBe(1);
		const after = readBankLogSince(dir, gaps[gaps.length - 1]!.seq);
		expect(after).toHaveLength(0);
	});
});
