# Release closure — 2026-10-01

STATUS=PARTIAL; candidate 4e29543d05fbd9c0b322b756d87226c94edbb463 is not accepted for production. DEPLOYMENT=BLOCKED; POST_DEPLOY_SMOKE=NOT_RUN. Runtime/source/policies/inventory/package/Manifest remain byte-identical to that candidate. No v1.1.0 tag or production cutover. Independent safe stages completed despite finance failure.

## Production baseline and rollback

Trusted SSH host msk-1-vm-66nr /72.56.0.166 confirmed with the owner's Timeweb fingerprint and StrictHostKeyChecking=yes, curve25519-sha256, ssh-ed25519. No trust bypass. production-identity.json and protocol-identities.jsonl independently bind Docker and actual MCP identity:

- Container c4c5d9d769cd093753105e3073b3a2e4bade29d5767414368f701b0f2cd777b5, healthy.
- Image ID sha256:df5059c568ae3566f14c21e96268792d02496b90ae29646c059b318459cd6c7d; RepoTag marketplace-mcp/router-upstream:ffc7ef2; engine-reported RepoDigest marketplace-mcp/router-upstream@sha256:df5059c568ae3566f14c21e96268792d02496b90ae29646c059b318459cd6c7d. Not a newly published registry artifact.
- Embedded AND actual MCP commit ffc7ef2465e3df84d6be6fb5aba4015d170b2d61, runtime version 0.4.0; Manifest 857a3c236f8b4229038fdf0da234942ba094cd14e9208fe43a666ea4f9d3e859. BASELINE=PASS; this is no longer inferred from a historical audit.
- Compose project marketplace-mcp; file /opt/marketplace-mcp/deployment/compose.yaml; SHA256 3f4a740316dc4e5b1d7fa22f296225004b19a3e1697e795f529c0dac0d79b94d. Resolved config validated privately; no secret values exported.

ROLLBACK_READY=YES. Archive /opt/marketplace-mcp/release-closure-20261001/rollback/router-ffc7ef2.tar, 61079040 bytes, SHA256 a27c133b01ed6bb354283c686502dd3a4eab6c66dc8ce9e7630626ab5f491bf1. Existing image retained. Actual docker image load succeeded and the loaded tag's ID/RepoDigests were compared with baseline. Compose snapshot was hash-checked against original; restore command dry-run succeeded. rollback-and-final-state.json records all these checks. This is archive/load and command validation, not an outage/restart rehearsal.

```sh
docker image load -i /opt/marketplace-mcp/release-closure-20261001/rollback/router-ffc7ef2.tar
CREDENTIALS_DIRECTORY=/run/credentials/marketplace-mcp.service docker compose -p marketplace-mcp -f /opt/marketplace-mcp/release-closure-20261001/rollback/compose-baseline.yaml up -d --no-deps --pull never router
```

No compose down, no volumes removed, no PostgreSQL or MOS recreation. Production container ID/image/health were rechecked unchanged after candidate work. Production identity READ uses the normal audited handler, which writes tool_calls metadata; no claim of zero production DB audit writes. Seller/MOS WRITE requests remain zero.

## Isolated candidate and real READ

Candidate archived from exact Git SHA; archive SHA256 2ff41355f53a4e41a30bf8e34227a6d6f3a366869a9e2ddf3efcd34fa7bb5fae matched locally and remotely. Built on host with Dockerfile GIT_COMMIT=4e29543d05fbd9c0b322b756d87226c94edbb463. Container 39adaef2ca65f5f54c9fe198bb3e511e22b68585eedfad5ff6bf79de1110a536; image ID sha256:baedfa5d50dcc2c036e79af97c984e1ddddd181bf33211fd213786e123a27047; engine RepoDigest marketplace-mcp/ozon-isolated@sha256:baedfa5d50dcc2c036e79af97c984e1ddddd181bf33211fd213786e123a27047. Bound only to 127.0.0.1:19272; no edge/production replacement.

Actual MCP identity: version 1.1.0-alpha.1, exact candidate commit, Manifest 33016fd9096b5305a41ed8ce8527b1ada3daeba10a01cb51aadac702e05fe474, mode READ_ONLY, write_runtime_enabled=false. Catalog 33 internal/18 model-visible, zero WRITE tools.

