/**
 * Entry points (spec §3):
 *  - stdio — local development and Claude Code/Desktop integration;
 *  - Streamable HTTP (stateless, POST /mcp) — production transport. No legacy HTTP+SSE.
 *
 * HTTP transport security: the tools sit in front of other people's seller-account keys,
 * so the endpoint is protected by a bearer token (MCP_AUTH_TOKEN) and Origin validation
 * (defence against DNS rebinding from a browser). Without MCP_AUTH_TOKEN the server binds
 * to 127.0.0.1 only and says so in the log.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { initStore } from "./core/store.js";
import { buildServer } from "./server.js";

const useHttp = process.argv.includes("--http");

/** Timing-safe token comparison. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Whether the Origin is allowed. Requests without Origin (non-browser MCP clients) pass. */
function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  return allowed.includes(origin);
}

async function main() {
  const store = await initStore();

  if (!useHttp) {
    const server = buildServer(store);
    await server.connect(new StdioServerTransport());
    console.error("[mcp] stdio transport ready");
    return;
  }

  const port = Number(process.env.PORT ?? 3000);
  const authToken = process.env.MCP_AUTH_TOKEN;
  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Without authentication we refuse to expose the server: bind to loopback only.
  const host = authToken ? (process.env.HOST ?? "0.0.0.0") : "127.0.0.1";

  if (!authToken) {
    console.error(
      "[mcp] WARNING: MCP_AUTH_TOKEN is not set — /mcp is unauthenticated, " +
        "binding to 127.0.0.1 only. Set MCP_AUTH_TOKEN to expose it externally.",
    );
  }

  const httpServer = createServer(async (req, res) => {
    const json = (code: number, payload: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.url === "/health") {
      json(200, { ok: true, store: store.kind });
      return;
    }

    if (req.url?.startsWith("/mcp")) {
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST" }).end();
        return;
      }
      if (!originAllowed(req.headers.origin, allowedOrigins)) {
        json(403, { error: "origin not allowed" });
        return;
      }
      if (authToken) {
        const header = req.headers.authorization ?? "";
        const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
        if (!provided || !tokenMatches(provided, authToken)) {
          res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
      }

      // Stateless mode: a fresh transport and server per request, no session state.
      const server = buildServer(store);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
        } catch {
          if (!res.headersSent) json(500, { error: "internal error" });
        }
      });
      return;
    }
    res.writeHead(404).end();
  });

  httpServer.listen(port, host, () => {
    console.error(
      `[mcp] Streamable HTTP ready on ${host}:${port} (POST /mcp), store=${store.kind}, auth=${authToken ? "bearer" : "none"}`,
    );
  });
}

main().catch((e) => {
  console.error("[mcp] fatal:", e);
  process.exit(1);
});
