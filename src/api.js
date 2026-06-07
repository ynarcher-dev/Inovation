import {
  initMockData,
  mockStoreFile,
  mockGetFile,
  mockGetCurrentUser,
  mockSignIn,
  mockSignUpFounder,
  mockSignOut,
  mockVerifyCurrentPassword,
  mockGetSupportPrograms,
  mockCreateSupportProgram,
  mockUpdateSupportProgram,
  mockDeleteSupportProgram,
  mockUpdateSupportProgramDescription,
  mockUpdateSupportProgramMemo,
  mockUpdateSupportProgramLevelLabels,
  mockGetSupportProgramBudgets,
  mockCreateSupportProgramBudget,
  mockUpdateSupportProgramBudget,
  mockDeleteSupportProgramBudget,
  mockGetAdminAccounts,
  mockCreateAdminAccount,
  mockDeleteAdminAccount,
  mockResetAdminPassword,
  mockUpdateAdminPrograms,
  mockGetAiSettings,
  mockUpdateAiSettings,
} from "./mockApi.js";

import {
  mockGetGuidanceItems,
  mockCreateGuidanceItem,
  mockUpdateGuidanceItem,
  mockDeleteGuidanceItem,
  mockGetFounderDashboard,
  mockSubmitFounderBudgetAllocations,
  mockGetAdminDashboard,
  mockGetAdminCompanyDetail,
  mockApproveCompany,
  mockRejectCompany,
  mockResetFounderPassword,
  mockReviewBudgetSubmission,
  mockUpsertCompanyBudgetAllocation,
  mockUpdateCompanySupportTotal,
  mockUpdateCompanyInternalMemo,
  mockGetExpenseDetail,
  mockCreateExpense,
  mockUpdateExpenseRequest,
  mockSubmitExpenseRequest,
  mockReviewExpenseRequest,
  mockUploadDocumentFile,
  mockMarkDocumentUploaded,
  mockDeleteUploadedFile,
  mockUpdateFounderProfile,
  mockUpdateBusinessPlan,
  mockGetBudgetDocumentRequirements,
  mockCreateBudgetDocumentRequirement,
  mockUpdateBudgetDocumentRequirement,
  mockDeactivateBudgetDocumentRequirement,
  mockDeleteBudgetDocumentRequirement,
  mockGetProgramAiCriteriaDocument,
  mockGetProgramAiCriteriaDocumentById,
  mockUploadProgramAiCriteriaDocument,
  mockSetProgramAiCriteriaExtractionStatus,
  mockSaveProgramAiCriteriaExtraction,
  mockDeleteProgramAiCriteriaDocument,
  mockGetExpenseDocumentRequirements,
  mockUploadExpenseDocumentFile,
  mockDeleteExpenseDocumentFile,
  mockGetAiDocumentReviewContext,
  mockGetAiDocumentReviewTargetByFile,
  mockSaveAiDocumentReviewResult,
  mockSetExpenseDocumentUserReview,
  mockValidateRequiredDocuments,
} from "./mockApi2.js";
import {
  requestBudgetAiReview as requestBudgetAiReviewFromEdge,
  requestDocumentReview as requestDocumentReviewFromEdge,
} from "./services/ai-agent.js";
import { parsePdfText } from "./services/pdf-parse.js";
import { isMockApi, isProduction } from "./config.js";
import { validateUploadFile, sanitizeFilename, getFileExtension } from "./domains/upload-policy.js";
import { uploadFileToS3, getS3DownloadUrl } from "./services/s3-storage.js";
import * as remote from "./services/supabase-api.js";
import { getCurrentUser } from "./auth.js";

