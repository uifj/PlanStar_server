import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isBlockedAddress } from "./link-preview-service.js";

// I.AiListModelsErrorCode (front_web interface/common.ts:151). Settings → AI treats a successful list
// as the config check — reachability, token and model availability all ride on this one call — and a
// nonzero code is rendered straight as "this provider does not work" (settings/import/aiSettings.tsx:58).
export const AI_ERROR = {
	OK: 0,
	UNKNOWN: 1,
	BAD_INPUT: 2,
	RATE_LIMIT: 100,
	NOT_REACHABLE: 101,
	MODEL_NOT_FOUND: 102,
	AUTH_REQUIRED: 103,
} as const;

export type AiListConfig = {
	provider: string;
	endpoint: string;
	token: string;
};

export type AiModel = { id: string; ownedBy: string };

export type AiModelList = {
	code: number;
	description: string;
	models: AiModel[];
};

const FETCH_TIMEOUT_MS = 8_000;

function failed(code: number, description: string): AiModelList {
	return { code, description, models: [] };
}

// The local providers this screen offers (Ollama, LM Studio) live on loopback, so loopback is allowed
// in every environment — the deliberate difference from a link preview, where it is a production
// secret. Any other address the preview guard classifies as private, reserved or link-local stays
// refused, as does the cloud-metadata range.
function isLoopbackHost(host: string): boolean {
	const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
	return (
		bare === "::1" ||
		bare.startsWith("127.") ||
		bare === "localhost" ||
		bare.endsWith(".localhost")
	);
}

async function assertEndpointAllowed(url: URL): Promise<string> {
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return "endpoint is not an http(s) url";
	}

	const host = url.hostname.replace(/^\[|\]$/g, "");
	if (isLoopbackHost(host)) {
		return "";
	}

	if (isIP(host)) {
		if (isBlockedAddress(host, true)) {
			return "endpoint host is not reachable from this server's allowlist";
		}
		return "";
	}

	const records = await lookup(host, { all: true, verbatim: true }).catch(
		() => null,
	);
	if (records === null || records.length === 0) {
		return "endpoint host does not resolve";
	}
	if (records.some((it) => isBlockedAddress(it.address, true))) {
		return "endpoint host resolves to a blocked address";
	}

	return "";
}

function modelsUrl(endpoint: string): string {
	const trimmed = endpoint.trim().replace(/\/+$/, "");
	return `${trimmed}/models`;
}

function modelEntries(payload: unknown): AiModel[] | null {
	const data = (payload as { data?: unknown })?.data;
	if (!Array.isArray(data)) {
		return null;
	}

	return data.flatMap((it) => {
		const model = it as { id?: unknown; owned_by?: unknown; ownedBy?: unknown };
		if (typeof model.id !== "string" || model.id === "") {
			return [];
		}
		const ownedBy =
			typeof model.owned_by === "string"
				? model.owned_by
				: typeof model.ownedBy === "string"
					? model.ownedBy
					: "";
		return [{ id: model.id, ownedBy }];
	});
}

// Ask an OpenAI-compatible provider for its model list. Nothing here is cached: the screen debounces
// on every keystroke of the provider/endpoint/token triple precisely so that a reply proves the config
// as it currently stands.
export async function listAiModels(config: AiListConfig): Promise<AiModelList> {
	const endpoint = config.endpoint.trim();
	if (endpoint === "") {
		return failed(AI_ERROR.BAD_INPUT, "no provider endpoint configured");
	}

	let url: URL;
	try {
		url = new URL(modelsUrl(endpoint));
	} catch {
		return failed(AI_ERROR.BAD_INPUT, "endpoint is not an absolute url");
	}

	const refusal = await assertEndpointAllowed(url);
	if (refusal !== "") {
		return failed(AI_ERROR.BAD_INPUT, refusal);
	}

	const headers: Record<string, string> = { accept: "application/json" };
	if (config.token.trim() !== "") {
		headers.authorization = `Bearer ${config.token.trim()}`;
	}

	const response = await fetch(url, {
		headers,
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		// A provider that answers with a redirect is not a provider we chase: the guard vetted the
		// host the caller configured, not whatever it points at next.
		redirect: "error",
	}).catch((error: unknown) => {
		const reason = error instanceof Error ? error.message : "request failed";
		return { error: `provider endpoint not reachable: ${reason}` } as const;
	});

	if ("error" in response) {
		return failed(AI_ERROR.NOT_REACHABLE, response.error);
	}

	if (response.status === 401 || response.status === 403) {
		return failed(
			AI_ERROR.AUTH_REQUIRED,
			"the provider rejected the configured token",
		);
	}
	if (response.status === 429) {
		return failed(AI_ERROR.RATE_LIMIT, "the provider rate limited the request");
	}
	if (!response.ok) {
		return failed(
			AI_ERROR.UNKNOWN,
			`provider answered ${response.status} for ${url.pathname}`,
		);
	}

	const payload = await response.json().catch(() => null);
	if (payload === null) {
		return failed(AI_ERROR.UNKNOWN, "provider did not answer json");
	}

	const models = modelEntries(payload);
	if (models === null) {
		return failed(
			AI_ERROR.UNKNOWN,
			"provider answered something other than a model list",
		);
	}

	return { code: AI_ERROR.OK, description: "", models };
}
