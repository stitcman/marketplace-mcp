export interface RuntimeIdentity {
  version: string;
  commit: string;
  manifest_sha256: string;
  mode: "READ_ONLY";
  write_runtime_enabled: false;
}

export interface EvidenceCheck {
  name: string;
  status: "PASS" | "FAIL";
  sha256: string;
}

export interface EvidenceEnvelope {
  schema_version: "1.0";
  marketplace: "ozon" | "wildberries" | "yandex_market";
  runtime: RuntimeIdentity;
  account_identity_sha256: string;
  started_at: string;
  completed_at: string;
  checks: EvidenceCheck[];
  audit_correlation_ids: string[];
}
