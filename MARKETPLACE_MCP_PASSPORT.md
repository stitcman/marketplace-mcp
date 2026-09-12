<!-- Generated from MARKETPLACE_MCP_MANIFEST.yaml. Do not edit independently. -->
# Marketplace MCP Passport

## Release identity

- MCP version: `0.4.0`
- Production repository baseline: `0acd8026f0bf688f2cc6bca1e5f9633997117b51` (origin/main repository baseline; deployed revision is not evidenced)
- Candidate: `e0e105f08e2139d76df2e919d8d073563ef3e7c5`
- Runtime mode: `READ_ONLY`
- Architecture: `READ + Controlled WRITE`; WRITE runtime is disabled
- v1 readiness: **55%** (19 target controls: 8 complete, 5 half-credit partial, 6 missing; planning estimate, not release acceptance.)

## Marketplace readiness

| Marketplace | Production READ | Candidate extended READ | Representative real E2E |
|---|---|---|---|
| Ozon | implemented | implemented_unverified | missing |
| Wildberries | implemented | implemented_unverified | missing |
| Yandex Market | implemented | implemented_unverified | missing |

## Production capabilities

- `ozon.products.read` — production
- `ozon.stocks.read` — production
- `ozon.prices.read` — production
- `ozon.orders.read` — production
- `wildberries.products.read` — production
- `wildberries.stocks.read` — production
- `wildberries.prices.read` — production
- `wildberries.orders.read` — production
- `yandex_market.campaigns.read` — production
- `yandex_market.products.read` — production
- `yandex_market.stocks.read` — production
- `yandex_market.prices.read` — production
- `yandex_market.orders.read` — production

## Candidate capabilities

- `ozon.finance.read` — candidate
- `wildberries.finance.read` — candidate
- `yandex_market.finance.read` — candidate

## Disabled WRITE and DESTRUCTIVE capabilities

- `ozon.prices.write` — disabled
- `wildberries.prices.write` — disabled
- `yandex_market.documents.update` — disabled
- `yandex_market.documents.delete` — disabled

## Known blockers

- **P0-REAL-E2E-001:** No representative real-credential E2E PASS is recorded for Ozon, Wildberries, or Yandex Market. Evidence: `README.md`.
- **P0-RELEASE-001:** The deployed production revision, production smoke result, Remote MCP E2E, and rollback exercise are not evidenced in this repository. Evidence: `docker-compose.yml`.
- **P1-SECURITY-001:** PII redaction exists, but a marketplace-by-marketplace PII inventory and production evidence are incomplete. Evidence: `src/core/readPolicy.ts`.

## Next milestone

Prove representative real-credential Ozon READ over authenticated Remote MCP with redacted evidence.

This Passport is a generated human view. The machine-readable source of truth is `MARKETPLACE_MCP_MANIFEST.yaml`; the complete endpoint inventories remain under `inventory/` and are not duplicated here.
