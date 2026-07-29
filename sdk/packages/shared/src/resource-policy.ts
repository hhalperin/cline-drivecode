import { z } from "zod";

export const RESOURCE_POLICY_VERSION = 1 as const;

export const ResourceDiagnosticsPolicySchema = z
	.object({
		enabled: z.boolean(),
		sampleIntervalMs: z.number().finite().int().positive(),
		eventLoopResolutionMs: z.number().finite().int().positive(),
	})
	.strict();

export const ResourcePolicyProfileV1Schema = z
	.object({
		version: z.literal(RESOURCE_POLICY_VERSION),
		maxParallelism: z.number().finite().int().positive(),
		processMemoryLimitBytes: z.number().finite().int().positive(),
		heapMemoryLimitBytes: z.number().finite().int().positive(),
		diagnostics: ResourceDiagnosticsPolicySchema,
	})
	.strict();

export const ResourcePolicyProfileSchema = z.discriminatedUnion("version", [
	ResourcePolicyProfileV1Schema,
]);

export type ResourceDiagnosticsPolicy = z.infer<
	typeof ResourceDiagnosticsPolicySchema
>;
export type ResourcePolicyProfileV1 = z.infer<
	typeof ResourcePolicyProfileV1Schema
>;
export type ResourcePolicyProfile = z.infer<typeof ResourcePolicyProfileSchema>;

/** Partial values accepted by Node runtimes when resolving a resource policy. */
export interface ResourcePolicyOverrides {
	maxParallelism?: number;
	processMemoryLimitBytes?: number;
	heapMemoryLimitBytes?: number;
	diagnostics?: Partial<ResourceDiagnosticsPolicy>;
}

export function parseResourcePolicyProfile(
	value: unknown,
): ResourcePolicyProfile {
	return ResourcePolicyProfileSchema.parse(value);
}

export function isResourcePolicyProfile(
	value: unknown,
): value is ResourcePolicyProfile {
	return ResourcePolicyProfileSchema.safeParse(value).success;
}
