# Marketplace MCP v1.0 Implementation Plan

> **For agentic workers:** execute one authorized task at a time. A green check is implementation evidence, not reviewer acceptance or cutover authority.

**Goal:** deliver a verified READ-only Marketplace MCP v1 access layer for Ozon, Wildberries, and Yandex Market while preserving disabled, per-capability Controlled WRITE architecture.

**Architecture:** Marketplace MCP owns marketplace access/execution only. MOS remains unchanged and later consumes accepted capabilities behind its existing `CapabilityAdapter`. Ozon migration is incremental; WB and Yandex Market use Marketplace MCP as their primary access layer. Keep the compact generic READ surface and inventories outside persistent LLM context.

**Baseline:** planning HEAD `3e48f6563f86f947fa13120edff3e7b48e8bc545`; Manifest SHA-256 `DBDEB513A8385AD52946C53984F34F418DA170B8932AA2D013DD8FF558E1A846`; candidate runtime code `e0e105f08e2139d76df2e919d8d073563ef3e7c5`.

**Spec:** `docs/roadmap/MARKETPLACE_MCP_V1.md`

## Global constraints

- Runtime remains exactly `READ_ONLY`; all WRITE/DESTRUCTIVE capabilities remain disabled.
- Do not implement a WRITE endpoint before a concrete MOS requirement and separate authorization.
- Do not modify MOS, add a new MOS integration layer, create a MOS connector for WB/Yandex, or perform a big-bang Ozon migration.
- Do not remove the existing MOS Ozon transport until all seven cutover criteria have immutable reviewer-accepted evidence.
- Do not add endpoint-per-tool wrappers. Stable capability IDs map to generic allowlisted execution.
- Keep credentials outside MCP arguments and real payloads outside Git evidence.
- Preserve lossless data needed by MOS normalization while producing separately redacted evidence.
- Do not perform the optional `32 -> 22 tools` optimization unless measured context cost blocks v1.
- Every release claim must bind full commit, Manifest SHA-256, immutable image digest, command evidence, and reviewer decision.

---

### Task 1: Close Ozon parity gaps

**Files:**
- Modify: `src/core/store.ts`
- Modify: `src/core/readPolicy.ts`
- Modify: `src/adapters/common/readTools.ts`
- Modify: `test/read-policy.test.ts`
- Create: `test/ozon-cutover-contract.test.ts`
- Modify: `MARKETPLACE_MCP_MANIFEST.yaml`
- Regenerate: `MARKETPLACE_MCP_PASSPORT.md`

**Consumes:** the allowlisted methods `AccessAPI_RolesByToken`, `SellerAPI_SellerInfo`, `WarehouseListV2`, `returnsList`, and `PostingFbsUnfulfilledList`, plus frozen pagination/normalization expectations from the MOS overlap audit.

**Produces:** stable capability mappings for the five existing reads, explicit least-privilege permissions, endpoint-specific continuation rules, and distinct normalization/evidence response views.

- [ ] Add failing contract tests for all seven Ozon cutover requirements before implementation.
- [ ] Provision `warehouses.read` and `returns.read` for the authorized Ozon connection path; prove unrelated permissions remain denied.
- [ ] Keep the five operations behind `ozon_read_execute`; do not register five new endpoint tools.
- [ ] Define cursor/offset/last-id extraction, continuation, and stop rules for warehouses, returns, and FBS unfulfilled; test empty, single-page, and multi-page sequences.
- [ ] Define a lossless bounded normalization input contract and a separate redacted evidence contract. Remove ambiguity from the currently unused `view` field and do not use a caller-controlled flag as evidence-redaction authority.
- [ ] Inventory sensitive Ozon fields for these responses and test nested objects, arrays, errors, account identifiers, buyer data, and credentials.
- [ ] Prove credentials isolation and retry/rate behavior with spy transports and deterministic 429/5xx/timeout cases.
- [ ] Run `npm run baseline:generate`, `npm run baseline:check`, `npm run policies:check`, `npm run build`, and the focused tests.
- [ ] Obtain independent reviewer acceptance. Keep `transport_removable=false`.

### Task 2: Prove Ozon representative real READ E2E

**Files:**
- Create/modify: `test/real/read-e2e.ts`
- Create/modify: `test/real/evidence.ts`
- Modify: `package.json`
- Evidence outside Git: entry keyed by runtime commit and Manifest SHA-256

**Consumes:** an isolated authorized Ozon Seller API credential and the accepted Task 1 contract.

**Produces:** immutable redacted evidence covering seller identity, roles/key capabilities, warehouses, returns, FBS unfulfilled, pagination equivalence, credentials isolation, retry/rate observations, and normalization field preservation.