// ----------------------------------------------------
// mock / remote API 경계 (P0-03 / T6)
// ----------------------------------------------------
// 현재 이 파일은 모든 데이터 API 를 mock service 로 export 한다.
// CONFIG.useMockApi(=isMockApi) 로 mock/remote 모드를 분기하며,
// 실제 Supabase 어댑터 구현 순서는 docs/api-migration.md 를 따른다.
//
// 운영(production) 배포인데 mock 모드면 데이터가 브라우저 저장소에만 남는
// 위험 상태이므로, 콘솔 + 화면 상단 배너로 경고한다.
function warnIfMockInProduction() {
  if (!isMockApi) return;
  // eslint 환경이 없으므로 console 직접 사용. 모든 모드에서 1회 안내.
  console.warn(
    "[api] mock 모드로 동작 중입니다. 데이터는 브라우저(localStorage/IndexedDB)에만 저장되며 서버에 반영되지 않습니다."
  );
  if (!isProduction || typeof document === "undefined") return;

  const show = () => {
    if (document.getElementById("mock-mode-banner")) return;
    const banner = document.createElement("div");
    banner.id = "mock-mode-banner";
    banner.textContent =
      "⚠️ 임시(mock) 데이터 모드 — 입력한 내용은 이 브라우저에만 저장되고 서버에 반영되지 않습니다.";
    banner.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:99999;background:#b91c1c;color:#fff;" +
      "font-size:13px;line-height:1.4;padding:8px 12px;text-align:center;font-weight:600;";
    document.body.appendChild(banner);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", show, { once: true });
  } else {
    show();
  }
}

// Initialize Mock Storage Data on load
if (isMockApi) initMockData();
warnIfMockInProduction();

// Export wrapped mock APIs
export const getSupportPrograms = isMockApi ? mockGetSupportPrograms : remote.getSupportPrograms;
export const createSupportProgram = isMockApi ? mockCreateSupportProgram : remote.createSupportProgram;
export const updateSupportProgram = isMockApi ? mockUpdateSupportProgram : remote.updateSupportProgram;
export const deleteSupportProgram = isMockApi ? mockDeleteSupportProgram : remote.deleteSupportProgram;
export const updateSupportProgramDescription = isMockApi ? mockUpdateSupportProgramDescription : remote.updateSupportProgramDescription;
export const updateSupportProgramMemo = isMockApi ? mockUpdateSupportProgramMemo : remote.updateSupportProgramMemo;
export const updateSupportProgramLevelLabels = isMockApi ? mockUpdateSupportProgramLevelLabels : remote.updateSupportProgramLevelLabels;

export const getSupportProgramBudgets = isMockApi ? mockGetSupportProgramBudgets : remote.getSupportProgramBudgets;
export const createSupportProgramBudget = isMockApi ? mockCreateSupportProgramBudget : remote.createSupportProgramBudget;
export const updateSupportProgramBudget = isMockApi ? mockUpdateSupportProgramBudget : remote.updateSupportProgramBudget;
export const deleteSupportProgramBudget = isMockApi ? mockDeleteSupportProgramBudget : remote.deleteSupportProgramBudget;

export const getAdminAccounts = isMockApi ? mockGetAdminAccounts : remote.getAdminAccounts;
export const createAdminAccount = isMockApi ? mockCreateAdminAccount : remote.createAdminAccount;
export const deleteAdminAccount = isMockApi ? mockDeleteAdminAccount : remote.deleteAdminAccount;
export const resetAdminPassword = isMockApi ? mockResetAdminPassword : remote.resetAdminPassword;
export const updateAdminPrograms = isMockApi ? mockUpdateAdminPrograms : remote.updateAdminPrograms;

export const getAiSettings = isMockApi ? mockGetAiSettings : remote.getAiSettings;
export const updateAiSettings = isMockApi ? mockUpdateAiSettings : remote.updateAiSettings;
export const requestBudgetAiReview = requestBudgetAiReviewFromEdge;

export const getGuidanceItems = isMockApi ? mockGetGuidanceItems : remote.getGuidanceItems;
export const createGuidanceItem = isMockApi ? mockCreateGuidanceItem : remote.createGuidanceItem;
export const updateGuidanceItem = isMockApi ? mockUpdateGuidanceItem : remote.updateGuidanceItem;
export const deleteGuidanceItem = isMockApi ? mockDeleteGuidanceItem : remote.deleteGuidanceItem;

export const getFounderDashboard = isMockApi ? mockGetFounderDashboard : remote.getFounderDashboard;
export const submitFounderBudgetAllocations = isMockApi ? mockSubmitFounderBudgetAllocations : remote.submitFounderBudgetAllocations;
export const getFounderProfile = async () => {
  if (isMockApi) {
    const user = mockGetCurrentUser();
    if (!user) return { company: null };
    const dashboard = mockGetFounderDashboard();
    return { company: dashboard.company };
  } else {
    const dashboard = await remote.getFounderDashboard();
    return { company: dashboard?.company || null };
  }
};
export const updateFounderProfile = isMockApi ? mockUpdateFounderProfile : remote.updateFounderProfile;
export const updateBusinessPlan = isMockApi ? mockUpdateBusinessPlan : remote.updateBusinessPlan;

