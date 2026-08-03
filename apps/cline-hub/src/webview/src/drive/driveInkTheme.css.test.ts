/**
 * `@cline/drive` may take only type-level dependencies on `@cline/shared` and
 * cannot read a stylesheet at all, so `facets/resolve.ts` repeats the theme
 * values that live in `index.css`. Two copies drift silently — a palette edit
 * in CSS would leave the contrast clamp measuring against the old colours and
 * nothing would fail. This is the pin, run from the hub where both are visible.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DRIVE_DARK_INK_THEME,
	DRIVE_INK_PALETTE,
	DRIVE_INK_VIOLET_INDEX,
	DRIVE_LIGHT_INK_THEME,
	formatOklch,
} from "@cline/drive";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
	join(import.meta.dirname, "..", "index.css"),
	"utf8",
);

/** Body of a top-level `:root { … }` / `.dark { … }` block. */
function block(selector: string): string {
	const start = CSS.indexOf(`${selector} {`);
	expect(start, `${selector} block missing from index.css`).toBeGreaterThan(-1);
	const end = CSS.indexOf("\n}", start);
	return CSS.slice(start, end);
}

function customProperty(source: string, name: string): string {
	const match = source.match(
		new RegExp(`--${name}:\\s*([^;]+);`),
	);
	expect(match, `--${name} missing`).not.toBeNull();
	return (match?.[1] ?? "").trim();
}

/** The `:root` block that carries the app tokens, not the brand block. */
const lightBlock = CSS.slice(
	CSS.indexOf("--background: var(--brand-white)"),
	CSS.indexOf("@theme inline"),
);
const darkBlock = block(".dark");
const brandBlock = block(":root");

describe("drive ink palette mirrors index.css", () => {
	it.each([
		{ mode: "light" as const, theme: DRIVE_LIGHT_INK_THEME, css: lightBlock },
		{ mode: "dark" as const, theme: DRIVE_DARK_INK_THEME, css: darkBlock },
	])("pins every $mode palette token", ({ theme, css }) => {
		DRIVE_INK_PALETTE.forEach((anchor, index) => {
			expect(customProperty(css, `drive-ink-${index}`)).toBe(
				formatOklch({ l: theme.lightness.name, c: anchor.c, h: anchor.h }),
			);
		});
	});

	it("pins the well each theme clamps against", () => {
		// Light: --background is var(--brand-white); resolve the indirection.
		expect(customProperty(lightBlock, "background")).toBe(
			"var(--brand-white)",
		);
		expect(customProperty(brandBlock, "brand-white")).toBe(
			DRIVE_LIGHT_INK_THEME.well,
		);
		expect(customProperty(darkBlock, "background")).toBe(
			DRIVE_DARK_INK_THEME.well,
		);
	});

	it("pins the fallback tokens the clamp lands on", () => {
		expect(customProperty(lightBlock, "foreground")).toBe(
			"var(--brand-black)",
		);
		expect(customProperty(brandBlock, "brand-black")).toBe(
			DRIVE_LIGHT_INK_THEME.tokens.foreground,
		);
		expect(customProperty(lightBlock, "muted-foreground")).toBe(
			DRIVE_LIGHT_INK_THEME.tokens.muted,
		);
		expect(customProperty(darkBlock, "foreground")).toBe(
			DRIVE_DARK_INK_THEME.tokens.foreground,
		);
		expect(customProperty(darkBlock, "muted-foreground")).toBe(
			DRIVE_DARK_INK_THEME.tokens.muted,
		);
	});
});

describe("violet stays product chrome", () => {
	it("is the accent, and the accent is not an agent default", () => {
		// DRV-AGENT-PROFILE: violet is selectable, never a default agent ink.
		expect(customProperty(brandBlock, "brand-purple")).toBe("#9f58fa");
		expect(DRIVE_INK_VIOLET_INDEX).toBe(5);
	});

	it("leaves no hardcoded violet utility on a Drive agent chip", () => {
		const spotlight = readFileSync(
			join(import.meta.dirname, "Spotlight.tsx"),
			"utf8",
		);
		expect(spotlight).not.toMatch(/(border|bg|text)-violet-\d/);
	});

	it("leaves no hardcoded ink hex in the webview Drive chrome", () => {
		// The old `nameInkPaletteColor` switch lived here.
		const types = readFileSync(join(import.meta.dirname, "types.ts"), "utf8");
		expect(types).not.toMatch(/#[0-9a-f]{6}/i);
	});
});
