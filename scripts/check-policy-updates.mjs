import fs from "node:fs";
import path from "node:path";

const [beforeDir, afterDir] = process.argv.slice(2);
if (!beforeDir || !afterDir) {
  console.error("usage: node scripts/check-policy-updates.mjs <old-inventory-dir> <new-inventory-dir>");
  process.exit(2);
}
let safetyChanges = 0;
for (const marketplace of ["ozon", "wb", "ym"]) {
  const file = `${marketplace}-operations.json`;
  const before = new Map(JSON.parse(fs.readFileSync(path.join(beforeDir, file), "utf8")).map((x) => [x.method_id, x]));
  const after = new Map(JSON.parse(fs.readFileSync(path.join(afterDir, file), "utf8")).map((x) => [x.method_id, x]));
  for (const [id, value] of after) {
    if (!before.has(id)) console.log(`+ ${marketplace} ${id} ${value.http_method} ${value.path} DENY_UNTIL_REVIEWED`);
    else {
      const old = before.get(id);
      if (JSON.stringify(old.input_schema) !== JSON.stringify(value.input_schema) || old.path !== value.path || old.http_method !== value.http_method) console.log(`~ ${marketplace} ${id}`);
      if (old.classification !== value.classification) { console.log(`! ${marketplace} ${id} safety ${old.classification} -> ${value.classification}`); safetyChanges++; }
    }
  }
  for (const [id] of before) if (!after.has(id)) console.log(`- ${marketplace} ${id}`);
}
if (safetyChanges) process.exitCode = 1;