export const getAdminDashboard = isMockApi ? mockGetAdminDashboard : remote.getAdminDashboard;
export const getAdminCompanyDetail = isMockApi ? mockGetAdminCompanyDetail : remote.getAdminCompanyDetail;
export const approveCompany = isMockApi ? mockApproveCompany : remote.approveCompany;
export const rejectCompany = isMockApi ? mockRejectCompany : remote.rejectCompany;
export const resetFounderPassword = isMockApi ? mockResetFounderPassword : remote.resetFounderPassword;
export const reviewBudgetSubmission = isMockApi ? mockReviewBudgetSubmission : remote.reviewBudgetSubmission;
export const upsertCompanyBudgetAllocation = isMockApi ? mockUpsertCompanyBudgetAllocation : remote.upsertCompanyBudgetAllocation;
export const updateCompanySupportTotal = isMockApi ? mockUpdateCompanySupportTotal : remote.updateCompanySupportTotal;
export const updateCompanyInternalMemo = isMockApi ? mockUpdateCompanyInternalMemo : remote.updateCompanyInternalMemo;

export const getExpenseDetail = isMockApi ? mockGetExpenseDetail : remote.getExpenseDetail;
export const createExpense = isMockApi ? mockCreateExpense : remote.createExpense;
export const updateExpenseRequest = isMockApi ? mockUpdateExpenseRequest : remote.updateExpenseRequest;
export const submitExpenseRequest = isMockApi ? mockSubmitExpenseRequest : remote.submitExpenseRequest;
export const reviewExpenseRequest = isMockApi ? mockReviewExpenseRequest : remote.reviewExpenseRequest;

// ----------------------------------------------------
// 예산 항목별 커스텀 첨부서류 / 운영사업 공통 AI 검토 기준 문서 / 창업자 업로드·AI검토
// (custom-document-requirements-plan.md §6)
// ----------------------------------------------------
export const getBudgetDocumentRequirements = isMockApi ? mockGetBudgetDocumentRequirements : remote.getBudgetDocumentRequirements;
export const createBudgetDocumentRequirement = isMockApi ? mockCreateBudgetDocumentRequirement : remote.createBudgetDocumentRequirement;
export const updateBudgetDocumentRequirement = isMockApi ? mockUpdateBudgetDocumentRequirement : remote.updateBudgetDocumentRequirement;
export const deactivateBudgetDocumentRequirement = isMockApi ? mockDeactivateBudgetDocumentRequirement : remote.deactivateBudgetDocumentRequirement;
export const deleteBudgetDocumentRequirement = isMockApi ? mockDeleteBudgetDocumentRequirement : remote.deleteBudgetDocumentRequirement;

export const getProgramAiCriteriaDocument = isMockApi ? mockGetProgramAiCriteriaDocument : remote.getProgramAiCriteriaDocument;
export const deleteProgramAiCriteriaDocument = isMockApi ? mockDeleteProgramAiCriteriaDocument : remote.deleteProgramAiCriteriaDocument;

