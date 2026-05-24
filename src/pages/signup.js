import { showError } from "../app.js";
import { signUpFounder } from "../auth.js";

document.querySelector("#signup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const resultTarget = document.querySelector("[data-result]");
  resultTarget.hidden = true;

  try {
    const result = await signUpFounder({
      email: document.querySelector("#email").value.trim(),
      password: document.querySelector("#password").value,
      company_name: document.querySelector("#company_name").value.trim(),
      founder_name: document.querySelector("#founder_name").value.trim(),
      business_number: document.querySelector("#business_number").value.trim(),
      phone: document.querySelector("#phone").value.trim(),
    });

    resultTarget.hidden = false;
    resultTarget.textContent = result.needsConfirmation
      ? result.message
      : "가입 신청이 완료되었습니다. 관리자 승인 후 지출 신청을 진행할 수 있습니다.";

    if (!result.needsConfirmation) {
      window.setTimeout(() => {
        window.location.href = "/founder/dashboard.html";
      }, 1200);
    }
  } catch (error) {
    showError(error);
  }
});
