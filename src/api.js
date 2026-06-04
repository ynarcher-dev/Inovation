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
} from "./mockApi2.js";

// Initialize Mock Storage Data on load
initMockData();

// Export wrapped mock APIs
export const getSupportPrograms = mockGetSupportPrograms;
export const createSupportProgram = mockCreateSupportProgram;
export const updateSupportProgram = mockUpdateSupportProgram;
export const deleteSupportProgram = mockDeleteSupportProgram;
export const updateSupportProgramDescription = mockUpdateSupportProgramDescription;
export const updateSupportProgramMemo = mockUpdateSupportProgramMemo;
export const updateSupportProgramLevelLabels = mockUpdateSupportProgramLevelLabels;

export const getSupportProgramBudgets = mockGetSupportProgramBudgets;
export const createSupportProgramBudget = mockCreateSupportProgramBudget;
export const updateSupportProgramBudget = mockUpdateSupportProgramBudget;
export const deleteSupportProgramBudget = mockDeleteSupportProgramBudget;

export const getAdminAccounts = mockGetAdminAccounts;
export const createAdminAccount = mockCreateAdminAccount;
export const deleteAdminAccount = mockDeleteAdminAccount;
export const resetAdminPassword = mockResetAdminPassword;
export const updateAdminPrograms = mockUpdateAdminPrograms;

export const getGuidanceItems = mockGetGuidanceItems;
export const createGuidanceItem = mockCreateGuidanceItem;
export const updateGuidanceItem = mockUpdateGuidanceItem;
export const deleteGuidanceItem = mockDeleteGuidanceItem;

export const getFounderDashboard = mockGetFounderDashboard;
export const submitFounderBudgetAllocations = mockSubmitFounderBudgetAllocations;
export const getFounderProfile = () => {
  const user = mockGetCurrentUser();
  if (!user) return { company: null };
  const dashboard = mockGetFounderDashboard();
  return { company: dashboard.company };
};
export const updateFounderProfile = mockUpdateFounderProfile;
export const updateBusinessPlan = mockUpdateBusinessPlan;

export const getAdminDashboard = mockGetAdminDashboard;
export const getAdminCompanyDetail = mockGetAdminCompanyDetail;
export const approveCompany = mockApproveCompany;
export const rejectCompany = mockRejectCompany;
export const reviewBudgetSubmission = mockReviewBudgetSubmission;
export const upsertCompanyBudgetAllocation = mockUpsertCompanyBudgetAllocation;
export const updateCompanySupportTotal = mockUpdateCompanySupportTotal;
export const updateCompanyInternalMemo = mockUpdateCompanyInternalMemo;

export const getExpenseDetail = mockGetExpenseDetail;
export const createExpense = mockCreateExpense;
export const updateExpenseRequest = mockUpdateExpenseRequest;
export const submitExpenseRequest = mockSubmitExpenseRequest;
export const reviewExpenseRequest = mockReviewExpenseRequest;

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
export async function uploadFile(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const link_url = await mockStoreFile(dataUrl, file.name, file.type);
  return { link_url, original_filename: file.name };
}

// 기존 호출부 호환용 별칭
export const uploadGuidanceFile = uploadFile;

// 미리보기(새 탭 열기)용 URL. 보관된 실제 파일이 있으면 그 파일을, 없으면 더미를 돌려준다.
export async function getGuidanceDownloadUrl(linkUrl) {
  const stored = await mockGetFile(linkUrl);
  if (stored?.data) return URL.createObjectURL(dataUrlToBlob(stored.data));
  return DUMMY_PDF;
}

// 보관된 실제 첨부 파일을 원본 파일명으로 다운로드한다. 없으면 더미를 새 탭으로 연다.
export async function downloadStoredFile(linkUrl, filename) {
  const stored = await mockGetFile(linkUrl);
  if (!stored?.data) {
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
  return mockUploadDocumentFile(expenseRequestId, documentType, file, user);
}

export async function markDocumentUploaded(expenseRequestId, documentType) {
  return mockMarkDocumentUploaded(expenseRequestId, documentType);
}

export async function deleteUploadedFile(fileId) {
  return mockDeleteUploadedFile(fileId);
}
