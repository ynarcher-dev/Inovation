// admin 현황 목록 공용 필터 툴바.
// 가입신청·기업목록·예산사용·예산승인 등 "검색 + 드롭다운 + 기간" 패턴을 한 곳으로 모은다.
//
// config = {
//   search?:    { placeholder, ariaLabel },
//   selects?:   [{ key, ariaLabel, options: [{ value, label }] }],  // 정적 옵션. 동적 옵션은 fillFilterSelect 로 추가.
//   dateRange?: { fromLabel, toLabel },
// }
//
// 사용 흐름:
//   container.innerHTML = FilterToolbar(config);
//   fillFilterSelect(container, "program", programOptions);   // 필요 시 동적 옵션 주입
//   bindFilters(container, render);                            // 값 변경 시 render 호출
//   const { term, selects, dateFrom, dateTo } = readFilters(container);

import { escapeHtml } from "../../utils.js";

function optionsHtml(options) {
  return (options || [])
    .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
    .join("");
}

export function FilterToolbar(config = {}) {
  const { search, selects = [], dateRange } = config;

  const searchHtml = search
    ? `<input
        class="list-toolbar-search"
        type="search"
        data-filter-search
        placeholder="${escapeHtml(search.placeholder || "")}"
        aria-label="${escapeHtml(search.ariaLabel || "검색")}"
      >`
    : "";

  const selectsHtml = selects
    .map((sel) => `
      <select
        class="list-toolbar-select"
        data-filter-select="${escapeHtml(sel.key)}"
        aria-label="${escapeHtml(sel.ariaLabel || sel.key)}"
      >${optionsHtml(sel.options)}</select>
    `)
    .join("");

  const dateHtml = dateRange
    ? `
      <div class="list-toolbar-date">
        <input type="date" data-filter-date-from aria-label="${escapeHtml(dateRange.fromLabel || "시작일")}">
        <span class="list-toolbar-date-sep">~</span>
        <input type="date" data-filter-date-to aria-label="${escapeHtml(dateRange.toLabel || "종료일")}">
      </div>`
    : "";

  return `<div class="list-toolbar">${searchHtml}${selectsHtml}${dateHtml}</div>`;
}

// 동적 옵션(참가 사업 등)을 특정 select 에 append 한다.
export function fillFilterSelect(root, key, options) {
  const select = root.querySelector(`[data-filter-select="${key}"]`);
  if (!select) return;
  select.insertAdjacentHTML("beforeend", optionsHtml(options));
}

// 현재 필터 값 스냅샷. select 미선택값은 "all" 로 본다.
export function readFilters(root) {
  const selects = {};
  root.querySelectorAll("[data-filter-select]").forEach((el) => {
    selects[el.dataset.filterSelect] = el.value || "all";
  });
  return {
    term: (root.querySelector("[data-filter-search]")?.value || "").trim().toLowerCase(),
    selects,
    dateFrom: root.querySelector("[data-filter-date-from]")?.value || "",
    dateTo: root.querySelector("[data-filter-date-to]")?.value || "",
  };
}

// 입력/변경 시 onChange 를 호출하도록 이벤트를 바인딩한다.
export function bindFilters(root, onChange) {
  root.querySelector("[data-filter-search]")?.addEventListener("input", onChange);
  root.querySelectorAll("[data-filter-select]").forEach((el) => el.addEventListener("change", onChange));
  root.querySelector("[data-filter-date-from]")?.addEventListener("change", onChange);
  root.querySelector("[data-filter-date-to]")?.addEventListener("change", onChange);
}
