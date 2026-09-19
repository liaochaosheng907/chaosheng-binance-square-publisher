import { createServer } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const PORT = Number(process.env.PORT || 3000);
const BINANCE_URL =
  "https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add";

async function publishTextToBinance(text) {
  const apiKey = process.env.BINANCE_SQUARE_OPENAPI_KEY;
  if (!apiKey) {
    throw new Error("BINANCE_SQUARE_OPENAPI_KEY is not configured on the server.");
  }

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Post text is empty.");
  }

  if (text.length > 2100) {
    throw new Error(`Post text is too long: ${text.length}/2100 characters.`);
  }

  const response = await fetch(BINANCE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "clienttype": "binanceSkill",
      "X-Square-OpenAPI-Key": apiKey,
    },
    body: JSON.stringify({ bodyTextOnly: text }),
  });

  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(`Binance Square returned HTTP ${response.status}. ${raw.slice(0, 500)}`);
  }

  if (!payload || payload.code !== "000000") {
    const code = payload?.code ?? "unknown";
    const message = payload?.message ?? "Unknown Binance Square error";
    throw new Error(`Binance Square publish failed. code=${code}, message=${message}`);
  }

  const id = payload?.data?.id;
  if (!id) {
    throw new Error("Binance Square reported success, but no post ID was returned.");
  }

  return {
    id: String(id),
    url: `https://www.binance.com/square/post/${id}`,
  };
}

function makeMcpServer() {
  const server = new McpServer({
    name: "chaosheng-binance-square-publisher",
    version: "1.1.0",
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
      try {
        const result = await publishTextToBinance(text);
        return {
          content: [
            {
              type: "text",
              text: `Published successfully. Post ID: ${result.id}\n${result.url}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
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

let startupPublishStarted = false;
async function maybePublishFromEnvironment() {
  if (startupPublishStarted) return;
  startupPublishStarted = true;

  const text = process.env.CHAOSHENG_PUBLISH_TEXT;
  const nonce = process.env.CHAOSHENG_PUBLISH_NONCE;

  if (!text || !nonce) {
    console.log("CHAOSHENG_PUBLISH_IDLE");
    return;
  }

  console.log(`CHAOSHENG_PUBLISH_START nonce=${nonce}`);

  try {
    const result = await publishTextToBinance(text);
    console.log(
      `CHAOSHENG_PUBLISH_SUCCESS nonce=${nonce} postId=${result.id} url=${result.url}`
    );
  } catch (error) {
    console.error(
      `CHAOSHENG_PUBLISH_FAILED nonce=${nonce} error=${error instanceof Error ? error.message : String(error)}`
    );
  }
}

void maybePublishFromEnvironment();

process.on("SIGTERM", async () => {
  await mcpHandler.close();
  httpServer.close(() => process.exit(0));
});
