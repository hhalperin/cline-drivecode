import {
	BUILTIN_PROVIDER_MANIFESTS,
	type DriveProviderManifest,
	type EgressClass,
	type RuntimeTopology,
	type SttBackend,
	type TtsBackend,
} from "@cline/shared";

export interface SttHandlers {
	onInterim?(text: string): void;
	onFinal(text: string): void;
	onError(error: { code: string; message: string }): void;
}

export interface SttSession {
	stop(): void;
}

export interface SttPort {
	readonly backend: SttBackend;
	readonly egress: EgressClass;
	start(handlers: SttHandlers): SttSession;
}

export interface TtsPort {
	readonly backend: TtsBackend;
	readonly egress: EgressClass;
	speak(text: string, opts?: { voiceSlot?: string }): Promise<void>;
	cancel(): void;
}

export interface VoiceStack {
	readonly stt: SttPort;
	readonly tts: TtsPort;
	readonly topology: RuntimeTopology;
}

const voiceStackCache = new Map<string, VoiceStack>();

function topologyCacheKey(topology: RuntimeTopology): string {
	return JSON.stringify({
		profile: topology.profile,
		stt: topology.stt,
		tts: topology.tts,
		egressCeiling: topology.egressCeiling,
		llm: topology.llm,
	});
}

/**
 * Composition root for Drive voice adapters (ARD-0010).
 * Builtins only for now; workspace plugins load in a later phase.
 * Memoized by topology fingerprint to avoid recreating TTS/STT ports per send.
 */
export function createVoiceStack(
	topology: RuntimeTopology,
	registry: readonly DriveProviderManifest[] = BUILTIN_PROVIDER_MANIFESTS,
): VoiceStack {
	const key = topologyCacheKey(topology);
	const cached = voiceStackCache.get(key);
	if (cached) {
		return cached;
	}
	const sttManifest = registry.find(
		(manifest) =>
			manifest.slot === "stt" &&
			JSON.stringify(manifest.backend) === JSON.stringify(topology.stt),
	);
	const ttsManifest = registry.find(
		(manifest) =>
			manifest.slot === "tts" &&
			JSON.stringify(manifest.backend) === JSON.stringify(topology.tts),
	);
	if (!sttManifest || !ttsManifest) {
		throw new Error("No builtin adapter matches the resolved topology");
	}

	const stack: VoiceStack = {
		topology,
		stt: createBuiltinSttPort(sttManifest),
		tts: createBuiltinTtsPort(ttsManifest),
	};
	voiceStackCache.set(key, stack);
	return stack;
}

function createBuiltinSttPort(manifest: DriveProviderManifest): SttPort {
	const backend = manifest.backend as SttBackend;
	return {
		backend,
		egress: manifest.egress,
		start(handlers) {
			if (backend.kind === "webSpeech") {
				// Real Web Speech wiring lands with DRV-MIC. Stub reports unsupported
				// until the browser adapter is attached by the webview host.
				handlers.onError({
					code: "stt_not_wired",
					message: `STT adapter ${manifest.id} is selected but not wired to the mic yet.`,
				});
			} else {
				handlers.onError({
					code: "stt_not_wired",
					message: `Local STT adapter ${manifest.id} is selected but the worker is not wired yet.`,
				});
			}
			return { stop() {} };
		},
	};
}

function createBuiltinTtsPort(manifest: DriveProviderManifest): TtsPort {
	const backend = manifest.backend as TtsBackend;
	let utterance: SpeechSynthesisUtterance | null = null;
	return {
		backend,
		egress: manifest.egress,
		async speak(text) {
			if (backend.kind !== "browser-speechSynthesis") {
				return;
			}
			if (typeof window === "undefined" || !window.speechSynthesis) {
				return;
			}
			window.speechSynthesis.cancel();
			utterance = new SpeechSynthesisUtterance(text);
			await new Promise<void>((resolve) => {
				if (!utterance) {
					resolve();
					return;
				}
				utterance.onend = () => resolve();
				utterance.onerror = () => resolve();
				window.speechSynthesis.speak(utterance);
			});
		},
		cancel() {
			if (typeof window !== "undefined" && window.speechSynthesis) {
				window.speechSynthesis.cancel();
			}
			utterance = null;
		},
	};
}
