import {
	createUsageBudgetAbortHandler,
	readProductMaxSessionCostUsd,
} from "@cline/core";

/**
 * Opt-in USD session budget via product policy env.
 * When unset / invalid, usage-budget abort is disabled (SDK-5.2 host hook).
 */
export function readCliMaxSessionCostUsd(
	env: NodeJS.ProcessEnv = process.env,
): number | undefined {
	return readProductMaxSessionCostUsd(env);
}

/**
 * Build an optional usage-budget abort listener for CLI agent events.
 * Returns undefined when no budget is configured.
 */
export function createCliUsageBudgetAbortHandler(options: {
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
