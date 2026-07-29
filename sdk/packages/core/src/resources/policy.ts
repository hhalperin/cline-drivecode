import { availableParallelism, totalmem } from "node:os";
import { getHeapStatistics } from "node:v8";
import type {
	ResourcePolicyOverrides,
	ResourcePolicyProfile,
} from "@cline/shared";

export const RESOURCE_POLICY_ENV = {
	maxParallelism: "CLINE_RESOURCE_MAX_PARALLELISM",
	processMemoryLimitBytes: "CLINE_RESOURCE_PROCESS_MEMORY_LIMIT_BYTES",
	heapMemoryLimitBytes: "CLINE_RESOURCE_HEAP_MEMORY_LIMIT_BYTES",
	diagnosticsEnabled: "CLINE_RESOURCE_DIAGNOSTICS_ENABLED",
	diagnosticsSampleIntervalMs: "CLINE_RESOURCE_DIAGNOSTICS_INTERVAL_MS",
	eventLoopResolutionMs: "CLINE_RESOURCE_EVENT_LOOP_RESOLUTION_MS",
} as const;

export const RESOURCE_POLICY_HARD_LIMITS = {
	maxParallelism: { min: 1, max: 256 },
	processMemoryLimitBytes: { min: 64 * 1024 ** 2, max: 1024 ** 4 },
	heapMemoryLimitBytes: { min: 32 * 1024 ** 2, max: 256 * 1024 ** 3 },
	diagnosticsSampleIntervalMs: { min: 100, max: 300_000 },
	eventLoopResolutionMs: { min: 1, max: 1_000 },
} as const;

export type ResourcePolicyValueSource =
	| "hardware"
	| "default"
	| "environment"
	| "explicit";

export interface ResourcePolicySources {
	maxParallelism: ResourcePolicyValueSource;
	processMemoryLimitBytes: ResourcePolicyValueSource;
	heapMemoryLimitBytes: ResourcePolicyValueSource;
	diagnostics: {
		enabled: ResourcePolicyValueSource;
		sampleIntervalMs: ResourcePolicyValueSource;
		eventLoopResolutionMs: ResourcePolicyValueSource;
	};
}

export interface ResourceHardwareProfile {
	availableParallelism: number;
	totalMemoryBytes: number;
	heapSizeLimitBytes: number;
}

export interface ResolvedResourcePolicy {
	profile: ResourcePolicyProfile;
	sources: ResourcePolicySources;
	hardware: ResourceHardwareProfile;
}

export interface ResolveResourcePolicyOptions {
	env?: Readonly<Record<string, string | undefined>>;
	overrides?: ResourcePolicyOverrides | ResourcePolicyProfile;
	hardware?: Partial<ResourceHardwareProfile>;
}

function clampFinite(
	value: number,
	fallback: number,
	limits: { readonly min: number; readonly max: number },
): number {
	if (Number.isNaN(value)) {
		return clampFinite(fallback, limits.min, limits);
	}
	const finite =
		value === Number.POSITIVE_INFINITY
			? limits.max
			: value === Number.NEGATIVE_INFINITY
				? limits.min
				: value;
	return Math.round(Math.min(limits.max, Math.max(limits.min, finite)));
}

function finiteHardwareValue(
	value: number | undefined,
	fallback: number,
): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback;
}

function parseNumber(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function parseBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}
	switch (value.trim().toLowerCase()) {
		case "1":
		case "true":
		case "yes":
		case "on":
			return true;
		case "0":
		case "false":
		case "no":
		case "off":
			return false;
		default:
			return undefined;
	}
}

function chooseNumber(
	explicit: number | undefined,
	environment: number | undefined,
	fallback: number,
	limits: { readonly min: number; readonly max: number },
): { value: number; source: ResourcePolicyValueSource } {
	if (explicit !== undefined) {
		return {
			value: clampFinite(explicit, fallback, limits),
			source: "explicit",
		};
	}
	if (environment !== undefined) {
		return {
			value: clampFinite(environment, fallback, limits),
			source: "environment",
		};
	}
	return {
		value: clampFinite(fallback, limits.min, limits),
		source: "hardware",
	};
}

