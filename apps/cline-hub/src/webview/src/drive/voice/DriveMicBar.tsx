import { SpeechInput } from "@/components/ai-elements/speech-input";
import type { SpeechInputMode } from "./speechInputModeForBackend";

export function DriveMicBar({
	disabled,
	forceMode,
	caption,
	muted,
	onCaptionChange,
	onTranscription,
}: {
	disabled?: boolean;
	forceMode: SpeechInputMode;
	caption: string;
	muted: boolean;
	onCaptionChange: (text: string) => void;
	onTranscription: (text: string) => void;
}) {
	if (muted) {
		return (
			<div className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
				Mic muted. Unmute on the call strip to speak to the partner.
			</div>
		);
	}

	return (
		<div className="flex items-center gap-3 border-t bg-background px-3 py-2">
			<SpeechInput
				disabled={disabled}
				forceMode={forceMode}
				onAudioRecorded={async () => {
					// Local/cloud-api STT workers land later; keep the blob path open.
					return "";
				}}
				onTranscriptionChange={(text) => {
					onCaptionChange(text);
					onTranscription(text);
				}}
			/>
			<div className="min-w-0 flex-1">
				{caption ? (
					<p className="truncate text-xs text-foreground">{caption}</p>
				) : (
					<p className="text-xs text-muted-foreground">
						Speak a task. Voice lands in the composer as text (confirm before
						send).
					</p>
				)}
			</div>
		</div>
	);
}
