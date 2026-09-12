# Marketplace MCP v1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote a verified READ-only Marketplace MCP v1.0 foundation for Ozon, Wildberries and Yandex Market while preserving a disabled, per-capability Controlled WRITE architecture.

**Architecture:** Keep the existing 17 typed READ tools and five generic allowlisted READ tools per marketplace. The candidate fail-closed boundary is restored at `e0e105f08e2139d76df2e919d8d073563ef3e7c5`; next bind runtime identity to the compact Manifest, then prove each marketplace and the production deployment with isolated real-credential Remote MCP evidence. No WRITE endpoint or global WRITE switch is introduced.

**Tech Stack:** Node.js 20+, TypeScript, MCP SDK, Zod, PostgreSQL, YAML, Docker/Compose.

**Spec:** `docs/roadmap/MARKETPLACE_MCP_V1.md`

## Global Constraints

- Production runtime remains exactly `READ_ONLY` until separate authorization.
- Do not add WRITE endpoints or change marketplace data.
- Do not introduce `write_enabled=true` or any equivalent global switch.
- Treat DESTRUCTIVE as a risk class separate from WRITE.
- Do not modify MOS or create `marketplace-mcp.lock.json` in this repository.
- Preserve generic capability dispatch; do not create a tool per endpoint.
- Store credentials outside MCP arguments and redact all evidence.
- Every release claim requires fresh command output and immutable evidence.

---

### Task 1: Bind runtime identity to the Manifest

**Files:**
- Modify: `scripts/generate-marketplace-passport.mjs`
- Create: `src/core/manifest.ts`
- Modify: `src/adapters/common/tools.ts`
- Modify: `src/server.ts`
- Modify: `test/smoke.test.ts`
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: `MARKETPLACE_MCP_MANIFEST.yaml` and build-provided `MARKETPLACE_MCP_COMMIT`.
- Produces: `loadRuntimeIdentity(): { mcp_version: string; commit: string; manifest_sha256: string; mode: "READ_ONLY"; write_runtime_enabled: false }` and read-only tool `marketplace_runtime_identity`.

- [ ] **Step 1: Add a failing identity tool test**

```ts
assert(names.includes("marketplace_runtime_identity"));
const identity = JSON.parse((await client.callTool({ name: "marketplace_runtime_identity", arguments: {} }) as any).content[0].text).data;
assert.equal(identity.mode, "READ_ONLY");
assert.equal(identity.write_runtime_enabled, false);
assert.match(identity.manifest_sha256, /^[a-f0-9]{64}$/);
assert.match(identity.commit, /^[a-f0-9]{40}$/);
```

- [ ] **Step 2: Run the smoke test and confirm the missing tool failure**

Run: `npx tsx test/smoke.test.ts`

Expected: FAIL because `marketplace_runtime_identity` is not registered.

- [ ] **Step 3: Implement bounded identity loading**

Implement `loadRuntimeIdentity()` to parse only release metadata, compute SHA-256 from Manifest bytes, reject non-`READ_ONLY` or enabled-WRITE input, and read the commit from a validated build environment variable. Do not return capability inventories.

- [ ] **Step 4: Register one common read-only identity tool**

Register `marketplace_runtime_identity` through `audited(...)` with an empty input schema and a fixed output schema. Update the expected compact catalog count from 32 to 33.

- [ ] **Step 5: Bind the immutable commit during image build**

Add Docker build argument and environment binding:

```dockerfile
ARG MARKETPLACE_MCP_COMMIT
ENV MARKETPLACE_MCP_COMMIT=${MARKETPLACE_MCP_COMMIT}
COPY MARKETPLACE_MCP_MANIFEST.yaml ./MARKETPLACE_MCP_MANIFEST.yaml
```

- [ ] **Step 6: Verify identity, baseline, build and tests**

Run: `npm run baseline:check && npm run build && npm test`

Expected: exit 0; the identity output contains only version, commit, hash, mode and the false WRITE flag.

- [ ] **Step 7: Commit runtime release identity**

```bash
git add MARKETPLACE_MCP_MANIFEST.yaml MARKETPLACE_MCP_PASSPORT.md scripts/generate-marketplace-passport.mjs src/core/manifest.ts src/adapters/common/tools.ts src/server.ts test/smoke.test.ts Dockerfile package.json
git commit -m "feat: expose immutable marketplace runtime identity"
```

### Task 2: Add a credential-safe real READ E2E harness

