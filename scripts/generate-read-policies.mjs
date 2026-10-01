import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import { execFileSync } from "node:child_process";
import { applyOzonOverrides } from './apply-ozon-contract-overrides.mjs';

const root = path.resolve(import.meta.dirname, "..");
const refs = process.env.MARKETPLACE_MCP_REFERENCE_ROOT ?? "C:/marketplace-mcp-references";
const outPolicies = path.join(root, "policies");
const outInventory = path.join(root, "inventory");
fs.mkdirSync(outPolicies, { recursive: true });
fs.mkdirSync(outInventory, { recursive: true });

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9а-яё]+/g, " ");

const destructiveWords = /\b(delete|remove|archive|trash|cancel|deactivate)\w*|отмен|удал|архив|корзин/i;
const writeWords = /\b(create|update|set|add|upload|import|activate|enable|disable|send|reply|answer|confirm|accept|reject|deliver|move|recover|change|edit|publish|unpublish)\b|созда|измен|обнов|добав|загруз|отправ|ответ|подтверд|приня|отклон|постав|перемест|публи/i;
const readWords = /\b(get|list|search|find|info|status|history|details|calculate|check|analytics|statistics|stats|report|download|roles|limits|recommendations|tree|attributes|values|stocks|orders|sales|returns|warehouses|campaigns|products|offers|prices|balance|documents|tariffs|ratings|quality|questions|feedbacks|chats)\b|получ|спис|поиск|информац|статус|истори|аналит|статист|отч[её]т|скача|рассчит|провер/i;
const semanticJobWords = /\b(generate|report|statistics|analytics|download|выгруз|отч[её]т|сформир)/i;

function classify({ http_method, path: apiPath, operationId, summary, description, readOnlyScope = false }) {
  const method = http_method.toUpperCase();
  const last = apiPath.replace(/\/+$/, "").split("/").pop() ?? "";
  const semantic = normalize(`${operationId} ${last} ${summary}`);
  const all = normalize(`${operationId} ${apiPath} ${summary} ${description}`);
  if (/\/chat\/(send|start)(\/|$)|\/seller\/message(\/|$)|\/feedbacks?\/answer(\/|$)|\/questions?\/(answer|reply)(\/|$)/i.test(apiPath)) return "WRITE";
  if (/^(change|update|set|add|delete|remove|cancel|send|reply|answer|confirm|accept|reject|activate|deactivate|измен|обнов|добав|удал|отмен|отправ|ответ|актив|деактив|установ|подтверд|приня|отклон)/i.test(String(summary ?? "").trim())) {
    return destructiveWords.test(String(summary)) ? "DESTRUCTIVE" : "WRITE";
  }
  if (/^(get|list|info|status|history|details|check|search)$/i.test(last) || /(Get|List|Info|Status|History|Details|Check|Search)(V\d+)?$/.test(operationId)) return "READ";
  if (method === "DELETE" || destructiveWords.test(semantic)) return "DESTRUCTIVE";
  if (semanticJobWords.test(all) && /\b(generate|download|report|statistics|analytics|выгруз|отч[её]т|сформир)/i.test(semantic)
      && !/\b(price|stock|order|shipment|carriage|campaign|product|offer|card|warehouse|promotion|bid|chat|feedback|question)\b.*\b(update|set|change|create|send|reply|answer|confirm|cancel)/i.test(all)) {
    return "SEMANTIC_READ_JOB";
  }
  if (writeWords.test(semantic)) return "WRITE";
  if (method === "GET" && !writeWords.test(all)) return "READ";
  if ((readOnlyScope || readWords.test(semantic)) && !writeWords.test(semantic)) return "READ";
  return "WRITE";
}

function domainOf(tags, apiPath) {
  const first = Array.isArray(tags) && tags.length ? String(tags[0]) : "";
  if (first) return normalize(first).trim().replace(/\s+/g, "_");
  return apiPath.split("/").filter(Boolean).find((x) => !/^v\d+$/.test(x)) ?? "other";
}

function permissionFor(domain, apiPath) {
  const s = normalize(`${domain} ${apiPath}`);
  const rules = [
    [/financ|transaction|accrual|commission|balance|cash|payment|deduction|реализ|netting/, "finance.read"],
    [/report|document|file|export|download|label|barcode/, "reports.read"],
    [/analytic|statistic|turnover|funnel|search report/, "analytics.read"],
    [/return|claim|refund/, "returns.read"],
    [/logistic|delivery|shipment|carriage|supply|acceptance|first mile/, "logistics.read"],
    [/warehouse|stock/, "warehouses.read"],
    [/promo|campaign|bid|advert/, "advertising.read"],
    [/feedback|review/, "reviews.read"],
    [/question/, "questions.read"],
    [/chat|message/, "chats.read"],
    [/tariff|subscription|commission/, "tariffs.read"],
    [/rating|quality|quarantine/, "quality.read"],
    [/order|posting|sale/, "orders.read"],
    [/price|discount/, "prices.read"],
    [/product|offer|catalog|card|categor|attribute|brand|content/, "catalog.read"],
  ];
  return rules.find(([re]) => re.test(s))?.[1] ?? "catalog.read";
}

