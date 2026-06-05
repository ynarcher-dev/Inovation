import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Provider = "openai" | "google" | "anthropic";

const DEFAULT_MODEL_BY_PROVIDER: Record<Provider, string> = {
  openai: "gpt-4o-mini",
  google: "gemini-2.5-flash",
  anthropic: "claude-3-5-sonnet-latest",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeProvider(value: unknown): Provider {
  const provider = String(value || "openai").toLowerCase();
  if (provider === "google" || provider === "anthropic" || provider === "openai") return provider;
  throw new Error(`지원하지 않는 provider입니다: ${provider}`);
}

function parseJsonObject(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeReviewResult(value: any, rawText: string) {
  // JSON 파싱이 실패(value 없음)하면 rawText 는 잘린/깨진 JSON 원문일 수 있다.
  // 이 경우 원문을 그대로 summary 로 노출하면 화면에 깨진 JSON 이 보이므로,
  // 안내 문구로 대체하고 원문은 raw_text 로만 남긴다.
  const parsedSummary = String(value?.summary || "").trim();
  const summary = value
    ? parsedSummary
    : "AI 응답을 구조화하지 못했습니다. (원문은 raw_text 참고) 다시 시도하거나 관리자가 직접 검토해주세요.";
  return {
    summary,
    decision_suggestion: String(value?.decision_suggestion || "needs_review").trim(),
    risks: Array.isArray(value?.risks) ? value.risks : [],
    revision_comment_draft: String(value?.revision_comment_draft || "").trim(),
    raw_text: rawText,
  };
}

function buildPrompt(payload: unknown) {
  const instructions = [
    "너는 정부지원사업/창업지원사업 예산 심사 보조 AI다.",
    "관리자의 최종 판단을 대체하지 말고, 구조화된 검토 의견만 제공한다.",
    "감액 불가 위반, 총액/항목 증감의 이상점, 보완요청 코멘트에 필요한 근거를 점검한다.",
    "반드시 JSON 객체만 반환한다.",
    "스키마: {\"summary\":\"string\",\"decision_suggestion\":\"approve|revision_requested|needs_review\",\"risks\":[{\"level\":\"info|warning|danger\",\"title\":\"string\",\"detail\":\"string\"}],\"revision_comment_draft\":\"string\"}",
  ].join("\n");

  const input = [
    "다음 예산 제출안을 검토해줘.",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");

  return { instructions, input };
}

// 제출 서류(영수증/견적서/계약서 등) 한 건을 신청 정보·검토 기준과 대조해 검토하는 프롬프트.
function buildDocumentReviewPrompt(payload: any) {
  const ctx = payload?.context || {};
  const expense = ctx.expense || {};
  const criteria = String(payload?.criteria_text || "").trim();
  const batchCount = Number(payload?.batch_count || 1);

  const instructions = [
    "너는 정부지원사업/창업지원사업의 사업비 지출 증빙 서류를 검토하는 보조 AI다.",
    "관리자의 최종 승인/반려를 대체하지 말고, 제출 전 보완이 필요한지 1차 판단만 한다.",
    "첨부된 문서(영수증/견적서/계약서 등)의 실제 내용을 읽고, 아래 신청 정보와 대조해 금액·거래처명·발행일자 등 핵심 정합성을 점검한다.",
    "문서에서 확인되지 않는 항목은 추정하지 말고 '확인되지 않음'으로 처리한다.",
    criteria
      ? "추가로, 아래 '검토 기준'에 적힌 항목도 함께 확인한다."
      : "공통 검토 기준 문서가 없으므로 첨부서류명·신청 정보 기준으로 검토한다.",
    "반드시 JSON 객체만 반환한다.",
    "스키마: {\"status\":\"passed|needs_revision\",\"comment\":\"string\",\"findings\":[{\"label\":\"string\",\"ok\":boolean,\"detail\":\"string\"}]}",
    "comment 는 한국어로 작성한다. 보완이 필요하면 '보완 필요:' 로 시작해 문제 항목을 줄바꿈 목록으로, 문제가 없으면 '제출 가능:' 으로 시작해 간단한 확인 문구로 쓴다.",
    "확인되지 않거나 신청 정보와 불일치하는 항목이 하나라도 있으면 status 는 needs_revision 으로 한다.",
  ].join("\n");

  const lines = [
    `[검토 대상 서류] ${ctx.doc_title || payload?.document?.filename || "첨부파일"}`,
    "",
    "[지출 신청 정보]",
    `- 지출 제목: ${expense.title || "-"}`,
    `- 거래처명: ${expense.vendor_name || "-"}`,
    `- 거래처 사업자등록번호: ${expense.vendor_business_number || "-"}`,
    `- 공급가액: ${Number(expense.amount_supply || 0).toLocaleString()}원`,
    `- 부가세: ${Number(expense.vat_amount || 0).toLocaleString()}원`,
    `- 지출 예정일자: ${expense.expected_completion_date || "-"}`,
    `- 신청 내용: ${expense.purpose || "-"}`,
  ];
  if (criteria) lines.push("", "[검토 기준]", criteria);
  if (batchCount > 1) {
    lines.push("", `참고: 같은 단계 ${batchCount}건의 서류를 함께 검토 중이다. 금액·거래처·발행일자 정합성을 교차 확인하라.`);
  }
  lines.push("", "첨부된 문서를 위 정보와 대조해 검토 결과를 JSON 으로 반환해줘.");

  return { instructions, input: lines.join("\n") };
}

// 문서 검토 LLM 응답을 화면이 기대하는 형태로 정규화한다.
// 파싱 실패(value 없음) 시에는 '통과'로 오인하지 않도록 needs_revision 으로 둔다.
function normalizeDocumentReviewResult(value: any, rawText: string) {
  const status = String(value?.status || "").trim().toLowerCase() === "passed" ? "passed" : "needs_revision";
  const findings = Array.isArray(value?.findings) ? value.findings : [];
  let comment = String(value?.comment || "").trim();
  if (!comment) {
    comment = value
      ? (status === "passed" ? "제출 가능: 주요 항목이 확인되었습니다." : "보완 필요: 일부 항목을 확인할 수 없습니다.")
      : "AI 응답을 구조화하지 못했습니다. (원문은 raw_text 참고) 다시 시도하거나 관리자가 직접 검토해주세요.";
  }
  return {
    status,
    comment,
    findings: findings.map((f: any) => ({
      label: String(f?.label || "").trim(),
      ok: !!f?.ok,
      detail: String(f?.detail || "").trim(),
    })).filter((f: any) => f.label || f.detail),
    raw_text: rawText,
  };
}

function buildCriteriaPrompt() {
  const instructions = [
    "너는 정부지원사업/창업지원사업의 사업비 집행 지침 문서를 읽고, 제출 서류 심사에 활용할 '검토 기준'을 정리하는 AI다.",
    "첨부된 문서의 실제 내용만 근거로 한다. 문서에 없는 기준을 지어내지 않는다.",
    "지출 증빙·정산 서류를 검토할 때 확인해야 할 핵심 기준을 항목별로 간결하게 정리한다.",
    "각 기준은 번호를 붙인 한 줄 문장으로 작성한다. (예: '1. 거래처명이 사업자등록증과 일치하는지 확인한다.')",
    "표지/목차/연락처 등 심사와 무관한 내용은 제외한다.",
    "마크다운 표나 코드블록 없이, 번호 매긴 평문 텍스트만 출력한다. 다른 설명 문장은 덧붙이지 않는다.",
  ].join("\n");

  const input = "첨부된 문서에서 제출 서류 검토에 사용할 검토 기준을 추출해줘.";
  return { instructions, input };
}

function extractOpenAiText(response: any) {
  if (typeof response?.output_text === "string") return response.output_text;
  const parts: string[] = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function extractGeminiText(response: any) {
  const parts: string[] = [];
  for (const candidate of response?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (typeof part?.text === "string") parts.push(part.text);
    }
  }
  return parts.join("\n").trim();
}

function extractAnthropicText(response: any) {
  const parts: string[] = [];
  for (const block of response?.content || []) {
    if (block?.type === "text" && typeof block?.text === "string") parts.push(block.text);
  }
  return parts.join("\n").trim();
}

type ProviderDocument = { mime_type: string; data_base64: string; filename?: string };

function isImageMime(mime: string) {
  return /^image\//i.test(String(mime || ""));
}
type CallOptions = {
  document?: ProviderDocument | null;
  jsonOutput?: boolean;
  maxOutputTokens?: number;
};

async function callOpenAi(model: string, instructions: string, input: string, options: CallOptions = {}) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY Secret이 등록되어 있지 않습니다.");

  // 문서가 있으면 input_text + (이미지는 input_image / PDF는 input_file) 멀티파트로, 없으면 문자열로 보낸다.
  const filePart = options.document
    ? (isImageMime(options.document.mime_type)
        ? { type: "input_image", image_url: `data:${options.document.mime_type};base64,${options.document.data_base64}` }
        : {
            type: "input_file",
            filename: options.document.filename || "document",
            file_data: `data:${options.document.mime_type};base64,${options.document.data_base64}`,
          })
    : null;
  const userInput = filePart
    ? [{ role: "user", content: [{ type: "input_text", text: input }, filePart] }]
    : input;

  const body: Record<string, unknown> = {
    model,
    instructions,
    input: userInput,
    max_output_tokens: options.maxOutputTokens || 1600,
  };
  // JSON 강제 모드: 모델이 마크다운 펜스/설명 없이 순수 JSON 객체만 반환하도록 한다.
  if (options.jsonOutput) body.text = { format: { type: "json_object" } };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "OpenAI API 호출에 실패했습니다.");
  return extractOpenAiText(data);
}

async function callGemini(model: string, instructions: string, input: string, options: CallOptions = {}) {
  const apiKey = Deno.env.get("GOOGLE_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_API_KEY Secret이 등록되어 있지 않습니다.");

  const parts: unknown[] = [{ text: input }];
  if (options.document) {
    parts.push({ inline_data: { mime_type: options.document.mime_type, data: options.document.data_base64 } });
  }

  const generationConfig: Record<string, unknown> = { maxOutputTokens: options.maxOutputTokens || 1600 };
  if (options.jsonOutput) generationConfig.responseMimeType = "application/json";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: instructions }] },
      contents: [{ role: "user", parts }],
      generationConfig,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini API 호출에 실패했습니다.");
  }
  return extractGeminiText(data);
}

