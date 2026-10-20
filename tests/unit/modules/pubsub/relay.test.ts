import { describe, expect, it } from "vitest";
import { createPubsubRelay } from "../../../../src/modules/pubsub/relay.js";

// The web backend has no gRPC event stream, so presence + chat typing status ride an
// in-memory relay that fans a published topic out to every OTHER account's live
// connections (ADR-0018: the shell reads these back as Event_PubsubMessage on the
// session stream). The relay is pure and process-local: no DB, no sockets.

function bytes(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

describe("pubsub relay", () => {
	it("delivers a published topic to another account's connection, once", () => {
		const relay = createPubsubRelay();
		const received: Array<{
			topic: string;
			identity: string;
			subIds: string[];
			payload: Uint8Array;
		}> = [];

		relay.connect("u-2", (message) => received.push(message));
		relay.subscribe("u-2", "space-a", ["presence/obj-1"], "sub-2");

		relay.publish("u-1", "space-a", "presence/obj-1", bytes("hello"));

		expect(received.length).toBe(1);
		expect(received[0].topic).toBe("presence/obj-1");
		expect(received[0].identity).toBe("u-1");
		expect(received[0].subIds).toEqual(["sub-2"]);
		expect(new TextDecoder().decode(received[0].payload)).toBe("hello");
	});

	it("never echoes a message back to the publisher's own connections", () => {
		const relay = createPubsubRelay();
		const own: unknown[] = [];

		relay.connect("u-1", (message) => own.push(message));
		relay.subscribe("u-1", "space-a", ["presence/obj-1"], "sub-1");

		relay.publish("u-1", "space-a", "presence/obj-1", bytes("hi"));

		expect(own.length).toBe(0);
	});

	it("delivers to every live connection of a subscriber account", () => {
		const relay = createPubsubRelay();
		let a = 0;
		let b = 0;

		relay.connect("u-2", () => a++);
		relay.connect("u-2", () => b++);
		relay.subscribe("u-2", "space-a", ["status/chat-9"], "sub-x");

		relay.publish("u-1", "space-a", "status/chat-9", bytes("typing"));

		expect(a).toBe(1);
		expect(b).toBe(1);
	});

	it("stops delivering once the account unsubscribes", () => {
		const relay = createPubsubRelay();
		const received: unknown[] = [];

		relay.connect("u-2", (message) => received.push(message));
		relay.subscribe("u-2", "space-a", ["presence/obj-1"], "sub-2");
		relay.unsubscribe("u-2", "sub-2");

		relay.publish("u-1", "space-a", "presence/obj-1", bytes("late"));

		expect(received.length).toBe(0);
	});

	it("ignores a publish on a topic nobody subscribes to and on a foreign space", () => {
		const relay = createPubsubRelay();
		const received: unknown[] = [];

		relay.connect("u-2", (message) => received.push(message));
		relay.subscribe("u-2", "space-a", ["presence/obj-1"], "sub-2");

		relay.publish("u-1", "space-a", "presence/obj-OTHER", bytes("x"));
		relay.publish("u-1", "space-B", "presence/obj-1", bytes("y"));

		expect(received.length).toBe(0);
	});

	it("closes a connection so it no longer receives, without dropping the account's other tabs", () => {
		const relay = createPubsubRelay();
		let stale = 0;
		let live = 0;

		const close = relay.connect("u-2", () => stale++);
		relay.connect("u-2", () => live++);
		relay.subscribe("u-2", "space-a", ["presence/obj-1"], "sub-2");

		close();
		relay.publish("u-1", "space-a", "presence/obj-1", bytes("after-close"));

		expect(stale).toBe(0);
		expect(live).toBe(1);
	});
});
