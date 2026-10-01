# Production decision follow-up — 2026-10-01

STATUS: PARTIAL. DEPLOYMENT: BLOCKED. POST_DEPLOY_SMOKE: NOT_RUN.

## Git and identity

Initial HEAD exactly 4e29543d05fbd9c0b322b756d87226c94edbb463; branch codex/ozon-api-refresh-20261001; origin https://github.com/stitcman/marketplace-mcp.git; tracked tree clean, only existing untracked .serena/. Original runtime/source/package/Manifest files were not rewritten. The 39-file candidate diff against ffc7ef2465e3df84d6be6fb5aba4015d170b2d61 was checked; no unrelated tracked changes found.

`git push --dry-run origin HEAD:refs/heads/codex/ozon-api-refresh-20261001` succeeded with existing credentials; actual `git push` succeeded. GitHub MCP get_commit independently read that branch and returned exactly 4e29543d05fbd9c0b322b756d87226c94edbb463. Candidate source is now published, not merely local. Later ls-remote hit a transient github.com connection failure; it does not erase the independent readback or prove a later push. This follow-up adds evidence and read-only probes in a successor commit, without changing the runtime implementation. Publication of the successor is verified separately.

Version remains 1.1.0-alpha.1. No v1.1.0 release tag created. Docker daemon unavailable locally, so image ID/digest/build timestamp remain unknown. Existing SSH deployment key was tried with strict host-key verification. Current 72.56.0.166 has no pinned entry and does not match the prior pinned 89.19.217.49 host key. Presented ED25519 fingerprint: SHA256:nu+Ecpp+ZAkdwsaCdvOCX3Y4TWfpy5GRu9NXDJaXFGo. No key added, no bypass, no production command ran. Verification through provider console requested from owner; still required.

## Isolated candidate

Actual built candidate launched as a temporary Node MCP HTTP process at 127.0.0.1:19271, MemoryStore with no real credentials. Explicit source commit 4e29543... and immutable Manifest were loaded. MCP SDK client connected via real Streamable HTTP, listed 33 internal /18 model-visible tools and called marketplace_runtime_identity. version=1.1.0-alpha.1, commit=4e29543..., mode=READ_ONLY, write_runtime_enabled=false; Manifest SHA256=33016fd9096b5305a41ed8ce8527b1ada3daeba10a01cb51aadac702e05fe474. isolated-runtime.json records the tool names and actual response.

This proves protocol and startup identity only. It is not Docker identity or candidate Ozon LIVE validation. Real credentials were neither copied out of the server nor placed in the temporary process. Candidate prices/stocks/FBS/FBO/certificate READ gates are BLOCKED until an authorized isolated instance can use the existing server-side secret mechanism. Temporary process stopped and listener absence verified.

## Live and finance

Only the unchanged existing Secure Tunnel server was read. Real connection name/status/mock/sandbox reconfirmed. New bounded READs: FBS unfulfilled v4 one posting/continuation=true; FBS v4 one posting with one product and Money object/continuation=true; accrual types success; roles success and 284 paths. The role contains by-day/postings/types; permission membership does not prove semantic safety or actual transport authorization.

For completed UTC date 2026-09-30, by-day with empty last_id and postings for the bounded real posting both returned only INVALID_ARGUMENT. There is no exposed HTTP status/body or diagnostic correlation sufficient to decide local-vs-upstream cause. Requests match the official browser docs and Context7 indexed official docs; no parameters were guessed/retried as WRITE. No claim of permission denial, empty finance success or reconciliation PASS is made. API total=null, control total=null, difference=null, rounding not evaluated. FINANCE_RECONCILIATION=BLOCKED. No old transaction/list used. Primary independent same-period financial control source unavailable.

Prices/stocks/FBO prior-stage real observations remain valid as prior-stage old-server evidence, not repeated candidate tests. A posting with multiple real products was not found in this bounded sample; this edge case remains fixture-only. No candidate terminal page or full export is claimed. Certificate products current request contract rechecked in official docs: use last_id/limit, not removed page/page_size; a real candidate call remains unavailable.

## MOS OLD → NEW comparison

MOS read-only source binding b400cd3809aad94acd516c83db8403ac3ce5b30f. Targeted production-code search across modules/apps/packages/scripts found no ozon_prices_get/ozon_stocks_get/ozon_orders_list/ozon_read_execute/meta.continuation/SDK consumer. Actual code uses OfficialOzonReadOnlyAdapter + OzonSellerHttpTransport + SourceContract, not MCP tools. Finance readiness is explicitly blocked and Performance optional degraded in MOS acceptance source. Source hashes and no-mutation proof are saved in mos-compatibility.json.

`npx tsx scripts/check-mos-mcp-boundary.mjs` passed five synthetic cases: prices, stocks with FBO/FBS/rFBS, FBS, FBO, FBS unfulfilled; old/new policy records through the CURRENT generic executor preserve raw payloads, and the ACTUAL MOS pure parser gives identical records/cursors. This is not a comparison of two running MCP binaries. Network=0; MOS mutations=0. Harness initially used the wrong internal result field (data instead of payload), then omitted the required posting filter; both harness errors fixed and final run PASS. They were not product defects.