- [ ] Require marketplace, expected commit/hash, target, and authentication from environment variables; no production defaults.
- [ ] Abort before marketplace traffic unless runtime is `READ_ONLY`, WRITE is false, identity matches, and required local permissions are present.
- [ ] Run bounded calls for all five READ capabilities and at least one safe multi-page parity case where account data permits.
- [ ] Compare identities, ordered record keys/page sequences, and required normalization fields with the existing MOS Ozon adapter output without modifying MOS.
- [ ] Store only hashes, schemas, counts, page metadata, timings, retry/rate events, and audit correlations; omit credentials and bodies.
- [ ] Bind acceptance to evidence SHA-256, runtime commit, Manifest hash, account-identity hash, and reviewer decision.
- [ ] Keep the MOS transport in place; this task proves eligibility for incremental cutover, not removal.

### Task 3: Prove Wildberries representative real READ E2E

**Files:**
- Modify: `test/real/read-e2e.ts`
- Evidence outside Git: entry keyed by runtime commit and Manifest SHA-256

**Consumes:** a scoped WB token with Content, Analytics, Statistics, and Prices categories.

**Produces:** accepted evidence for products, seller/WB stock paths, prices, and orders through Marketplace MCP as the primary access layer.

- [ ] Abort unless category probes and runtime identity match the accepted candidate.
- [ ] Run bounded representative reads and record the fact that Analytics/Common may read the production account even with sandbox enabled.
- [ ] Prove credentials/PII are absent from evidence and no mutation is invoked.
- [ ] Bind evidence and reviewer acceptance to commit/Manifest/account hash.
- [ ] Do not create a WB connector in MOS.

### Task 4: Prove Yandex Market representative real READ E2E

**Files:**
- Modify: `test/real/read-e2e.ts`
- Evidence outside Git: entry keyed by runtime commit and Manifest SHA-256

**Consumes:** a scoped Yandex Market API key plus known business and campaign IDs.

**Produces:** accepted evidence for campaigns, products, seller-warehouse stocks, Market-warehouse stocks, prices, and orders through the primary Marketplace MCP access layer.

- [ ] Run committed negative tests proving `deleteDocuments` and `updateDocuments` remain locally unavailable.
- [ ] Verify discovered business/campaign identity before data calls.
- [ ] Run both stock paths explicitly; do not merge or infer a missing warehouse model.
- [ ] Prove bounded responses, audit correlations, and credential/PII exclusion from evidence.
- [ ] Bind evidence and reviewer acceptance to commit/Manifest/account hash.
- [ ] Do not create a Yandex Market connector in MOS.

### Task 5: Bind deployment, commit, and Manifest

**Files:**
- Modify: `scripts/generate-marketplace-passport.mjs`
- Create: `src/core/manifest.ts`
- Modify: `src/adapters/common/tools.ts`
- Modify: `src/server.ts`
- Modify: `test/smoke.test.ts`
- Modify: `Dockerfile`
- Modify: `.github/workflows/verify.yml`

**Produces:** compact runtime identity and an immutable image/release gate bound to an accepted commit and Manifest.

- [ ] Add a failing test for `marketplace_runtime_identity` returning only version, full commit, Manifest SHA-256, `READ_ONLY`, and `write_runtime_enabled=false`.
- [ ] Parse only required Manifest release fields, compute the hash from exact bytes, and fail closed on invalid mode/WRITE state.
- [ ] Bind the full commit at image build and copy the exact Manifest used by the runtime.
- [ ] Gate Passport generation/check, policy checks, build, tests, and security contracts in CI.
- [ ] Build the immutable candidate image and record its digest; do not deploy in this task.
- [ ] Obtain a release-candidate reviewer decision bound to digest, commit, Manifest hash, and Tasks 1-4 evidence.

### Task 6: Prove deployed authenticated Remote MCP E2E

**Files:**
- Modify: `test/real/read-e2e.ts`
- Evidence outside Git: deployment and Remote MCP records

**Consumes:** the accepted immutable image, existing scoped credentials, Remote MCP URL/token, and Tasks 2-5 evidence.

**Produces:** deployed evidence for health, identity, authentication, Origin policy, generic capability execution, audit, credentials isolation, retry/rate behavior, and bounded redacted evidence.

- [ ] Deploy only through the separately authorized release procedure; do not rotate credentials or enable WRITE.
- [ ] Verify health and runtime identity before marketplace calls.
- [ ] Run the accepted bounded matrices for Ozon, WB, and Yandex Market over Remote MCP.
- [ ] Confirm no full catalog is injected into persistent MOS Codex context and no WRITE/DESTRUCTIVE method is discoverable or executable.
- [ ] Bind acceptance to image digest, commit, Manifest hash, evidence hashes, and reviewer decision.

### Task 7: Verify rollback

**Files:**
- Evidence outside Git: rollback record

**Consumes:** accepted current and prior immutable image digests.

**Produces:** a rehearsed rollback and forward-restoration record.

- [ ] Resolve and record both exact digests before any switch.
- [ ] Restore the prior digest without rebuilding; verify health and identity.
- [ ] Restore the accepted v1 digest without rebuilding; verify health, identity, and one bounded READ per marketplace.
- [ ] Record timestamps, digests, commit/Manifest identities, smoke/evidence hashes, and reviewer acceptance.
- [ ] Only after Ozon cutover acceptance through `CapabilityAdapter` may removal of the old MOS transport be proposed as a separate MOS-authorized task.
