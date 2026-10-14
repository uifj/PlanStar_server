import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import type { DocumentBlock, UpdateBlockInput } from "../types";
import { useBlockEditor } from "./useBlockEditor";

function block(id: string, text: string): DocumentBlock {
	return {
		id,
		objectId: "doc-1",
		parentId: null,
		type: "text",
		style: "paragraph",
		text,
		linkTargetId: null,
		createdAt: "2026-10-14T00:00:00.000Z",
		updatedAt: "2026-10-14T00:00:00.000Z",
	};
}

const blocks = [
	block("b-1", "first"),
	block("b-2", "second"),
	block("b-3", "third"),
];

function wrapper({ children }: PropsWithChildren) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function fakeDocument(initial: DocumentBlock[]) {
	const stored = [...initial];
	const patches: { url: string; body: UpdateBlockInput }[] = [];

	return {
		patches,
		handlers: [
			http.get("/api/objects/doc-1/blocks", () =>
				HttpResponse.json({ data: stored }),
			),
			http.patch("/api/blocks/:blockId", async ({ request, params }) => {
				const body = (await request.json()) as UpdateBlockInput;
				const blockId = params.blockId as string;
				patches.push({ url: `/api/blocks/${blockId}`, body });

				if (body.text !== undefined) {
					const target = stored.find((block) => block.id === blockId);

					if (target) {
						target.text = body.text;
					}
				}

				if (body.afterBlockId !== undefined) {
					const moved = stored.find((block) => block.id === blockId);
					const without = stored.filter((block) => block.id !== blockId);
					const after = without.findIndex(
						(block) => block.id === body.afterBlockId,
					);

					without.splice(after + 1, 0, moved as DocumentBlock);
					stored.length = 0;
					stored.push(...without);
				}

				return HttpResponse.json({});
			}),
		],
	};
}

describe("useBlockEditor", () => {
	it("moves a block by naming the sibling it should follow", async () => {
		// Arrange
		const fake = fakeDocument(blocks);
		server.use(...fake.handlers);

		const { result } = renderHook(() => useBlockEditor("doc-1"), { wrapper });
		await waitFor(() => expect(result.current.blocks).toHaveLength(3));

		// Act — drag the third block onto the first
		result.current.move("b-3", "b-1");

		// Assert — one PATCH for the moved block only, and it lands in front
		await waitFor(() => expect(fake.patches).toHaveLength(1));
		expect(fake.patches[0].url).toBe("/api/blocks/b-3");
		expect(fake.patches[0].body).toEqual({ afterBlockId: null });
		await waitFor(() =>
			expect(result.current.blocks.map((block) => block.id)).toEqual([
				"b-3",
				"b-1",
				"b-2",
			]),
		);
	});

	it("saves an edited block's text", async () => {
		// Arrange
		const fake = fakeDocument(blocks);
		server.use(...fake.handlers);

		const { result } = renderHook(() => useBlockEditor("doc-1"), { wrapper });
		await waitFor(() => expect(result.current.blocks).toHaveLength(3));

		// Act
		await result.current.changeText("b-2", "rewritten second");

		// Assert
		expect(fake.patches).toEqual([
			{ url: "/api/blocks/b-2", body: { text: "rewritten second" } },
		]);
		await waitFor(() =>
			expect(result.current.blocks[1].text).toBe("rewritten second"),
		);
	});

	it("follows the drop target when moving a block down the list", async () => {
		// Arrange
		const fake = fakeDocument(blocks);
		server.use(...fake.handlers);

		const { result } = renderHook(() => useBlockEditor("doc-1"), { wrapper });
		await waitFor(() => expect(result.current.blocks).toHaveLength(3));

		// Act — drag the first block onto the third
		result.current.move("b-1", "b-3");

		// Assert
		await waitFor(() => expect(fake.patches).toHaveLength(1));
		expect(fake.patches[0].body).toEqual({ afterBlockId: "b-3" });
	});
});
