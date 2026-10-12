import { deepSeek } from "@genkit-ai/compat-oai/deepseek";
import { googleAI } from "@genkit-ai/google-genai";
import { genkit } from "genkit/beta";
import { env } from "../config/env.js";

type GenkitConfig = Pick<
	typeof env,
	"AGENT_MODEL" | "DEEPSEEK_API_KEY" | "GEMINI_API_KEY"
>;

/**
 * Only the provider the configured model points at may be loaded: with a second
 * provider registered, agents resolve to that provider's default model and the
 * chosen one is silently ignored.
 */
export function providerNameFor(config: GenkitConfig) {
	const [provider] = config.AGENT_MODEL.split("/");

	switch (provider) {
		case "deepseek":
			return config.DEEPSEEK_API_KEY ? "deepseek" : undefined;
		case "googleai":
			return "googleai";
		default:
			return undefined;
	}
}

export function createAi(config: GenkitConfig = env) {
	const provider = providerNameFor(config);

	// deepSeek() throws while initialising unless it is given a key
	const plugins =
		provider === "deepseek"
			? [deepSeek({ apiKey: config.DEEPSEEK_API_KEY })]
			: provider === "googleai"
				? [googleAI()]
				: [];

	return genkit({ plugins, model: config.AGENT_MODEL });
}

export const ai = createAi();
