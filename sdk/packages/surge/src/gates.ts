import type { SurgeGate, SurgeGateContext, SurgeGateDecision } from "./types";

export function continueDecision(reason?: string): SurgeGateDecision {
	return { action: "continue", reason };
}

export function pauseDecision(reason: string): SurgeGateDecision {
	return { action: "pause", reason };
}

export function abortDecision(reason: string): SurgeGateDecision {
	return { action: "abort", reason };
}

/** Always continue. Useful as a default when no gates are configured. */
export const alwaysContinueGate: SurgeGate = {
	name: "always-continue",
	kinds: ["pre", "post", "emergency"],
	evaluate: () => continueDecision("default"),
};

/**
 * Abort when any task in the wave failed and remaining pending work exists.
 * Post-surge only.
 */
export function failFastGate(name = "fail-fast"): SurgeGate {
	return {
		name,
		kinds: ["post"],
		evaluate: (ctx: SurgeGateContext): SurgeGateDecision => {
			const failed = ctx.tasks.filter((task) => task.status === "failed");
			if (failed.length === 0) {
				return continueDecision();
			}
			const pending = ctx.tasks.some((task) => task.status === "pending");
			if (!pending) {
				return continueDecision("failures present but no pending work");
			}
			return abortDecision(
				`fail-fast: ${failed.length} failed task(s); aborting remaining work`,
			);
		},
	};
}

/**
 * Pause when memory flag `surge.pause` is truthy.
 * Emergency + pre gates.
 */
export function memoryPauseGate(name = "memory-pause"): SurgeGate {
	return {
		name,
		kinds: ["emergency", "pre"],
		evaluate: (ctx: SurgeGateContext): SurgeGateDecision => {
			if (ctx.memory.get("surge.pause")) {
				return pauseDecision("memory flag surge.pause is set");
			}
			return continueDecision();
		},
	};
}

export async function evaluateGates(
	gates: readonly SurgeGate[],
	ctx: SurgeGateContext,
): Promise<SurgeGateDecision> {
	const applicable = gates.filter((gate) => gate.kinds.includes(ctx.kind));
	for (const gate of applicable) {
		const decision = await gate.evaluate(ctx);
		if (decision.action !== "continue") {
			return { ...decision, reason: decision.reason ?? gate.name };
		}
	}
	return continueDecision();
}
