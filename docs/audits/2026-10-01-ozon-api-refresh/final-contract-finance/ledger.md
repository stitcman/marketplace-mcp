# Final contract and finance closure

Baseline: 091dadb7f09af2104d171291e5ad63f325bc8a16; production independently observed unchanged ffc7ef2 image/container, healthy, 2026-10-01.

- A: oversized accrual page reproduced RED (BULK_LIMIT_EXCEEDED). Lossless ephemeral local chunking GREEN; finite upstream 16 MiB; cache 64 MiB/32 entries/10 minute TTL; packed MCP ceiling unchanged 256 KiB including duplicate text/structured payload and envelope, 8 KiB transport reserve. No persistence or database writes.
- B: official postings DOM read at 2026-10-01T07:38:39.204Z. Explicit READ decision in generator overrides; permission finance.read; posting_numbers 1..200 strings; generic minItems validation fixed. Regeneration retains admission. Live verification pending.
- C: full official rendered text of 20 additions captured in official-new-20-rendered.json. Explicit 13 READ, 1 label generation SEMANTIC_READ_JOB, 4 WRITE, 2 DESTRUCTIVE decisions. Two absent Quant records retained as denied tombstones; absence does not imply a formal removal date or replacement. Current operation inventory 481 Seller + 48 Performance = 529; allowlist 286.
- D: full 529 normalized schema capture/review is pending. Do not report full_official_contract PASS or ALL_METHODS_CURRENT YES based solely on inventory equality. HTTP source extraction still redirects; rendered docs remain the accepted source, not a permanent Swagger requirement.
- E–K: new isolated runtime, real finance reconciliation, compatibility, security revalidation and deployment gates pending. Production deployment prohibited until all required gates pass.

Ruling: upstream finance cap is separate and finite; by-day and postings get 16 MiB — fixes an endpoint with no page-size parameter without enlarging the global MCP cap — oversized single records remain explicit errors.
Ruling: preserve historical audit scripts/evidence; new stage artifacts use this directory — prior release results remain immutable — new candidate must have its own identity and checks.

Review 091dadb7..662e941: CHANGES_REQUIRED, three findings. One correction pass: explicit new pagination contracts with two-page RED/GREEN; postings packed ceiling RED/GREEN with lossless local chunks; cross-endpoint reconciliation rejects absent posting-day coverage, compares exact currency/decimal totals by posting and date, reports observed differences and blocks PASS. Single-posting real control mandatory. Direct 429 finite retries (4 attempts, <=60 seconds each), sanitized progress survives failures. Runtime rc.2 staged; full contract gate remains pending.
