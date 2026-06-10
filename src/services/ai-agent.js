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
      throw aiError(data.error || "AI 검토 권한이 없습니다. 로그인이 풀렸을 수 있어요. 다시 로그인한 뒤 시도해주세요.", "auth");
    }
    if (response.status === 429) {
      throw aiError(data.error || "요청이 잠시 몰렸어요. 1~2분 후 다시 시도해주세요.", "rate_limit");
    }
    if (response.status === 413 || response.status === 415) {
      throw aiError(data.error || "이 파일은 검토할 수 없어요. PDF·이미지(JPG/PNG) 형식으로, 5MB 이하인지 확인해주세요.", "payload");
    }
    if (response.status === 502 || response.status === 503) {
      throw aiError(data.error || "AI가 지금 혼잡해요. 잠시 후 다시 시도하면 대부분 해결됩니다. 계속되면 AI 관리에서 모델을 바꿔보세요.", "overloaded");
    }
    throw aiError(data.error || "AI 검토를 완료하지 못했어요. 잠시 후 다시 시도해주세요. 계속되면 관리자에게 문의해주세요.", "request_failed");
  }
  throw aiError(lastData.error || "AI가 지금 혼잡해요. 잠시 후 다시 시도하면 대부분 해결됩니다. 계속되면 AI 관리에서 모델을 바꿔보세요.", "overloaded");
}

// Edge Function 이 JSON 파싱 실패 시 채우는 안내 문구. structured 플래그가 없는 (구버전) 응답을 위해 문자열로도 실패를 감지한다.
const AI_REVIEW_UNSTRUCTURED_SUMMARY =
  "AI 검토 결과를 정리하지 못했어요. 다시 시도하거나, 아래 원문을 참고해 직접 확인해주세요.";

function normalizeAiReviewResult(result = {}) {
  const risks = Array.isArray(result.risks) ? result.risks : [];
  const summary = String(result.summary || "").trim();
  // structured 플래그가 있으면 그대로, 없으면(구버전 Edge Function) 실패 안내 문구로 추론한다.
  const structured =
    typeof result.structured === "boolean" ? result.structured : summary !== AI_REVIEW_UNSTRUCTURED_SUMMARY;
  return {
    structured,
    summary,
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

function withExecutionMeta(result, data = {}) {
  return {
    ...result,
    provider: String(data.provider || "").trim(),
    model: String(data.model || "").trim(),
  };
}

export async function requestBudgetAiReview(input = {}) {
  const settings = await getAiSettings();
  if (!settings.enabled) {
    throw aiError("AI 검토 기능이 꺼져 있어요. [AI 관리]에서 기능을 켜주세요.", "disabled");
  }
  if (!settings.api_key_configured) {
    throw aiError("AI 연결이 아직 설정되지 않았어요. [AI 관리]에서 API Key 등록을 완료해주세요.", "no_key");
  }

  const url = resolveEdgeFunctionUrl(settings.edge_function_url);
  if (!url) {
    throw aiError("AI 서버 주소가 설정되지 않았어요. [AI 관리]에서 연결 주소를 입력해주세요.", "no_url");
  }

  const provider = settings.provider || "openai";
  const data = await callEdgeFunction(url, {
    type: "budget_submission_review",
    provider,
    model: settings.model || DEFAULT_MODEL_BY_PROVIDER[provider] || DEFAULT_MODEL_BY_PROVIDER.openai,
    payload: {
      ...input,
      review_instructions: settings.review_instructions || "",
    },
  });
  return {
    ...withExecutionMeta(normalizeAiReviewResult(data.result || data), data),
    review_instructions: settings.review_instructions || "",
  };
}

// 제출 서류(영수증/견적서 등) 한 건을 실제 LLM 으로 검토한다.
// 브라우저가 문서 바이트(base64)와 신청 정보·적용 기준을 Edge Function 으로 보내면,
// 설정된 provider 의 비전/문서 모델이 문서를 읽어 구조화된 검토 결과를 돌려준다.
export async function requestDocumentReview(input = {}) {
  const settings = await getAiSettings();
  if (!settings.enabled) {
    throw new Error("AI 검토 기능이 꺼져 있어요. [AI 관리]에서 기능을 켜주세요.");
  }
  if (!settings.api_key_configured) {
    throw new Error("AI 연결이 아직 설정되지 않았어요. [AI 관리]에서 API Key 등록을 완료해주세요.");
  }
  if (!input.fileBase64) {
    throw new Error("검토할 파일을 찾지 못했어요. 파일을 다시 첨부한 뒤 시도해주세요.");
  }

  const url = resolveEdgeFunctionUrl(settings.edge_function_url);
  if (!url) {
    throw new Error("AI 서버 주소가 설정되지 않았어요. [AI 관리]에서 연결 주소를 입력해주세요.");
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
      review_instructions: settings.review_instructions || "",
      batch_count: input.batchCount || 1,
    },
  });
  return {
    ...withExecutionMeta(normalizeDocumentReviewResult(data.result || data), data),
    review_instructions: settings.review_instructions || "",
  };
}