async function callAnthropic(model: string, instructions: string, input: string, options: CallOptions = {}) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY Secret이 등록되어 있지 않습니다.");

  const content: unknown[] = [{ type: "text", text: input }];
  if (options.document) {
    // 이미지는 image 블록, PDF 등은 document 블록으로 보낸다.
    content.push({
      type: isImageMime(options.document.mime_type) ? "image" : "document",
      source: { type: "base64", media_type: options.document.mime_type, data: options.document.data_base64 },
    });
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxOutputTokens || 1600,
      system: instructions,
      messages: [{ role: "user", content }],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "Anthropic API 호출에 실패했습니다.");
  }
  return extractAnthropicText(data);
}

async function callProvider(provider: Provider, model: string, instructions: string, input: string, options: CallOptions = {}) {
  if (provider === "google") return await callGemini(model, instructions, input, options);
  if (provider === "anthropic") return await callAnthropic(model, instructions, input, options);
  return await callOpenAi(model, instructions, input, options);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST 요청만 지원합니다." }, 405);

  try {
    const { type, provider: providerInput, model: modelInput, payload } = await req.json();
    const provider = normalizeProvider(providerInput);
    const model = String(modelInput || DEFAULT_MODEL_BY_PROVIDER[provider]).trim();

    // 운영사업 공통 AI 검토 기준 문서 → 검토 기준 텍스트 추출
    if (type === "criteria_extraction") {
      const document = payload?.document;
      if (!document?.data_base64) {
        return jsonResponse({ error: "추출할 문서 데이터가 없습니다." }, 400);
      }
      const { instructions, input } = buildCriteriaPrompt();
      const extractedText = await callProvider(provider, model, instructions, input, {
        document: {
          mime_type: String(document.mime_type || "application/pdf"),
          data_base64: String(document.data_base64),
          filename: String(document.filename || "document"),
        },
        maxOutputTokens: 2400,
      });
      return jsonResponse({
        provider,
        model,
        result: { extracted_text: String(extractedText || "").trim() },
      });
    }

    // 제출 서류 한 건을 신청 정보·검토 기준과 대조해 검토
    if (type === "document_review") {
      const document = payload?.document;
      if (!document?.data_base64) {
        return jsonResponse({ error: "검토할 문서 데이터가 없습니다." }, 400);
      }
      const { instructions, input } = buildDocumentReviewPrompt(payload);
      const rawText = await callProvider(provider, model, instructions, input, {
        document: {
          mime_type: String(document.mime_type || "application/pdf"),
          data_base64: String(document.data_base64),
          filename: String(document.filename || "document"),
        },
        jsonOutput: true,
        maxOutputTokens: 1600,
      });
      const parsed = parseJsonObject(rawText);
      return jsonResponse({
        provider,
        model,
        result: normalizeDocumentReviewResult(parsed, rawText),
      });
    }

    if (type !== "budget_submission_review") {
      return jsonResponse({ error: "지원하지 않는 AI 검토 타입입니다." }, 400);
    }
    if (!payload?.submission?.items?.length) {
      return jsonResponse({ error: "검토할 예산 제출 항목이 없습니다." }, 400);
    }

    const { instructions, input } = buildPrompt(payload);
    // summary + risks + revision_comment_draft 를 모두 담은 JSON 이 토큰 한도에서
    // 잘려 파싱이 깨지지 않도록 충분한 출력 토큰을 확보한다.
    const rawText = await callProvider(provider, model, instructions, input, {
      jsonOutput: true,
      maxOutputTokens: 3000,
    });
    const parsed = parseJsonObject(rawText);

    return jsonResponse({
      provider,
      model,
      result: normalizeReviewResult(parsed, rawText),
    });
  } catch (error) {
    return jsonResponse({ error: error?.message || "AI 검토 처리 중 오류가 발생했습니다." }, 500);
  }
});
