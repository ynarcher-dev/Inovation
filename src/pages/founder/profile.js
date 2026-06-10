import { mountShell, setText, showError, showToast } from "../../app.js";
import { getFounderProfile } from "../../api.js";
import { requireRole, changePassword, deleteFounderAccount } from "../../auth.js";
import { enhancePasswordInputs } from "../../password-toggle.js";

const WITHDRAW_PHRASE = "회원탈퇴";

function WithdrawModal() {
  return `
    <div class="modal-backdrop" data-withdraw-modal>
      <form class="modal withdraw-modal" data-withdraw-form>
        <div class="modal-header">
          <div>
            <h2>회원 탈퇴</h2>
            <p class="muted">탈퇴하면 로그인 계정과 소속 정보가 삭제되며 되돌릴 수 없습니다.</p>
          </div>
          <button class="modal-close" type="button" data-withdraw-cancel aria-label="닫기">×</button>
        </div>
        <p class="notice">경고: 탈퇴 후에는 같은 계정으로 다시 로그인할 수 없습니다. 진행하려면 아래 확인 절차를 모두 완료해야 합니다.</p>
        <div class="field">
          <label for="withdraw-phrase">확인 문구 입력 — <span class="withdraw-phrase">${WITHDRAW_PHRASE}</span> 을(를) 정확히 입력하세요</label>
          <input id="withdraw-phrase" autocomplete="off" placeholder="${WITHDRAW_PHRASE}" required>
        </div>
        <div class="field">
          <label for="withdraw-password">비밀번호 확인</label>
          <input id="withdraw-password" type="password" autocomplete="current-password" required>
        </div>
        <div class="actions">
          <button class="button danger" type="submit" data-withdraw-submit disabled>회원 탈퇴</button>
          <button class="button secondary" type="button" data-withdraw-cancel>취소</button>
        </div>
      </form>
    </div>
  `;
}

function openWithdrawModal() {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = WithdrawModal();
  document.body.append(wrapper);

  // 탈퇴 모달의 비밀번호 입력에도 눈 아이콘 토글을 추가한다.
  enhancePasswordInputs(wrapper);

  const modal = wrapper.querySelector("[data-withdraw-modal]");
  const form = wrapper.querySelector("[data-withdraw-form]");
  const phraseInput = wrapper.querySelector("#withdraw-phrase");
  const passwordInput = wrapper.querySelector("#withdraw-password");
  const submit = wrapper.querySelector("[data-withdraw-submit]");

  const close = () => wrapper.remove();

  // 1차 블락: 확인 문구가 정확히 일치해야 제출 버튼이 활성화된다.
  phraseInput.addEventListener("input", () => {
    submit.disabled = phraseInput.value.trim() !== WITHDRAW_PHRASE;
  });

  wrapper.querySelectorAll("[data-withdraw-cancel]").forEach((button) => {
    button.addEventListener("click", close);
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (phraseInput.value.trim() !== WITHDRAW_PHRASE) return;

    submit.disabled = true;
    try {
      // 2차 블락: 비밀번호 확인 후에만 실제 탈퇴 처리.
      await deleteFounderAccount(passwordInput.value);
      showToast("회원 탈퇴가 완료되었습니다.", { type: "success" });
      setTimeout(() => { window.location.href = "../auth/login.html"; }, 800);
    } catch (error) {
      showToast(error?.message || "회원 탈퇴 중 오류가 발생했습니다.", { type: "danger" });
      submit.disabled = false;
    }
  });

  phraseInput.focus();
}

try {
  mountShell();
  // 비밀번호 변경 폼(현재/새/새 확인) 입력에 눈 아이콘 토글을 추가한다.
  enhancePasswordInputs();
  const user = await requireRole(["founder"]);
  if (user) {
    const { company } = await getFounderProfile();
    if (!company) throw new Error("연결된 기업 정보를 찾을 수 없습니다.");

    const ROLE_LABELS = { founder: "창업자", admin: "관리자" };
    const STATUS_META = {
      approved: { label: "승인 완료", className: "badge badge-success" },
      pending: { label: "승인 대기", className: "badge badge-warning" },
      rejected: { label: "반려", className: "badge badge-danger" },
    };
    const formatDate = (value) => {
      if (!value) return "-";
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? "-"
        : `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, "0")}. ${String(date.getDate()).padStart(2, "0")}.`;
    };

    const companyName = company.name || "-";
    const representativeName = company.representative_name || user.profile.name || "-";
    const roleLabel = ROLE_LABELS[user.profile.role] || user.profile.role || "-";

    // 헤더
    document.querySelector("[data-account-avatar]").textContent =
      (companyName !== "-" ? companyName : representativeName).trim().charAt(0) || "·";
    setText("[data-company-name]", companyName);
    setText("[data-account-subtitle]", `대표 ${representativeName} · ${roleLabel}`);

    // 기본 정보
    setText("[data-company-name-value]", companyName);
    setText("[data-representative-name]", representativeName);
    setText("[data-business-number]", company.business_number || "-");
    setText("[data-phone]", user.profile.phone || "-");

    // 계정 정보
    setText("[data-account-email]", user.email || "-");
    setText("[data-account-role]", roleLabel);
    setText("[data-account-joined]", formatDate(company.created_at));

    // 가입 승인 상태 (헤더 뱃지 + 계정 정보 인라인 뱃지)
    const status = STATUS_META[company.approval_status] || {
      label: company.approval_status || "-",
      className: "badge badge-neutral",
    };
    document.querySelectorAll("[data-account-status], [data-account-status-inline]").forEach((el) => {
      el.textContent = status.label;
      el.className = status.className;
    });

    // 비밀번호 변경 — 결과/오류는 얼럿으로 안내한다.
    document.querySelector("#password-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const current = document.querySelector("#current_password").value;
      const next = document.querySelector("#new_password").value;
      const confirm = document.querySelector("#new_password_confirm").value;
      // 서버 왕복 전에 규칙을 먼저 안내한다(6자 이상·현재 비밀번호와 다름·확인 일치).
      if (next.length < 6) {
        showToast("새 비밀번호는 6자 이상이어야 합니다.", { type: "warning" });
        document.querySelector("#new_password").focus();
        return;
      }
      if (next === current) {
        showToast("현재 비밀번호와 다른 비밀번호를 입력해 주세요.", { type: "warning" });
        document.querySelector("#new_password").focus();
        return;
      }
      if (next !== confirm) {
        showToast("새 비밀번호가 일치하지 않습니다.", { type: "warning" });
        document.querySelector("#new_password_confirm").focus();
        return;
      }

      const button = event.submitter;
      button.disabled = true;
      try {
        await changePassword(current, next);
        event.target.reset();
        showToast("비밀번호가 변경되었습니다.", { type: "success" });
      } catch (error) {
        showToast(error?.message || "비밀번호 변경 중 오류가 발생했습니다.", { type: "danger" });
      } finally {
        button.disabled = false;
      }
    });

    // 회원 탈퇴 (확인 문구 + 비밀번호 이중 확인)
    document.querySelector("[data-withdraw]").addEventListener("click", openWithdrawModal);
  }
} catch (error) {
  showError(error);
}
