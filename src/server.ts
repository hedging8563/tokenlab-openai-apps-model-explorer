import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ErrorCode, GetPromptRequestSchema, ListPromptsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server';
import { CatalogUnavailableError, categoryCounts, createCatalogReader, selectModels } from './catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENLAB_API_BASE = (process.env.TOKENLAB_API_BASE || 'https://api.tokenlab.sh').replace(/\/+$/, '');
const PORT = Number(process.env.PORT || 8000);
const WIDGET_URI = 'ui://tokenlab/model-explorer.html';

const getCatalog = createCatalogReader({
  apiBase: TOKENLAB_API_BASE,
  maxAgeMs: process.env.CATALOG_CACHE_MS ? Number(process.env.CATALOG_CACHE_MS) : undefined,
});

// Every tool only reads TokenLab's own public catalog: nothing is written, deleted or posted anywhere.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

const CHALLENGE_FILE = path.join(__dirname, '../config/openai-apps-challenge.txt');

// OpenAI Apps domain verification token: env OPENAI_APPS_CHALLENGE_TOKEN, else config/openai-apps-challenge.txt,
// else none (the route answers 404). The token is public by design.
export async function readChallengeToken(): Promise<string | null> {
  const fromEnv = process.env.OPENAI_APPS_CHALLENGE_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = (await fs.readFile(process.env.OPENAI_APPS_CHALLENGE_FILE || CHALLENGE_FILE, 'utf8')).trim();
    return fromFile || null;
  } catch {
    return null;
  }
}

