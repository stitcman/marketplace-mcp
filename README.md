# marketplace-mcp

## Extended read-only discovery and execution

Version 0.4 keeps the promoted marketplace tools and adds five compact tools per marketplace: `*_read_search`, `*_read_describe`, `*_read_capabilities`, `*_read_execute`, and `*_read_file`. The complete operation inventory is stored under `inventory/`; only reviewed `READ` and `SEMANTIC_READ_JOB` entries are copied into the version-controlled manifests under `policies/`.

Every generic execution resolves the exact connection and marketplace, requires an internal `.read` permission, finds the method in the explicit allowlist, validates request shape and size, applies an account/endpoint-group rate limit, and only then calls a pinned official host. Unknown and classified write/destructive methods fail locally without an HTTP request. Sensitive responses are redacted by default. On-demand files are cached for at most 72 hours with MIME, size, quota, SHA-256, and free-disk checks; binary/base64 content is never returned to MCP clients.

Policy regeneration uses separately pinned reference checkouts via `MARKETPLACE_MCP_REFERENCE_ROOT`. New upstream methods never enter an existing allowlist automatically. Compare generated inventories with `npm run policies:diff -- <old-inventory-dir> <new-inventory-dir>` and manually review every `+`, `~`, and especially `!` safety change before changing the allowlist. Initial creation requires the explicit `--approve-reviewed` flag after semantic review.

An MCP server that lets AI agents work with **Wildberries / Ozon / Yandex Market** seller accounts: typed read tools, multi-account support, data normalization, rate limiting, auditing and encrypted credentials. Not a generic proxy — tools are namespaced per marketplace (`wb_*`, `ozon_*`, `ym_*`), each checks connection permissions and returns one normalized shape.

> **Status: v0.3 — READ surface across all three marketplaces.** Core, the WB / Ozon / Yandex Market adapters, 17 tools. Not implemented yet: WRITE with preview/confirmation, history collectors, advertising and finance. See the roadmap.

## The point of this project

One question, one response shape, regardless of the platform. The three marketplaces model products, stocks and orders incompatibly: on WB a stock row is "a size in a warehouse", on Ozon it is "a product with an array of fbo/fbs types", on Yandex Market it is "warehouse → product → stock types (AVAILABLE/FREEZE/DEFECT/…)". This server reduces that to a single schema, so an agent can ask "what is running low?" and get one answer covering three accounts:

```
unified stock list: 9 rows from 3 marketplaces
low stock: wildberries/ZR-002=7, ozon/ZR-002=3
ym dual-path stocks ok: 1 FBS (account) + 2 FBO (shop)
```

That is not an illustration — it is output from `npm test`, which runs all three adapters through the same zod schemas.

The second line shows an honest platform quirk: Yandex Market splits stocks across two API methods, and one call physically cannot cover both warehouse kinds. So a merged query across three accounts returns only seller warehouses from Yandex Market until the agent also asks about Market warehouses. The server does not hide this behind a "convenient" aggregation that would silently drop stock.

## Quick start without API keys (demo)

No database, no tokens: without `DATABASE_URL` the server starts with an in-memory store and mock seller accounts for **all three marketplaces**, filled with realistic data.

```bash
npm install
npm run dev            # stdio transport
```

Connect it to Claude Code:

```bash
claude mcp add marketplace -- npx tsx /path/to/marketplace-mcp/src/index.ts
```

Then ask in chat: *"show my connections"*, *"what is running out of stock — check every marketplace"*, *"compare prices for ZR-002 across the three accounts"*, *"how many orders this week in total?"*.

## Connecting real seller accounts

Credentials can come from the environment (demo mode, no database) or be stored encrypted in PostgreSQL (production).

```bash
WB_API_TOKEN=...                          # Wildberries
OZON_CLIENT_ID=... OZON_API_KEY=...       # Ozon
YM_API_KEY=...                            # Yandex Market
npm run dev
```

Every platform authenticates differently, which is exactly why credentials are stored as a set of keys rather than a single token column:

| Marketplace | Authentication | Where to get it |
|---|---|---|
| Wildberries | `Authorization: <token>` header (**no** `Bearer` prefix) | Seller cabinet → Settings → API access |
| Ozon | two headers: `Client-Id` + `Api-Key` | Seller cabinet → Settings → Seller API |
| Yandex Market | `Api-Key: <key>` header | Seller cabinet → API modules → Authorization tokens |

`connection_test` validates the key and reports what is actually reachable: per API category on WB, and the list of business accounts and shops on Yandex Market.

### Test environments

None of the three marketplaces hands out public test credentials — every sandbox is tied to a seller account. What actually exists:

