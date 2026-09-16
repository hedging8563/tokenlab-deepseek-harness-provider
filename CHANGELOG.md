# Changelog

## 0.1.2

- Refreshed the public model snapshot to 124 exclusive routes (23 Responses, 9 Messages, 92 Chat), including GPT-6 Astra and the current model input capabilities.
- Pinned TokenLab MCP 0.6.18 for current delivery/idempotency parameters, media input limits, portable schemas, and structured recovery errors.
- Defaulted to the 31-tool core profile; kept explicit catalog/full and schema-mode configuration plus the read-only async waiter.
- Targeted Harness 0.1.5-rc.1, corrected peer ranges and the public JsonValue type import, and aligned the development SDK dependency graph.
- Documented provider-settings merge behavior and the public-contract limit on declaring reasoning efforts.

## 0.1.0

- Added exclusive TokenLab Responses, Messages, and Chat provider routes generated from the public model-detail contract.
- Added the TokenLab MCP full profile for multimodal, developer, and async APIs.
- Added the cancellable `tokenlab_wait_task` terminal poller with bounded transient retries and result URL extraction.
