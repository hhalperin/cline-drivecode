import {
	BUILTIN_BROWSER_TTS_ID,
	BUILTIN_LOCAL_WORKER_STT_ID,
	BUILTIN_WEB_SPEECH_STT_ID,
	defaultEgressCeiling,
	type DeploymentProfile,
} from "@cline/shared";

/** Partial facet values seeded when the user picks a runtime profile. */
export interface ProfileFacetSeed {
	readonly "runtime.profile": DeploymentProfile;
	readonly "runtime.egressCeiling": ReturnType<typeof defaultEgressCeiling>;
	readonly "providers.sttId": string;
	readonly "providers.ttsId": string;
	readonly "providers.sttConfig": Record<string, never>;
	readonly "providers.ttsConfig": Record<string, never>;
}

export function seedFacetsForProfile(
	profile: DeploymentProfile,
): ProfileFacetSeed {
	const egressCeiling = defaultEgressCeiling(profile);
	switch (profile) {
		case "local":
			return {
				"runtime.profile": "local",
				"runtime.egressCeiling": egressCeiling,
				"providers.sttId": BUILTIN_LOCAL_WORKER_STT_ID,
				"providers.ttsId": BUILTIN_BROWSER_TTS_ID,
				"providers.sttConfig": {},
				"providers.ttsConfig": {},
			};
		case "cloud":
			return {
				"runtime.profile": "cloud",
				"runtime.egressCeiling": egressCeiling,
				"providers.sttId": BUILTIN_WEB_SPEECH_STT_ID,
				"providers.ttsId": BUILTIN_BROWSER_TTS_ID,
				"providers.sttConfig": {},
				"providers.ttsConfig": {},
			};
		case "hybrid":
			return {
				"runtime.profile": "hybrid",
				"runtime.egressCeiling": egressCeiling,
				"providers.sttId": BUILTIN_LOCAL_WORKER_STT_ID,
				"providers.ttsId": BUILTIN_BROWSER_TTS_ID,
				"providers.sttConfig": {},
				"providers.ttsConfig": {},
			};
		default: {
			const _exhaustive: never = profile;
			return _exhaustive;
		}
	}
}
