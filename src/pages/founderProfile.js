import { mountShell, runWithErrorBoundary, showError } from "../app.js";
import { getFounderProfile, updateFounderProfile } from "../api.js";
import { requireRole } from "../auth.js";

try {
  mountShell();
  const user = await requireRole(["founder"]);
  if (user) {
    const { company } = await getFounderProfile();
    if (!company) throw new Error("연결된 기업 정보를 찾을 수 없습니다.");

    document.querySelector("#company_name").value = company.name || "";
    document.querySelector("#representative_name").value = company.representative_name || user.profile.name || "";
    document.querySelector("#business_number").value = company.business_number || "";
    document.querySelector("#phone").value = user.profile.phone || "";

    document.querySelector("#profile-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const resultTarget = document.querySelector("[data-result]");
      resultTarget.hidden = true;

      await runWithErrorBoundary(async () => {
        await updateFounderProfile({
          company_name: document.querySelector("#company_name").value.trim(),
          representative_name: document.querySelector("#representative_name").value.trim(),
          business_number: document.querySelector("#business_number").value.trim(),
          phone: document.querySelector("#phone").value.trim(),
        });
        resultTarget.hidden = false;
        resultTarget.textContent = "프로필이 저장되었습니다.";
      }, { button: event.submitter });
    });
  }
} catch (error) {
  showError(error);
}
