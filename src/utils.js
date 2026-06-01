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