| Contract | Old → new candidate | MOS checked source |
|---|---|---|
| Generic raw payload / field names | Preserved, five targeted tests | Parses official raw fields directly |
| Normalized declared_price / Money | New additive Money field; missing/null/zero retained | No MCP normalized price consumer found; money projection not certified by boundary test |
| Stocks FBO/FBS/rFBS/null | opt-in v2 preserves types/null; v1 explicit incompatibility error | Own raw stock parser aggregates present/reserved; no MCP v2 consumer found |
| Orders IDs / source_sku | sku no longer aliases product_id; nullable true | Own posting-level raw parser; no normalized MCP consumer found |
| Cursor / last_id / meta.continuation | Bound opaque wrapper cursors; raw generic tokens retained | Own raw cursor parser; no meta.continuation consumer found |
| total / total_items | Wrapper termination follows token, not total | Checked parser does not use total for termination |
| Finance / reports | Retired finance denied; exact live reconciliation unresolved | No active finance/report request builder in checked source |

OFFLINE_BOUNDARY=PASS; MOS_COMPATIBILITY=BLOCKED_RUNTIME_BINDING_UNVERIFIED. Source scan alone cannot certify actual running MOS or undiscovered external consumers. No MOS imports, backfill, DB queries, configuration changes or patches performed.

## Official sources

Browser Seller/Performance docs work. Browser observes Seller swagger.json?1790833747847 as a fetched asset and official loadSwagger/initRedoc JS resources. Asset-export API rejects their kinds; no unsupported browser APIs or security bypass used. Direct read-only probe of the observed asset, Performance spec and official JS records every 302 Location and final URL; all four end at __rr=6 / REDIRECT_LIMIT. Public JS was not executed by a helper.

Source priority covered: official machine asset attempted; official docs browser verified; current /v1/roles paths obtained; official Performance changelog reviewed. Mirrored specifications were not substituted. ALL_METHODS_CURRENT=NO. Endpoint matrix has 511 historical records with current-targeted doc status, path version, safety/admission/test/live/replacement/verification date. It explicitly does not claim completeness against the unavailable fresh snapshot. Seller 482 DOM nodes /481 unique endpoints from prior observation; Performance 48. Node count is not a release coverage invariant.

Official references: [Seller](https://docs.ozon.ru/api/seller/), [Performance](https://docs.ozon.ru/api/performance/), [by-day](https://docs.ozon.ru/api/seller/#operation/GetFinanceAccrualByDay), [postings](https://docs.ozon.ru/api/seller/#operation/GetFinanceAccrualPostings), [types](https://docs.ozon.ru/api/seller/#operation/GetFinanceAccrualTypes), [certificate products](https://docs.ozon.ru/api/seller/#operation/CertificateProductsList). Indexed docs corroborate financial request fields; they are not the fresh full spec.

## Security, tests and release gates

Repeated `npm run build`, `npm test`, `npm run policies:check`, `npm run baseline:check`: PASS. Full suite includes tool visibility, 238 forbidden/retired local denials with zero transport calls, barcode, unknown methods/nested routing-auth overrides, report-job retry protection, streaming bounds and file host/DNS checks. Reports/files were not generated/downloaded live. Internal tools and ChatGPT visibility are checked locally; this is not post-deploy ChatGPT validation. WRITE_TOOLS_VISIBLE=0; WRITE_REQUESTS_SENT=0.

Performance candidate loopback has no credentials. Production credential presence cannot be inspected without trusted host access. PERFORMANCE=BLOCKED_CREDENTIAL_STATE_UNVERIFIED (candidate has BLOCKED_NO_CREDENTIALS). Do not send Seller key through the unchanged old Performance transport to test this; candidate credential separation is already tested offline. No OAuth/rotation/rights expansion done.

Production container name, image ID, digest, prior commit, Compose project, volume dependencies and preserved rollback image all UNKNOWN. ROLLBACK_READY=NO. An illustrative Compose file is not production evidence. Exact rollback/restart commands cannot be asserted before binding the real deployment. No deployment/tag/image publication was attempted, because production-gates.json has eight blocked mandatory gates. POST_DEPLOY_SMOKE=NOT_RUN.

Next access package: verify presented SSH fingerprint out-of-band or provide the existing authorized deployment access; use it first for narrow read-only container/image/Compose attestation, then prepare an isolated candidate with existing server-side credentials and preserved rollback image. After that: diagnose finance INVALID_ARGUMENT using sanitized server diagnostics; obtain API pages + independent same-period control total; verify actual MOS runtime binding; inspect Performance credential existence only server-side; complete fresh-contract coverage. Production remains prohibited until the explicit gates are all PASS.

## Bound verification and independent review

The final immutable capture is stage-checks-20261001061408681.json, SHA256 829343045c1df8582f247acab49646969a3e65c1c992406789742cc6fa3388dd. It records actual exit codes and output hashes for build, full suite, policy and baseline checks. Source binding covers every candidate source/checker script plus the literal six new evidence scripts, including untracked content. The earlier 06:09 capture is preserved as historical evidence and superseded after strengthening this binding.

Reproduce gate evaluation: `node scripts/record-ozon-release-gates.mjs docs/audits/2026-10-01-ozon-api-refresh/release-gate-followup/stage-checks-20261001061408681.json 829343045c1df8582f247acab49646969a3e65c1c992406789742cc6fa3388dd`. Expected exit code 1: eight mandatory gates BLOCKED. `node scripts/test-ozon-gate-attestation.mjs` passes negative cases for missing evidence, changed source, failed suite, wrong publication SHA and wrong runtime Manifest. Independent review found two P2 evidence-integrity gaps (hardcoded PASS and incomplete checker binding); both fixed and reviewed closed. No remaining P0/P1/P2 findings in the reviewed follow-up. No runtime source edits.
