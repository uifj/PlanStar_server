import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
	".txt": "text/plain; charset=utf-8",
	".webmanifest": "application/manifest+json",
};

const hasExtension = (requestPath: string): boolean =>
	/\.[a-z0-9]{2,5}$/i.test(requestPath);

const typeOf = (filePath: string): string =>
	TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";

/**
 * A loopback static server for the built renderer. It exists so the app can be loaded from an http
 * origin (see desktop.ts) instead of `file://`, and it is deliberately minimal: one root, read-only,
 * bound to 127.0.0.1, no directory listing, and a path that cannot escape its root.
 */
export function createRendererServer(root: string): http.Server {
	const server = http.createServer((req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405).end("Method not allowed");
			return;
		}

		// `decodeURIComponent` throws on malformed escapes (e.g. `/%E0%A4%A`). An uncaught throw
		// here escapes the request handler and takes the main process down with it.
		let requestPath: string;
		try {
			requestPath = decodeURIComponent(
				(req.url || "/").split("?")[0].split("#")[0],
			);
		} catch {
			res.writeHead(400).end("Bad request");
			return;
		}
		const relative =
			requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
		const candidate = path.resolve(root, relative);

		// Containment check against the resolved root, not the raw string.
		if (candidate !== root && !candidate.startsWith(root + path.sep)) {
			res.writeHead(403).end("Forbidden");
			return;
		}

		const serve = (filePath: string): void => {
			fs.readFile(filePath, (error, body) => {
				if (error) {
					res.writeHead(404).end("Not found");
					return;
				}
				res.writeHead(200, {
					"Content-Type": typeOf(filePath),
					"Cache-Control": "no-cache",
					// The renderer is same-site with the API but cross-origin, so it needs its own
					// isolation header; the app never frames itself.
					"X-Content-Type-Options": "nosniff",
					"X-Frame-Options": "DENY",
					// Enforcing, minimal: these three directives cannot break a Vite bundle (no plugin
					// injection, no frames, no base rewriting), so a violation here is always a bug
					// worth blocking. Browsers intersect every `Content-Security-Policy` header with the
					// Report-Only one below, so the rest of the policy is advisory until it is proven.
					"Content-Security-Policy":
						"object-src 'none'; base-uri 'none'; frame-ancestors 'none';",
					// Report-Only on purpose: the renderer can be pointed at another API with
					// `?server=`, so `connect-src` must stay open. Do not promote the whole policy to
					// enforcing without solving that first.
					"Content-Security-Policy-Report-Only":
						"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
						"img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; " +
						"worker-src 'self' blob:; connect-src *;",
				});
				res.end(req.method === "HEAD" ? undefined : body);
			});
		};

		if (!hasExtension(requestPath)) {
			// The client drives its own routes through history.pushState, so any extension-less path
			// belongs to the single-page app.
			serve(path.join(root, "index.html"));
			return;
		}

		fs.stat(candidate, (error, stats) => {
			if (!error && stats.isFile()) {
				serve(candidate);
				return;
			}
			serve(path.join(root, "index.html"));
		});
	});

	server.on("clientError", (_error, socket) => socket.destroy());
	return server;
}

/**
 * Listen on the fixed port. A refusal to bind is reported, never answered with a different port: the
 * backend's CORS whitelist and Better Auth trusted origins name exactly one desktop origin, so an
 * ephemeral port would produce an app that boots and then 401s in a way that looks like an auth bug.
 */
export function listen(server: http.Server, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
}
