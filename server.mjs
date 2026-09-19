import { createServer } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const PORT = Number(process.env.PORT || 3000);
const BINANCE_URL =
  "https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add";

function makeMcpServer() {
  const server = new McpServer({
    name: "chaosheng-binance-square-publisher",
    version: "1.0.0",
  });

  server.registerTool(
    "publish_binance_square_post",
    {
      description:
        "Publish the exact finalized text to Binance Square. This is an external write action. Call only after the user explicitly asks to publish the post.",
      inputSchema: z.object({
        text: z
          .string()
          .min(1)
          .max(2100)
          .describe("The exact Binance Square post text to publish."),
      }),
    },
    async ({ text }) => {
      const apiKey = process.env.BINANCE_SQUARE_OPENAPI_KEY;
      if (!apiKey) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "BINANCE_SQUARE_OPENAPI_KEY is not configured on the server.",
            },
          ],
        };
      }

      let response;
      try {
        response = await fetch(BINANCE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "clienttype": "binanceSkill",
            "X-Square-OpenAPI-Key": apiKey,
          },
          body: JSON.stringify({ bodyTextOnly: text }),
        });
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Network error while publishing to Binance Square: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }

      const raw = await response.text();
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }

      if (!response.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Binance Square returned HTTP ${response.status}. ${raw.slice(0, 500)}`,
            },
          ],
        };
      }

      if (!payload || payload.code !== "000000") {
        const code = payload?.code ?? "unknown";
        const message = payload?.message ?? "Unknown Binance Square error";
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Binance Square publish failed. code=${code}, message=${message}`,
            },
          ],
        };
      }

      const id = payload?.data?.id;
      if (!id) {
        return {
          content: [
            {
              type: "text",
              text: "Binance Square reported success, but no post ID was returned. Check your Square profile.",
            },
          ],
        };
      }

      const url = `https://www.binance.com/square/post/${id}`;
      return {
        content: [
          {
            type: "text",
            text: `Published successfully. Post ID: ${id}\n${url}`,
          },
        ],
      };
    }
  );

  return server;
}

const mcpHandler = createMcpHandler(makeMcpServer);
const nodeMcpHandler = toNodeHandler(mcpHandler);

const httpServer = createServer((req, res) => {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "chaosheng-binance-square-publisher",
        mcpConfigured: Boolean(process.env.MCP_PATH_SECRET),
        binanceConfigured: Boolean(process.env.BINANCE_SQUARE_OPENAPI_KEY),
      })
    );
    return;
  }

  const secret = process.env.MCP_PATH_SECRET;
  if (!secret) {
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "MCP endpoint is not configured." }));
    return;
  }

  const expectedPath = `/mcp/${secret}`;
  if (url.pathname !== expectedPath) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  void nodeMcpHandler(req, res);
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`chaosheng publisher listening on port ${PORT}`);
});

process.on("SIGTERM", async () => {
  await mcpHandler.close();
  httpServer.close(() => process.exit(0));
});
