import { describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { createAi, providerNameFor } from "../../src/lib/genkit.js";

describe("genkit provider wiring", () => {
	it("boots without a DeepSeek key", () => {
		// Assert — the DeepSeek plugin throws on a missing key, so it must not
		// be loaded unless one is configured
		expect(() =>
			createAi({ ...env, DEEPSEEK_API_KEY: undefined }),
		).not.toThrow();
	});

	it("boots with a DeepSeek key", () => {
		// Act / Assert
		expect(() =>
			createAi({ ...env, DEEPSEEK_API_KEY: "test-deepseek-key" }),
		).not.toThrow();
	});

	it("picks exactly the provider the configured model points at", () => {
		// Assert — loading a second provider makes agents fall back to its
		// default model, so only the selected one may be registered
		expect(
			providerNameFor({
				AGENT_MODEL: "deepseek/deepseek-chat",
				DEEPSEEK_API_KEY: "k",
			}),
		).toBe("deepseek");
		expect(
			providerNameFor({ AGENT_MODEL: "googleai/gemini-flash-latest" }),
		).toBe("googleai");
		expect(providerNameFor({ AGENT_MODEL: "deepseek/deepseek-chat" })).toBe(
			undefined,
		);
		expect(
			providerNameFor({ AGENT_MODEL: "ollama/llama3", DEEPSEEK_API_KEY: "k" }),
		).toBeUndefined();
	});
});
