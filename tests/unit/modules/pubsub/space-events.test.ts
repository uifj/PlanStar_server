import { describe, expect, it } from "vitest";
import { createSpaceEvents } from "../../../../src/modules/pubsub/space-events.js";

// Object-mutation deltas (a new chat message, a deleted object) are pushed to the members
// of a space so their open tabs update without a reload. Delivery is scoped to accounts that
// have opened that space (membership is already gated at WorkspaceOpen), and the acting
// account is excluded because its own command response already carries the event.

type Frame = { contextId: string; messages: string[] };

const chatFrame = (text: string): Frame => ({
	contextId: "chat-1",
	messages: [text],
});

describe("space event hub", () => {
	it("delivers an event to another member's connection that opened the space", () => {
		const hub = createSpaceEvents();
		const received: Frame[] = [];

		hub.connect("u-2", (frame) => received.push(frame));
		hub.track("space-a", "u-2");

		hub.emit("space-a", chatFrame("hello"), "u-1");

		expect(received).toEqual([chatFrame("hello")]);
	});

	it("never echoes the acting account", () => {
		const hub = createSpaceEvents();
		const received: Frame[] = [];

		hub.connect("u-1", (frame) => received.push(frame));
		hub.track("space-a", "u-1");

		hub.emit("space-a", chatFrame("mine"), "u-1");

		expect(received.length).toBe(0);
	});

	it("does not leak into a space the account never opened", () => {
		const hub = createSpaceEvents();
		const received: Frame[] = [];

		hub.connect("u-2", (frame) => received.push(frame));
		hub.track("space-a", "u-2");

		hub.emit("space-b", chatFrame("secret"), "u-1");

		expect(received.length).toBe(0);
	});

	it("stops delivering after the account leaves the space", () => {
		const hub = createSpaceEvents();
		const received: Frame[] = [];

		hub.connect("u-2", (frame) => received.push(frame));
		hub.track("space-a", "u-2");
		hub.leave("space-a", "u-2");

		hub.emit("space-a", chatFrame("after-leave"), "u-1");

		expect(received.length).toBe(0);
	});

	it("delivers once per live connection and stops after that connection closes", () => {
		const hub = createSpaceEvents();
		let a = 0;
		let b = 0;

		const close = hub.connect("u-2", () => a++);
		hub.connect("u-2", () => b++);
		hub.track("space-a", "u-2");

		hub.emit("space-a", chatFrame("x"), "u-1");
		expect(a).toBe(1);
		expect(b).toBe(1);

		close();
		hub.emit("space-a", chatFrame("y"), "u-1");
		expect(a).toBe(1);
		expect(b).toBe(2);
	});
});
