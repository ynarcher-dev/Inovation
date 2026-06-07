import { redirectByRole, signIn } from "../../auth.js";
import { showError, showToast } from "../../app.js";
import { enhancePasswordInputs } from "../../password-toggle.js";

// 비밀번호 입력에 눈 아이콘 토글을 추가한다.
enhancePasswordInputs();

// 회원가입 직후 이동해 온 경우, 가입 안내 메시지를 토스트로 보여준다.
const signupNotice = sessionStorage.getItem("signup:notice");
if (signupNotice) {
  sessionStorage.removeItem("signup:notice");
  showToast(signupNotice, { type: "success", duration: 6000 });
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const email = document.querySelector("#email").value;
    const password = document.querySelector("#password").value;
    // "로그인 유지" 체크: 체크 시 브라우저를 닫아도 유지, 미체크 시 탭 종료하면 로그아웃.
    const remember = document.querySelector("#remember-me")?.checked || false;
    await signIn(email, password, remember);
    const { getCurrentUser } = await import("../../auth.js");
    const user = await getCurrentUser();
    redirectByRole(user.profile.role);
  } catch (error) {
    // 가입 승인 대기/반려로 로그인이 차단된 경우도 브라우저 alert 대신 인라인 안내로 표시한다(§7.2).
    showError(error);
  }
});