// 기준 문서 텍스트 파싱: 브라우저에 보관된 실제 PDF 바이트를 pdf.js 로 읽어
// 전체 텍스트와 파싱 품질 지표(페이지 수/글자 수/이미지 PDF 여부)를 저장한다.
// 저장된 전체 텍스트는 제출 서류 AI 검토에 그대로 적용된다.
export async function extractProgramAiCriteria(criteriaId) {
  const docFn = isMockApi ? mockGetProgramAiCriteriaDocumentById : remote.mockGetProgramAiCriteriaDocumentById;
  const doc = await docFn(criteriaId);
  if (!doc) throw new Error("기준 문서를 찾을 수 없습니다.");
  if (!doc.link_url) throw new Error("파싱할 문서 파일이 없습니다. 문서를 다시 업로드해주세요.");

  const setStatusFn = isMockApi ? mockSetProgramAiCriteriaExtractionStatus : remote.mockSetProgramAiCriteriaExtractionStatus;
  await setStatusFn(criteriaId, "pending");
  try {
    let stored;
    if (isMockApi) {
      stored = await mockGetFile(doc.link_url);
      if (!stored?.data) throw new Error("보관된 문서 파일을 찾을 수 없습니다. 문서를 다시 업로드해주세요.");
    } else {
      const s3Url = await getS3DownloadUrl(doc.link_url);
      const res = await fetch(s3Url);
      if (!res.ok) throw new Error("S3에서 문서 파일을 가져오지 못했습니다.");
      const blob = await res.blob();
      const dataUrl = await readFileAsDataUrl(blob);
      stored = {
        data: dataUrl,
        type: blob.type,
      };
    }

    // 텍스트가 거의 없는 이미지(스캔) PDF 도 지표만 남기고 '완료'로 저장한다(화면에서 경고 표시).
    const parsed = await parsePdfText(stored.data, {
      mimeType: stored.type || doc.mime_type || "application/pdf",
    });
    const saveFn = isMockApi ? mockSaveProgramAiCriteriaExtraction : remote.mockSaveProgramAiCriteriaExtraction;
    return await saveFn(criteriaId, parsed.text, {
      page_count: parsed.pageCount,
      char_count: parsed.charCount,
      pages_with_text: parsed.pagesWithText,
      image_likely: parsed.imageLikely,
    });
  } catch (error) {
    await setStatusFn(criteriaId, "failed");
    throw error;
  }
}

export const getExpenseDocumentRequirements = isMockApi ? mockGetExpenseDocumentRequirements : remote.getExpenseDocumentRequirements;
export const deleteExpenseDocumentFile = isMockApi ? mockDeleteExpenseDocumentFile : remote.mockDeleteUploadedFile;
export const validateRequiredDocuments = isMockApi ? mockValidateRequiredDocuments : remote.mockValidateRequiredDocuments;

// ----------------------------------------------------
// 제출 서류 실제 AI 검토 (§2.4 / §4)
// 보관된 첨부 파일 바이트(base64) + 신청 정보 + 적용 기준을 Edge Function 으로 보내
// 설정된 provider 의 비전/문서 모델이 문서를 직접 읽어 검토한다. 결과는 보관 파일에 저장한다.
// ----------------------------------------------------

// dataURL → base64 페이로드(접두부 제거).
function dataUrlToBase64(dataUrl) {
  return String(dataUrl || "").split(",")[1] || "";
}

// AI 결과 코멘트에 적용 기준·교차검증 안내를 덧붙인다(기존 UX 유지).
function buildDocumentReviewComment(result, { criteriaTitle, batchCount }) {
  let comment = result.comment || "";
  if (criteriaTitle) {
    comment += `\n\n[적용 기준] ${criteriaTitle} 의 지침을 함께 참고했습니다.`;
  } else {
    comment += "\n\n[기본 검토] 공통 기준 문서가 없어 첨부서류명·신청 정보 기준으로 검토했습니다.";
  }
  if (batchCount > 1) {
    comment += `\n\n[교차검증] 같은 단계 ${batchCount}건 문서를 함께 검토했습니다.`;
  }
  return comment;
}

// 보관된 첨부 파일 한 건을 실제 LLM 으로 검토하고 결과를 저장한다.
async function reviewStoredDocument({ file, req, expense, criteriaText, criteriaTitle, batchCount }) {
  let stored;
  if (isMockApi) {
    stored = await mockGetFile(file.link_url);
    if (!stored?.data) throw new Error("보관된 첨부 파일을 찾을 수 없습니다. 파일을 다시 업로드해주세요.");
  } else {
    const s3Url = await getS3DownloadUrl(file.link_url);
    const res = await fetch(s3Url);
    if (!res.ok) throw new Error("S3에서 첨부 파일을 가져오지 못했습니다.");
    const blob = await res.blob();
    const dataUrl = await readFileAsDataUrl(blob);
    stored = {
      data: dataUrl,
      type: blob.type,
      filename: file.original_filename,
    };
  }

  const result = await requestDocumentReviewFromEdge({
    fileBase64: dataUrlToBase64(stored.data),
    filename: file.original_filename || stored.filename || "document",
    mimeType: stored.type || file.mime_type || "application/pdf",
    context: {
      doc_title: req?.title || file.original_filename || "첨부파일",
      expense: {
        title: expense.title || "",
        vendor_name: expense.vendor_name || "",
        vendor_business_number: expense.vendor_business_number || "",
        amount_supply: Number(expense.amount_supply || 0),
        vat_amount: Number(expense.vat_amount || 0),
        expected_completion_date: expense.expected_completion_date || "",
        purpose: expense.purpose || "",
      },
    },
    criteriaText,
    batchCount: batchCount || 1,
  });

  const saveFn = isMockApi ? mockSaveAiDocumentReviewResult : remote.mockSaveAiDocumentReviewResult;
  return await saveFn(file.id, {
    status: result.status,
    comment: buildDocumentReviewComment(result, { criteriaTitle, batchCount }),
    ai_check_result: {
      findings: result.findings,
      criteria_applied: !!criteriaText,
      criteria_title: criteriaTitle || null,
      batch_size: batchCount || 1,
      raw_text: result.raw_text || "",
    },
  });
}

