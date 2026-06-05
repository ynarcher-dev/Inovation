import { STORAGE_KEYS, load, save } from "./storage.mock.js";

const DEFAULT_AI_SETTINGS = {
  enabled: false,
  provider: "openai",
  model: "",
  api_key_configured: false,
  api_key_hint: "",
  edge_function_url: "",
  memo: "",
  updated_at: null,
  updated_by: null,
};

export function mockGetAiSettings() {
  return { ...DEFAULT_AI_SETTINGS, ...load(STORAGE_KEYS.AI_SETTINGS, {}) };
}

export function mockUpdateAiSettings(input = {}, userId = null) {
  const current = mockGetAiSettings();
  const next = {
    ...current,
    enabled: input.enabled !== undefined ? !!input.enabled : current.enabled,
    provider: input.provider !== undefined ? String(input.provider || "").trim() : current.provider,
    model: input.model !== undefined ? String(input.model || "").trim() : current.model,
    api_key_configured: input.api_key_configured !== undefined ? !!input.api_key_configured : current.api_key_configured,
    api_key_hint: input.api_key_hint !== undefined ? String(input.api_key_hint || "").trim() : current.api_key_hint,
    edge_function_url: input.edge_function_url !== undefined ? String(input.edge_function_url || "").trim() : current.edge_function_url,
    memo: input.memo !== undefined ? String(input.memo || "").trim() : current.memo,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  save(STORAGE_KEYS.AI_SETTINGS, next);
  return next;
}