**Files:**
- Create: `test/real/read-e2e.ts`
- Create: `test/real/evidence.ts`
- Create: `test/real/evidence.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: marketplace selection, existing environment-backed connection loading, and Remote MCP URL/token supplied outside command arguments.
- Produces: `runMarketplaceReadE2E(marketplace): Promise<RedactedReadEvidence>` and SHA-256-addressed redacted evidence outside Git.

- [ ] **Step 1: Add tests for evidence redaction and immutability**

Create fixtures containing nested API keys, tokens, names, phones and addresses; assert serialized evidence contains hashes/statuses/counts but none of the fixture values.

- [ ] **Step 2: Run the evidence test and confirm it fails before implementation**

Run: `npx tsx test/real/evidence.test.ts`

Expected: FAIL because the redaction/evidence module does not exist.

- [ ] **Step 3: Implement the shared Remote MCP runner**

The runner must call runtime identity, connection test, capabilities and a supplied ordered list of representative READ calls. It must abort if identity is not `READ_ONLY`, WRITE is true, the commit/hash differs from the accepted candidate, or any response contains a credential marker.

- [ ] **Step 4: Implement redacted evidence output**

Store timestamp, marketplace, runtime commit/hash, called capability IDs, response schema result, item counts, audit correlation IDs and overall status. Hash account identifiers; omit request/response bodies and all credentials.

- [ ] **Step 5: Add an explicit real-E2E command**

```json
"test:real:read": "tsx test/real/read-e2e.ts"
```

Require `MARKETPLACE`, `MCP_REMOTE_URL`, `MCP_AUTH_TOKEN`, `EXPECTED_COMMIT`, and `EXPECTED_MANIFEST_SHA256` from the environment; never provide defaults that could target production accidentally.

- [ ] **Step 6: Verify locally without contacting a marketplace**

Run: `npm run build && npx tsx test/real/evidence.test.ts && npm test`

Expected: all local checks pass; `test:real:read` is not run without a separately authorized credential session.

- [ ] **Step 7: Commit the reusable E2E harness**

```bash
git add test/real package.json .gitignore
git commit -m "test: add credential-safe remote read e2e harness"
```

### Task 3: Capture Ozon representative real E2E evidence

**Files:**
- Modify: `test/real/read-e2e.ts`
- Evidence outside Git: release evidence store entry keyed by commit and Manifest hash

**Interfaces:**
- Consumes: `runMarketplaceReadE2E("ozon")` and an isolated Seller Admin Read-Only connection.
- Produces: accepted evidence for `ozon.products.read`, `ozon.stocks.read`, `ozon.prices.read`, and `ozon.orders.read`.

- [ ] **Step 1: Define the minimal Ozon call matrix**

Use bounded `limit: 1` calls for products/prices and bounded date windows for FBO/FBS orders; include stocks. Do not include Performance API or any candidate capability not required by MOS.

- [ ] **Step 2: Verify runtime identity and account permissions**

Run: `$env:MARKETPLACE='ozon'; npm run test:real:read`

Expected: the harness aborts before marketplace calls unless commit/hash/mode and required read permissions match.

- [ ] **Step 3: Run the controlled real READ session**

Run the same command only in the authorized credential environment.

Expected: representative calls pass schemas, audit correlations exist, secrets/PII are absent from evidence, and no WRITE/DESTRUCTIVE capability is invoked.

- [ ] **Step 4: Record reviewer acceptance**

Bind acceptance to the evidence SHA-256, runtime commit and Manifest hash. A green local test alone is not acceptance.

### Task 4: Capture Wildberries representative real E2E evidence

**Files:**
- Modify: `test/real/read-e2e.ts`
- Evidence outside Git: release evidence store entry keyed by commit and Manifest hash

**Interfaces:**
- Consumes: `runMarketplaceReadE2E("wildberries")` and a scoped token.
- Produces: accepted evidence for products, stocks, prices and orders, including the no-sandbox caveat.

- [ ] **Step 1: Define the minimal WB call matrix and token categories**

Require Content, Analytics, Statistics, and Prices scopes. Mark the Analytics/Common calls as production-account READ even if the connection has `sandbox=true`.

- [ ] **Step 2: Run the controlled real READ session**

Run: `$env:MARKETPLACE='wildberries'; npm run test:real:read`

Expected: per-category connection checks and four business capabilities pass with bounded responses; the evidence records the accepted production-read caveat.

- [ ] **Step 3: Record reviewer acceptance**

Bind acceptance to the evidence SHA-256, runtime commit and Manifest hash; reject evidence that implies full WB sandbox isolation.

### Task 5: Capture Yandex Market representative real E2E evidence

**Files:**
- Modify: `test/real/read-e2e.ts`
- Evidence outside Git: release evidence store entry keyed by commit and Manifest hash

**Interfaces:**
- Consumes: `runMarketplaceReadE2E("yandex_market")`, a scoped API key, business ID and campaign ID.
- Produces: accepted evidence for campaigns, products, FBS stocks, FBO stocks, prices and orders.

- [ ] **Step 1: Define both stock paths explicitly**

Call `ym_stocks_get` once with business identity for seller warehouses and once with `campaign_id` for Market warehouses. Do not merge or infer missing models.

- [ ] **Step 2: Prove forbidden document operations remain local**

Before real calls, execute the committed negative spy-transport tests in `test/read-policy.test.ts` and bind their result to the candidate commit.

- [ ] **Step 3: Run the controlled real READ session**

Run: `$env:MARKETPLACE='yandex_market'; npm run test:real:read`

Expected: campaign discovery and both stock paths plus products/prices/orders pass; `deleteDocuments` and `updateDocuments` are absent from search/describe/execute policy surfaces.

- [ ] **Step 4: Record reviewer acceptance**

Bind acceptance to the evidence SHA-256, runtime commit and Manifest hash.

### Task 6: Complete PII, audit and release gates

**Files:**
- Create: `test/security/pii-redaction.test.ts`
- Create: `docs/operations/AUDIT_AND_PII.md`
- Create: `.github/workflows/verify.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: representative redacted field names from Tasks 3–5 and existing `audited`/`redactSensitive` behavior.
- Produces: adversarial PII tests, audit operating rules, and a single CI verification command.

