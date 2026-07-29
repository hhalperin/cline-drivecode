import { describe, expect, it } from "vitest";
import { resolveClineHubServerOptions } from "./options";

describe("websocket server options", () => {
	it("provides bounded delivery and inbound defaults", () => {
		const options = resolveClineHubServerOptions({});
		expect(options.maxInboundPayloadBytes).toBe(1024 * 1024);
		expect(options.websocketDelivery).toEqual({
			softWatermarkBytes: 256 * 1024,
			hardWatermarkBytes: 1024 * 1024,
		});
	});

	it("accepts configured byte limits", () => {
		const options = resolveClineHubServerOptions({
			CLINE_HUB_WS_MAX_INBOUND_PAYLOAD_BYTES: "2048",
			CLINE_HUB_WS_SOFT_WATERMARK_BYTES: "1024",
			CLINE_HUB_WS_HARD_WATERMARK_BYTES: "4096",
		});
		expect(options.maxInboundPayloadBytes).toBe(2048);
		expect(options.websocketDelivery).toEqual({
			softWatermarkBytes: 1024,
			hardWatermarkBytes: 4096,
		});
	});

	it("rejects invalid or inverted limits", () => {
		expect(() =>
			resolveClineHubServerOptions({
				CLINE_HUB_WS_MAX_INBOUND_PAYLOAD_BYTES: "0",
			}),
		).toThrow("must be a positive integer");
		expect(() =>
			resolveClineHubServerOptions({
				CLINE_HUB_WS_SOFT_WATERMARK_BYTES: "5",
				CLINE_HUB_WS_HARD_WATERMARK_BYTES: "4",
			}),
		).toThrow("soft watermark cannot exceed hard watermark");
	});
});