// 단일 파일 실제 AI 검토(개별 재검토).
export async function requestAiDocumentReview(fileId) {
  const getTargetFn = isMockApi ? mockGetAiDocumentReviewTargetByFile : remote.mockGetAiDocumentReviewTargetByFile;
  const { file, req, expense, criteriaText, criteriaTitle } = await getTargetFn(fileId);
  return reviewStoredDocument({ file, req, expense, criteriaText, criteriaTitle, batchCount: 1 });
}

// 단계별 일괄 실제 AI 검토(§4): 해당 단계의 'AI검토 사용 + 파일 업로드' 서류를 순차 검토한다.
export async function requestAiBatchDocumentReview(expenseRequestId, phase) {
  const getContextFn = isMockApi ? mockGetAiDocumentReviewContext : remote.mockGetAiDocumentReviewContext;
  const { expense, criteriaText, criteriaTitle, targets } = await getContextFn(expenseRequestId, phase);
  if (!targets.length) return { reviewed: 0 };
  for (const req of targets) {
    await reviewStoredDocument({ file: req.file, req, expense, criteriaText, criteriaTitle, batchCount: targets.length });
  }
  return { reviewed: targets.length };
}

// 창업자 'AI 보완 → 이상없음' 소명 처리/취소. AI 결과는 보존하고 소명만 덧붙인다.
export function setExpenseDocumentUserReview(fileId, { cleared, comment, user }) {
  const fn = isMockApi ? mockSetExpenseDocumentUserReview : remote.mockSetExpenseDocumentUserReview;
  return fn(fileId, { cleared, comment, user });
}

// 운영사업 공통 AI 기준 문서 업로드: 실제 파일을 보관(link_url)한 뒤 메타데이터를 등록한다.
export async function uploadProgramAiCriteriaDocument(programId, file, user) {
  const upload = await uploadFile(file, { programId });
  const fn = isMockApi ? mockUploadProgramAiCriteriaDocument : remote.mockUploadProgramAiCriteriaDocument;
  return fn(programId, {
    title: file.name,
    original_filename: upload.original_filename,
    mime_type: file.type,
    size_bytes: file.size,
    link_url: upload.link_url,
    uploaded_by: user?.id || null,
  });
}

// 창업자 첨부서류 업로드: 실제 파일을 보관(link_url)한 뒤 요구사항에 연결한다.
export async function uploadExpenseDocumentFile(expenseRequestId, requirement, phase, file, user) {
  const upload = await uploadFile(file, {
    companyId: user?.company_id || user?.profile?.company_id,
    expenseRequestId
  });
  const fn = isMockApi ? mockUploadExpenseDocumentFile : remote.mockUploadExpenseDocumentFile;
  return fn(expenseRequestId, requirement.id, phase, {
    support_program_budget_id: requirement.support_program_budget_id || null,
    original_filename: upload.original_filename,
    mime_type: file.type,
    size_bytes: file.size,
    link_url: upload.link_url,
    uploaded_by: user?.id || null,
  });
}