| Marketplace | Sandbox | How to get in |
|---|---|---|
| Wildberries | Yes — separate `*-api-sandbox.wildberries.ru` hosts with generated test data | The sandbox token is created in the seller cabinet separately from the production one. Supported via `WB_SANDBOX=1` |
| Ozon | Yes — the test environment mirrors Seller API methods and is isolated from real data | Needs Client-Id and Api-Key from a seller cabinet |
| Yandex Market | No separate environment — instead there are **test orders** inside the live cabinet (delivered with `fake: true`) | Seller cabinet → API modules → Test order |

One caveat about WB is baked into the code: **not every category has a sandbox**. "Analytics" has none, and that is where stocks live — so in sandbox mode `wb_stocks_get` talks to the production API. The server does not pretend the isolation is complete: the `sandbox` flag is visible in `connections_list`, and `marketplace_capabilities` returns an explicit `sandbox_warning`. Everything is read-only, so the account is never modified.

## Production mode

```bash
cp .env.example .env    # MASTER_KEY and MCP_AUTH_TOKEN: openssl rand -hex 32
docker compose up --build
```

Brings up PostgreSQL with automatic migrations plus the server on **Streamable HTTP**: `POST /mcp`, health at `GET /health`.

**Transport security.** These tools sit in front of other people's seller-account keys, so `/mcp` is protected by a bearer token (`MCP_AUTH_TOKEN`) and Origin validation (`MCP_ALLOWED_ORIGINS`, DNS-rebinding defence). Without `MCP_AUTH_TOKEN` the server deliberately binds to `127.0.0.1` only and warns about it. In compose the port is published on loopback — expose it through a TLS reverse proxy. Account keys are stored as AES-256-GCM ciphertext; the master key lives outside the database.

## Architecture

```
MCP client (Claude / ChatGPT / agent)
        │  stdio | Streamable HTTP (stateless, POST /mcp, bearer + Origin)
        ▼
   MCP server ── shared tools: connections_list, connection_test, marketplace_capabilities
        │
        ├─ core: store (Postgres/in-memory) · secrets (AES-GCM) · rate limiter
        │        (token bucket per marketplace+connection+endpoint group) ·
        │        retries (backoff+jitter) · audit (tool_calls) · unified error model
        │
        ├─ adapters/common/schema.ts — THE single normalized schema for all platforms
        │
        ├─ adapters/wb    — Content / Analytics / Statistics / Discounts-Prices APIs
        ├─ adapters/ozon  — Seller API (all methods POST, last_id cursor)
        └─ adapters/ym    — Partner API (businessId → campaignId)
```

Core principles:

- **One schema for every platform and for the mocks**: `adapters/common/schema.ts` is the single source of truth. The schemas double as tool `outputSchema`s, so the SDK validates responses, and the test suite additionally runs the real-API mappings through them. Shape drift fails at compile time or in tests — not in the customer's account.
- **Multi-account**: when several connections exist for one marketplace and `connection_id` is omitted, the server returns `AMBIGUOUS_CONNECTION` with the list, never a silent pick. The same rule applies to Yandex Market business accounts (`businessId`).
- **FBO and FBS never merge**: on all three platforms they are separate rows with an explicit `fulfillment_model`, not one blended number.
- **Unified error model**: `AUTH_FAILED`, `MARKETPLACE_PERMISSION_DENIED`, `RATE_LIMITED` (with `retry_after_ms`), `UPSTREAM_TIMEOUT`, … — AI-legible codes carrying a `retryable` flag.
- **Money as decimal strings** with a currency, dates as UTC ISO 8601, and a single `limit/cursor` pagination contract layered over three different mechanisms (WB cursor, Ozon `last_id`, Yandex Market `nextPageToken`).
- **Secrets** are never logged and never appear in responses, errors or the audit log; only ciphertext reaches the database.

## Tools (17)

| Tool | Purpose |
|---|---|
| `connections_list` / `connection_get` | connected seller accounts, never secrets |
| `connection_test` | key check: per API category on WB, with the shop list on Yandex Market |
| `marketplace_capabilities` | what the agent may access, which credentials and scopes are required |
| `wb_products_list` · `wb_stocks_get` · `wb_prices_get` · `wb_orders_list` | Wildberries |
| `ozon_products_list` · `ozon_stocks_get` · `ozon_prices_get` · `ozon_orders_list` | Ozon |
| `ym_campaigns_list` · `ym_products_list` · `ym_stocks_get` · `ym_prices_get` · `ym_orders_list` | Yandex Market |

