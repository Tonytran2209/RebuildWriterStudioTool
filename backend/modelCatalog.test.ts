import test from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_CONFIG, DEFAULT_MODELS, MODEL_CATALOG_VERSION, MODEL_REPLACEMENTS, mergeWithLatestModelCatalog } from "../src/lib/defaultData.ts"

const ids = new Set(DEFAULT_MODELS.map(m => m.id))

test("every replacement points at a model in the catalog", () => {
  for (const [from, to] of Object.entries(MODEL_REPLACEMENTS)) {
    assert.ok(ids.has(to), `${from} → ${to} is not in the catalog`)
    assert.ok(!ids.has(from), `${from} is replaced but still listed`)
  }
  assert.equal(ids.size, DEFAULT_MODELS.length, "duplicate model ids")
})

test("a gate on a retired model moves to its successor, which stays enabled", () => {
  const old = { ...DEFAULT_CONFIG, stepConfigs: { ...DEFAULT_CONFIG.stepConfigs, 4: { ...DEFAULT_CONFIG.stepConfigs[4], modelId: "claude-opus-5" } },
    models: [{ ...DEFAULT_MODELS[0], id: "claude-opus-5", provider: "anthropic" as const, enabled: true, pricing: { inputUsdPerMillion: 5, outputUsdPerMillion: 25 } }] }
  const merged = mergeWithLatestModelCatalog(old)
  assert.equal(merged.stepConfigs[4].modelId, "claude-opus-5-5")
  const opus = merged.models.find(m => m.id === "claude-opus-5-5")!
  assert.equal(opus.enabled, true)
  assert.equal(opus.pricing?.inputUsdPerMillion, 4, "an older catalog version takes the new list price")
  assert.equal(merged.modelCatalogVersion, MODEL_CATALOG_VERSION)
  assert.equal(mergeWithLatestModelCatalog({ ...old, stepConfigs: { 4: { ...old.stepConfigs[4], modelId: "gone-model" } } }).stepConfigs[4].modelId, "")
})

test("manual price edits survive within the same catalog version", () => {
  const edited = mergeWithLatestModelCatalog(DEFAULT_CONFIG)
  edited.models = edited.models.map(m => m.id === "gpt-6.2-sol" ? { ...m, pricing: { inputUsdPerMillion: 9, outputUsdPerMillion: 9 } } : m)
  assert.equal(mergeWithLatestModelCatalog(edited).models.find(m => m.id === "gpt-6.2-sol")!.pricing?.inputUsdPerMillion, 9)
})

test("DeepSeek V4 Flash keeps its API id; configs saved with the bad deepseek-flash id move back", () => {
  assert.ok(DEFAULT_MODELS.some(m => m.id === "deepseek-v4-flash"))
  assert.ok(!DEFAULT_MODELS.some(m => m.id === "deepseek-flash"))
  const config = { ...DEFAULT_CONFIG, models: DEFAULT_CONFIG.models.map(m => m.id === "deepseek-v4-flash" ? { ...m, id: "deepseek-flash", enabled: true } : m), stepConfigs: { ...DEFAULT_CONFIG.stepConfigs, 1: { ...DEFAULT_CONFIG.stepConfigs[1], modelId: "deepseek-flash" } } }
  const merged = mergeWithLatestModelCatalog(config)
  assert.equal(merged.stepConfigs[1].modelId, "deepseek-v4-flash")
  assert.equal(merged.models.find(m => m.id === "deepseek-v4-flash")?.enabled, true)
})
