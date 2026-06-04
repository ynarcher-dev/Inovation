// 비밀번호 입력 옆에 눈 아이콘 토글 버튼을 붙여, 클릭하면 입력값을 그대로(평문) 볼 수 있게 한다.
// 회원가입·로그인·마이페이지 등 type="password" 입력이 있는 모든 화면에서 재사용한다.

// 눈 모양(현재 숨김 → 클릭하면 표시) / 눈에 빗금(현재 표시 → 클릭하면 숨김)
const ICON_SHOW = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_HIDE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

// 단일 비밀번호 입력에 토글 버튼을 추가한다(중복 적용 방지).
function enhanceOne(input) {
  if (input.closest(".password-field")) return; // 이미 처리됨

  const wrap = document.createElement("div");
  wrap.className = "password-field";
  input.parentNode.insertBefore(wrap, input);
  wrap.append(input);

  const button = document.createElement("button");
  button.type = "button"; // 폼 제출 방지
  button.className = "password-toggle";
  button.setAttribute("aria-label", "비밀번호 표시");
  button.innerHTML = ICON_SHOW;

  button.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password"; // text로 바꾸면 입력값이 그대로 보인다
    button.innerHTML = show ? ICON_HIDE : ICON_SHOW;
    button.setAttribute("aria-label", show ? "비밀번호 숨기기" : "비밀번호 표시");
  });

  wrap.append(button);
}

// root 하위의 모든 비밀번호 입력에 토글을 적용한다. 동적으로 추가된 모달 등에도 재호출 가능.
export function enhancePasswordInputs(root = document) {
  root.querySelectorAll('input[type="password"]').forEach(enhanceOne);
}
