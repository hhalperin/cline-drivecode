import type { AimdConfig } from "./types";

export const DEFAULT_AIMD: AimdConfig = {
	initial: 2,
	min: 1,
	max: 8,
	increase: 1,
	decrease: 0.5,
};

/**
 * Additive-increase / multiplicative-decrease concurrency window.
 * Success widens the window; rate-limit or failure shrinks it.
 */
export class AimdController {
	readonly config: AimdConfig;
	#window: number;

	constructor(config: Partial<AimdConfig> = {}) {
		this.config = { ...DEFAULT_AIMD, ...config };
		if (this.config.min < 1) {
			throw new Error("AimdController min must be >= 1");
		}
		if (this.config.max < this.config.min) {
			throw new Error("AimdController max must be >= min");
		}
		this.#window = clamp(
			this.config.initial,
			this.config.min,
			this.config.max,
		);
	}

	get window(): number {
		return this.#window;
	}

	onSuccess(): number {
		this.#window = clamp(
			this.#window + this.config.increase,
			this.config.min,
			this.config.max,
		);
		return this.#window;
	}

	onFailure(): number {
		this.#window = clamp(
			Math.max(this.config.min, Math.floor(this.#window * this.config.decrease)),
			this.config.min,
			this.config.max,
		);
		return this.#window;
	}

	/** Treat provider 429 / throttle as a hard shrink. */
	onRateLimited(): number {
		return this.onFailure();
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
