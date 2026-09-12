# Marketplace MCP v1.0 Roadmap

Source of truth: [`MARKETPLACE_MCP_MANIFEST.yaml`](../../MARKETPLACE_MCP_MANIFEST.yaml). This roadmap does not duplicate endpoint inventories or enable WRITE.

## Baseline

- Audited planning baseline: `3e48f6563f86f947fa13120edff3e7b48e8bc545`; baseline Manifest SHA-256: `DBDEB513A8385AD52946C53984F34F418DA170B8932AA2D013DD8FF558E1A846`.
- Production repository baseline remains v0.3.0 at `0acd8026f0bf688f2cc6bca1e5f9633997117b51`; a deployed revision is not evidenced.
- Candidate runtime code is v0.4.0 at `321478fcd02b2dd779aa0ca2e3fa7bc599026d3b`.
- Runtime: `READ_ONLY`; architecture: `READ + Controlled WRITE`; WRITE capabilities remain disabled and no WRITE endpoint is required before a real MOS demand.
- Surface: 17 production tools and 32 candidate tools. The extra 15 are five generic READ discovery/execution tools per marketplace, not endpoint wrappers.
- Full inventories remain outside persistent LLM context: Ozon 511 operations, WB 181, Yandex Market 169; candidate READ allowlists contain 282, 113, and 108 methods.
- Planning readiness: **68%** — 25 controls: 15 complete including seven locally verified Ozon parity controls, 4 partial at half credit, and 6 missing. This is prioritization, not release acceptance.

## MOS boundary and ownership

- MOS is unchanged. Its existing `CapabilityAdapter` is the future integration boundary.
- Marketplace MCP owns marketplace access/execution infrastructure only.
- MOS retains tenant authorization, connection lifecycle, SourceContract, Raw Vault, lineage, normalization, DQ/schema drift, sync orchestration, checkpoints, and Findings/Actions/Approval/Verification/Outcomes.
- Integrate capabilities incrementally behind `CapabilityAdapter`; do not create another MOS integration layer and do not perform a big-bang transport migration.
- Existing MOS Ozon transport is not removable until every Ozon cutover criterion below has accepted evidence.
- WB and Yandex Market have no MOS connectors; Marketplace MCP is their primary access layer. Do not duplicate those connectors in MOS.

## Ozon MOS requirements coverage

| Requirement | Existing capability | Status | Gap | Action |
|---|---|---|---|---|
| Seller roles / API-key capabilities | `AccessAPI_RolesByToken` via `ozon_read_execute`; Manifest ID `ozon.seller_roles.read` | local_verified | Real-key parity not yet evidenced | Run bounded real READ and bind to seller identity |
| Seller account identity / cabinet binding | `SellerAPI_SellerInfo` via `ozon_read_execute`; Manifest ID `ozon.seller_identity.read` | local_verified | Real cabinet binding not yet evidenced | Hash and compare authorized cabinet identity during E2E |
| Warehouse directory READ | `WarehouseListV2` via `ozon_read_execute`; Manifest ID `ozon.warehouses.read` | local_verified | Real response/multi-page evidence missing | Run bounded cursor E2E with `warehouses.read` |
| Returns READ | `returnsList` via `ozon_read_execute`; Manifest ID `ozon.returns.read` | local_verified | Real response evidence missing | Run bounded `last_id` E2E with `returns.read` |
| FBS unfulfilled READ | `PostingFbsUnfulfilledList` via `ozon_read_execute`; Manifest ID `ozon.fbs_unfulfilled.read` | local_verified | Real response evidence missing | Run bounded v4 cursor E2E with `orders.read` |
| Pagination parity with MOS Ozon adapter | Generic `cursor` / `offset` / `last_id` contract returns `has_more` and minimal `request_patch` | local_verified | Real multi-page equivalence evidence missing | Compare ordered page sequences during E2E |
| Redacted/raw response contract for MOS normalization | Generic execution returns a lossless bounded page; audit captures no payload; evidence uses recursive PII/secret redaction | local_verified | Real-payload evidence missing | Prove normalization fields and redaction on representative E2E payloads |

No listed requirement is classified as absent solely because it was not previously a separate business capability in the Manifest.

## Remaining v1 gaps

