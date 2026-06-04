import { mountShell, runWithErrorBoundary, showError } from "../../app.js";
import {
  createAdminAccount,
  deleteAdminAccount,
  getAdminAccounts,
  resetAdminPassword,
  updateAdminPrograms,
  getSupportPrograms,
} from "../../api.js";
import { requireRole, verifyCurrentPassword } from "../../auth.js";
import { escapeHtml } from "../../utils.js";

const ROLE_LABELS = { super_admin: "슈퍼관리자", admin: "일반관리자" };
const ROLE_TONES = { super_admin: "badge-info", admin: "badge-neutral" };

// 본인 비밀번호로 민감한 동작(삭제·비밀번호 초기화)을 재확인하는 모달.
function PasswordConfirmModal(title, description, confirmLabel) {
  return `
    <div class="modal-backdrop" data-admin-password-modal>
      <form class="modal" data-admin-password-form>
        <div class="modal-header">
          <div>
            <h2>${escapeHtml(title)}</h2>
            <p class="muted">${escapeHtml(description)}</p>
          </div>
          <button class="modal-close" type="button" data-admin-password-cancel aria-label="닫기">x</button>
        </div>
        <div class="field">
          <label for="admin-confirm-password">내 비밀번호</label>
          <input id="admin-confirm-password" type="password" autocomplete="current-password" required>
        </div>
        <div class="actions">
          <button class="button danger" type="submit">${escapeHtml(confirmLabel)}</button>
          <button class="button secondary" type="button" data-admin-password-cancel>취소</button>
        </div>
      </form>
    </div>
  `;
}

function requestAdminPassword(title, description, confirmLabel) {
  return new Promise((resolve) => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = PasswordConfirmModal(title, description, confirmLabel);
    document.body.append(wrapper);

    const modal = wrapper.querySelector("[data-admin-password-modal]");
    const form = wrapper.querySelector("[data-admin-password-form]");
    const input = wrapper.querySelector("#admin-confirm-password");

    const close = (value) => {
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

// 일반관리자가 관리할 참가 사업을 체크박스로 배정하는 모달. 선택한 program_id 배열(또는 취소 시 null) 반환.
function ProgramAssignModal(adminName, programs, selectedIds) {
  const set = new Set(selectedIds);
  const list = programs.length
    ? programs.map((p) => `
        <label style="display:flex;align-items:center;gap:8px;font-weight:500;padding:4px 0">
          <input type="checkbox" value="${escapeHtml(p.id)}" ${set.has(p.id) ? "checked" : ""}>
          <span>${escapeHtml(p.name)}</span>
        </label>
      `).join("")
    : `<p class="muted">등록된 참가 사업이 없습니다.</p>`;
  return `
    <div class="modal-backdrop" data-assign-modal>
      <form class="modal" data-assign-form>
        <div class="modal-header">
          <div>
            <h2>사업 권한 배정</h2>
            <p class="muted">${escapeHtml(adminName)} 관리자가 관리할 참가 사업을 선택합니다.</p>
          </div>
          <button class="modal-close" type="button" data-assign-cancel aria-label="닫기">x</button>
        </div>
        <div class="field" style="gap:4px">${list}</div>
        <div class="actions">
          <button class="button" type="submit">저장</button>
          <button class="button secondary" type="button" data-assign-cancel>취소</button>
        </div>
      </form>
    </div>
  `;
}

function requestProgramAssignment(adminName, programs, selectedIds) {
  return new Promise((resolve) => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = ProgramAssignModal(adminName, programs, selectedIds);
    document.body.append(wrapper);

    const modal = wrapper.querySelector("[data-assign-modal]");
    const form = wrapper.querySelector("[data-assign-form]");

    const close = (value) => {
      wrapper.remove();
      resolve(value);
    };

    wrapper.querySelectorAll("[data-assign-cancel]").forEach((button) => {
      button.addEventListener("click", () => close(null));
    });
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close(null);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const ids = Array.from(form.querySelectorAll('input[type="checkbox"]:checked')).map((i) => i.value);
      close(ids);
    });
  });
}