`ym_campaigns_list` exists because of Yandex Market's two-level model: a business account (`businessId`) contains shops (`campaignId`), and different methods need different identifiers.

## Marketplace API compliance (verified 2026-08-28)

Paths, hosts and limits were checked against the official specifications rather than written from memory.

**Wildberries** — from the official OpenAPI specifications:

| Group | Host | Limit |
|---|---|---|
| Content | `content-api.wildberries.ru` | 100/min |
| Prices and discounts | `discounts-prices-api.wildberries.ru` | 10/6s |
| Statistics | `statistics-api.wildberries.ru` | 1/min |
| Analytics | `seller-analytics-api.wildberries.ru` | 3/min |

- **`GET /api/v1/supplier/stocks` was switched off on 2026-06-23.** Stocks now come from `POST /api/analytics/v1/stocks-report/wb-warehouses` (FBO) and `.../seller-warehouses` (FBS); the token needs the "Analytics" category.
- The new method does not return the seller article (only `nmId`), so `seller_sku` is enriched from the product cards.
- Authorization is the **raw token with no `Bearer` prefix**: the spec declares an `apiKey` security scheme, and the word `Bearer` never appears in the WB specifications.

**Ozon** — `api-seller.ozon.ru`, every method a POST, `last_id` cursor pagination. Uses `/v3/product/list`, `/v3/product/info/list`, `/v4/product/info/stocks`, `/v5/product/info/prices` (v4 is deprecated), `/v2/posting/fbo/list`, `/v3/posting/fbs/list`. As of August 2026 none of these carry a shutdown notice. Ozon publishes no public OpenAPI specification, so the contract was assembled from documentation and maintained clients — this is the part that most needs verification against a live key. Verified live: Ozon reports bad credentials with HTTP 400 (`code: 5` / `code: 16`), not 401, and the client maps that to `AUTH_FAILED`.

**Yandex Market** — `api.partner.market.yandex.ru`, from the official OpenAPI specification (`github.com/yandex-market/yandex-market-partner-api`). Limits taken from the spec: `GET /v2/campaigns` 1000/hour, `POST /v3/businesses/{id}/offers/stocks` 500/min, `POST /v1/businesses/{id}/orders` 10000/hour (max 50 orders per response, ≤30-day window). The non-standard `420` status is treated as a rate limit.

Yandex Market splits stocks across two methods, which the adapter handles: `POST /v3/businesses/{id}/offers/stocks` covers seller warehouses (FBS/DBS/Express, and only works without warehouse groups), while `POST /v2/campaigns/{campaignId}/offers/stocks` covers Market warehouses (FBY → FBO) and is the only working path when warehouse groups exist. `ym_stocks_get` picks the right path based on whether `campaign_id` was passed; to see all stock the tool is called twice — stated explicitly in its description for the agent.

**What remains unverified.** The actual response bodies of all three platforms: specifications describe the contract, but only a live key confirms that production matches in every field — contract tests over recorded responses are planned for that. Ozon is the weakest link (no public spec). Also deliberately out of scope for v0.3: Ozon product brand (lives in attributes, a separate call) and warehouse names on Ozon and Yandex Market (separate directories) — those fields return `null` rather than being invented.

## Roadmap

| Stage | Scope | Status |
|---|---|---|
| 1. Core | connections, secrets, permissions, audit, rate limits, error model | ✅ |
| 2. Wildberries READ | products / stocks / prices / orders | ✅ |
| 3. Ozon READ | Seller API: products / stocks / prices / orders FBO+FBS | ✅ |
| 4. Yandex Market READ | campaigns / products / stocks / prices / orders | ✅ |
| 4b. Extended READ | finance, reviews, advertising (Ozon Performance API, WB Advert) | — |
| 5. History collectors | price/stock snapshot worker (tables already in the schema) | — |
| 6–7. WRITE | preview/dry-run → confirmation → execution; policy limits; idempotency | — |

## Tests

```bash
npm test
```

No external dependencies — an in-memory linked MCP client↔server pair. Covers: `tools/list` and the presence of `outputSchema` on all 12 data tools, mock data for three platforms, pagination, FBO/FBS separation, the unified error model, auditing, absence of secrets in responses, **cross-marketplace normalization** (3 platforms × 4 entity kinds through one set of schemas), merging stocks from three accounts into one list, both Yandex Market stock paths (account FBS and shop FBO), WB sandbox host routing (including the categories that have no sandbox), the real-API mappings for WB / Ozon / Yandex Market against the shared schemas, and rate limiter behaviour.

Mock product titles and warehouse names are intentionally left in Russian: that is what the real marketplace APIs return, so the demo stays faithful to production data.

## License

MIT
