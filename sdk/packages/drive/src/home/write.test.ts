import type { DriveagentHome } from "@cline/shared";
import { DRIVE_ENV_FORBIDDEN_SECRET_KEYS as SHARED_FORBIDDEN_SECRET_KEYS } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	assertDriveagentHomePatch,
	DRIVE_ENV_FORBIDDEN_SECRET_KEYS,
	DRIVEAGENT_AGENT_HIDDEN_FIELDS,
	DriveagentHomeWriteError,
	driveagentHomeIsEditable,
	isForbiddenPlaintextSecretKey,
	mergeDriveagentHomePatch,
	serializeDriveagentHome,
} from "./write";

const PROMPT = "You are the Drive pair partner.\nNarrate decision points.\n";

function home(overrides?: {
	agent?: Partial<DriveagentHome["agent"]>;
	permissions?: Partial<DriveagentHome["permissions"]>;
	env?: Partial<DriveagentHome["env"]>;
}): DriveagentHome {
	return {
		slug: "pair-partner",
		agent: {
			name: "pair-partner",
			description: "Default Drive pair partner.",
			tools: ["read_file", "write_file"],
			skills: ["drive-persona"],
			systemPrompt: PROMPT,
			providerId: "anthropic",
			modelId: "claude-opus-5",
			...overrides?.agent,
		},
		permissions: {
			presetIntent: "standard",
			approvalHooks: ["highImpact"],
			notes: "Intent only.",
			...overrides?.permissions,
		},
		env: {
			values: { DRIVE_NARRATION_DENSITY: "decision_points" },
			secretRefs: [],
			...overrides?.env,
		},
	};
}

function writeErrorCode(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		if (error instanceof DriveagentHomeWriteError) {
			return error.code;
		}
		throw error;
	}
	throw new Error("expected the patch to be refused, but it was accepted");
}

describe("DRIVE_ENV_FORBIDDEN_SECRET_KEYS", () => {
	/**
	 * `@cline/drive` may not value-import `@cline/shared`, so the forbidden key
	 * list is duplicated. A copy that drifts silently stops refusing whatever
	 * key was added on the other side, so the two are pinned equal here.
	 */
	it("matches the shared schema's list exactly", () => {
		expect([...DRIVE_ENV_FORBIDDEN_SECRET_KEYS]).toEqual([
			...SHARED_FORBIDDEN_SECRET_KEYS,
		]);
	});
});

