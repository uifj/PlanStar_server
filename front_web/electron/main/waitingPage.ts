import { apiUrl } from "./desktop";

/**
 * The placeholder document the shell shows while it waits for the local harness server to answer.
 * Split out of main.ts so the orchestrator stays about *sequencing* the boot, not about markup.
 */
export const waitingHtml = (): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Harness server needed</title>
<style>
 body { font: 14px/1.6 -apple-system, system-ui, sans-serif; margin: 0; min-height: 100vh;
   display: grid; place-items: center; background: #f4f4f4; color: #111;
   -webkit-app-region: drag; }
 main { max-width: 34rem; padding: 2rem; background: #fff; border-radius: 12px;
   box-shadow: 0 1px 3px rgba(0,0,0,.12); -webkit-app-region: no-drag; }
 h1 { font-size: 1.1rem; margin: 0 0 .6rem; }
 code { background: #f0f0f0; padding: .15rem .4rem; border-radius: 4px; }
 p { margin: .5rem 0; }
 .dot { display:inline-block; width:.5rem; height:.5rem; border-radius:50%; background:#e0a100; margin-right:.4rem; }
</style></head>
<body><main>
 <h1><span class="dot"></span>Waiting for the local harness server</h1>
 <p>This desktop app is a shell around your own backend. It is looking for the API at
 <code>${apiUrl()}</code> and will connect as soon as it answers.</p>
 <p>Start it from the repository root:</p>
 <p><code>podman start vanlife-postgres</code> then <code>pnpm dev</code></p>
 <p>Nothing is sent anywhere else — commands go only to that origin.</p>
</main></body></html>`;
