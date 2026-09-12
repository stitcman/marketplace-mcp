# Marketplace MCP v1.0 Roadmap

Source of truth: [`MARKETPLACE_MCP_MANIFEST.yaml`](../../MARKETPLACE_MCP_MANIFEST.yaml). This roadmap does not duplicate endpoint inventories or enable WRITE.

## Baseline

- Production repository baseline: v0.3.0 at `0acd8026f0bf688f2cc6bca1e5f9633997117b51` (`origin/main`). A deployed revision is not evidenced in this repository.
- Candidate: v0.4.0 at `e0e105f08e2139d76df2e919d8d073563ef3e7c5` on `codex/full-readonly-coverage`.
- Runtime: `READ_ONLY`; architecture target: `READ + Controlled WRITE`; no global WRITE switch.
- Surface: 17 production tools; 32 candidate tools. The extra 15 are five generic READ discovery/execution tools per marketplace, not endpoint wrappers.
- Inventory: Ozon 511 operations, WB 181, Yandex Market 169. Candidate READ allowlists contain 282, 113, and 108 methods respectively.
- Planning readiness: **55%** — 19 target controls scored as 8 complete, 5 partial at half credit, and 6 missing. This is prioritization, not release acceptance.

## Gap analysis

| v1 target | Current evidence | Gap |
|---|---|---|
| READ + Controlled WRITE architecture | Capability classes and disabled WRITE are represented in the Manifest | Controlled-WRITE runtime contract is intentionally deferred; no WRITE endpoint is needed for v1 |
| WRITE disabled | No WRITE tools or global enable flag in production or candidate | No v1 gap; future WRITE remains demand-gated |
| Fail closed | Production v0.3 explicit tools are READ-only; candidate locally denies Yandex `deleteDocuments`/`updateDocuments` with zero transport calls | Continue semantic review for every inventory refresh |
| Ozon READ | Products, stocks, prices, orders plus candidate generic READ | Representative real-account E2E and recorded contract evidence missing |
| Wildberries READ | Products, stocks, prices, orders plus candidate generic READ | Representative real-account E2E missing; Analytics has no sandbox |
| Yandex Market READ | Campaigns, products, stocks, prices, orders plus candidate generic READ | Representative real-account E2E missing |
| Credentials isolation | Credentials are separate from MCP arguments and encrypted in PostgreSQL | Production secret-manager/deployment evidence missing |
| Permissions | Per-connection `.read` permissions are enforced | Real tokens/scopes need evidence per marketplace |
| Rate/retry | Per marketplace/connection/group limits, retries, timeout handling exist | Production telemetry proving behavior is missing |
| Audit | Every registered tool is wrapped by audit logic | Retention/access/export operating contract is not documented or verified |
| PII/security | Default sensitive-field redaction, bounded I/O, bearer auth and Origin checks exist | Marketplace PII inventory and adversarial production evidence incomplete |
| Capability registry | Compact Manifest created; full inventories remain external to LLM context | Runtime version/manifest-hash visibility still missing |
| Production deployment | Docker and compose definitions exist | Deployed commit and health evidence absent |
| Remote MCP E2E | Streamable HTTP transport exists | Authenticated remote E2E evidence absent |
| Rollback | Git history and container build inputs exist | A rehearsed rollback with evidence is absent |

## P0 — blocks v1.0

### P0.1 Restore the fail-closed candidate boundary — COMPLETE

- Why: the candidate READ allowlist contains `deleteDocuments` and `updateDocuments`, both explicitly state-changing upstream operations.
- Dependencies: pinned Yandex inventory source already recorded in `inventory/ym-operations.json`.
- Acceptance criteria: both operations are classified `DESTRUCTIVE`/`WRITE`, absent from the READ allowlist, and negative spy-transport tests prove `HTTP_REQUESTS_SENT=0`; all policy checks pass.
- Complexity: S.
- Done: commit `e0e105f08e2139d76df2e919d8d073563ef3e7c5` classifies `deleteDocuments` as `DESTRUCTIVE`, `updateDocuments` as `WRITE`, removes both from the allowlist, and proves `2/2 HTTP_REQUESTS_SENT=0`.
- Remaining: independent review is still required before promotion; no implementation work remains for this defect.

### P0.2 Prove representative Ozon real READ E2E

- Why: Ozon contracts are least authoritative and current tests use samples/mocks rather than a complete live flow.
- Dependencies: isolated read-only seller credential, redacted evidence storage, P0.1.
- Acceptance criteria: authenticated Remote MCP calls for capabilities plus representative products, stocks, prices, and orders reads pass; no seller data changes; response schemas, audit entries, rate handling, and secret redaction are evidenced.
- Complexity: M.
- Done: normalized adapter, generic dispatch, permissions, rate/retry and mock/sample contract tests.
- Remaining: controlled real-account run and immutable redacted evidence.

### P0.3 Prove representative Wildberries real READ E2E

- Why: sandbox coverage excludes Analytics/Common and cannot alone prove stocks safely.
- Dependencies: isolated read-only token with documented categories, redacted evidence storage, P0.1.
- Acceptance criteria: capabilities, products, both stock models where available, prices, and orders pass over Remote MCP; the production-read caveat is explicitly accepted; no mutation occurs.
- Complexity: M.
- Done: adapter, category-specific rate limits, sandbox warning and mock/sample contract tests.
- Remaining: controlled real-account run and evidence.

### P0.4 Prove representative Yandex Market real READ E2E

