/**
 * Viewport-aware diagram / animation presentation (22-default-posture).
 *
 * Spotlight already presents → always render. Browse / Status Hub Mermaid is
 * ~1.5 MB — do not spend a phone's first paint on a diagram the user may never
 * open. Ultrawide keeps side-by-side; phone stacks.
 */

export const DIAGRAM_NARROW_MAX_PX = 720;
/** Soft cue for wide desk layouts (side-by-side before/after, larger type). */
export const DIAGRAM_WIDE_MIN_PX = 1440;

export type DiagramSurface = "spotlight" | "browse" | "status";

export type DiagramLayout = "stack" | "fit" | "wide";

export function shouldAutoRenderMermaid(options: {
	surface: DiagramSurface;
	widthPx: number;
}): boolean {
	if (options.surface === "spotlight") {
		return true;
	}
	// Browse / Status: tap-to-render below the phone breakpoint.
	return options.widthPx > DIAGRAM_NARROW_MAX_PX;
}

export function mermaidFontSizeForViewport(widthPx: number): number {
	if (widthPx <= DIAGRAM_NARROW_MAX_PX) {
		return 11;
	}
	if (widthPx >= DIAGRAM_WIDE_MIN_PX) {
		return 14;
	}
	return 13;
}

export function diagramLayoutForViewport(widthPx: number): DiagramLayout {
	if (widthPx <= DIAGRAM_NARROW_MAX_PX) {
		return "stack";
	}
	if (widthPx >= DIAGRAM_WIDE_MIN_PX) {
		return "wide";
	}
	return "fit";
}
