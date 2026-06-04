import { redirectByRole, signIn } from "../../auth.js";
import { showError } from "../../app.js";
import { enhancePasswordInputs } from "../../password-toggle.js";

// 비밀번호 입력에 눈 아이콘 토글을 추가한다.
enhancePasswordInputs();

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const email = document.querySelector("#email").value;
    const password = document.querySelector("#password").value;
    await signIn(email, password);
    const { getCurrentUser } = await import("../../auth.js");
    const user = await getCurrentUser();
    redirectByRole(user.profile.role);
  } catch (error) {
    if (error?.blocked) {
      window.alert(error.message); // 가입 승인 대기/반려: 얼럿으로 안내하고 로그인 차단
    } else {
      showError(error);
    }
  }
});
