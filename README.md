# TokenLab OpenAI Apps Model Explorer

[![CI](https://github.com/hedging8563/tokenlab-openai-apps-model-explorer/actions/workflows/ci.yml/badge.svg)](https://github.com/hedging8563/tokenlab-openai-apps-model-explorer/actions/workflows/ci.yml)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-0f766e)](https://exposure-tokenlab-openai-apps-model.vercel.app/mcp)

Lightweight TokenLab Model Explorer prototype for ChatGPT/OpenAI Apps SDK. It exposes an MCP Streamable HTTP endpoint plus an interactive MCP Apps widget for:

- browsing TokenLab models from `/v1/models`, preserving the native `decision` category
- comparing pricing from `/pricing.json`
- generating contract-checked examples for Chat Completions, Responses, Anthropic Messages, Gemini `generateContent`, and Jev / System One decisions

This repository is intentionally small so it can be used as a public discoverability asset and a starting point for a hosted ChatGPT app.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhedging8563%2Ftokenlab-openai-apps-model-explorer&project-name=tokenlab-model-explorer&repository-name=tokenlab-model-explorer)

Live MCP endpoint: `https://exposure-tokenlab-openai-apps-model.vercel.app/mcp`

The maintained Vercel project deploys this repository to that hostname. The historical `tokenlab-model-explorer.vercel.app` deployment is not attached to this project and still serves the older contract; use the maintained endpoint for Jev decision examples.

## Run locally

```bash
npm install
npm test
npm start
```

The server listens on `http://localhost:8000`.

- MCP endpoint: `http://localhost:8000/mcp`
- Standalone model directory: `http://localhost:8000/widget`

Opening `/widget` directly loads the complete public model index, with 50 results per page. Search and category filters run across the entire loaded catalog, not just the current page. The embedded MCP App resource remains a tool-result view and displays no placeholder models before the host supplies a result. MCP discovery tools still return a bounded result set for conversation use.

For ChatGPT local testing, expose the MCP endpoint with a tunnel such as ngrok, then add the `/mcp` URL as a connector in ChatGPT developer mode.

The Express app is also exported as the default module, so Vercel can deploy this repository without a custom adapter.

## Environment

```bash
TOKENLAB_API_BASE=https://api.tokenlab.sh
PORT=8000
```

## Tools

| Tool | Purpose |
| --- | --- |
| `open_tokenlab_model_explorer` | Browse TokenLab models by category or search query. |
| `compare_tokenlab_models` | Compare pricing metadata for up to 8 model IDs. |
| `generate_tokenlab_endpoint_example` | Generate cURL snippets for OpenAI-compatible and native TokenLab endpoints. |

## Discovery inputs

- `https://api.tokenlab.sh/v1/models` and `/v1/models/{id}`
- `https://api.tokenlab.sh/pricing.json`
- `https://api.tokenlab.sh/integrations.json`
- `https://docs.tokenlab.sh/openapi.json`

## Notes

- The standalone `/widget` and Hugging Face static Space share `huggingface/index.html`. Upload that exact file to the existing `kiln4758/tokenlab-model-explorer` Space after validation; do not independently edit its pagination or endpoint logic in two places.
- `/widget` reads the catalog through same-origin `/public/v1/models`, `/public/v1/models/:model`, and `/public/pricing.json`. These read-only routes forward neither credentials nor arbitrary URLs; the static Space retains direct public API reads from its allowed origin.

- This app does not require a TokenLab API key for discovery tools.
- Inference tools should use `@tokenlabai/mcp-server`; this repo focuses on model exploration and endpoint examples. System One examples are synchronous typed decisions, not chat replies or authorization to execute actions.
- The widget follows the MCP Apps pattern: tools are registered with UI metadata, and the HTML resource is served as an MCP app resource.