Same production secret mount and encrypted credential store were used ONLY on host. A documented preload overlay enforces PostgreSQL default_transaction_read_only=on and checks SHOW transaction_read_only before startup; it redirects audit to memory and denies addConnection. Candidate source/dist/Manifest were not patched. This overlay changes audit/storage behavior for isolation; it is not an unmodified deployment smoke. Read-only filesystem, dropped capabilities, resource limits and private port preserved.

candidate-live.json records successful official_api calls: prices v5 pages 1/2; stocks v4 pages 1/2; rFBS 110 returned stock rows; FBS v4, unfulfilled and FBO v3 one posting each with continuation; accrual types; roles. Business payloads, cursor values, real posting numbers and credentials are not in evidence/Git. Pagination tested for two pages, not full-catalog completeness.

FINANCE_RECONCILIATION=BLOCKED. For 2026-09-30, by-day fails BULK_LIMIT_EXCEEDED at the candidate's 256 KiB page bound. Official request has date/last_id, no page-size field; asking to reduce page size cannot resolve this response. Accrual postings is in inventory but conservatively classified WRITE and absent from the candidate allowlist, so an actual MCP attempt using one real FBS posting returns LOCAL_DENY before HTTP. Its current official documentation describes retrieval with posting_numbers[1..200]; correcting admission requires a reviewed successor candidate. No local deny was bypassed. API total/control total/difference remain null. Independent same-period control requested, not supplied; no API-to-itself reconciliation or zero invented.

First live harness used old offset/dir arguments and received local deny for orders; corrected to current cursor/sort_dir before the final successful run. First temporary startup failed because node could not read the preload mount; fixed the temporary probe directory permissions and recreated only that exited candidate. SSH/scp transient timeout and a missing shell in the MOS image were handled with strict SSH and read-only Node inspection. None is a product fix or production replacement.

PERFORMANCE=BLOCKED_NO_CREDENTIALS: same connection has Seller keys, but no separately provisioned performance_access_token/performance_expires_at. No Performance HTTP request, OAuth, token acquisition, rotation or Seller-key substitution. Optional credentialed Performance stage cannot be verified.

## Actual MOS compatibility

Running API/worker/web OCI revision is 88f23b2ecaeffc7d8043cd1e136643e1a8a04cfe, healthy. Four Ozon source files were hashed inside the API filesystem; hashes exactly match the previously tested local source. Git source inspection at that exact revision found no MCP normalized-tool/continuation/SDK consumer. MOS uses its own official Seller transport.

Five actual candidate generic READ payloads travelled only through host process memory into the pure OzonControlSyncParser loaded from the RUNNING MOS API filesystem. Prices, stock totals, FBS, FBO and unfulfilled each parsed one record and retained a cursor: 5/5 PASS. No MOS sync, import, backfill, DB call or write was invoked; no files/configuration/containers changed. MOS_COMPATIBILITY=PASS for these five raw contracts and unchanged consumer binding; it does not certify finance, normalized-wrapper integration, full MOS readiness or cutover. mos-candidate-live-parser.json + mos-source-hashes.json are the direct evidence. Earlier provisional mos-runtime.json status is superseded by these actual parser/hash checks.

## Exact official membership diff

Official DOMs: https://docs.ozon.ru/api/seller/ and https://docs.ozon.ru/api/performance/. Extractor reads data-section-id operation identifiers and displayed verb/path, never hidden app state. seller-dom.tsv has 482 nodes/481 unique keys: GetProductInfoStocksByWarehouseFbo is repeated in two sections with identical verb/path. Performance has 48/48. Combined unique set 529; inventory 511=463 Seller+48 Performance. Exact family/method_id/verb/path diff: 509 matched, 20 added Seller, 2 absent Seller, zero Performance differences. Formula 511+20-2=529; 530 rendered nodes include the one duplicate. Text transcription verified by length and FNV64 (Seller 29960/c4fd1a4f8597bb89, Performance 3342/9959cbcb1e5fa10d); persisted input SHA256s are in exact-set-diff.json. Reproduce with node exact-set-diff.mjs.

