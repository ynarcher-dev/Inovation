import { redirectByRole, signIn } from "../auth.js";
import { showError } from "../app.js";

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const email = document.querySelector("#email").value;
    const password = document.querySelector("#password").value;
    await signIn(email, password);
    const { getCurrentUser } = await import("../auth.js");
    const user = await getCurrentUser();
    redirectByRole(user.profile.role);
  } catch (error) {
    showError(error);
  }
});
