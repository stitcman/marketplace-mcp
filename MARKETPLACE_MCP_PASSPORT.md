<!-- Generated from MARKETPLACE_MCP_MANIFEST.yaml. Do not edit independently. -->
# Marketplace MCP Passport

## Release identity

- MCP version: `0.4.0`
- Production repository baseline: `0acd8026f0bf688f2cc6bca1e5f9633997117b51` (origin/main repository baseline; deployed revision is not evidenced)
- Candidate source baseline: `321478fcd02b2dd779aa0ca2e3fa7bc599026d3b` (Historical source baseline metadata only; not runtime release binding.)
- Runtime mode: `READ_ONLY`
- Architecture: `READ + Controlled WRITE`; WRITE runtime is disabled
- Candidate tool surface: **33 tools**, including audited `marketplace_runtime_identity`
- Runtime binding: declared build commit + SHA-256 of exact Manifest bytes
- Final provenance boundary: external attestation of commit + Manifest SHA-256 + image digest
- v1 readiness: **68%** (25 target controls: 15 complete including seven local Ozon parity controls, 4 half-credit partial, 6 missing; planning estimate, not release acceptance.)

## Marketplace readiness

| Marketplace | Production READ | Candidate extended READ | Representative real E2E |
|---|---|---|---|
| Ozon | implemented | local_verified | missing |
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

- `ozon.seller_roles.read` — candidate
- `ozon.seller_identity.read` — candidate
- `ozon.warehouses.read` — candidate
- `ozon.returns.read` — candidate
- `ozon.fbs_unfulfilled.read` — candidate
- `ozon.finance.read` — candidate
- `wildberries.finance.read` — candidate
- `yandex_market.finance.read` — candidate

## Disabled WRITE and DESTRUCTIVE capabilities

- `ozon.prices.write` — disabled
- `wildberries.prices.write` — disabled
- `yandex_market.documents.update` — disabled
- `yandex_market.documents.delete` — disabled

## Known blockers

- **P0-REAL-E2E-001:** No representative real-credential E2E PASS is recorded for Ozon cutover requirements, Wildberries, or Yandex Market. Evidence: `README.md`.
- **P0-RELEASE-001:** The deployed production revision, production smoke result, Remote MCP E2E, and rollback exercise are not evidenced in this repository. Evidence: `docker-compose.yml`.
- **P1-SECURITY-001:** PII redaction exists, but a marketplace-by-marketplace PII inventory and production evidence are incomplete. Evidence: `src/core/readPolicy.ts`.

## Next milestone

Run representative Ozon Real READ E2E for all seven cutover requirements and bind redacted evidence to the candidate commit and Manifest hash.

This Passport is a generated human view. The machine-readable source of truth is `MARKETPLACE_MCP_MANIFEST.yaml`; the complete endpoint inventories remain under `inventory/` and are not duplicated here.