function catalogError(error: unknown) {
  const message = error instanceof CatalogUnavailableError ? error.message : 'TokenLab live model catalog is unavailable right now; no prices or models were returned.';
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

async function readWidgetHtml(): Promise<string> {
  return fs.readFile(path.join(__dirname, 'widget.html'), 'utf8');
}

async function fetchJson<T>(pathname: string): Promise<T> {
  const response = await fetch(`${TOKENLAB_API_BASE}${pathname}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`TokenLab ${pathname} returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function endpointExample(endpoint: string, model: string): string {
  if (endpoint === 'systemone') {
    const body = JSON.stringify({ model, state: { ticket: 'Please refund the duplicate charge.' }, questions: { refund: { type: 'noul', instructions: 'Is a refund requested?' } } });
    return `curl ${TOKENLAB_API_BASE}/v1/systemone \\
  -H "Authorization: Bearer $TOKENLAB_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${body.replaceAll("'", "'\\''")}'`;
  }
  if (endpoint === 'anthropic_messages') {
    return `curl ${TOKENLAB_API_BASE}/v1/messages \\
  -H "Authorization: Bearer $TOKENLAB_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${model}","max_tokens":512,"messages":[{"role":"user","content":"Hello from TokenLab"}]}'`;
  }

  if (endpoint === 'gemini_generate_content') {
    return `curl ${TOKENLAB_API_BASE}/v1beta/models/${model}:generateContent \\
  -H "Authorization: Bearer $TOKENLAB_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"contents":[{"role":"user","parts":[{"text":"Hello from TokenLab"}]}]}'`;
  }

  if (endpoint === 'responses') {
    return `curl ${TOKENLAB_API_BASE}/v1/responses \\
  -H "Authorization: Bearer $TOKENLAB_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${model}","input":"Hello from TokenLab"}'`;
  }

  return `curl ${TOKENLAB_API_BASE}/v1/chat/completions \\
  -H "Authorization: Bearer $TOKENLAB_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello from TokenLab"}]}'`;
}

function createTokenLabAppsServer(): McpServer {
  // Prompts are declared (and listed as empty) so directory scanners that call
  // prompts/list get a valid answer instead of "Method not found".
  const server = new McpServer({
    name: 'tokenlab-model-explorer-app',
    version: '0.1.0',
  }, {
    capabilities: { prompts: {} },
  });
  server.server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: [] }));
  server.server.setRequestHandler(GetPromptRequestSchema, (request) => {
    throw new McpError(ErrorCode.InvalidParams, `Prompt ${request.params.name} not found`);
  });

  registerAppResource(
    server,
    'TokenLab Model Explorer',
    WIDGET_URI,
    {
      description: 'Interactive model, pricing, and endpoint explorer for TokenLab.',
      _meta: {
        ui: {
          csp: {
            connectDomains: [TOKENLAB_API_BASE],
            resourceDomains: [],
          },
          prefersBorder: true,
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readWidgetHtml(),
          _meta: {
            ui: {
              csp: {
                connectDomains: [TOKENLAB_API_BASE],
                resourceDomains: [],
              },
              prefersBorder: true,
            },
          },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    'open_tokenlab_model_explorer',
    {
      title: 'Open TokenLab Model Explorer',
      description: 'Browse TokenLab models by category or search query, with context window, capabilities and platform price from the live public catalog.',
      inputSchema: {
        category: z.string().max(64).optional().describe('Catalog category such as chat (or text), image, video, audio, tts, stt, music, embedding, rerank, 3d, decision.'),
        query: z.string().max(200).optional().describe('Case-insensitive text matched against model IDs, for example "claude" or "gpt-5".'),
      },
      annotations: READ_ONLY,
      _meta: {
        ui: { resourceUri: WIDGET_URI },
      },
    },
    async ({ category, query }) => {
      let catalog;
      try {
        catalog = await getCatalog();
      } catch (error) {
        return catalogError(error);
      }
      const models = selectModels(catalog, category, query);
      return {
        content: [
          {
            type: 'text',
            text: `Found ${models.length} TokenLab models${category ? ` in ${category}` : ''} (live catalog read at ${catalog.fetched_at}).`,
          },
        ],
        structuredContent: {
          category: category || 'all',
          query: query || null,
          total: models.length,
          catalog_fetched_at: catalog.fetched_at,
          catalog_source: catalog.source,
          categories: categoryCounts(catalog),
          models,
        },
      };
    },
  );

  registerAppTool(
    server,
    'compare_tokenlab_models',
    {
      title: 'Compare TokenLab Models',
      description: 'Compare platform price, context window and capabilities for specific TokenLab model IDs, from the live public catalog.',
      inputSchema: {
        models: z.array(z.string().max(200)).min(1).max(8).describe('One to eight exact TokenLab model IDs to compare, for example ["gpt-5.5", "claude-sonnet-5-5"].'),
      },
      annotations: READ_ONLY,
      _meta: {
        ui: { resourceUri: WIDGET_URI },
      },
    },
    async ({ models }) => {
      let catalog;
      try {
        catalog = await getCatalog();
      } catch (error) {
        return catalogError(error);
      }
      const byId = new Map(catalog.models.map((m) => [m.id, m]));
      const compared = models.map((id) => byId.get(id)).filter((m) => m !== undefined);
      const missing = models.filter((id) => !byId.has(id));
      return {
        content: [
          {
            type: 'text',
            text: (compared.length > 0
              ? `Compared ${compared.length} TokenLab models (live catalog read at ${catalog.fetched_at}).`
              : 'No matching TokenLab models found in the live catalog.')
              + (missing.length > 0 ? ` Not in the catalog: ${missing.join(', ')}.` : ''),
          },
        ],
        structuredContent: {
          category: 'pricing',
          catalog_fetched_at: catalog.fetched_at,
          catalog_source: catalog.source,
          models: compared,
          missing,
        },
      };
    },
  );

  registerAppTool(
    server,
    'generate_tokenlab_endpoint_example',
    {
      title: 'Generate TokenLab Endpoint Example',
      description: 'Generate a copyable cURL example for OpenAI-compatible or native TokenLab endpoints.',
      inputSchema: {
        endpoint: z.enum(['chat_completions', 'responses', 'anthropic_messages', 'gemini_generate_content', 'systemone']).describe('API format for the example: OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, Gemini generateContent, or TokenLab SystemOne.'),
        model: z.string().default('gpt-5.5').describe('Exact TokenLab model ID to put in the example; it must be in the live catalog and support the chosen endpoint.'),
      },
      annotations: READ_ONLY,
      _meta: {
        ui: { resourceUri: WIDGET_URI },
      },
    },
    async ({ endpoint, model }) => {
      let catalog;
      try {
        catalog = await getCatalog();
      } catch (error) {
        return catalogError(error);
      }
      const listed = catalog.models.find((m) => m.id === model);
      if (!listed) throw new Error(`${model} is not in the live TokenLab catalog.`);
      const detail = await fetchJson<{ tokenlab?: { accepted_request_formats?: string[]; public_contract?: { public_operations?: string[]; request_endpoint?: string; request_endpoint_by_operation?: Record<string, string> } } }>(`/v1/models/${encodeURIComponent(model)}`);
      const contract = detail.tokenlab?.public_contract;
      const formats: Record<string, string> = { chat_completions: 'openai_chat_completions', responses: 'openai_responses', anthropic_messages: 'anthropic_messages', gemini_generate_content: 'gemini_generate_content' };
      const supported = endpoint === 'systemone'
        ? contract?.public_operations?.includes('systemone') && (contract.request_endpoint_by_operation?.systemone ?? contract.request_endpoint) === '/v1/systemone'
        : detail.tokenlab?.accepted_request_formats?.includes(formats[endpoint]);
      if (!supported) throw new Error(`${model} does not declare ${endpoint}; inspect its public model contract before selecting an endpoint.`);
      const example = endpointExample(endpoint, model);
      return {
        content: [{ type: 'text', text: example }],
        structuredContent: {
          category: 'example',
          models: [{ ...listed, category: endpoint }],
          catalog_fetched_at: catalog.fetched_at,
          example,
        },
      };
    },
  );

  return server;
}

async function handleMcpRequest(request: express.Request, response: express.Response): Promise<void> {
  const server = createTokenLabAppsServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  response.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(request, response, request.body);
}

export function createHttpApp() {
  const app = express();
  app.use(cors({
    origin: '*',
    exposedHeaders: ['mcp-session-id'],
  }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/', (_request, response) => {
    response.json({
      name: 'TokenLab Model Explorer App',
      mcp: '/mcp',
      widget_preview: '/widget',
      tokenlab_api_base: TOKENLAB_API_BASE,
    });
  });

  app.get('/.well-known/openai-apps-challenge', async (_request, response) => {
    const token = await readChallengeToken();
    if (!token) {
      response.status(404).type('text/plain').send('Not found');
      return;
    }
    response.set('Cache-Control', 'no-store').type('text/plain').send(token);
  });

  app.get('/widget', async (_request, response) => {
    // The standalone directory and HF Space share one maintained public UI.
    response.type('html').send(await fs.readFile(path.join(__dirname, '../huggingface/index.html'), 'utf8'));
  });

  // Only public discovery reads are exposed; never forward user credentials or
  // arbitrary URLs. This keeps standalone browsers independent of gateway CORS.
  const publicRead = (pathname: string) => async (_request: express.Request, response: express.Response) => {
    try {
      const data = await fetchJson(pathname);
      response.set('Cache-Control', 'public, max-age=15').json(data);
    } catch {
      response.status(502).json({ error: 'Public discovery endpoint unavailable' });
    }
  };
  app.get('/public/v1/models', publicRead('/v1/models'));
  app.get('/public/pricing.json', publicRead('/pricing.json'));
  app.get('/public/v1/models/:model', (request, response) => {
    const model = String(request.params.model);
    if (model === '.' || model === '..' || model.length > 512) {
      response.status(400).json({ error: 'Invalid model ID' });
      return;
    }
    return publicRead(`/v1/models/${encodeURIComponent(model)}`)(request, response);
  });

  app.all('/mcp', async (request, response, next) => {
    try {
      await handleMcpRequest(request, response);
    } catch (error) {
      next(error);
    }
  });

  return app;
}

const app = createHttpApp();
export default app;

if (process.argv.includes('--smoke')) {
  createTokenLabAppsServer();
  console.log('tokenlab model explorer app ok');
} else if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`TokenLab Model Explorer App listening on http://localhost:${PORT}`);
    console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  });
}