- [ ] **Step 1: Add nested PII/adversarial tests**

Cover mixed-case nested keys, arrays, upstream error bodies, audit arguments and output evidence. Assert credentials never enter tool schemas or serialized audit records.

- [ ] **Step 2: Run the security test and capture failures**

Run: `npx tsx test/security/pii-redaction.test.ts`

Expected: any unredacted nested/error field fails with the exact JSON path.

- [ ] **Step 3: Apply the minimum redaction/audit corrections**

Change only shared core redaction/audit code required by the failing cases; do not add marketplace-specific endpoint wrappers.

- [ ] **Step 4: Document the operating contract**

Specify retained fields, forbidden fields, retention duration, authorized readers, correlation procedure and deletion process. Keep real payloads and credentials out of Git.

- [ ] **Step 5: Add the release verification script**

```json
"verify": "npm run baseline:check && npm run policies:check && npm run build && npm test && tsx test/security/pii-redaction.test.ts"
```

- [ ] **Step 6: Run the complete local release gate**

Run: `npm run verify`

Expected: exit 0 with baseline current, all forbidden operations excluded, build successful, and all tests passing.

- [ ] **Step 7: Commit security and release gates**

```bash
git add test/security docs/operations package.json
git commit -m "test: gate marketplace v1 read security"
```

### Task 7: Verify production deployment, Remote MCP and rollback

**Files:**
- Create: `docs/operations/RELEASE_AND_ROLLBACK.md`
- Evidence outside Git: deployment, Remote MCP smoke and rollback records

**Interfaces:**
- Consumes: accepted commit, Manifest hash, immutable image digest and Tasks 3–6 evidence.
- Produces: a v1.0 release decision bound to immutable identities.

- [ ] **Step 1: Build and identify the immutable image**

Run:

```powershell
$acceptedCommit = git rev-parse HEAD
if ($acceptedCommit -notmatch '^[a-f0-9]{40}$') { throw 'Accepted commit is not a full Git object ID' }
docker build --build-arg "MARKETPLACE_MCP_COMMIT=$acceptedCommit" -t marketplace-mcp:v1.0 .
```

Expected: build succeeds and image inspection shows the reviewer-accepted commit from Task 6; record the image digest.

- [ ] **Step 2: Deploy only under the separately authorized production release procedure**

Deploy the immutable digest with existing credentials and network controls. Do not change marketplace credentials or enable WRITE.

- [ ] **Step 3: Verify health and authenticated Remote MCP identity**

Run the release environment's health probe and `marketplace_runtime_identity` call.

Expected: health passes; runtime commit/Manifest hash/image digest match acceptance; mode is `READ_ONLY`; WRITE is false.

- [ ] **Step 4: Run one bounded representative READ per marketplace**

Use the accepted real-E2E harness and existing scoped credentials.

Expected: all three reads pass and emit audit correlation IDs; no state-changing method is discoverable or executed.

- [ ] **Step 5: Rehearse rollback to the prior immutable digest**

Follow the runbook to restore the prior digest, verify health/identity, then return to the accepted v1 digest and verify again. Do not rebuild either image during rollback.

- [ ] **Step 6: Record the release decision**

Record current/prior digests, commit, Manifest hash, health results, Remote MCP evidence hashes, rollback timestamps and reviewer acceptance. Only this evidence can mark v1.0 production-ready.