// ----------------------------------------------------
// File Upload / Download (mock: 실제 첨부 파일을 dataURL 로 보관·복원)
// ----------------------------------------------------
const DUMMY_PDF = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("파일을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = String(dataUrl).split(",");
  const mime = (meta.match(/:(.*?);/) || [])[1] || "application/octet-stream";
  const bin = atob(b64 || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// 첨부 파일을 업로드(보관)하고 link_url 을 반환한다. 사업계획서/안내자료 공용.
// 업로드 전 클라이언트 측 정책 검증(MIME/확장자/크기). 서버(Storage)에서도 동일 정책을 재검증해야 한다(T10).
export async function uploadFile(file, policyOpts = {}) {
  const check = validateUploadFile(file, policyOpts);
  if (!check.valid) throw new Error(check.error);

  if (!isMockApi) {
    const ext = getFileExtension(file.name);
    const uuid = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
    let filePath = "";

    if (policyOpts.path) {
      filePath = policyOpts.path;
    } else if (policyOpts.companyId) {
      const folder = policyOpts.expenseRequestId ? `expenses/${policyOpts.expenseRequestId}` : 'business-plans';
      filePath = `companies/${policyOpts.companyId}/${folder}/${uuid}.${ext}`;
    } else if (policyOpts.programId) {
      filePath = `programs/${policyOpts.programId}/criteria/${uuid}.${ext}`;
    } else {
      let companyId = "unknown";
      try {
        const currentUser = await getCurrentUser();
        if (currentUser?.profile?.company_id) {
          companyId = currentUser.profile.company_id;
        }
      } catch (_) {}
      filePath = `companies/${companyId}/general/${uuid}.${ext}`;
    }

    const key = await uploadFileToS3(file, filePath);
    return { link_url: key, original_filename: sanitizeFilename(file.name) };
  }

  const dataUrl = await readFileAsDataUrl(file);
  const link_url = await mockStoreFile(dataUrl, sanitizeFilename(file.name), file.type);
  return { link_url, original_filename: sanitizeFilename(file.name) };
}

// 기존 호출부 호환용 별칭
export const uploadGuidanceFile = uploadFile;

// 미리보기(새 탭 열기)용 URL. 보관된 실제 파일이 있으면 그 파일을, 없으면(개발 한정) 더미를 돌려준다.
export async function getGuidanceDownloadUrl(linkUrl) {
  if (!isMockApi && linkUrl && (linkUrl.startsWith("companies/") || linkUrl.startsWith("programs/"))) {
    try {
      return await getS3DownloadUrl(linkUrl);
    } catch (error) {
      console.error("Failed to get S3 download URL:", error);
    }
  }

  const stored = await mockGetFile(linkUrl);
  if (stored?.data) return URL.createObjectURL(dataUrlToBlob(stored.data));
  // 운영에서는 외부 더미 파일을 열지 않는다(혼란 방지). 개발에서만 fallback.
  if (isProduction) throw new Error("파일을 찾을 수 없습니다.");
  return DUMMY_PDF;
}

// 보관된 실제 첨부 파일을 원본 파일명으로 다운로드한다. 없으면(개발 한정) 더미를 새 탭으로 연다.
export async function downloadStoredFile(linkUrl, filename) {
  if (!isMockApi && linkUrl && (linkUrl.startsWith("companies/") || linkUrl.startsWith("programs/"))) {
    try {
      const s3Url = await getS3DownloadUrl(linkUrl);
      window.open(s3Url, "_blank", "noopener,noreferrer");
      return;
    } catch (error) {
      console.error("Failed to download file from S3:", error);
    }
  }

  const stored = await mockGetFile(linkUrl);
  if (!stored?.data) {
    // 운영에서는 외부 더미 파일을 열지 않는다.
    if (isProduction) throw new Error("파일을 찾을 수 없습니다.");
    window.open(DUMMY_PDF, "_blank", "noopener,noreferrer");
    return;
  }
  const url = URL.createObjectURL(dataUrlToBlob(stored.data));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || stored.filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function uploadDocumentFile(expenseRequestId, documentType, file, user) {
  if (isMockApi) {
    return mockUploadDocumentFile(expenseRequestId, documentType, file, user);
  }
  throw new Error("uploadDocumentFile is deprecated. Use uploadExpenseDocumentFile instead.");
}

export async function markDocumentUploaded(expenseRequestId, documentType) {
  if (isMockApi) {
    return mockMarkDocumentUploaded(expenseRequestId, documentType);
  }
  throw new Error("markDocumentUploaded is deprecated.");
}

export async function deleteUploadedFile(fileId) {
  if (isMockApi) {
    return mockDeleteUploadedFile(fileId);
  }
  return await remote.mockDeleteUploadedFile(fileId);
}