function sensitiveOf(domain, apiPath, operationId) {
  return /(^|[^a-z])(buyer|client|chat|message|feedback|question|address|phone|customer)([^a-z]|$)/i.test(`${domain} ${apiPath} ${operationId}`);
}

function paginationOf(op) {
  const text = JSON.stringify(op?.parameters ?? []) + JSON.stringify(op?.requestBody ?? {});
  if (/pageToken|nextPageToken|cursor|last_id|offset|limit|pageSize|pageNum/i.test(text)) return "bounded";
  return "none";
}

function record(base, sourceVersion, sourceHash, classification) {
  const domain = domainOf(base.tags, base.path);
  return {
    method_id: base.operationId || `${base.http_method}_${base.path}`.replace(/[^a-zA-Z0-9]+/g, "_"),
    domain,
    path: base.path,
    http_method: base.http_method.toUpperCase(),
    classification,
    safety: classification === "READ" || classification === "SEMANTIC_READ_JOB" ? "read" : undefined,
    reason: classification === "SEMANTIC_READ_JOB" ? "Explicitly classified report/file generation with no seller-state mutation" :
      classification === "READ" ? "Explicitly classified data retrieval" :
      classification === "DESTRUCTIVE" ? "Destructive operation denied by local policy" : "State-changing or insufficiently proven read-only operation denied",
    permission: permissionFor(domain, base.path),
    endpoint_group: base.endpoint_group ?? domain,
    pagination: paginationOf(base.op),
    file_download: /download|document|file|label|barcode|pdf|csv|xlsx/i.test(`${base.path} ${base.operationId}`),
    report_job: classification === "SEMANTIC_READ_JOB",
    sensitive_data: sensitiveOf(domain, base.path, base.operationId),
    summary: String(base.summary ?? "").trim(),
    description: String(base.description ?? "").trim().slice(0, 4000),
    input_schema: base.input_schema ?? inputSchemaFromOperation(base.op, base.path, base.resolveRef),
    source_version: sourceVersion,
    source_hash: sourceHash,
  };
}

function inputSchemaFromOperation(op = {}, apiPath, resolveRef) {
  const root = { type: "object", properties: {}, required: [], additionalProperties: false };
  for (const raw of op.parameters ?? []) {
    const parameter = raw?.$ref && resolveRef ? resolveRef(raw.$ref) : raw;
    if (!parameter?.name) continue;
    if (parameter.in === "header" || /^(client-id|api-key|authorization)$/i.test(parameter.name)) continue;
    root.properties[parameter.name] = simplifySchema(parameter.schema ?? {}, resolveRef, 0);
    if (parameter.required) root.required.push(parameter.name);
  }
  const body = op.requestBody?.content?.["application/json"]?.schema;
  if (body) {
    const simplified = simplifySchema(body, resolveRef, 0);
    if (simplified.type === "object") {
      Object.assign(root.properties, simplified.properties ?? {});
      root.required.push(...(simplified.required ?? []));
      root.additionalProperties = simplified.additionalProperties ?? false;
    } else {
      root.properties.body = simplified;
      if (op.requestBody.required) root.required.push("body");
    }
  }
  for (const key of [...apiPath.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])) {
    root.properties[key] ??= { type: "string", minLength: 1, maxLength: 200 };
    root.required.push(key);
  }
  root.required = [...new Set(root.required)];
  if (!root.required.length) delete root.required;
  return root;
}

function simplifySchema(raw, resolveRef, depth) {
  if (!raw || depth > 5) return {};
  const resolved = raw.$ref && resolveRef ? resolveRef(raw.$ref) : raw;
  if (!resolved) return {};
  if (resolved.allOf) return resolved.allOf.map((x) => simplifySchema(x, resolveRef, depth + 1)).reduce((a, b) => ({ ...a, ...b, properties: { ...(a.properties ?? {}), ...(b.properties ?? {}) }, required: [...new Set([...(a.required ?? []), ...(b.required ?? [])])] }), {});
  const out = {};
  for (const key of ["type", "enum", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "additionalProperties"]) if (resolved[key] !== undefined) out[key] = resolved[key];
  if (resolved.properties) out.properties = Object.fromEntries(Object.entries(resolved.properties).map(([key, value]) => [key, simplifySchema(value, resolveRef, depth + 1)]));
  if (resolved.required) out.required = resolved.required;
  if (resolved.items) out.items = simplifySchema(resolved.items, resolveRef, depth + 1);
  return out;
}

