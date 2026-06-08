// 지출결의서 텍스트 템플릿 엔진 (순수 모듈)
//   기업 상세 > 예산 사용 현황의 '지출결의' 버튼이 만드는 텍스트(자사 결재시스템 복붙용)를,
//   관리자가 조립한 템플릿({기업명}_{거래처}_{총액}_{첨부목록} 등)으로 생성한다.
//   - 파일명 정리기와 달리 '읽는 문서'라 sanitize 하지 않고 원문 그대로 치환한다.
//   - {첨부목록} 은 파일명 정리기 규칙대로 만든 첨부 파일명을 줄바꿈으로 나열한다(값은 api.js가 채움).
import { buildExpenseTokenValues } from "./filename-template.js";
import { getStatusLabel } from "../status.js";

// 콤마 포함 금액: "1,100,000원" (읽는 문서용).
function formatAmountComma(value) {
  return `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
}

// 날짜: "YYYY-MM-DD". 파싱 불가/없으면 빈 문자열.
function formatYmdDash(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export const DEFAULT_VOUCHER_SETTINGS = {
  template: [
    "[지출결의서]",
    "",
    "기업명: {기업명}",
    "대표자: {대표자}",
    "건명: {신청제목}",
    "예산항목: {예산항목}",
    "거래처: {거래처} ({사업자번호})",
    "공급가액: {공급가액}",
    "부가세: {부가세}",
    "합계: {총액}",
    "지출사유: {적요}",
    "신청일: {제출일}",
    "",
    "[첨부서류]",
    "{첨부목록}",
  ].join("\n"),
};

// 모달 칩 메타. group 으로 묶어서 보여준다.
export const VOUCHER_TOKENS = [
  { token: "{기업명}", label: "기업명", group: "신청" },
  { token: "{대표자}", label: "대표자", group: "신청" },
  { token: "{신청제목}", label: "건명", group: "신청" },
  { token: "{예산항목}", label: "예산 항목", group: "신청" },
  { token: "{거래처}", label: "거래처", group: "신청" },
  { token: "{사업자번호}", label: "사업자번호", group: "신청" },
  { token: "{공급가액}", label: "공급가액", group: "금액" },
  { token: "{부가세}", label: "부가세", group: "금액" },
  { token: "{총액}", label: "총액(합계)", group: "금액" },
  { token: "{적요}", label: "지출사유", group: "기타" },
  { token: "{지출예정일}", label: "지출예정일", group: "기타" },
  { token: "{상태}", label: "상태", group: "기타" },
  { token: "{제출일}", label: "신청일", group: "기타" },
  { token: "{승인일}", label: "승인일", group: "기타" },
  { token: "{첨부목록}", label: "첨부 목록", group: "첨부" },
];

// 신청 1건의 텍스트 토큰 값 묶음({첨부목록} 제외 — 그건 api.js가 첨부를 모아 채운다).
//   expense: 지출 행(전 컬럼) + 호출부가 붙인 company_name/representative_name.
export function buildVoucherTokenValues(expense = {}) {
  // 공통 토큰({기업명}/{신청제목}/{예산항목}/{상태} 등)은 파일명 엔진 빌더를 재사용하되,
  // 금액·날짜는 '읽는 문서' 포맷으로 덮어쓰고, 지출결의 전용 토큰을 추가한다.
  const shared = buildExpenseTokenValues(expense);
  const total =
    expense.total_amount != null
      ? expense.total_amount
      : Number(expense.amount_supply || 0) + Number(expense.vat_amount || 0);
  return {
    ...shared,
    "{공급가액}": formatAmountComma(expense.amount_supply),
    "{부가세}": formatAmountComma(expense.vat_amount),
    "{총액}": formatAmountComma(total),
    "{제출일}": formatYmdDash(expense.submitted_at || expense.created_at),
    "{대표자}": expense.representative_name || "",
    "{거래처}": expense.vendor_name || "",
    "{사업자번호}": expense.vendor_business_number || "",
    "{적요}": expense.purpose || "",
    "{지출예정일}": formatYmdDash(expense.expected_completion_date),
    "{승인일}": formatYmdDash(expense.final_approved_at || expense.approved_at),
    "{상태}": expense.status ? getStatusLabel(expense.status) : "",
  };
}

// 템플릿 토큰을 값으로 치환해 텍스트를 만든다(파일명과 달리 sanitize 없음).
//   values: { "{토큰}": "값" } 맵. 미정의 토큰은 빈 문자열로.
export function renderVoucherText(template, values = {}) {
  const tpl = String(template || DEFAULT_VOUCHER_SETTINGS.template);
  return tpl.replace(/\{[^{}]+\}/g, (match) => (match in values ? String(values[match] ?? "") : ""));
}
