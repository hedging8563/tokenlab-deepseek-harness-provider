# DSH market submission draft

This file is a release-time draft. Do not submit it until the GitHub repository and npm package are public and their URLs have been read back successfully.

## Repository metadata

- Repository: `https://github.com/hedging8563/tokenlab-deepseek-harness-provider`
- GitHub topics: `dsh-plugin`, `deepseek-harness`, `tokenlab`, `model-provider`, `mcp`, `multimodal`, `async-ai`
- npm: `@tokenlabai/dsh-provider`
- Category: Models / Integrations
- License: MIT

## dshplugin.io issue

Submission endpoint: `https://github.com/tjsdyy/dshplugin/issues/new?labels=plugin-submission`

Suggested title:

```text
[Plugin submission] TokenLab for DeepSeek Harness
```

Suggested body:

```markdown
## Plugin

- Name: TokenLab for DeepSeek Harness
- Repository: https://github.com/hedging8563/tokenlab-deepseek-harness-provider
- npm: https://www.npmjs.com/package/@tokenlabai/dsh-provider
- Install: `dsh plugin --profile web add @tokenlabai/dsh-provider`
- Category: Models / Integrations
- License: MIT

## Summary

TokenLab model provider and full multimodal tool bundle for DeepSeek Harness. It routes eligible OpenAI models through Responses, Anthropic models through Messages, and remaining models through Chat Completions. The bundled TokenLab MCP full profile adds image, video, music, 3D, audio, files, embeddings, rerank, translation and async task tools; `tokenlab_wait_task` provides cancellable terminal polling.

## Verification

- Declares `dsh.bundle.patch` in package.json
- Ships prebuilt `lib/`; no install or prepare script
- Pins the TokenLab MCP server version
- Tested with DeepSeek Harness 0.1.1-rc.2 and Node 24.18
- `npm run check` and `npm pack --dry-run` pass
```

## Release-time readback

1. Confirm the npm tarball contains `cordis.patch.yml`, `generated/model-routes.json`, `lib/`, README, and LICENSE.
2. Install the public npm package into a clean temporary DSH `web` profile.
3. Confirm the three TokenLab provider routes and 134-model snapshot load.
4. Confirm the MCP bridge lists the full TokenLab tool set.
5. Confirm a forced Responses call, Messages call, Chat call, and one async media submit/wait flow with request attribution.
6. Add the `dsh-plugin` GitHub topic and wait for topic-based indexes to ingest the repository.
7. Submit the dshplugin.io issue and record its URL in TokenLab's external asset ledger.