function jsonPointer(spec, ref) {
  if (!ref?.startsWith("#/")) return undefined;
  return ref.slice(2).split("/").reduce((value, key) => value?.[key.replaceAll("~1", "/").replaceAll("~0", "~")], spec);
}

function writeMarketplace(name, records) {
  const inventory = records.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)));
  const policyFile = path.join(outPolicies, `${name}-read-allowlist.json`);
  const approvedIds = fs.existsSync(policyFile) && !process.argv.includes("--approve-reviewed")
    ? new Set(JSON.parse(fs.readFileSync(policyFile, "utf8")).map((method) => method.method_id))
    : null;
  if (!approvedIds && !process.argv.includes("--approve-reviewed")) throw new Error(`${name}: initial allowlist creation requires --approve-reviewed after semantic review`);
  const allow = inventory.filter((r) => r.admission !== 'denied' && (r.classification === "READ" || r.classification === "SEMANTIC_READ_JOB") && (!approvedIds || approvedIds.has(r.method_id)))
    .map(({ classification, ...r }) => r);
  fs.writeFileSync(path.join(outInventory, `${name}-operations.json`), JSON.stringify(inventory, null, 2) + "\n");
  fs.writeFileSync(policyFile, JSON.stringify(allow, null, 2) + "\n");
  const counts = Object.fromEntries(["READ", "SEMANTIC_READ_JOB", "WRITE", "DESTRUCTIVE"].map((k) => [k, inventory.filter((r) => r.classification === k).length]));
  console.log(JSON.stringify({ marketplace: name, total: inventory.length, ...counts, allowed: allow.length, new_methods_denied: approvedIds ? inventory.filter((r) => !approvedIds.has(r.method_id)).length : 0, unclassified: inventory.filter((r) => !r.classification).length }));
}

function generateOzon() {
  if(process.argv.includes('--approve-reviewed')) throw new Error('Ozon bulk approval is disabled: review explicit contract decisions instead');
  const files = ["ozon-seller-openapi.json", "ozon-performance-openapi.json"];
  const pinned=readJson(path.join(root,'policies','ozon-source-pins.json'));
  const records = [];
  for (const fileName of files) {
    const file = path.join(refs, "ozon-api", "references", fileName);
    const bytes = fs.readFileSync(file);
    if(sha256(bytes)!==pinned[fileName]) throw new Error(`Ozon source drift: ${fileName}; prepare full official diff and semantic review before repinning`);
    const spec = JSON.parse(bytes);
    for (const [apiPath, item] of Object.entries(spec.paths ?? {})) {
      for (const method of ["get", "post", "put", "patch", "delete"]) {
        const op = item[method];
        if (!op) continue;
        const base = { http_method: method, path: apiPath, operationId: op.operationId, summary: op.summary, description: op.description, tags: op.tags, op, resolveRef: (ref) => jsonPointer(spec, ref),
          endpoint_group: fileName.includes("performance") ? "performance" : domainOf(op.tags, apiPath) };
        records.push(record(base, `${spec.info?.version ?? "unknown"};${fileName}`, sha256(bytes), classify(base)));
      }
    }
  }
  writeMarketplace("ozon", applyOzonOverrides(records));
}

