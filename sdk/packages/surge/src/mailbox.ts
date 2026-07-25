import { newId, nowIso, type SurgeMailboxMessage } from "./types";

/** Inter-worker mailbox. Supports direct and broadcast (`to: "*"`) delivery. */
export class SurgeMailbox {
	#messages: SurgeMailboxMessage[] = [];

	get messages(): readonly SurgeMailboxMessage[] {
		return this.#messages;
	}

	send(
		input: Omit<SurgeMailboxMessage, "id" | "createdAt"> & {
			id?: string;
			createdAt?: string;
		},
	): SurgeMailboxMessage {
		const message: SurgeMailboxMessage = {
			id: input.id ?? newId("msg"),
			from: input.from,
			to: input.to,
			topic: input.topic,
			body: input.body,
			createdAt: input.createdAt ?? nowIso(),
		};
		this.#messages.push(message);
		return message;
	}

	/** Messages addressed to recipient or broadcast. */
	inbox(recipient: string, topic?: string): SurgeMailboxMessage[] {
		return this.#messages.filter((message) => {
			const addressed = message.to === "*" || message.to === recipient;
			const topicOk = topic === undefined || message.topic === topic;
			return addressed && topicOk;
		});
	}

	snapshot(): SurgeMailboxMessage[] {
		return this.#messages.map((message) => ({ ...message, body: { ...message.body } }));
	}

	restore(messages: readonly SurgeMailboxMessage[]): void {
		this.#messages = messages.map((message) => ({
			...message,
			body: { ...message.body },
		}));
	}

	clear(): void {
		this.#messages = [];
	}
}
