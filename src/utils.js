export function formatCurrency(value) {
  const number = Number(value || 0);
  return `${number.toLocaleString("ko-KR")}원`;
}

export function formatNumber(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("ko-KR");
}

export function parseNumber(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

// 천단위 콤마 입력란을 재포맷하면서 커서 위치를 보존한다.
// 커서 앞의 '숫자 개수'를 기준으로 다시 배치하므로, 값 중간을 수정해도 커서가 끝으로 튀지 않는다.
export function formatMoneyInput(input) {
  const digitsBeforeCaret = (input.value.slice(0, input.selectionStart).match(/\d/g) || []).length;
  input.value = formatNumber(input.value);
  let pos = 0;
  let seen = 0;
  while (pos < input.value.length && seen < digitsBeforeCaret) {
    if (/\d/.test(input.value[pos])) seen += 1;
    pos += 1;
  }
  input.setSelectionRange(pos, pos);
}

export function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  // 순수 날짜값("YYYY-MM-DD")은 시각 정보가 없으므로 날짜만 표시하고,
  // 타임스탬프(시각 포함)는 시·분까지 노출한다.
  const isDateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  const options = isDateOnly
    ? { dateStyle: "medium" }
    : { dateStyle: "medium", timeStyle: "short" };
  return new Intl.DateTimeFormat("ko-KR", options).format(date);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