describe("assertDriveagentHomePatch", () => {
	it.each(DRIVEAGENT_AGENT_HIDDEN_FIELDS)(
		"refuses a patch naming agent.%s",
		(field) => {
			expect(
				writeErrorCode(() =>
					assertDriveagentHomePatch({ agent: { [field]: "anything" } }),
				),
			).toBe("hidden_field_write");
		},
	);

	it("refuses a hidden field even when it is being cleared", () => {
		expect(
			writeErrorCode(() =>
				assertDriveagentHomePatch({ agent: { systemPrompt: undefined } }),
			),
		).toBe("hidden_field_write");
	});

	/**
	 * The patch arrives as parsed JSON from a browser, so `__proto__` and
	 * `constructor` are keys a caller can actually send. The allow-list rejects
	 * them as unknown fields; this pins that it stays an *explicit* rejection
	 * rather than something a future `{...patch}` spread quietly re-opens.
	 */
	it("refuses prototype-shaped keys without polluting Object.prototype", () => {
		expect(
			writeErrorCode(() =>
				assertDriveagentHomePatch(
					JSON.parse('{"agent":{"__proto__":{"systemPrompt":"pwned"}}}'),
				),
			),
		).toBe("unknown_field");
		expect(
			writeErrorCode(() =>
				assertDriveagentHomePatch(JSON.parse('{"__proto__":{"slug":"x"}}')),
			),
		).toBe("unknown_field");
		expect(
			writeErrorCode(() =>
				assertDriveagentHomePatch(JSON.parse('{"agent":{"constructor":"x"}}')),
			),
		).toBe("unknown_field");
		expect(({} as { systemPrompt?: string }).systemPrompt).toBeUndefined();
	});

	it("refuses unknown top-level and section fields", () => {
		expect(
			writeErrorCode(() => assertDriveagentHomePatch({ compiled: {} })),
		).toBe("unknown_field");
		expect(
			writeErrorCode(() =>
				assertDriveagentHomePatch({ permissions: { presetId: "x" } }),
			),
		).toBe("unknown_field");
	});

	it.each(SHARED_FORBIDDEN_SECRET_KEYS)(
		"refuses a plaintext %s in env.values",
		(key) => {
			expect(
				writeErrorCode(() =>
					assertDriveagentHomePatch({
						env: { values: { [key]: "sk-live-not-a-real-credential" } },
					}),
				),
			).toBe("plaintext_secret");
		},
	);

	/**
	 * Case matters to a `Set` and not to a person. `APIKEY` typed into an
	 * editor is the same credential as `apiKey`, and this is the last boundary
	 * that can say so before it lands in a file.
	 */
	it.each(["APIKEY", "apikey", "ApiKey", "TOKEN", "CLIENTSECRET"])(
		"refuses '%s' as a case variant of a forbidden key",
		(key) => {
			expect(
				writeErrorCode(() =>
					assertDriveagentHomePatch({ env: { values: { [key]: "s" } } }),
				),
			).toBe("plaintext_secret");
		},
	);

	it("still allows keys that merely contain a forbidden word", () => {
		expect(isForbiddenPlaintextSecretKey("MY_TOKEN_PATH")).toBe(false);
		expect(isForbiddenPlaintextSecretKey("token")).toBe(true);
		const patch = assertDriveagentHomePatch({
			env: { values: { MY_TOKEN_PATH: "/etc/x" } },
		});
		expect(patch.env?.values).toEqual({ MY_TOKEN_PATH: "/etc/x" });
	});

	it("accepts secretRefs alongside ordinary env values", () => {
		const patch = assertDriveagentHomePatch({
			env: {
				values: { DRIVE_NARRATION_DENSITY: "all" },
				secretRefs: [{ key: "ANTHROPIC_API_KEY", secretRef: "keychain://x" }],
			},
		});
		expect(patch.env?.secretRefs).toEqual([
			{ key: "ANTHROPIC_API_KEY", secretRef: "keychain://x" },
		]);
	});

	it("rejects malformed values rather than coercing them", () => {
		expect(
			writeErrorCode(() =>
				assertDriveagentHomePatch({ agent: { tools: "a" } }),
			),
		).toBe("invalid_patch");
		expect(
			writeErrorCode(() =>
				assertDriveagentHomePatch({ agent: { description: "  " } }),
			),
		).toBe("invalid_patch");
		expect(
			writeErrorCode(() =>
				assertDriveagentHomePatch({ permissions: { presetIntent: "root" } }),
			),
		).toBe("invalid_patch");
	});
});

