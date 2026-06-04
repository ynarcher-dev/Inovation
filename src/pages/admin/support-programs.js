import { mountShell, runWithErrorBoundary, showError } from "../../app.js";
import { createSupportProgram, deleteSupportProgram, getSupportPrograms, updateSupportProgram } from "../../api.js";
import { requireRole, verifyCurrentPassword } from "../../auth.js";
import { escapeHtml } from "../../utils.js";

function PasswordConfirmModal() {
  return `
    <div class="modal-backdrop" data-admin-password-modal>
      <form class="modal" data-admin-password-form>
        <div class="modal-header">
          <div>
            <h2>삭제 확인</h2>
            <p class="muted">신규사업을 비활성화하려면 관리자 비밀번호를 입력해야 합니다.</p>
          </div>
          <button class="modal-close" type="button" data-admin-password-cancel aria-label="닫기">x</button>
        </div>
        <p class="notice">경고: 삭제하면 기존 가입 기업, 가입 신청, 이후 데이터 조회에 문제가 생길 수 있습니다. 이미 연결된 데이터의 화면 표시에서 사라질 수 있습니다.</p>
        <div class="field">
          <label for="admin-delete-password">관리자 비밀번호</label>
          <input id="admin-delete-password" type="password" autocomplete="current-password" required>
        </div>
        <div class="actions">
          <button class="button danger" type="submit">비활성화</button>
          <button class="button secondary" type="button" data-admin-password-cancel>취소</button>
        </div>
      </form>
    </div>
  `;
}

function requestAdminPassword() {
  return new Promise((resolve) => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = PasswordConfirmModal();
    document.body.append(wrapper);

    const modal = wrapper.querySelector("[data-admin-password-modal]");
    const form = wrapper.querySelector("[data-admin-password-form]");
    const input = wrapper.querySelector("#admin-delete-password");

    const close = (value) => {
      modal.remove();
      wrapper.remove();
      resolve(value);
    };

    wrapper.querySelectorAll("[data-admin-password-cancel]").forEach((button) => {
      button.addEventListener("click", () => close(null));
    });
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close(null);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      close(input.value);
    });
    input.focus();
  });
}

function SupportProgramList(items) {
  if (!items?.length) return `<p class="empty">등록된 신규사업이 없습니다.</p>`;
  return `
    <div class="manual-list">
      ${items.map((item) => `
        <div class="manual-link guidance-admin-row">
          <div class="program-edit-fields">
            <div class="program-name-code">
              <label>
                <span>신규사업명</span>
                <input value="${escapeHtml(item.name)}" data-program-name="${escapeHtml(item.id)}" aria-label="신규사업명">
              </label>
              <label>
                <span>사업코드</span>
                <input value="${escapeHtml(item.code || "-")}" aria-label="사업코드" readonly>
              </label>
            </div>
            <label>
              <span>표시 순서</span>
              <input type="number" value="${Number(item.sort_order || 0)}" data-program-sort="${escapeHtml(item.id)}" aria-label="표시 순서">
            </label>
          </div>
          <div class="actions">
            <button class="button small secondary icon-button" type="button" data-save-support-program="${escapeHtml(item.id)}" aria-label="저장" title="저장"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg></button>
            <button class="button small danger icon-button" type="button" data-delete-support-program="${escapeHtml(item.id)}" aria-label="삭제" title="삭제"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function getNextSortOrder(items) {
  const maxSortOrder = (items || []).reduce((max, item) => Math.max(max, Number(item.sort_order || 0)), 0);
  return maxSortOrder + 10;
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    let supportPrograms = await getSupportPrograms();

    const render = () => {
      document.querySelector("[data-support-program-list]").innerHTML = SupportProgramList(supportPrograms);
      document.querySelectorAll("[data-delete-support-program]").forEach((button) => {
        button.addEventListener("click", async () => {
          const confirmed = window.confirm(
            "경고: 신규사업을 삭제하면 기존 가입 기업, 가입 신청, 이후 데이터 조회에 문제가 생길 수 있습니다.\n\n" +
            "삭제 대신 비활성화 처리하지만 이미 연결된 데이터의 화면 표시가 사라질 수 있습니다.\n\n" +
            "계속하면 관리자 비밀번호 확인이 필요합니다."
          );
          if (!confirmed) return;

          const password = await requestAdminPassword();
          if (!password) return;

          await runWithErrorBoundary(async () => {
            await verifyCurrentPassword(password);
            await deleteSupportProgram(button.dataset.deleteSupportProgram);
            supportPrograms = await getSupportPrograms();
            render();
          }, { button });
        });
      });

      document.querySelectorAll("[data-save-support-program]").forEach((button) => {
        button.addEventListener("click", async () => {
          await runWithErrorBoundary(async () => {
            const id = button.dataset.saveSupportProgram;
            await updateSupportProgram(id, {
              name: document.querySelector(`[data-program-name="${CSS.escape(id)}"]`).value.trim(),
              sort_order: document.querySelector(`[data-program-sort="${CSS.escape(id)}"]`).value,
            });
            supportPrograms = await getSupportPrograms();
            render();
          }, { button });
        });
      });
    };

    document.querySelector("[data-support-program-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await runWithErrorBoundary(async () => {
        await createSupportProgram({
          name: document.querySelector("#support-program-name").value.trim(),
          sort_order: getNextSortOrder(supportPrograms),
        }, user.id);
        form.reset();
        supportPrograms = await getSupportPrograms();
        render();
      }, { button: event.submitter });
    });

    render();
  }
} catch (error) {
  showError(error);
}
