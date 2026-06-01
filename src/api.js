import {
  initMockData,
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
  mockUpdateCompanySupportTotal,
  mockGetExpenseDetail,
  mockCreateExpense,
  mockSubmitExpenseRequest,
  mockReviewExpenseRequest,
  mockUpdateFounderProfile,
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

export const getAdminDashboard = mockGetAdminDashboard;
export const getAdminCompanyDetail = mockGetAdminCompanyDetail;
export const approveCompany = mockApproveCompany;
export const rejectCompany = mockRejectCompany;
export const updateCompanySupportTotal = mockUpdateCompanySupportTotal;

export const getExpenseDetail = mockGetExpenseDetail;
export const createExpense = mockCreateExpense;
export const submitExpenseRequest = mockSubmitExpenseRequest;
export const reviewExpenseRequest = mockReviewExpenseRequest;

// File Upload Mocks
export async function uploadGuidanceFile(file) {
  return {
    link_url: `storage:${file.name}`,
    original_filename: file.name,
  };
}

export async function getGuidanceDownloadUrl(linkUrl) {
  return "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"; // Mock PDF
}

export async function uploadDocumentFile(expenseRequestId, documentType, file, user) {
  return { ok: true };
}

export async function markDocumentUploaded(expenseRequestId, documentType) {
  return { ok: true };
}