export function resolveResourcePolicy(
	options: ResolveResourcePolicyOptions = {},
): ResolvedResourcePolicy {
	const env = options.env ?? process.env;
	const explicit = options.overrides ?? {};
	const hardware: ResourceHardwareProfile = {
		availableParallelism: finiteHardwareValue(
			options.hardware?.availableParallelism,
			availableParallelism(),
		),
		totalMemoryBytes: finiteHardwareValue(
			options.hardware?.totalMemoryBytes,
			totalmem(),
		),
		heapSizeLimitBytes: finiteHardwareValue(
			options.hardware?.heapSizeLimitBytes,
			getHeapStatistics().heap_size_limit,
		),
	};

	const maxParallelism = chooseNumber(
		explicit.maxParallelism,
		parseNumber(env[RESOURCE_POLICY_ENV.maxParallelism]),
		hardware.availableParallelism,
		RESOURCE_POLICY_HARD_LIMITS.maxParallelism,
	);
	const processMemoryLimitBytes = chooseNumber(
		explicit.processMemoryLimitBytes,
		parseNumber(env[RESOURCE_POLICY_ENV.processMemoryLimitBytes]),
		hardware.totalMemoryBytes * 0.5,
		RESOURCE_POLICY_HARD_LIMITS.processMemoryLimitBytes,
	);
	const heapMemoryLimitBytes = chooseNumber(
		explicit.heapMemoryLimitBytes,
		parseNumber(env[RESOURCE_POLICY_ENV.heapMemoryLimitBytes]),
		hardware.heapSizeLimitBytes * 0.8,
		RESOURCE_POLICY_HARD_LIMITS.heapMemoryLimitBytes,
	);
	const sampleIntervalMs = chooseNumber(
		explicit.diagnostics?.sampleIntervalMs,
		parseNumber(env[RESOURCE_POLICY_ENV.diagnosticsSampleIntervalMs]),
		5_000,
		RESOURCE_POLICY_HARD_LIMITS.diagnosticsSampleIntervalMs,
	);
	const eventLoopResolutionMs = chooseNumber(
		explicit.diagnostics?.eventLoopResolutionMs,
		parseNumber(env[RESOURCE_POLICY_ENV.eventLoopResolutionMs]),
		20,
		RESOURCE_POLICY_HARD_LIMITS.eventLoopResolutionMs,
	);
	const explicitEnabled = explicit.diagnostics?.enabled;
	const environmentEnabled = parseBoolean(
		env[RESOURCE_POLICY_ENV.diagnosticsEnabled],
	);
	const enabled = explicitEnabled ?? environmentEnabled ?? true;
	const enabledSource: ResourcePolicyValueSource =
		explicitEnabled !== undefined
			? "explicit"
			: environmentEnabled !== undefined
				? "environment"
				: "default";

	return {
		profile: {
			version: 1,
			maxParallelism: maxParallelism.value,
			processMemoryLimitBytes: processMemoryLimitBytes.value,
			heapMemoryLimitBytes: heapMemoryLimitBytes.value,
			diagnostics: {
				enabled,
				sampleIntervalMs: sampleIntervalMs.value,
				eventLoopResolutionMs: eventLoopResolutionMs.value,
			},
		},
		sources: {
			maxParallelism: maxParallelism.source,
			processMemoryLimitBytes: processMemoryLimitBytes.source,
			heapMemoryLimitBytes: heapMemoryLimitBytes.source,
			diagnostics: {
				enabled: enabledSource,
				sampleIntervalMs:
					sampleIntervalMs.source === "hardware"
						? "default"
						: sampleIntervalMs.source,
				eventLoopResolutionMs:
					eventLoopResolutionMs.source === "hardware"
						? "default"
						: eventLoopResolutionMs.source,
			},
		},
		hardware,
	};
}
