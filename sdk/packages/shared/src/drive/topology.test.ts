import { describe, expect, it } from "vitest";
import {
	defaultEgressCeiling,
	egressWithinCeiling,
	parseRuntimeTopology,
	sttBackendEgress,
} from "./topology";

describe("parseRuntimeTopology", () => {
	it("parses a legal local topology", () => {
		const topology = parseRuntimeTopology({
			profile: "local",
			llm: {
				kind: "local",
				providerId: "ollama",
				baseUrlClass: "loopback",
			},
			stt: { kind: "local-worker", engine: "whisper-cpp" },
			tts: { kind: "browser-speechSynthesis" },
			egressCeiling: "loopback-only",
		});
		expect(topology.profile).toBe("local");
	});

	it("rejects unknown profile", () => {
		expect(() =>
			parseRuntimeTopology({
				profile: "airgap",
				llm: { kind: "cloud", providerId: "anthropic" },
				stt: { kind: "webSpeech" },
				tts: { kind: "browser-speechSynthesis" },
				egressCeiling: "loopback-only",
			}),
		).toThrow();
	});
});

describe("egress helpers", () => {
	it("maps webSpeech to platform-cloud", () => {
		expect(sttBackendEgress({ kind: "webSpeech" })).toBe("platform-cloud");
	});

	it("seeds ceiling from profile", () => {
		expect(defaultEgressCeiling("local")).toBe("loopback-only");
		expect(defaultEgressCeiling("cloud")).toBe("platform-cloud");
	});

	it("allows loopback under declared-providers ceiling", () => {
		expect(
			egressWithinCeiling("loopback-only", "declared-providers"),
		).toBe(true);
		expect(
			egressWithinCeiling("platform-cloud", "loopback-only"),
		).toBe(false);
	});
});