function generateYm() {
  const repo = path.join(refs, "yandex-official");
  const version = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const sourceHash = crypto.createHash("sha256");
  const records = [];
  const dir = path.join(repo, "openapi", "paths");
  const rootSpec = YAML.parse(fs.readFileSync(path.join(repo, "openapi", "openapi.yaml"), "utf8"));
  const pathByFile = new Map(Object.entries(rootSpec.paths ?? {}).map(([apiPath, item]) => [path.basename(item?.$ref ?? ""), apiPath]));
  for (const fileName of fs.readdirSync(dir).filter((x) => x.endsWith(".yaml")).sort()) {
    const bytes = fs.readFileSync(path.join(dir, fileName));
    sourceHash.update(bytes);
    const doc = YAML.parse(bytes.toString("utf8"));
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = doc?.[method];
      if (!op) continue;
      const apiPath = pathByFile.get(fileName) ?? ("/" + fileName.replace(/\.yaml$/, "").replaceAll("_", "/")
        .replace(/\/businessId(?=\/|$)/g, "/{businessId}").replace(/\/campaignId(?=\/|$)/g, "/{campaignId}")
        .replace(/\/orderId(?=\/|$)/g, "/{orderId}").replace(/\/reportId(?=\/|$)/g, "/{reportId}")
        .replace(/\/shipmentId(?=\/|$)/g, "/{shipmentId}").replace(/\/returnId(?=\/|$)/g, "/{returnId}")
        .replace(/\/outletId(?=\/|$)/g, "/{outletId}").replace(/\/itemId(?=\/|$)/g, "/{itemId}"));
      const scopes = op["x-auth-scopes"] ?? [];
      const currentFile = path.join(dir, fileName);
      const resolveRef = (ref) => {
        if (!ref || ref.startsWith("#/")) return undefined;
        const relative = ref.split("#")[0];
        const candidates = [
          path.resolve(path.dirname(currentFile), relative),
          path.resolve(repo, "openapi", "components", "parameters", relative),
          path.resolve(repo, "openapi", "components", "schemas", relative),
        ];
        const target = candidates.find((candidate) => candidate.startsWith(path.join(repo, "openapi")) && fs.existsSync(candidate));
        return target ? YAML.parse(fs.readFileSync(target, "utf8")) : undefined;
      };
      const base = { http_method: method, path: apiPath, operationId: op.operationId, summary: op.summary, description: op.description, tags: op.tags, op, resolveRef,
        endpoint_group: domainOf(op.tags, apiPath) };
      records.push(record(base, `official-git:${version}`, "pending", classify({ ...base, readOnlyScope: scopes.some((s) => String(s).endsWith(":read-only")) })));
    }
  }
  const digest = sourceHash.digest("hex");
  for (const r of records) r.source_hash = digest;
  writeMarketplace("ym", records);
}

function generateWb() {
  const repo = path.join(refs, "wb-mcp-server");
  const file = path.join(repo, "wb_mcp", "client.py");
  const bytes = fs.readFileSync(file);
  const text = bytes.toString("utf8");
  const starts = [...text.matchAll(/^    async def ([a-zA-Z0-9_]+)\(/gm)];
  const records = [];
  const groupMap = { _statistics: "statistics", _analytics: "analytics", _content: "content", _prices: "prices", _common: "common", _advert: "advertising", _feedbacks: "feedbacks", _questions: "questions", _returns: "returns", _tariffs: "tariffs", _buyer_chat: "chats", _documents: "documents", _marketplace: "marketplace", _supplies: "supplies" };
  for (let i = 0; i < starts.length; i++) {
    const name = starts[i][1];
    const block = text.slice(starts[i].index, starts[i + 1]?.index ?? text.length);
    const summary = block.match(/"""([^\n]+)/)?.[1]?.trim() ?? name;
    const signature = block.match(/^    async def [a-zA-Z0-9_]+\(([\s\S]*?)\)\s*->/m)?.[1] ?? "";
    const properties = {};
    const required = [];
    for (const rawParam of signature.replace(/\n/g, " ").split(",")) {
      const token = rawParam.trim();
      if (!token || token === "self" || token.startsWith("*")) continue;
      const [left, defaultValue] = token.split("=", 2);
      const [paramName, annotation = ""] = left.split(":", 2).map((x) => x.trim());
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(paramName)) continue;
      properties[paramName] = /list\[|tuple\[|set\[/i.test(annotation) ? { type: "array", maxItems: 1000 } :
        /dict\[|mapping\[/i.test(annotation) ? { type: "object" } : /\b(int|float)\b/i.test(annotation) ? { type: "number" } :
        /\bbool\b/i.test(annotation) ? { type: "boolean" } : { type: ["string", "null"], maxLength: 4000 };
      if (defaultValue === undefined && !/None/.test(annotation)) required.push(paramName);
    }
    const calls = [...block.matchAll(/self\._(get|post|put|patch|delete)(?:_with_params)?\(self\.(\_[a-z_]+),\s*f?["']([^"']+)["']/g)];
    for (const call of calls) {
      const method = call[1].toUpperCase();
      const group = groupMap[call[2]] ?? call[2].replace(/^_/, "");
      const apiPath = call[3].replace(/\{[^}]+\}/g, (m) => m);
      const suffix = `${method}_${apiPath}`.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
      const base = { http_method: method, path: apiPath, operationId: `wb_${name}_${suffix}`, summary, description: summary, tags: [group], endpoint_group: group, op: {},
        input_schema: { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false } };
      records.push(record(base, "DeviceIngineering/wb-mcp-server@b0e208318d5099a7d429d7e4bcf745352ca20771", sha256(bytes), classify(base)));
    }
  }
  const unique = [...new Map(records.map((r) => [`${r.http_method} ${r.path}`, r])).values()];
  writeMarketplace("wb", unique);
}

generateOzon();
if (!process.argv.includes('--ozon-only')) { generateWb(); generateYm(); }
