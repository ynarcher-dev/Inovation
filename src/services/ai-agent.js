import { CONFIG } from "../config.js";
import { getAiSettings } from "./supabase-api.js";

const DEFAULT_MODEL_BY_PROVIDER = {
  openai: "gpt-4o-mini",
  google: "gemini-2.5-flash",
  anthropic: "claude-3-5-sonnet-latest",
};

// AI 호출 실패 시 원인을 식별할 수 있도록 code 를 붙인 Error 를 만든다.
// (예: 테스트 화면이 code 별로 사용자 친화 카피를 매핑한다)
function aiError(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

function joinUrl(base, path) {
  return `${String(base || "").replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
}

function resolveEdgeFunctionUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/functions/")) return joinUrl(CONFIG.supabaseUrl, raw);
  if (raw.startsWith("functions/")) return joinUrl(CONFIG.supabaseUrl, raw);
  return raw;
}

// Edge Function 호출용 인증 토큰을 가져온다.
// 실제 Supabase Auth 전환 시 세션 access_token 을 반환하도록 window.APP_CONFIG.getSupabaseAccessToken
// 를 주입한다. mock 인증 단계에서는 토큰이 없어 null 이며, 이 경우 AI 기능은 서버에서 401 로 차단된다(의도된 동작).
async function getEdgeAccessToken() {
  try {
    const provider = window.APP_CONFIG?.getSupabaseAccessToken;
    if (typeof provider === "function") return (await provider()) || null;
  } catch (_) {
    /* 토큰 조회 실패는 무시하고 미인증으로 처리한다 */
  }
  try {
    const supabase = window.supabaseClient;
    if (supabase) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) return session.access_token;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

// ai-review Edge Function 공용 호출 헬퍼.
// 인증 토큰을 첨부하고, status 별 사용자 메시지를 일관되게 처리한다.
async function callEdgeFunction(url, body) {
  const token = await getEdgeAccessToken();
  const headers = { "Content-Type": "application/json", apikey: CONFIG.supabaseAnonKey };
  if (token) headers.Authorization = `Bearer ${token}`;

  // provider 측 일시 과부하(502/503, "high demand" 등)는 짧게 대기 후 재시도한다.
  const MAX_ATTEMPTS = 3;
  let lastData = {};
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    lastData = data;

    if ((response.status === 502 || response.status === 503) && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw aiError(data.error || "AI 기능을 사용할 권한이 없습니다. 관리자 계정으로 로그인했는지 확인해주세요.", "auth");
    }
    if (response.status === 429) {
      throw aiError(data.error || "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", "rate_limit");
    }
    if (response.status === 413 || response.status === 415) {
      throw aiError(data.error || "첨부 파일 형식 또는 크기가 허용되지 않습니다.", "payload");
    }
    if (response.status === 502 || response.status === 503) {
      throw aiError(data.error || "AI provider가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.", "overloaded");
    }
    throw aiError(data.error || "AI 요청에 실패했습니다.", "request_failed");
  }
  throw aiError(lastData.error || "AI provider가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.", "overloaded");
}

function normalizeAiReviewResult(result = {}) {
  const risks = Array.isArray(result.risks) ? result.risks : [];
  return {
    summary: String(result.summary || "").trim(),
    decision_suggestion: String(result.decision_suggestion || "needs_review").trim(),
    risks: risks.map((risk) => ({
      level: String(risk.level || "info").trim(),
      title: String(risk.title || "").trim(),
      detail: String(risk.detail || "").trim(),
    })).filter((risk) => risk.title || risk.detail),
    revision_comment_draft: String(result.revision_comment_draft || "").trim(),
    raw_text: String(result.raw_text || "").trim(),
  };
}

function normalizeDocumentReviewResult(result = {}) {
  const status = String(result.status || "").trim().toLowerCase() === "passed" ? "passed" : "needs_revision";
  const findings = Array.isArray(result.findings) ? result.findings : [];
  return {
    status,
    comment: String(result.comment || "").trim(),
    findings: findings.map((f) => ({
      label: String(f.label || "").trim(),
      ok: !!f.ok,
      detail: String(f.detail || "").trim(),
    })).filter((f) => f.label || f.detail),
    raw_text: String(result.raw_text || "").trim(),
  };
}

export async function requestBudgetAiReview(input = {}) {
  const settings = await getAiSettings();
  if (!settings.enabled) {
    throw aiError("AI 기능이 비활성화되어 있습니다. AI 관리에서 기능 상태를 켜주세요.", "disabled");
  }
  if (!settings.api_key_configured) {
    throw aiError("API Key 등록 상태가 미등록입니다. 선택한 provider의 Secret을 Supabase Edge Function에 등록한 뒤 AI 관리에서 등록됨으로 바꿔주세요.", "no_key");
  }

  const url = resolveEdgeFunctionUrl(settings.edge_function_url);
  if (!url) {
    throw aiError("Supabase Edge Function URL을 입력해주세요. 예: /functions/v1/ai-review", "no_url");
  }

  const provider = settings.provider || "openai";
  const data = await callEdgeFunction(url, {
    type: "budget_submission_review",
    provider,
    model: settings.model || DEFAULT_MODEL_BY_PROVIDER[provider] || DEFAULT_MODEL_BY_PROVIDER.openai,
    payload: input,
  });
  return normalizeAiReviewResult(data.result || data);
}

// 제출 서류(영수증/견적서 등) 한 건을 실제 LLM 으로 검토한다.
// 브라우저가 문서 바이트(base64)와 신청 정보·적용 기준을 Edge Function 으로 보내면,
// 설정된 provider 의 비전/문서 모델이 문서를 읽어 구조화된 검토 결과를 돌려준다.
export async function requestDocumentReview(input = {}) {
  const settings = await getAiSettings();
  if (!settings.enabled) {
    throw new Error("AI 기능이 비활성화되어 있습니다. AI 관리에서 기능 상태를 켜주세요.");
  }
  if (!settings.api_key_configured) {
    throw new Error("API Key 등록 상태가 미등록입니다. 선택한 provider의 Secret을 Supabase Edge Function에 등록한 뒤 AI 관리에서 등록됨으로 바꿔주세요.");
  }
  if (!input.fileBase64) {
    throw new Error("검토할 문서 데이터가 비어 있습니다.");
  }

  const url = resolveEdgeFunctionUrl(settings.edge_function_url);
  if (!url) {
    throw new Error("Supabase Edge Function URL을 입력해주세요. 예: /functions/v1/ai-review");
  }

  const provider = settings.provider || "openai";
  const data = await callEdgeFunction(url, {
    type: "document_review",
    provider,
    model: settings.model || DEFAULT_MODEL_BY_PROVIDER[provider] || DEFAULT_MODEL_BY_PROVIDER.openai,
    payload: {
      document: {
        filename: input.filename || "document",
        mime_type: input.mimeType || "application/pdf",
        data_base64: input.fileBase64,
      },
      context: input.context || {},
      criteria_text: input.criteriaText || "",
      batch_count: input.batchCount || 1,
    },
  });
  return normalizeDocumentReviewResult(data.result || data);
}

// 운영사업 공통 AI 검토 기준 문서에서 검토 기준 텍스트를 추출한다.
// 브라우저가 문서 바이트(base64)를 Edge Function 으로 보내면, 설정된 provider 의
// 모델이 문서를 읽어 구조화된 검토 기준 텍스트를 돌려준다.
export async function requestCriteriaExtraction(input = {}) {
  const settings = await getAiSettings();
  if (!settings.enabled) {
    throw new Error("AI 기능이 비활성화되어 있습니다. AI 관리에서 기능 상태를 켜주세요.");
  }
  if (!settings.api_key_configured) {
    throw new Error("API Key 등록 상태가 미등록입니다. 선택한 provider의 Secret을 Supabase Edge Function에 등록한 뒤 AI 관리에서 등록됨으로 바꿔주세요.");
  }
  if (!input.fileBase64) {
    throw new Error("추출할 문서 데이터가 비어 있습니다.");
  }

  const url = resolveEdgeFunctionUrl(settings.edge_function_url);
  if (!url) {
    throw new Error("Supabase Edge Function URL을 입력해주세요. 예: /functions/v1/ai-review");
  }

  const provider = settings.provider || "openai";
  const data = await callEdgeFunction(url, {
    type: "criteria_extraction",
    provider,
    model: settings.model || DEFAULT_MODEL_BY_PROVIDER[provider] || DEFAULT_MODEL_BY_PROVIDER.openai,
    payload: {
      document: {
        filename: input.filename || "criteria",
        mime_type: input.mimeType || "application/pdf",
        data_base64: input.fileBase64,
      },
    },
  });
  return String(data.result?.extracted_text || data.extracted_text || "").trim();
}
