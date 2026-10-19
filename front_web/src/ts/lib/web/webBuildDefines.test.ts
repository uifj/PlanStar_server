import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import webConfig from '../../../../vite.web.config';

// The web build injects vendor endpoints and credentials as compile-time defines. A fallback here is
// not a default — it ships inside the bundle every visitor downloads, and it silently turns a
// self-hosted build into a client of the vendor's telemetry and staging services. These two cases
// hold the line: nothing leaves by default, and setting the env still opts in.
type DefineBlock = Record<string, string>;

const defines = async (): Promise<DefineBlock> => {
	const config: any = await (webConfig as any)({ mode: 'development' });
	return config.define as DefineBlock;
};

const ENV_KEYS = ['SENTRY_DSN', 'SPARK_ONBOARDING_URL', 'SPARK_ONBOARDING_TOKEN'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
	for (const key of ENV_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		if (saved[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = saved[key];
		}
	}
});

describe('web build defines', () => {
	it('carries no vendor host or credential when the env names none', async () => {
		const define = await defines();

		expect(JSON.parse(define.SENTRY_DSN)).toBe('');
		expect(JSON.parse(define.SPARK_ONBOARDING_URL)).toBe('');
		expect(JSON.parse(define.SPARK_ONBOARDING_TOKEN)).toBe('');

		const shipped = Object.values(define).join('\n');

		expect(shipped).not.toMatch(/anytype|sentry\.io|spark|wss?:\/\//i);
	});

	it('still passes an operator-supplied value through', async () => {
		process.env.SENTRY_DSN = 'https://public@example.internal/7';
		process.env.SPARK_ONBOARDING_URL = 'wss://spark.example.internal';

		const define = await defines();

		expect(JSON.parse(define.SENTRY_DSN)).toBe('https://public@example.internal/7');
		expect(JSON.parse(define.SPARK_ONBOARDING_URL)).toBe('wss://spark.example.internal');
	});
});
