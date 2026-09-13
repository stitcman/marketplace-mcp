import assert from "node:assert/strict";
import { bootstrapApplication } from "../src/bootstrap.js";

for (const failure of [
  "MARKETPLACE_RUNTIME_ENV is required",
  "GIT_COMMIT is required in production",
  "Manifest parse failed",
  "production_mode must remain READ_ONLY",
]) {
  let storeCalls = 0;
  let runtimeCalls = 0;
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("network must not be called");
  };
  try {
    await assert.rejects(
      bootstrapApplication({
        loadIdentity: () => { throw new Error(failure); },
        initializeStore: async () => { storeCalls += 1; return {}; },
        startRuntime: async () => { runtimeCalls += 1; },
      }),
      new RegExp(failure),
      `${failure}: bootstrap returns the identity failure`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(storeCalls, 0, `${failure}: Store factory not called`);
  assert.equal(runtimeCalls, 0, `${failure}: server/client/listen boundary not called`);
  assert.equal(networkCalls, 0, `${failure}: network activity is zero`);
}

console.log("Runtime identity startup ordering: PASS");