// canManage: 슈퍼관리자만 삭제·비밀번호 초기화·사업 권한 버튼을 본다.
function AdminList(items, currentUserId, canManage, programNameById) {
  if (!items?.length) return `<p class="empty">등록된 관리자가 없습니다.</p>`;
  const superCount = items.filter((item) => item.role === "super_admin").length;
  return `
    <div class="admin-list-rows">
      ${items.map((item) => {
        const isSelf = item.user_id === currentUserId;
        const isSuper = item.role === "super_admin";
        const isLastSuper = isSuper && superCount <= 1;
        const programsHtml = isSuper
          ? `<span class="admin-chip">전체 사업</span>`
          : (item.program_ids?.length
              ? item.program_ids.map((id) => `<span class="admin-chip">${escapeHtml(programNameById.get(id) || id)}</span>`).join("")
              : `<span class="muted">미배정</span>`);
        return `
        <div class="admin-row">
          <span class="badge ${ROLE_TONES[item.role] || "badge-neutral"}">${escapeHtml(ROLE_LABELS[item.role] || item.role)}</span>
          <span class="admin-name">${escapeHtml(item.name || "(이름 없음)")}${isSelf ? ` <span class="muted">(나)</span>` : ""}</span>
          <span class="admin-email muted">${escapeHtml(item.email)}</span>
          <span class="admin-programs">${programsHtml}</span>
          <span class="admin-actions">
            ${canManage && !isSuper ? `<button class="button small secondary" type="button" data-assign-admin="${escapeHtml(item.user_id)}">사업 권한</button>` : ""}
            ${canManage && !isSelf ? `<button class="button small secondary icon-button" type="button" data-reset-admin="${escapeHtml(item.user_id)}" aria-label="비밀번호 초기화" title="비밀번호 초기화"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 4v6h6"></path><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg></button>` : ""}
            ${canManage && !isSelf && !isLastSuper ? `<button class="button small danger icon-button" type="button" data-delete-admin="${escapeHtml(item.user_id)}" aria-label="삭제" title="삭제"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>` : ""}
          </span>
        </div>
        `;
      }).join("")}
    </div>
  `;
}

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    const canManage = user.profile.role === "super_admin";
    let admins = await getAdminAccounts();
    // 슈퍼관리자는 전체 사업을 받아 칩/배정 모달에 사용한다(일반관리자는 배정 버튼이 없음).
    const programs = await getSupportPrograms();
    const programNameById = new Map(programs.map((p) => [p.id, p.name]));

    const render = () => {
      document.querySelector("[data-admin-list]").innerHTML = AdminList(admins, user.id, canManage, programNameById);

      document.querySelectorAll("[data-delete-admin]").forEach((button) => {
        button.addEventListener("click", async () => {
          const targetId = button.dataset.deleteAdmin;
          const target = admins.find((item) => item.user_id === targetId);
          if (!window.confirm(`관리자 "${target?.name || target?.email}" 계정을 삭제합니다. 계속하면 내 비밀번호 확인이 필요합니다.`)) return;

          const password = await requestAdminPassword("관리자 삭제", "삭제를 진행하려면 내 비밀번호를 입력해 주세요.", "삭제");
          if (!password) return;

          await runWithErrorBoundary(async () => {
            await verifyCurrentPassword(password);
            await deleteAdminAccount(user.id, targetId);
            admins = await getAdminAccounts();
            render();
          }, { button });
        });
      });

      document.querySelectorAll("[data-reset-admin]").forEach((button) => {
        button.addEventListener("click", async () => {
          const targetId = button.dataset.resetAdmin;
          const target = admins.find((item) => item.user_id === targetId);
          const newPassword = window.prompt(`"${target?.name || target?.email}" 계정의 새 비밀번호 (6자 이상)`);
          if (newPassword === null) return;

          const password = await requestAdminPassword("비밀번호 초기화", "초기화를 진행하려면 내 비밀번호를 입력해 주세요.", "초기화");
          if (!password) return;

          await runWithErrorBoundary(async () => {
            await verifyCurrentPassword(password);
            await resetAdminPassword(targetId, newPassword);
            window.alert("비밀번호가 초기화되었습니다.");
          }, { button });
        });
      });

      document.querySelectorAll("[data-assign-admin]").forEach((button) => {
        button.addEventListener("click", async () => {
          const targetId = button.dataset.assignAdmin;
          const target = admins.find((item) => item.user_id === targetId);
          const result = await requestProgramAssignment(target?.name || target?.email, programs, target?.program_ids || []);
          if (result === null) return;

          await runWithErrorBoundary(async () => {
            await updateAdminPrograms(targetId, result);
            admins = await getAdminAccounts();
            render();
          }, { button });
        });
      });
    };

    document.querySelector("[data-admin-create-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await runWithErrorBoundary(async () => {
        await createAdminAccount({
          name: document.querySelector("#admin-name").value.trim(),
          email: document.querySelector("#admin-email").value.trim(),
          password: document.querySelector("#admin-password").value,
        });
        form.reset();
        admins = await getAdminAccounts();
        render();
      }, { button: event.submitter });
    });

    render();
  }
} catch (error) {
  showError(error);
}
