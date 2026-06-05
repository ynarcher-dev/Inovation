// 배럴(barrel): mock API(part 2)를 도메인별 파일(src/services/mock)로 분리하고,
// 기존 import 경로("./mockApi2.js")와 export 이름을 그대로 유지하기 위해 재노출한다.
// 공유 계산 헬퍼는 services/mock/_shared.mock.js 에 모았다.

export {
  mockGetGuidanceItems,
  mockCreateGuidanceItem,
  mockUpdateGuidanceItem,
  mockDeleteGuidanceItem,
} from "./services/mock/guidance.mock.js";

export {
  mockGetFounderDashboard,
  mockGetAdminDashboard,
  mockGetAdminCompanyDetail,
  mockApproveCompany,
  mockRejectCompany,
  mockResetFounderPassword,
  mockUpdateCompanySupportTotal,
  mockUpdateCompanyInternalMemo,
  mockUpdateFounderProfile,
  normalizeBusinessPlans,
  mockUpdateBusinessPlan,
} from "./services/mock/company.mock.js";

export {
  mockSubmitFounderBudgetAllocations,
  mockReviewBudgetSubmission,
  mockUpsertCompanyBudgetAllocation,
} from "./services/mock/budget.mock.js";

export {
  mockGetExpenseDetail,
  mockCreateExpense,
  mockUpdateExpenseRequest,
  mockSubmitExpenseRequest,
  mockReviewExpenseRequest,
  mockUploadDocumentFile,
  mockMarkDocumentUploaded,
  mockDeleteUploadedFile,
} from "./services/mock/expense.mock.js";

export {
  mockGetBudgetDocumentRequirements,
  mockCreateBudgetDocumentRequirement,
  mockUpdateBudgetDocumentRequirement,
  mockDeactivateBudgetDocumentRequirement,
  mockDeleteBudgetDocumentRequirement,
  mockGetProgramAiCriteriaDocument,
  mockUploadProgramAiCriteriaDocument,
  mockExtractProgramAiCriteria,
  mockDeleteProgramAiCriteriaDocument,
  mockGetExpenseDocumentRequirements,
  mockUploadExpenseDocumentFile,
  mockDeleteExpenseDocumentFile,
  mockRequestAiDocumentReview,
  mockRequestAiBatchReview,
  mockSetExpenseDocumentUserReview,
  mockValidateRequiredDocuments,
} from "./services/mock/document-requirement.mock.js";
