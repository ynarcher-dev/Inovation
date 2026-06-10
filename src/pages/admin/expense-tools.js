import { mountShell, showError, showToast } from "../../app.js";
import { requireRole } from "../../auth.js";
import {
  getEvidenceFilenameSettings,
  updateEvidenceFilenameSettings,
  getExpenseVoucherSettings,
  updateExpenseVoucherSettings,
} from "../../api.js";
import { openEvidenceFilenameModal } from "../../components/EvidenceFilenameModal.js";
import { openExpenseVoucherSettingsModal } from "../../components/ExpenseVoucherModal.js";

// 증빙 파일명 정리기 / 지출결의 정리기 설정 페이지.
//   두 설정 모두 서버의 단일 행(id=1) 싱글톤이라 특정 기업에 묶이지 않는다.
//   기업 상세(company-detail)에서 이 페이지로 분리했다.
try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    const evidenceCurrentEl = document.querySelector("[data-evidence-current]");
    const voucherCurrentEl = document.querySelector("[data-voucher-current]");

    // 증빙 파일명 규칙. 로드 실패해도 기본값으로 동작하게 한다.
    let evidenceFilenameSettings = { template: "{기업명}_{첨부분류}_{신청제목}_{총액}", seq_start: 1, seq_pad: 1 };
    try {
      evidenceFilenameSettings = await getEvidenceFilenameSettings();
    } catch (e) {
      // 설정 조회 실패 시 기본값 유지.
    }
    // 지출결의서 텍스트 양식. 로드 실패해도 기본 양식으로 동작.
    let voucherSettings = { template: "" };
    try {
      voucherSettings = await getExpenseVoucherSettings();
    } catch (e) {
      // 설정 조회 실패 시 기본값(빈 template → 엔진이 기본 양식 사용) 유지.
    }

    const renderCurrent = () => {
      if (evidenceCurrentEl) evidenceCurrentEl.textContent = evidenceFilenameSettings.template || "-";
      if (voucherCurrentEl) {
        const firstLine = (voucherSettings.template || "").split("\n").find((line) => line.trim());
        voucherCurrentEl.textContent = firstLine ? `${firstLine} …` : "기본 양식";
      }
    };
    renderCurrent();

    document.getElementById("btn-evidence-filename-rule")?.addEventListener("click", () => {
      openEvidenceFilenameModal({
        settings: evidenceFilenameSettings,
        sampleExpense: null, // 기업 컨텍스트가 없으므로 모달 내장 샘플로 미리보기.
        onSave: async (payload) => {
          evidenceFilenameSettings = await updateEvidenceFilenameSettings(payload);
          renderCurrent();
          showToast("증빙 파일명 규칙을 저장했습니다.", { type: "success" });
        },
      });
    });

    document.getElementById("btn-voucher-rule")?.addEventListener("click", () => {
      openExpenseVoucherSettingsModal({
        settings: voucherSettings,
        sampleExpense: null,
        onSave: async (payload) => {
          voucherSettings = await updateExpenseVoucherSettings(payload);
          renderCurrent();
          showToast("지출결의 양식을 저장했습니다.", { type: "success" });
        },
      });
    });
  }
} catch (error) {
  showError(error);
}
