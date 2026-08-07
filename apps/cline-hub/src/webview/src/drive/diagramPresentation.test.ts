import { describe, expect, it } from "vitest";
import {
	DIAGRAM_NARROW_MAX_PX,
	DIAGRAM_WIDE_MIN_PX,
	diagramLayoutForViewport,
	mermaidFontSizeForViewport,
	shouldAutoRenderMermaid,
} from "./diagramPresentation";

describe("shouldAutoRenderMermaid", () => {
	it("always renders on Spotlight", () => {
		expect(
			shouldAutoRenderMermaid({ surface: "spotlight", widthPx: 320 }),
		).toBe(true);
	});

	it("defers browse/status below the phone breakpoint", () => {
		expect(
			shouldAutoRenderMermaid({
				surface: "browse",
				widthPx: DIAGRAM_NARROW_MAX_PX,
			}),
		).toBe(false);
		expect(
			shouldAutoRenderMermaid({
				surface: "status",
				widthPx: DIAGRAM_NARROW_MAX_PX + 1,
			}),
		).toBe(true);
	});
});

describe("mermaidFontSizeForViewport", () => {
	it("steps phone → desk → ultrawide", () => {
		expect(mermaidFontSizeForViewport(390)).toBe(11);
		expect(mermaidFontSizeForViewport(1024)).toBe(13);
		expect(mermaidFontSizeForViewport(DIAGRAM_WIDE_MIN_PX)).toBe(14);
	});
});

describe("diagramLayoutForViewport", () => {
	it("stacks on phone and widens on ultrawide", () => {
		expect(diagramLayoutForViewport(390)).toBe("stack");
		expect(diagramLayoutForViewport(1100)).toBe("fit");
		expect(diagramLayoutForViewport(DIAGRAM_WIDE_MIN_PX)).toBe("wide");
	});
});
