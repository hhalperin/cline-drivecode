import type { AddressSet, Participant } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { resolveAddressedSpeakerId } from "./speaker-attribution";

const human: Participant = {
	id: "drive:human",
	kind: "human",
	displayName: "Harrison",
	role: "host",
	status: "idle",
};

const partner: Participant = {
	id: "drive:partner",
	kind: "agent",
	displayName: "Partner",
	role: "partner",
	status: "idle",
	seatSources: [],
};

const specialist: Participant = {
	id: "agent:reviewer",
	kind: "agent",
	displayName: "Reviewer",
	role: "specialist",
	status: "idle",
	seatSources: [{ kind: "pack", packId: "review" }],
};

const everyone: AddressSet = { mode: "everyone" };

describe("resolveAddressedSpeakerId", () => {
	it("returns undefined with no snapshot", () => {
		expect(resolveAddressedSpeakerId(undefined)).toBeUndefined();
		expect(resolveAddressedSpeakerId(null)).toBeUndefined();
	});

	it("returns undefined when no agent is seated", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: everyone,
				participants: [human],
			}),
		).toBeUndefined();
	});

	it("attributes to the only seated agent", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: everyone,
				participants: [human, partner],
			}),
		).toBe("drive:partner");
	});

	it("returns undefined when everyone covers two agents", () => {
		// One runtime, two candidates — nothing says which one spoke.
		expect(
			resolveAddressedSpeakerId({
				addressSet: everyone,
				participants: [human, partner, specialist],
			}),
		).toBeUndefined();
	});

	it("attributes an explicitly addressed single agent", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: { mode: "agents", agentIds: ["agent:reviewer"] },
				participants: [human, partner, specialist],
			}),
		).toBe("agent:reviewer");
	});

	it("returns undefined when two agents are addressed explicitly", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: {
					mode: "agents",
					agentIds: ["drive:partner", "agent:reviewer"],
				},
				participants: [human, partner, specialist],
			}),
		).toBeUndefined();
	});

	it("returns undefined when the addressed agent is not seated", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: { mode: "agents", agentIds: ["agent:ghost"] },
				participants: [human, partner],
			}),
		).toBeUndefined();
	});

	it("attributes a pack address that resolves to one agent", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: { mode: "pack", packId: "review" },
				participants: [human, partner, specialist],
			}),
		).toBe("agent:reviewer");
	});

	it("returns undefined for a pack nobody carries", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: { mode: "pack", packId: "absent" },
				participants: [human, partner, specialist],
			}),
		).toBeUndefined();
	});
});