export async function requestDocumentBatchReview(input = {}) {
  const settings = await getAiSettings();
  if (!settings.enabled) {
    throw new Error("AI 검토 기능이 꺼져 있어요. [AI 관리]에서 기능을 켜주세요.");
  }
  if (!settings.api_key_configured) {
    throw new Error("AI 연결이 아직 설정되지 않았어요. [AI 관리]에서 API Key 등록을 완료해주세요.");
  }

  const documents = Array.isArray(input.documents) ? input.documents : [];
  if (!documents.length) throw new Error("검토할 파일을 찾지 못했어요. 파일을 다시 첨부한 뒤 시도해주세요.");

  const url = resolveEdgeFunctionUrl(settings.edge_function_url);
  if (!url) {
    throw new Error("AI 서버 주소가 설정되지 않았어요. [AI 관리]에서 연결 주소를 입력해주세요.");
  }

  const provider = settings.provider || "openai";
  const data = await callEdgeFunction(url, {
    type: "document_batch_review",
    provider,
    model: settings.model || DEFAULT_MODEL_BY_PROVIDER[provider] || DEFAULT_MODEL_BY_PROVIDER.openai,
    payload: {
      documents: documents.map((item) => ({
        id: item.id,
        filename: item.filename || "document",
        mime_type: item.mimeType || "application/pdf",
        data_base64: item.fileBase64,
        context: item.context || {},
      })),
      criteria_text: input.criteriaText || "",
      review_instructions: settings.review_instructions || "",
    },
  });

  const rawResults = Array.isArray(data.result?.results) ? data.result.results : [];
  return {
    provider: String(data.provider || "").trim(),
    model: String(data.model || "").trim(),
    review_instructions: settings.review_instructions || "",
    raw_text: String(data.result?.raw_text || "").trim(),
    results: rawResults.map((item) => ({
      id: String(item.id || "").trim(),
      ...normalizeDocumentReviewResult(item),
    })),
  };
}

// 운영사업 공통 AI 검토 기준 문서에서 검토 기준 텍스트를 추출한다.
// 브라우저가 문서 바이트(base64)를 Edge Function 으로 보내면, 설정된 provider 의
// 모델이 문서를 읽어 구조화된 검토 기준 텍스트를 돌려준다.
export async function requestCriteriaExtraction(input = {}) {
  const settings = await getAiSettings();
  if (!settings.enabled) {
    throw new Error("AI 검토 기능이 꺼져 있어요. [AI 관리]에서 기능을 켜주세요.");
  }
  if (!settings.api_key_configured) {
    throw new Error("AI 연결이 아직 설정되지 않았어요. [AI 관리]에서 API Key 등록을 완료해주세요.");
  }
  if (!input.fileBase64) {
    throw new Error("읽어올 파일을 찾지 못했어요. 기준 문서를 다시 첨부해주세요.");
  }

  const url = resolveEdgeFunctionUrl(settings.edge_function_url);
  if (!url) {
    throw new Error("AI 서버 주소가 설정되지 않았어요. [AI 관리]에서 연결 주소를 입력해주세요.");
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
