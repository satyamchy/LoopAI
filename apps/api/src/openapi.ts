/** OpenAPI document served at /openapi.json and rendered by Swagger UI at /docs. */
export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "LoopAI API",
    version: "0.1.0",
    description:
      "Dashboard calls need no Authorization header. An outside agent sends Authorization: Bearer lai_.... MCP always requires that header. Tokens are never returned.",
  },
  servers: [{ url: "http://localhost:8787" }],
  tags: [
    { name: "Catalog" },
    { name: "Connections" },
    { name: "Tools" },
    { name: "Chat" },
    { name: "Agents" },
  ],
  components: {
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer", description: "Agent key starting with lai_. Omit it for the local dashboard." },
    },
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"],
      },
      Account: {
        type: "object",
        properties: {
          id: { type: "string" },
          workspaceId: { type: "string" },
          toolkitSlug: { type: "string" },
          scope: { type: "string", enum: ["user", "workspace"] },
          status: { type: "string" },
          externalLabel: { type: "string", nullable: true },
          expiresAt: { type: "string", nullable: true },
          createdAt: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/v1/health": {
      get: { tags: ["Catalog"], summary: "Liveness", responses: { "200": { description: "API is up" } } },
    },
    "/v1/workspace": {
      get: { tags: ["Catalog"], summary: "Get or create the local workspace", responses: { "200": { description: "Workspace id and name" } } },
    },
    "/v1/toolkits": {
      get: { tags: ["Catalog"], summary: "List apps and their actions", responses: { "200": { description: "Toolkit cards. No tokens and no run functions." } } },
    },
    "/v1/providers": {
      get: { tags: ["Chat"], summary: "List model providers", responses: { "200": { description: "OpenAI, Gemini, Groq, OpenRouter, and Custom." } } },
    },
    "/v1/connections": {
      get: {
        tags: ["Connections"],
        summary: "List connected accounts",
        responses: { "200": { description: "Accounts without encrypted credentials." } },
      },
      post: {
        tags: ["Connections"],
        summary: "Save an API-key connection",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["toolkit"],
                properties: {
                  toolkit: { type: "string", example: "telegram" },
                  scope: { type: "string", enum: ["user", "workspace"] },
                  label: { type: "string" },
                  secret: { type: "string", description: "Echo only. At least 8 characters." },
                  credentials: {
                    type: "object",
                    additionalProperties: { type: "string" },
                    example: { botToken: "from-botfather" },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "The new account. The secret is not in the body." },
          "400": { description: "Wrong app type, or a credential shorter than 8 characters.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/v1/connections/start": {
      post: {
        tags: ["Connections"],
        summary: "Start OAuth or reconnect an account",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["toolkit"],
                properties: {
                  toolkit: { type: "string", example: "gmail" },
                  scope: { type: "string", enum: ["user", "workspace"] },
                  accountId: { type: "string", description: "Set this to update an existing account instead of inserting one." },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Provider login URL." },
          "400": { description: "App is not OAuth, or the client id and secret are missing." },
          "404": { description: "accountId was not found in this workspace." },
        },
      },
    },
    "/v1/oauth/callback": {
      get: {
        tags: ["Connections"],
        summary: "OAuth redirect target",
        parameters: [
          { name: "code", in: "query", schema: { type: "string" } },
          { name: "state", in: "query", schema: { type: "string" } },
          { name: "error", in: "query", schema: { type: "string" } },
        ],
        responses: { "302": { description: "Redirects to the dashboard app page." } },
      },
    },
    "/v1/connections/{id}": {
      delete: {
        tags: ["Connections"],
        summary: "Delete a connected account",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Deleted." }, "404": { description: "Not found." } },
      },
    },
    "/v1/tools/execute": {
      post: {
        tags: ["Tools"],
        summary: "Run one tool action",
        parameters: [{ name: "Idempotency-Key", in: "header", schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["toolkit", "action"],
                properties: {
                  toolkit: { type: "string", example: "news" },
                  action: { type: "string", example: "latest" },
                  arguments: { type: "object" },
                  connectedAccountId: { type: "string" },
                  idempotencyKey: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Succeeded. result is redacted." },
          "400": { description: "Invalid arguments or the app is not connected." },
          "502": { description: "Vendor failed. The body does not include the token." },
        },
      },
    },
    "/v1/llm-connections": {
      get: { tags: ["Chat"], summary: "List saved models", responses: { "200": { description: "Models without API keys." } } },
      post: {
        tags: ["Chat"],
        summary: "Save a model key",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["model", "apiKey"],
                properties: {
                  provider: { type: "string", example: "gemini" },
                  model: { type: "string", example: "gemini-2.0-flash" },
                  apiKey: { type: "string" },
                  baseUrl: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Saved model. The key is not returned." }, "400": { description: "Missing model, short key, or custom provider without a base URL." } },
      },
    },
    "/v1/conversations": {
      get: { tags: ["Chat"], summary: "List chats", responses: { "200": { description: "Newest first." } } },
    },
    "/v1/conversations/{id}": {
      delete: {
        tags: ["Chat"],
        summary: "Delete one chat",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "The chat and its messages are gone." }, "404": { description: "Not in this workspace." } },
      },
    },
    "/v1/conversations/{id}/messages": {
      get: {
        tags: ["Chat"],
        summary: "Load one chat",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Last 20 messages, oldest first." }, "404": { description: "Not in this workspace." } },
      },
    },
    "/v1/chat": {
      post: {
        tags: ["Chat"],
        summary: "Send a chat message",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["llmConnectionId", "message"],
                properties: {
                  llmConnectionId: { type: "string" },
                  message: { type: "string" },
                  conversationId: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Reply text and the tool names that ran." },
          "400": { description: "Missing message or unknown model." },
          "502": { description: "Model or tool failed. The error is stored on the thread and does not contain the key." },
        },
      },
    },
    "/v1/agent-keys": {
      get: { tags: ["Agents"], summary: "List agent key prefixes", responses: { "200": { description: "Prefixes and the MCP URL. Raw keys are not listed." } } },
      post: {
        tags: ["Agents"],
        summary: "Create an agent key",
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { name: { type: "string", example: "Cursor" } } } } },
        },
        responses: { "200": { description: "The raw lai_ key is returned once." } },
      },
    },
    "/mcp": {
      post: {
        tags: ["Agents"],
        summary: "MCP endpoint",
        security: [{ bearer: [] }],
        responses: { "200": { description: "Streamable HTTP MCP response." }, "401": { description: "Bearer key missing or unknown." } },
      },
    },
  },
} as const;
