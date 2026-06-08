// 증빙 파일명 정리기 — 파일명 규칙(템플릿) 엔진 (순수 모듈)
//   기업 상세 > 예산 사용 현황의 '증빙 다운로드' ZIP 안 파일명을, 관리자가 조립한
//   템플릿({기업명}_{첨부분류}_{신청제목}_{총액} 등)에 따라 생성한다.
//   - 모달 미리보기와 실제 다운로드(api.js)가 같은 규칙을 공유하도록 한 곳에 모은다.
//   - '신청' 토큰은 신청 1건 공통, '파일' 토큰은 첨부 파일마다 달라진다(순번/첨부분류/원본파일명).
import { sanitizeFilename } from "../upload-policy.js";
import { getStatusLabel } from "../status.js";

export const DEFAULT_EVIDENCE_FILENAME_SETTINGS = {
  template: "{기업명}_{첨부분류}_{신청제목}_{총액}",
  seq_start: 1,
  seq_pad: 1,
};

// 모달 칩 메타. scope: 'expense' = 신청 공통, 'file' = 첨부 파일별로 변함.
export const EVIDENCE_TOKENS = [
  { token: "{기업명}", label: "기업명", scope: "expense" },
  { token: "{신청제목}", label: "신청 제목", scope: "expense" },
  { token: "{예산항목}", label: "예산 항목", scope: "expense" },
  { token: "{공급가액}", label: "공급가액", scope: "expense" },
  { token: "{총액}", label: "총액", scope: "expense" },
  { token: "{상태}", label: "상태", scope: "expense" },
  { token: "{제출일}", label: "제출일", scope: "expense" },
  { token: "{첨부분류}", label: "첨부 분류", scope: "file" },
  { token: "{원본파일명}", label: "원본 파일명", scope: "file" },
  { token: "{순번}", label: "순번", scope: "file" },
];

// 금액: "1100000원"(콤마 없이 — 파일명 안전). 지출결의서 등 다른 모듈에서도 재사용.
export function formatAmount(value) {
  return `${Math.round(Number(value || 0)).toLocaleString("ko-KR").replace(/,/g, "")}원`;
}

// 제출일: "YYYYMMDD". 파싱 불가/없으면 빈 문자열.
export function formatYmd(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${m}${day}`;
}

// 원본 파일명에서 확장자를 뗀 stem.
function stripExtension(filename) {
  const name = String(filename || "");
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

// 신청 객체에서 '신청' 토큰 값 묶음을 만든다(파일과 무관한 공통 값).
//   expense: 지출 행(company_name/title/amount_supply/total_amount/status/submitted_at/
//            business_plan_item_label/budget_category 등). 일부 누락돼도 안전하게 처리.
export function buildExpenseTokenValues(expense = {}) {
  const total =
    expense.total_amount != null
      ? expense.total_amount
      : Number(expense.amount_supply || 0) + Number(expense.vat_amount || 0);
  return {
    "{기업명}": expense.company_name || expense.companyName || "기업",
    "{신청제목}": expense.title || "지출",
    "{예산항목}": expense.business_plan_item_label || expense.budget_category || "",
    "{공급가액}": formatAmount(expense.amount_supply),
    "{총액}": formatAmount(total),
    "{상태}": expense.status ? getStatusLabel(expense.status) : "",
    "{제출일}": formatYmd(expense.submitted_at || expense.created_at),
  };
}

// 파일 단위 토큰 값({첨부분류}/{원본파일명}/{순번}).
//   file: { attachLabel, originalFilename }, index: 0-based, seqConfig: { seq_start, seq_pad }
export function buildFileTokenValues(file = {}, index = 0, seqConfig = {}) {
  const start = Number.isFinite(Number(seqConfig.seq_start)) ? Number(seqConfig.seq_start) : 1;
  const pad = Math.max(1, Number(seqConfig.seq_pad) || 1);
  const seq = String(start + index).padStart(pad, "0");
  return {
    "{첨부분류}": file.attachLabel || "증빙서류",
    "{원본파일명}": stripExtension(file.originalFilename),
    "{순번}": seq,
  };
}

// 템플릿 문자열의 토큰을 값으로 치환해 파일명 stem(확장자 제외)을 만든다.
//   values: { "{토큰}": "값" } 병합 맵. 각 값은 경로 구분자/제어문자를 제거해 끼운다.
//   결과 전체에 한 번 더 sanitizeFilename 을 적용해 안전성을 보장한다.
export function renderEvidenceFilename(template, values = {}) {
  const tpl = String(template || DEFAULT_EVIDENCE_FILENAME_SETTINGS.template);
  const out = tpl.replace(/\{[^{}]+\}/g, (match) => {
    if (!(match in values)) return ""; // 알 수 없는 토큰은 빈 문자열로
    return sanitizeFilename(String(values[match] ?? "")).replace(/^file$/, "");
  });
  const cleaned = sanitizeFilename(out);
  return cleaned === "file" ? "" : cleaned; // 전부 비면 호출처에서 기본명으로 대체
}