| Target | Current evidence | Gap |
|---|---|---|
| Ozon cutover | Local parity gate passes for five required reads, continuation, permissions, and raw/evidence separation | Representative real-account parity evidence; MOS transport remains non-removable |
| WB primary access | Typed and generic READ paths exist | Representative real-credential E2E; Analytics/Common have no sandbox isolation |
| Yandex Market primary access | Typed and generic READ paths exist | Representative business/campaign and dual-stock E2E |
| Credentials isolation | Credentials stay outside MCP arguments and are encrypted in PostgreSQL | Production secret-manager/deployment evidence |
| Rate/retry | Per marketplace/connection/group limiting, retries, and timeouts exist | Ozon representative telemetry and parity evidence |
| PII/evidence | Key-based redaction, bounded I/O, bearer auth, and Origin checks exist | Marketplace field inventory, adversarial tests, and proof that MOS normalization remains lossless |
| Release binding | Manifest and generated Passport exist | Runtime commit/Manifest identity, immutable image binding, and release gate |
| Remote MCP | Streamable HTTP exists | Authenticated Remote MCP E2E evidence |
| Rollback | Git/container inputs exist | Rehearsed immutable-digest rollback evidence |

## Ordered v1 roadmap

### 1. Close Ozon parity gaps — COMPLETE LOCALLY

- Commit `321478fcd02b2dd779aa0ca2e3fa7bc599026d3b` keeps all five operations behind generic execution and provisions only required READ permissions.
- Cursor, offset/limit, and `last_id` share one continuation shape: `kind`, `has_more`, and a minimal `request_patch`; repeated/empty/short terminal pages stop.
- Normalization receives an unchanged bounded marketplace page. Oversized pages fail explicitly rather than being truncated; audit stores no payload and evidence redaction is separate.
- Regression coverage binds Ozon inventory `511`, reviewed generic READ `282`, permission denial before transport, raw preservation, evidence redaction, and existing WRITE/DESTRUCTIVE zero-transport tests.
- Remaining: representative real-credential evidence. Local completion does not authorize MOS cutover or transport removal.

### 2. Prove Ozon real READ E2E

- Use an isolated authorized Seller API credential and bounded calls for all seven cutover requirements.
- Compare seller identity, roles, records, page sequences, and required normalization fields with the existing MOS adapter without modifying MOS.
- Acceptance: representative real-credential evidence is immutable, redacted, reviewer-accepted, and bound to runtime commit/Manifest hash. Only then may an incremental `CapabilityAdapter` cutover be considered; the legacy transport remains available until cutover acceptance.

### 3. Prove Wildberries real READ E2E

- Validate token categories and products, stocks, prices, and orders over the primary Marketplace MCP access layer.
- Acceptance: bounded Remote MCP reads pass with the Analytics/Common production-read caveat explicitly accepted; no MOS connector is created.

### 4. Prove Yandex Market real READ E2E

- Validate key scope, business/campaign identity, products, FBS/FBO stocks, prices, and orders.
- Acceptance: bounded Remote MCP reads pass and forbidden document mutations remain locally denied; no MOS connector is created.

### 5. Bind deployment, commit, and Manifest

- Expose a compact read-only runtime identity containing version, full commit, Manifest SHA-256, `READ_ONLY`, and `write_runtime_enabled=false`.
- Bind the accepted commit and Manifest into an immutable image; release gates regenerate/check the Passport and reject stale or WRITE-enabled state.
- Acceptance: image digest, runtime identity, commit, Manifest hash, local verification, and reviewer decision agree.

### 6. Prove authenticated Remote MCP E2E

- Run the accepted bounded read matrix through the deployed HTTP transport for Ozon, WB, and Yandex Market.
- Acceptance: authentication, Origin controls, credentials isolation, audit correlations, rate/retry behavior, bounded output, and redacted evidence are proven against the bound image.

### 7. Verify rollback

- Restore the prior immutable digest, verify health/identity, return to the accepted v1 digest, and verify again without rebuilding either image.
- Acceptance: timestamps, both digests, commit/Manifest identities, health results, Remote MCP smoke hashes, and reviewer acceptance are recorded.

## Context economy

- Keep the compact generic tool surface; do not put the full API inventory, Passport, or roadmap into mandatory MOS Codex context.
- Load the Manifest first and fetch an individual allowlist entry only when needed.
- Do not optimize `32 -> 22 tools` during v1 unless measured context cost blocks a v1 criterion.
- Do not permanently attach the full Marketplace MCP catalog to MOS Codex. MOS should consume stable capability contracts behind `CapabilityAdapter`.
- Preserve the disabled Controlled WRITE architecture; implementation requires a later concrete MOS demand and separate capability-level acceptance.