describe("mergeDriveagentHomePatch", () => {
	it("keeps every hidden field when the patch omits it", () => {
		// The exact payload a naive editor builds from the sanitized read.
		const merged = mergeDriveagentHomePatch({
			current: home(),
			patch: {
				slug: "pair-partner",
				agent: {
					name: "pair-partner",
					description: "Default Drive pair partner.",
					tools: ["read_file", "write_file"],
					skills: ["drive-persona"],
				},
				permissions: {
					presetIntent: "standard",
					approvalHooks: ["highImpact"],
					notes: "Intent only.",
				},
			},
		});
		expect(merged.agent.systemPrompt).toBe(PROMPT);
		expect(merged.agent.providerId).toBe("anthropic");
		expect(merged.agent.modelId).toBe("claude-opus-5");
		expect(merged.env.values).toEqual({
			DRIVE_NARRATION_DENSITY: "decision_points",
		});
	});

	it("applies the fields the patch does name", () => {
		const merged = mergeDriveagentHomePatch({
			current: home(),
			patch: {
				agent: { description: "Reviewed by hand.", tools: ["read_file"] },
				permissions: { presetIntent: "readonly", approvalHooks: [] },
			},
		});
		expect(merged.agent.description).toBe("Reviewed by hand.");
		expect(merged.agent.tools).toEqual(["read_file"]);
		expect(merged.agent.skills).toEqual(["drive-persona"]);
		expect(merged.permissions.presetIntent).toBe("readonly");
		expect(merged.permissions.approvalHooks).toEqual([]);
		expect(merged.agent.systemPrompt).toBe(PROMPT);
	});

	it("clears notes only when the patch sends them empty", () => {
		expect(
			mergeDriveagentHomePatch({ current: home(), patch: {} }).permissions
				.notes,
		).toBe("Intent only.");
		expect(
			mergeDriveagentHomePatch({
				current: home(),
				patch: { permissions: { notes: "   " } },
			}).permissions.notes,
		).toBeUndefined();
	});

	it("merges env values key-by-key rather than replacing the map", () => {
		const merged = mergeDriveagentHomePatch({
			current: home(),
			patch: { env: { values: { DRIVE_STAGE_HINTS: "on" } } },
		});
		expect(merged.env.values).toEqual({
			DRIVE_NARRATION_DENSITY: "decision_points",
			DRIVE_STAGE_HINTS: "on",
		});
	});

	it("refuses a home marked editable: false", () => {
		expect(
			writeErrorCode(() =>
				mergeDriveagentHomePatch({
					current: home({ agent: { editable: false } }),
					patch: { agent: { description: "nope" } },
				}),
			),
		).toBe("not_editable");
	});

	it("treats an absent editable flag as editable (ADR-0001)", () => {
		expect(driveagentHomeIsEditable(home())).toBe(true);
		expect(driveagentHomeIsEditable(home({ agent: { editable: false } }))).toBe(
			false,
		);
	});

	it("refuses a rename and refuses flipping the editable gate", () => {
		expect(
			writeErrorCode(() =>
				mergeDriveagentHomePatch({
					current: home(),
					patch: { agent: { name: "other-agent" } },
				}),
			),
		).toBe("slug_mismatch");
		expect(
			writeErrorCode(() =>
				mergeDriveagentHomePatch({
					current: home(),
					patch: { agent: { editable: false } },
				}),
			),
		).toBe("immutable_field");
	});

	it("accepts the editable flag echoed back unchanged", () => {
		const merged = mergeDriveagentHomePatch({
			current: home({ agent: { editable: true } }),
			patch: { agent: { editable: true, description: "Still fine." } },
		});
		expect(merged.agent.editable).toBe(true);
		expect(merged.agent.description).toBe("Still fine.");
	});
});

describe("serializeDriveagentHome", () => {
	it("round-trips the prompt through YAML unchanged", () => {
		const files = serializeDriveagentHome(home());
		expect(files.agentYaml).toContain("systemPrompt: |");
		expect(files.agentYaml).toContain("Narrate decision points.");
		expect(files.permissionsYaml).toContain("presetIntent: standard");
		expect(files.envYaml).toContain("DRIVE_NARRATION_DENSITY");
	});

	it("keeps comments on keys a save did not touch", () => {
		const previous = [
			"presetIntent: standard",
			"# Effective preset is still capPreset()'d at seat time",
			"approvalHooks:",
			"  - highImpact",
			"",
		].join("\n");
		const files = serializeDriveagentHome(
			home({ permissions: { presetIntent: "readonly", notes: undefined } }),
			{ permissionsYaml: previous },
		);
		expect(files.permissionsYaml).toContain("presetIntent: readonly");
		expect(files.permissionsYaml).toContain(
			"# Effective preset is still capPreset()'d at seat time",
		);
	});

	it("drops keys the merged home no longer carries", () => {
		const files = serializeDriveagentHome(
			home({ permissions: { notes: undefined } }),
			{ permissionsYaml: "presetIntent: standard\nnotes: old note\n" },
		);
		expect(files.permissionsYaml).not.toContain("old note");
	});

	it("falls back to a clean render when the previous text is unparseable", () => {
		const files = serializeDriveagentHome(home(), {
			permissionsYaml: "presetIntent: [unclosed\n",
		});
		expect(files.permissionsYaml).toContain("presetIntent: standard");
	});
});
