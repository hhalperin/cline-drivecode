/**
 * Self-check: DriveMarkMotion exposes the four motion kinds and keeps wheel+head layers.
 * Run: bun test apps/cline-hub/src/webview/src/components/icons/drive-mark-motion.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dir, "drive-mark-motion.tsx"), "utf8");
// ponytail: resolve from repo root via cwd — cloud/agent cwd is workspace
const asset = readFileSync(join(process.cwd(), "assets/drive/cline-drive-mark-layers.svg"), "utf8");

const panel = readFileSync(join(import.meta.dir, "../ConversationPanel.tsx"), "utf8");
const chat = readFileSync(
	join(import.meta.dir, "../../Chat.tsx"),
	"utf8",
);

describe("DriveMarkMotion", () => {
	test("declares idle/loading/peek/drive", () => {
		expect(src).toContain('"idle" | "loading" | "peek" | "drive"');
		expect(src).toContain("data-motion={motion}");
	});

	test("keeps layered wheel + head groups", () => {
		expect(src).toContain('className="dm-wheel"');
		expect(src).toContain('className="dm-head"');
		expect(asset).toContain('class="dm-wheel"');
		expect(asset).toContain('class="dm-head"');
	});

	test("conversation hydrate uses loading motion", () => {
		expect(panel).toContain('motion="loading"');
		expect(panel).toContain("DriveMarkMotion");
		expect(chat).toContain('motion="loading"');
		expect(chat).toContain("DriveMarkMotion");
	});
});