- Why: business/campaign identity and dual stock paths require live verification.
- Dependencies: P0.1, isolated API key, known business/campaign IDs, redacted evidence storage.
- Acceptance criteria: campaigns, products, FBS stocks, FBO stocks, prices, and orders pass over Remote MCP; forbidden document mutations remain locally denied.
- Complexity: M.
- Done: dual-path adapter and sample mapping tests.
- Remaining: controlled real-account run and evidence.

### P0.5 Bind and verify the production release

- Why: repository state does not prove what is deployed or whether rollback works.
- Dependencies: P0.1–P0.4, accepted candidate commit.
- Acceptance criteria: immutable image digest maps to an accepted commit and Manifest hash; `/health` and authenticated Remote MCP smoke pass; rollback to the prior digest is rehearsed and the service is re-verified; WRITE remains disabled.
- Complexity: M.
- Done: Dockerfile, compose definition, HTTP bearer/Origin protections.
- Remaining: release evidence, deployment verification, remote smoke and rollback drill.

## P1 — required for a complete v1.0

### P1.1 Expose version and Manifest identity safely

- Why: operators and MOS must distinguish source, candidate and deployed runtime without loading the full inventory.
- Dependencies: stable Manifest schema.
- Acceptance criteria: a compact read-only identity response exposes MCP version, commit and Manifest SHA-256 without paths, credentials or inventory payloads; tests bind values to the build.
- Complexity: S.
- Done: version exists in `package.json` and `src/server.ts`; commits exist in the Manifest.
- Remaining: one compact runtime surface and build binding.

### P1.2 Complete PII and audit operating controls

- Why: technical redaction and audit storage need explicit marketplace coverage and operations rules.
- Dependencies: representative payload samples from P0 E2E runs.
- Acceptance criteria: sensitive fields are inventoried per marketplace; adversarial tests cover nested keys and errors; audit retention/access rules are documented and verified without credential leakage.
- Complexity: M.
- Done: default redaction, encrypted credentials and audit wrappers.
- Remaining: coverage matrix, nested/adversarial tests and operating evidence.

### P1.3 Make baseline artifacts release-gated

- Why: Passport, version and capability statuses must not drift independently.
- Dependencies: Manifest generator/checker.
- Acceptance criteria: CI runs `baseline:check`, `policies:check`, build and tests; stale Passport, enabled WRITE, missing references or a MOS lock fail the gate.
- Complexity: S.
- Done: Manifest and generated Passport checker exist.
- Remaining: wire the checks into the repository CI/release gate without duplicating inventories.

### P1.4 Reconcile stale README status

- Why: README currently says both v0.4 and “Status: v0.3”, and documents 17 tools although candidate exposes 32.
- Dependencies: accepted promotion decision.
- Acceptance criteria: README points to Manifest/Passport, clearly separates production from candidate, and contains no independent capability registry.
- Complexity: S.
- Done: contradiction identified.
- Remaining: update only after the candidate disposition is accepted.

## P2 — after v1.0

### P2.1 History collectors

- Why: longitudinal analysis may later help MOS, but it is not required for safe live READ.
- Dependencies: explicit MOS use case and retention design.
- Acceptance criteria: a future task packet defines required snapshots, retention, tenant isolation and cost before implementation.
- Complexity: L.
- Done: schema foundations are mentioned in the current project roadmap.
- Remaining: all runtime implementation, deferred.

### P2.2 Additional READ domains

- Why: finance, advertising, reviews and reports should only be promoted when MOS consumes them.
- Dependencies: concrete MOS capability IDs and marketplace-specific real E2E.
- Acceptance criteria: each promoted business capability has demand, minimal permissions, real evidence and no new endpoint-specific MCP tool unless justified.
- Complexity: M per domain.
- Done: candidate inventory/allowlist discovery exists.
- Remaining: demand-driven selection and verification.

### P2.3 Controlled WRITE capabilities — DO NOT BUILD BEFORE MOS NEEDS IT

- Why: WRITE is future architecture, not a v1 READ requirement.
- Dependencies: explicit MOS use case, separate authorization, preview/dry-run, human confirmation where required, idempotency, limits, audit and rollback semantics.
- Acceptance criteria: each WRITE capability is enabled independently by stable capability ID; DESTRUCTIVE remains a separate class; no global `write_enabled=true`; negative tests prove every other mutation stays local.
- Complexity: L per capability.
- Done: WRITE/DESTRUCTIVE inventory classes and disabled Manifest entries exist.
- Remaining: no runtime work is authorized or required for v1.0.

## Context economy

- Keep the 15 candidate generic tools through v1 to avoid an unneeded compatibility rewrite; they cover 503 approved operations without 503 endpoint wrappers.
- Do not place inventories, Passport or roadmap into mandatory agent context. Load the Manifest first, then a referenced policy item only when needed.
- The 17 legacy typed tools overlap the generic dispatch, but removing them before MOS migration would create compatibility risk. Measure actual MOS usage after v1; then deprecate redundant typed tools individually.
- After MOS call sites are known, the three namespaced generic sets could become five shared `marketplace_read_*` tools, reducing the surface from 32 to 22 without losing endpoint coverage. Combining that with a controlled typed-tool migration could eventually reach 9 tools; neither change belongs in the v1 critical path.
- The README is currently the main duplicate/stale narrative. Reduce it to onboarding/operations plus links after release identity is settled.
- A compact runtime identity/capability response can further reduce persistent context by replacing prose with version, hash and stable IDs.