All membership differences explained below; safety labels here are review notes, not execution admission:

| New method(s) | Observed purpose / disposition |
|---|---|
| ProductImportPicturesV2 | v2 image upload/update, WRITE; keep denied |
| ActionsCandidates, ActionsProducts | v2 retrieval replacing analogous v1 behavior; docs note transition on 13 October; schemas/admission pending |
| ActionsProductsUpdate, ActionsProductsDeactivate | add/update/remove promotional products, WRITE; keep denied |
| ActionsAutoAddProductsListV2, ActionsAutoAddProductsCandidatesV2 | v2 auto-add retrieval; analogous v1 behavior until 13 October; schemas/admission pending |
| ActionsAutoAddProductsDeleteV2, ActionsAutoAddProductsUpdateV2 | delete/update auto-add products, WRITE; keep denied |
| PostingFbsPackageLabelCreate | v3 asynchronous label job creation; safety/report workflow review pending; denied |
| PostingFbsPackageLabelGet | v2 label-file retrieval; schema/download safety review pending; denied |
| AnalyticsDecommissionedGoods | decommissioned-goods report retrieval; schema/account capability review pending |
| AnalyticsCategoryComparison | category analytics, Premium Pro capability; schema/account review pending |
| DescriptionCategoryDependentAttributes, DescriptionCategoryDependentAttributesValues | dependent attribute pairs/values retrieval; schemas/admission pending |
| AnalyticsLocalSaleTotal, AnalyticsLocalSaleClustersItemsInfo, AnalyticsLocalSaleItemsClustersInfo | locality totals/by-cluster/by-product retrieval; schemas/admission pending |
| WarehouseRfbsReturnPointList | rFBS return-point directory retrieval; schema/admission pending |
| FbpOrderDirectTplDlvEdit | update third-party delivery, WRITE; keep denied |

QuantProductList /v1/product/quant/list and QuantGetInfo /v1/product/quant/info are absent from current rendered official operations. No formal retirement/date/replacement is inferred merely from absence; their lifecycle/admission needs successor review. Existing current-doc methods can still carry deprecation notices; membership is not proof of support.

ALL_METHODS_CURRENT=NO. Full fresh machine-readable schemas remain unavailable; the earlier asset probes were not repeated. Membership gap is now exact, but full schema/lifecycle/safety reconciliation and implementation of newly reviewed READ methods are incomplete. Runtime method diff remains added 0/changed 18/retired 9/removed allowlist 9; the 20 DOM additions are documentation delta, not implemented methods.

## Verification and decision

checks-1790838096336.json binds all four actual command exit codes/output hashes to unchanged candidate source fingerprint: build/full suite/policy/baseline PASS. Repeated forbidden/retired 238-method transport-spy tests send zero HTTP requests. Security includes exact catalog visibility, nested routing/auth denial and report/file guards. WRITE_REQUESTS_SENT=0 refers to external marketplace mutation requests, supported by the approved live-call ledger and unchanged policy/tests, not independent packet capture. No WRITE negative probe was sent upstream.

Rollback review found an evidence-integrity P2: the first finalize helper asserted load_verified without performing/checking load itself. Fixed helper now hashes archive, loads it, matches ID/RepoDigests, checks Compose snapshot SHA and successful dry-run before deriving ready. rollback-first-provisional.json is historical and not gate evidence. Final gate generator consumes the corrected artifact and actual test/parser/identity results. Missing/bad required inputs throw; existing finance failures keep deployment BLOCKED (expected exit 1).

Candidate stopped, image retained for review; production container/image/Compose unchanged and healthy. No v1.1.0 tag, production deployment or post-deploy smoke occurred. Remaining mandatory work: reviewed successor for by-day bounded handling and accrual-postings admission; real finance page traversal and independent same-period control; full official schema/safety/lifecycle coverage including the 20 new/two absent operations. Performance needs existing human-managed credentials if that stage is to run. Deployment remains prohibited until mandatory gates pass; rollback should be revalidated immediately before any future cutover.
