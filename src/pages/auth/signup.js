import { showError } from "../../app.js";
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

    // 가입 결과 안내 메시지. 이메일 확인이 켜져 있으면 인증 안내를 함께 보여준다.
    const message = result.needsConfirmation
      ? "가입 신청이 완료되었습니다. 메일로 보낸 인증 링크로 이메일 확인을 마친 뒤 로그인해 주세요."
      : "가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.";

    // 로그인 페이지에서 안내 토스트로 이어 보여주기 위해 메시지를 전달하고 이동한다.
    sessionStorage.setItem("signup:notice", message);
    window.location.href = "./login.html";
  } catch (error) {
    showError(error);
  }
});

