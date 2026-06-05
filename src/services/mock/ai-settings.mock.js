import { STORAGE_KEYS, load, save } from "./storage.mock.js";

// AI 설정 보안 모델 (T9 / P1-03) — 자세한 내용은 docs/ai-settings-security.md
//  - source of truth 는 "서버"다. remote 전환 시 enabled/provider/model/last_checked 만 클라이언트로 내려준다.
//  - api_key_configured(Secret 등록 여부)는 서버가 판정한다. 클라이언트가 임의로 true 로 만들 수 없다.
//  - api_key_hint 에는 절대 실제 키나 키 일부를 저장하지 않는다(표시는 "등록됨/미등록"만).
//  - provider/model 은 서버 allowlist(Edge Function MODEL_ALLOWLIST)로 최종 검증된다.
//  현재(mock 단계)는 이 모델을 시뮬레이션하며, 아래 필드는 하위호환을 위해 유지한다.
const DEFAULT_AI_SETTINGS = {
  enabled: false,
  provider: "openai",
  model: "",
  api_key_configured: false, // 서버 권위값(remote 전환 시 서버 응답으로 덮어씀)
  api_key_hint: "",          // 표시용 문구만. 실제 키/키 일부 저장 금지
  edge_function_url: "",
  memo: "",
  last_checked: null,        // 마지막 연결 테스트 시각(서버 판정 결과)
  updated_at: null,
  updated_by: null,
};

// 클라이언트가 신뢰해서 보관/표시해도 되는 필드(나머지는 서버 권위값).
export const CLIENT_SAFE_AI_FIELDS = ["enabled", "provider", "model", "last_checked"];

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
