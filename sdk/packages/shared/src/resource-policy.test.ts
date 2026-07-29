import { describe, expect, it } from "vitest";
import {
	isResourcePolicyProfile,
	parseResourcePolicyProfile,
	RESOURCE_POLICY_VERSION,
} from "./resource-policy";

const validProfile = {
	version: RESOURCE_POLICY_VERSION,
	maxParallelism: 4,
	processMemoryLimitBytes: 2_000_000_000,
	heapMemoryLimitBytes: 1_000_000_000,
	diagnostics: {
		enabled: true,
		sampleIntervalMs: 5_000,
		eventLoopResolutionMs: 20,
	},
};

describe("resource policy profiles", () => {
	it("parses a portable versioned profile", () => {
		expect(parseResourcePolicyProfile(validProfile)).toEqual(validProfile);
		expect(isResourcePolicyProfile(validProfile)).toBe(true);
	});

	it.each([
		{ ...validProfile, version: 2 },
		{ ...validProfile, maxParallelism: Number.POSITIVE_INFINITY },
		{ ...validProfile, processMemoryLimitBytes: 0 },
		{
			...validProfile,
			diagnostics: { ...validProfile.diagnostics, sampleIntervalMs: 1.5 },
		},
		{ ...validProfile, unexpected: true },
	])("rejects invalid or unknown profile shapes", (profile) => {
		expect(isResourcePolicyProfile(profile)).toBe(false);
		expect(() => parseResourcePolicyProfile(profile)).toThrow();
	});
});
