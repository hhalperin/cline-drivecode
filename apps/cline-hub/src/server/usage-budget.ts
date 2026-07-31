import { createUsageBudgetAbortHandler } from "@cline/core";

/**
 * Opt-in USD session budget via `CLINE_MAX_SESSION_COST` (BL-5.1 env-only).
 * When unset / invalid, usage-budget abort is disabled.
 */
export function readHubMaxSessionCostUsd(
	env: NodeJS.ProcessEnv = process.env,
): number | undefined {
	const raw = env.CLINE_MAX_SESSION_COST?.trim();
	if (!raw) {
		return undefined;
	}
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return value;
}

/**
 * Build an optional usage-budget abort listener for Hub agent events.
 * Returns undefined when no budget is configured.
 */
export function createHubUsageBudgetAbortHandler(options: {
	maxCostUsd: number | undefined;
	abort: (reason: string) => void;
}): ((event: unknown) => void) | undefined {
	if (options.maxCostUsd === undefined) {
		return undefined;
	}
	return createUsageBudgetAbortHandler({
		maxCostUsd: options.maxCostUsd,
		abort: options.abort,
	});
}
