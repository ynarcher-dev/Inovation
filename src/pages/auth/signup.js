import { showError, showToast } from "../../app.js";
import { getSupportPrograms } from "../../api.js";
import { signUpFounder } from "../../auth.js";
import { escapeHtml } from "../../utils.js";
import { enhancePasswordInputs } from "../../password-toggle.js";

// 비밀번호 규칙: 8자 이상 + 영문/숫자 모두 포함
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

function renderSupportPrograms(programs) {
  const select = document.querySelector("#support_program_id");
  select.innerHTML = programs.length
    ? `<option value="">참가 사업을 선택하세요</option>` + programs
      .map((program) => `<option value="${escapeHtml(program.id)}">${escapeHtml(program.name)}</option>`)
      .join("")
    : `<option value="">등록된 참가 사업이 없습니다</option>`;
}

try {
  renderSupportPrograms(await getSupportPrograms());
} catch (error) {
  showError(error);
}

// 비밀번호·비밀번호 확인 입력에 눈 아이콘 토글을 추가한다.
enhancePasswordInputs();

document.querySelector("#signup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const resultTarget = document.querySelector("[data-result]");
  resultTarget.hidden = true;

  const password = document.querySelector("#password").value;
  const passwordConfirm = document.querySelector("#password_confirm").value;
  const hint = document.querySelector("#password-hint");

  // 비밀번호 규칙 검증
  if (!PASSWORD_RULE.test(password)) {
    hint.classList.add("invalid");
    showError(new Error("비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다."));
    return;
  }
  hint.classList.remove("invalid");

  // 비밀번호 확인 일치 검증
  if (password !== passwordConfirm) {
    showError(new Error("비밀번호와 비밀번호 확인이 일치하지 않습니다."));
    return;
  }

  try {
    const result = await signUpFounder({
      email: document.querySelector("#email").value.trim(),
      password,
      company_name: document.querySelector("#company_name").value.trim(),
      support_program_id: document.querySelector("#support_program_id").value,
      founder_name: document.querySelector("#founder_name").value.trim(),
      business_number: document.querySelector("#business_number").value.trim(),
      phone: document.querySelector("#phone").value.trim(),
    });

    resultTarget.hidden = false;
    resultTarget.textContent = result.needsConfirmation
      ? result.message
      : "가입 신청이 완료되었습니다. 예산 및 비목 승인 후 지출 신청을 진행할 수 있습니다.";

    // 자동 리다이렉트 대신 결과 메시지를 충분히 보여주고, 명시적 '로그인으로 이동' 버튼을 노출한다(§7.1).
    showToast("가입 신청이 완료되었습니다.", { type: "success" });
    const loginLink = document.querySelector("[data-login-after-signup]");
    if (loginLink) loginLink.hidden = false;
    // 중복 제출을 막기 위해 제출 버튼은 숨긴다.
    document.querySelector("[data-signup-submit]")?.setAttribute("hidden", "");
  } catch (error) {
    showError(error);
  }
});

