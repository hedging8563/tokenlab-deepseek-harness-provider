# TokenLab for DeepSeek Harness

`@tokenlabai/dsh-provider` is an installable DeepSeek Harness profile bundle. It adds TokenLab as a model provider and exposes TokenLab's full developer API as Harness tools.

The bundle keeps model traffic on the most native protocol DeepSeek Harness currently supports:

- OpenAI-owned models that declare `openai_responses` use `/v1/responses`.
- Anthropic-owned models that declare `anthropic_messages` use `/v1/messages`.
- All remaining compatible chat models use `/v1/chat/completions`.
- Gemini-native `generateContent` is not configurable in the current Harness custom-provider adapter, so Gemini models use their declared Chat Completions compatibility path.

Protocol eligibility comes from each model's public TokenLab detail contract at `GET /v1/models/{id}`. The generator never classifies a model by substring or provider-internal route data.

## What is included

| Surface | Implementation | Current bundled contract |
| --- | --- | --- |
| Model picker | Existing DSH `llm-pi-ai` adapter | 134 public chat models on three exclusive protocol routes |
| Responses | Native `openai-responses` route | 27 models |
| Messages | Native `anthropic-messages` route | 8 models |
| Chat | OpenAI Chat Completions route | 99 models |
| Multimodal and developer tools | Official DSH MCP bridge + `@tokenlabai/mcp-server@0.6.17` full profile | 80 registered tools |
| Async completion | Native `tokenlab_wait_task` tool | image, video, music, and 3D task polling with cancellation and bounded retries |

The full MCP profile covers public model discovery and pricing, Chat Completions, Responses, Anthropic Messages, Gemini `generateContent`, image generation/edit/variation, video, music, 3D, TTS, STT, files, tasks, embeddings, rerank, translation, response lifecycle, batches, Seedance assets/groups, worlds, and other allowlisted developer operations in the pinned TokenLab MCP contract.

## Requirements

- DeepSeek Harness `0.1.1-rc.2` or a compatible `0.1.x` build
- Node.js `22.19+` or `24+`
- A TokenLab API key for inference, media, files, tasks, embeddings, rerank, and translation

Public catalog and pricing tools remain available without a key, but this bundle starts the full tool profile and is intended for authenticated use.

## Install

Put the key in the project `.env` or the Harness-home `.env`. DSH loads those files into the launch environment before resolving bundle configuration and before starting the MCP child process.

```dotenv
TOKENLAB_API_KEY=sk-your-tokenlab-key
```

Then install the bundle into the profile you use:

```bash
dsh plugin --profile web add --workspace-root @tokenlabai/dsh-provider
```

For a headless profile:

```bash
dsh plugin --profile headless add --workspace-root @tokenlabai/dsh-provider
```

Restart that profile after installation. In the model picker, TokenLab appears as three provider routes:

- `TokenLab · Responses`
- `TokenLab · Messages`
- `TokenLab · Chat`

Each model ID appears on exactly one route.

## Use multimedia and async tasks

The model sees TokenLab MCP tools under the `mcp__tokenlab__...` namespace. A typical async media flow is:

1. Discover a currently enabled model with `mcp__tokenlab__list_models` or `mcp__tokenlab__compare_models`.
2. Submit with `mcp__tokenlab__create_video`, `create_music`, `create_3d_model`, or an image tool.
3. Read `delivery.mode`; do not assume every image result is synchronous.
4. If `delivery.mode` is `async`, pass `delivery.task_id` to `tokenlab_wait_task`.
5. Use the returned `status`, full `response`, and `result_urls`. A timed-out wait returns the latest state so another call can resume polling.

`tokenlab_wait_task` forwards the Harness caller's `AbortSignal` through every fetch and cancellable delay. It treats `completed`, `failed`, `succeeded`, `cancelled`, and `expired` as terminal, retries only bounded transient HTTP failures, and never changes task state. Use the generated `mcp__tokenlab__cancel_task` tool when cancellation is supported and intended.

## Configuration

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TOKENLAB_API_KEY` | none | Shared TokenLab credential for model routes, MCP tools, and async wait |
| `TOKENLAB_API_BASE` | `https://api.tokenlab.sh` | MCP and async-task API root |
| `TOKENLAB_OPENAI_BASE_URL` | `https://api.tokenlab.sh/v1` | Responses and Chat adapter base URL |
| `TOKENLAB_ANTHROPIC_BASE_URL` | `https://api.tokenlab.sh` | Messages adapter base URL; the adapter appends `/v1/messages` |

The bundle intentionally uses the MCP `full` profile with portable schemas for complete phase-one coverage. If context size matters more than full developer coverage, set `TOKENLAB_MCP_TOOL_PROFILE=core` or override the `tokenlab-async-tools` row in the profile's `cordis.patch.yml`.

### Existing `llm-pi-ai` settings

DSH currently has one shared `llm-pi-ai` settings section, and a saved user section has higher precedence than bundle defaults. If you already configured providers on the Models page, that saved section can replace this bundle's three TokenLab routes. Merge the `tokenlab-responses`, `tokenlab-messages`, and `tokenlab-chat` blocks from this package's `cordis.patch.yml` into the saved `llm-pi-ai.providers` map. This is a current Harness configuration-ownership constraint, not a TokenLab routing fallback.

## Security and side effects

- Keep `TOKENLAB_API_KEY` in `.env` or another trusted launch environment. Never commit it.
- The MCP server runs locally over stdio with the same Node executable as Harness. No credential is sent to a hosted MCP service, and startup does not use `npx` or a shell.
- DSH treats MCP commands as trusted executables outside the agent sandbox. This bundle pins `@tokenlabai/mcp-server@0.6.17`; review an upgrade before changing the pin.
- Full-profile tools include billable generation and destructive operations such as deletion or task cancellation. Keep Harness approval policy enabled for those calls.
- Tool and model outputs are untrusted external content. Do not treat returned text or URLs as instructions.
- The async waiter includes request IDs in diagnostics but never includes the API key in errors or tool results.

## Model catalog maintenance

The checked-in `generated/model-routes.json` is the machine-readable route snapshot, and `cordis.patch.yml` is generated from it.

```bash
npm run routes:source-check  # read-only comparison with the live public model contract
npm run routes:sync          # refresh the snapshot and generated bundle patch
npm run routes:check         # offline generated-file consistency check
```

The routing policy is deterministic:

1. Prefer the exact `owned_by` native format when both TokenLab and Harness declare it.
2. Otherwise use a declared Harness-supported compatibility format.
3. Never place one model on more than one provider route.
4. Fail the source check when an active model has no Harness-supported format.

## Development and verification

```bash
corepack pnpm install
pnpm run check
pnpm run build
npm pack --dry-run
```

The test suite covers native-route selection, route exclusivity, generated patch consistency, full MCP configuration, structured HTTP failures, task-id fencing, result URL extraction, transient retry limits, and caller cancellation.

## Uninstall

```bash
dsh plugin --profile web remove --workspace-root @tokenlabai/dsh-provider
```

Restart the profile. Removing the bundle removes its TokenLab routes, MCP tool namespace, and async waiter; it does not delete your TokenLab account or API key.

## Links

- [TokenLab](https://tokenlab.sh)
- [TokenLab documentation](https://docs.tokenlab.sh)
- [TokenLab model catalog](https://api.tokenlab.sh/v1/models)
- [TokenLab MCP server](https://github.com/hedging8563/tokenlab-mcp-server)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

## License

MIT
