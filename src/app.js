import { signOut } from "./auth.js";
import { qsa } from "./utils.js";

export function mountShell() {
  qsa("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      await signOut();
      const isSubFolder = window.location.pathname.includes("/admin/") || window.location.pathname.includes("/founder/");
      window.location.href = isSubFolder ? "../login.html" : "login.html";
    });
  });
}

export function showError(error) {
  console.error(error);
  const target = document.querySelector("[data-error]");
  if (target) {
    target.hidden = false;
    target.textContent = error?.message || "처리 중 오류가 발생했습니다.";
  }
}

export function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

export async function runWithErrorBoundary(action, options = {}) {
  const button = options.button;
  try {
    if (button) button.disabled = true;
    return await action();
  } catch (error) {
    showError(error);
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

