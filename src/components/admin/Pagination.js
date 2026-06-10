// admin 현황 목록 공용 페이지네이션.
// FilterToolbar 와 짝을 이뤄, 이미 받아 둔 전체 배열을 클라이언트에서 페이지 단위로 끊어 렌더한다.
// (서버 페이지네이션이 아니므로 getAdminDashboard 가 한 번에 받은 데이터에만 적용된다.)
//
// 사용 흐름:
//   const list = createPaginatedList({
//     container: document.querySelector("[data-all-signups]"),
//     renderItems: (rows) => SignupTable(rows),   // 받은 페이지 행만 표로
//     onRendered: bindRowNavigation,              // 페이지 전환마다 재바인딩(행 클릭/액션 버튼)
//   });
//   list.setItems(filtered);                       // 필터 결과 갱신 → 1페이지로 리셋 후 렌더

export const DEFAULT_PAGE_SIZE = 20;

// 표시할 페이지 번호 목록. 1·마지막·현재±1 만 남기고 사이는 "…" 로 접는다.
function pageWindow(page, totalPages) {
  const keep = new Set([1, totalPages, page, page - 1, page + 1]);
  const sorted = [...keep].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

// page(1-base)·pageSize·total → 컨트롤 바 HTML. 한 페이지 이하면 "" (바 숨김).
// 숫자만 보간하므로 escapeHtml 불필요.
export function Pagination({ page, pageSize, total }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return "";
  const btn = (target, label, { disabled = false, active = false } = {}) =>
    `<button type="button" class="page-btn${active ? " active" : ""}"`
    + (disabled ? " disabled" : ` data-page-to="${target}"`)
    + (active ? ' aria-current="page"' : "")
    + `>${label}</button>`;
  const numbers = pageWindow(page, totalPages)
    .map((p) => (p === "…" ? `<span class="page-ellipsis">…</span>` : btn(p, p, { active: p === page })))
    .join("");
  return `
    <div class="list-pagination">
      <span class="page-total">총 ${total.toLocaleString()}건</span>
      <div class="page-controls">
        ${btn(page - 1, "이전", { disabled: page <= 1 })}
        ${numbers}
        ${btn(page + 1, "다음", { disabled: page >= totalPages })}
      </div>
    </div>
  `;
}

// 페이지 상태(page) 보유 + 슬라이스 + 렌더 + 재바인딩을 캡슐화한 컨트롤러.
export function createPaginatedList({ container, pageSize = DEFAULT_PAGE_SIZE, renderItems, onRendered }) {
  let items = [];
  let page = 1;

  const draw = () => {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    if (page > totalPages) page = totalPages; // 마지막 페이지에서 삭제 등으로 줄어든 경우 보정
    const start = (page - 1) * pageSize;
    const slice = items.slice(start, start + pageSize);
    container.innerHTML = renderItems(slice) + Pagination({ page, pageSize, total: items.length });
    container.querySelectorAll("[data-page-to]").forEach((b) => {
      b.addEventListener("click", () => {
        page = Number(b.dataset.pageTo);
        draw();
      });
    });
    onRendered?.(container);
  };

  return {
    // 필터/검색 결과가 바뀌면 호출. 항상 1페이지로 리셋한다(결과가 줄어드는 경우 대비).
    setItems(next) {
      items = next || [];
      page = 1;
      draw();
    },
  };
}
