# TokenLab OpenAI Apps Model Explorer

[![CI](https://github.com/hedging8563/tokenlab-openai-apps-model-explorer/actions/workflows/ci.yml/badge.svg)](https://github.com/hedging8563/tokenlab-openai-apps-model-explorer/actions/workflows/ci.yml)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-0f766e)](https://tokenlab-model-explorer.vercel.app/mcp)

Lightweight TokenLab Model Explorer prototype for ChatGPT/OpenAI Apps SDK. It exposes an MCP Streamable HTTP endpoint plus an interactive MCP Apps widget for:

- browsing TokenLab models from `/models.json`
- comparing pricing from `/pricing.json`
- generating copyable examples for Chat Completions, Responses, Anthropic Messages, and Gemini `generateContent`

This repository is intentionally small so it can be used as a public discoverability asset and a starting point for a hosted ChatGPT app.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhedging8563%2Ftokenlab-openai-apps-model-explorer&project-name=tokenlab-model-explorer&repository-name=tokenlab-model-explorer)

Live MCP endpoint: `https://tokenlab-model-explorer.vercel.app/mcp`

## Run locally

```bash
npm install
npm test
npm start
```

The server listens on `http://localhost:8000`.

- MCP endpoint: `http://localhost:8000/mcp`
- Widget preview: `http://localhost:8000/widget`

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

- `https://api.tokenlab.sh/models.json`
- `https://api.tokenlab.sh/pricing.json`
- `https://api.tokenlab.sh/integrations.json`
- `https://docs.tokenlab.sh/openapi.json`

## Notes

- This app does not require a TokenLab API key for discovery tools.
- Inference tools should use `@tokenlab/mcp-server`; this repo focuses on model exploration and endpoint examples.
- The widget follows the MCP Apps pattern: tools are registered with UI metadata, and the HTML resource is served as an MCP app resource.
