import {
	BUILTIN_BROWSER_TTS_ID,
	BUILTIN_PROVIDER_MANIFESTS,
	parseDriveFacetValues,
	type DriveFacetValues,
	type DriveProviderManifest,
	type ResolvedLlmEgress,
	type RuntimeTopology,
	type SttBackend,
	type TtsBackend,
} from "@cline/shared";
import { assertProviderCompatible } from "./assertProviderCompatible.js";
import { assertTopologyLegal } from "./assertTopologyLegal.js";
import { seedFacetsForProfile } from "./seedFacetsForProfile.js";

export function defaultFacetValuesFromProfile(
	profile: DriveFacetValues["runtime.profile"],
): DriveFacetValues {
	const seed = seedFacetsForProfile(profile);
	return parseDriveFacetValues({
		...seed,
		"tts.enabled": false,
		"tts.maxSpokenSentences": 3,
		"captions.enabled": true,
		"drive.defaults.pairAgent": { kind: "builtin", id: "pair_partner" },
	});
}

export function resolveTopologyFromFacets(input: {
	facets: DriveFacetValues;
	llm: ResolvedLlmEgress;
	registry?: readonly DriveProviderManifest[];
}):
	| { ok: true; topology: RuntimeTopology }
	| { ok: false; message: string } {
	const registry = input.registry ?? BUILTIN_PROVIDER_MANIFESTS;
	const sttManifest = registry.find(
		(manifest) =>
			manifest.id === input.facets["providers.sttId"] &&
			manifest.slot === "stt",
	);
	const ttsManifest = registry.find(
		(manifest) =>
			manifest.id === input.facets["providers.ttsId"] &&
			manifest.slot === "tts",
	);
	if (!sttManifest) {
		return {
			ok: false,
			message: `Unknown STT provider ${input.facets["providers.sttId"]}`,
		};
	}
	if (!ttsManifest) {
		return {
			ok: false,
			message: `Unknown TTS provider ${input.facets["providers.ttsId"]}`,
		};
	}

	// Manifest parse already ties slot ↔ backend kind.
	const stt = sttManifest.backend as SttBackend;
	const tts = ttsManifest.backend as TtsBackend;

	const topology: RuntimeTopology = {
		profile: input.facets["runtime.profile"],
		llm: input.llm,
		stt,
		tts,
		egressCeiling: input.facets["runtime.egressCeiling"],
	};

	const legal = assertTopologyLegal(topology);
	if (!legal.ok) {
		return { ok: false, message: legal.message };
	}

	const sttCompat = assertProviderCompatible(sttManifest, topology);
	if (!sttCompat.ok) {
		return { ok: false, message: sttCompat.message };
	}
	const ttsCompat = assertProviderCompatible(ttsManifest, topology);
	if (!ttsCompat.ok) {
		return { ok: false, message: ttsCompat.message };
	}

	return { ok: true, topology };
}

export function assertFacetProviderSelection(input: {
	facets: DriveFacetValues;
	llm: ResolvedLlmEgress;
	registry?: readonly DriveProviderManifest[];
}): { ok: true } | { ok: false; message: string } {
	const resolved = resolveTopologyFromFacets(input);
	if (!resolved.ok) {
		return resolved;
	}
	return { ok: true };
}

export function cloudDefaultsWithAnthropic(): {
	facets: DriveFacetValues;
	llm: ResolvedLlmEgress;
} {
	return {
		facets: defaultFacetValuesFromProfile("cloud"),
		llm: { kind: "cloud", providerId: "anthropic" },
	};
}

export function localDefaultsWithOllama(): {
	facets: DriveFacetValues;
	llm: ResolvedLlmEgress;
} {
	return {
		facets: defaultFacetValuesFromProfile("local"),
		llm: {
			kind: "local",
			providerId: "ollama",
			baseUrlClass: "loopback",
		},
	};
}

export const DEFAULT_TTS_PROVIDER_ID = BUILTIN_BROWSER_TTS_ID;
