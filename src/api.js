// 화면 계층의 단일 데이터 진입점. 모든 데이터 API 는 실제 Supabase/S3 어댑터(remote)로 위임한다.
// (mock 계층은 제거됨 — 항상 실 백엔드에 연결한다.)
import {
  requestBudgetAiReview as requestBudgetAiReviewFromEdge,
  requestDocumentReview as requestDocumentReviewFromEdge,
} from "./services/ai-agent.js";
import { parsePdfText } from "./services/pdf-parse.js";
import { validateUploadFile, sanitizeFilename, getFileExtension } from "./domains/upload-policy.js";
import { uploadFileToS3, getS3DownloadUrl } from "./services/s3-storage.js";
import * as remote from "./services/supabase-api.js";
import { getCurrentUser } from "./auth.js";

// ----------------------------------------------------
// 운영사업 / 비목
// ----------------------------------------------------
export const getSupportPrograms = remote.getSupportPrograms;
export const createSupportProgram = remote.createSupportProgram;
export const updateSupportProgram = remote.updateSupportProgram;
export const deleteSupportProgram = remote.deleteSupportProgram;
export const updateSupportProgramDescription = remote.updateSupportProgramDescription;
export const updateSupportProgramMemo = remote.updateSupportProgramMemo;
export const updateSupportProgramLevelLabels = remote.updateSupportProgramLevelLabels;

export const getSupportProgramBudgets = remote.getSupportProgramBudgets;
export const createSupportProgramBudget = remote.createSupportProgramBudget;
export const updateSupportProgramBudget = remote.updateSupportProgramBudget;
export const deleteSupportProgramBudget = remote.deleteSupportProgramBudget;

// ----------------------------------------------------
// 관리자 계정
// ----------------------------------------------------
export const getAdminAccounts = remote.getAdminAccounts;
export const createAdminAccount = remote.createAdminAccount;
export const deleteAdminAccount = remote.deleteAdminAccount;
export const resetAdminPassword = remote.resetAdminPassword;
export const updateAdminPrograms = remote.updateAdminPrograms;

// ----------------------------------------------------
// AI 설정
// ----------------------------------------------------
export const getAiSettings = remote.getAiSettings;
export const updateAiSettings = remote.updateAiSettings;
export const requestBudgetAiReview = requestBudgetAiReviewFromEdge;

// ----------------------------------------------------
// 안내자료
// ----------------------------------------------------
export const getGuidanceItems = remote.getGuidanceItems;
export const createGuidanceItem = remote.createGuidanceItem;
export const updateGuidanceItem = remote.updateGuidanceItem;
export const deleteGuidanceItem = remote.deleteGuidanceItem;

// ----------------------------------------------------
// 창업자 대시보드 / 프로필 / 사업계획서
// ----------------------------------------------------
export const getFounderDashboard = remote.getFounderDashboard;
export const submitFounderBudgetAllocations = remote.submitFounderBudgetAllocations;
export const getFounderProfile = async () => {
  const dashboard = await remote.getFounderDashboard();
  return { company: dashboard?.company || null };
};
export const updateFounderProfile = remote.updateFounderProfile;
export const updateBusinessPlan = remote.updateBusinessPlan;

// ----------------------------------------------------
// 관리자 대시보드 / 기업 / 예산 검토
// ----------------------------------------------------
export const getAdminDashboard = remote.getAdminDashboard;
export const getAdminCompanyDetail = remote.getAdminCompanyDetail;
export const approveCompany = remote.approveCompany;
export const rejectCompany = remote.rejectCompany;
export const resetFounderPassword = remote.resetFounderPassword;
export const reviewBudgetSubmission = remote.reviewBudgetSubmission;
export const upsertCompanyBudgetAllocation = remote.upsertCompanyBudgetAllocation;
export const updateCompanySupportTotal = remote.updateCompanySupportTotal;
export const updateCompanyInternalMemo = remote.updateCompanyInternalMemo;

// ----------------------------------------------------
// 지출 신청 / 검토
// ----------------------------------------------------
export const getExpenseDetail = remote.getExpenseDetail;
export const createExpense = remote.createExpense;
export const updateExpenseRequest = remote.updateExpenseRequest;
export const submitExpenseRequest = remote.submitExpenseRequest;
export const reviewExpenseRequest = remote.reviewExpenseRequest;

// ----------------------------------------------------
// 예산 항목별 커스텀 첨부서류 / 운영사업 공통 AI 검토 기준 문서
// ----------------------------------------------------
export const getBudgetDocumentRequirements = remote.getBudgetDocumentRequirements;
export const createBudgetDocumentRequirement = remote.createBudgetDocumentRequirement;
export const updateBudgetDocumentRequirement = remote.updateBudgetDocumentRequirement;
export const deactivateBudgetDocumentRequirement = remote.deactivateBudgetDocumentRequirement;
export const deleteBudgetDocumentRequirement = remote.deleteBudgetDocumentRequirement;

export const getProgramAiCriteriaDocument = remote.getProgramAiCriteriaDocument;
export const deleteProgramAiCriteriaDocument = remote.deleteProgramAiCriteriaDocument;

export const getExpenseDocumentRequirements = remote.getExpenseDocumentRequirements;
export const deleteExpenseDocumentFile = remote.mockDeleteUploadedFile;
export const validateRequiredDocuments = remote.mockValidateRequiredDocuments;

// 기준 문서 텍스트 파싱: S3 에 보관된 PDF 바이트를 pdf.js 로 읽어
// 전체 텍스트와 파싱 품질 지표(페이지 수/글자 수/이미지 PDF 여부)를 저장한다.
export async function extractProgramAiCriteria(criteriaId) {
  const doc = await remote.mockGetProgramAiCriteriaDocumentById(criteriaId);
  if (!doc) throw new Error("기준 문서를 찾을 수 없습니다.");
  if (!doc.link_url) throw new Error("파싱할 문서 파일이 없습니다. 문서를 다시 업로드해주세요.");

  await remote.mockSetProgramAiCriteriaExtractionStatus(criteriaId, "pending");
  try {
    const s3Url = await getS3DownloadUrl(doc.link_url);
    const res = await fetch(s3Url);
    if (!res.ok) throw new Error("S3에서 문서 파일을 가져오지 못했습니다.");
    const blob = await res.blob();
    const dataUrl = await readFileAsDataUrl(blob);

    // 텍스트가 거의 없는 이미지(스캔) PDF 도 지표만 남기고 '완료'로 저장한다(화면에서 경고 표시).
    const parsed = await parsePdfText(dataUrl, {
      mimeType: blob.type || doc.mime_type || "application/pdf",
    });
    return await remote.mockSaveProgramAiCriteriaExtraction(criteriaId, parsed.text, {
      page_count: parsed.pageCount,
      char_count: parsed.charCount,
      pages_with_text: parsed.pagesWithText,
      image_likely: parsed.imageLikely,
    });
  } catch (error) {
    await remote.mockSetProgramAiCriteriaExtractionStatus(criteriaId, "failed");
    throw error;
  }
}

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
  const s3Url = await getS3DownloadUrl(file.link_url);
  const res = await fetch(s3Url);
  if (!res.ok) throw new Error("S3에서 첨부 파일을 가져오지 못했습니다.");
  const blob = await res.blob();
  const dataUrl = await readFileAsDataUrl(blob);
  const stored = { data: dataUrl, type: blob.type, filename: file.original_filename };

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

  return await remote.mockSaveAiDocumentReviewResult(file.id, {
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
  const { file, req, expense, criteriaText, criteriaTitle } = await remote.mockGetAiDocumentReviewTargetByFile(fileId);
  return reviewStoredDocument({ file, req, expense, criteriaText, criteriaTitle, batchCount: 1 });
}

// 단계별 일괄 실제 AI 검토(§4): 해당 단계의 'AI검토 사용 + 파일 업로드' 서류를 순차 검토한다.
export async function requestAiBatchDocumentReview(expenseRequestId, phase) {
  const { expense, criteriaText, criteriaTitle, targets } = await remote.mockGetAiDocumentReviewContext(expenseRequestId, phase);
  if (!targets.length) return { reviewed: 0 };
  for (const req of targets) {
    await reviewStoredDocument({ file: req.file, req, expense, criteriaText, criteriaTitle, batchCount: targets.length });
  }
  return { reviewed: targets.length };
}

// 창업자 'AI 보완 → 이상없음' 소명 처리/취소. AI 결과는 보존하고 소명만 덧붙인다.
export const setExpenseDocumentUserReview = remote.mockSetExpenseDocumentUserReview;

// 운영사업 공통 AI 기준 문서 업로드: 실제 파일을 S3 에 보관(link_url)한 뒤 메타데이터를 등록한다.
export async function uploadProgramAiCriteriaDocument(programId, file, user) {
  const upload = await uploadFile(file, { programId });
  return remote.mockUploadProgramAiCriteriaDocument(programId, {
    title: file.name,
    original_filename: upload.original_filename,
    mime_type: file.type,
    size_bytes: file.size,
    link_url: upload.link_url,
    uploaded_by: user?.id || null,
  });
}

// 창업자 첨부서류 업로드: 실제 파일을 S3 에 보관(link_url)한 뒤 요구사항에 연결한다.
export async function uploadExpenseDocumentFile(expenseRequestId, requirement, phase, file, user) {
  const upload = await uploadFile(file, {
    companyId: user?.company_id || user?.profile?.company_id,
    expenseRequestId,
  });
  return remote.mockUploadExpenseDocumentFile(expenseRequestId, requirement.id, phase, {
    support_program_budget_id: requirement.support_program_budget_id || null,
    original_filename: upload.original_filename,
    mime_type: file.type,
    size_bytes: file.size,
    link_url: upload.link_url,
    uploaded_by: user?.id || null,
  });
}

// ----------------------------------------------------
// File Upload / Download (S3)
// ----------------------------------------------------
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("파일을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

// 첨부 파일을 S3 에 업로드하고 link_url(Key)을 반환한다. 사업계획서/안내자료 공용.
// 업로드 전 클라이언트 측 정책 검증(MIME/확장자/크기). 서버(Storage)에서도 동일 정책을 재검증해야 한다(T10).
export async function uploadFile(file, policyOpts = {}) {
  const check = validateUploadFile(file, policyOpts);
  if (!check.valid) throw new Error(check.error);

  const ext = getFileExtension(file.name);
  const uuid = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
  let filePath = "";

  if (policyOpts.path) {
    filePath = policyOpts.path;
  } else if (policyOpts.companyId) {
    const folder = policyOpts.expenseRequestId ? `expenses/${policyOpts.expenseRequestId}` : "business-plans";
    filePath = `companies/${policyOpts.companyId}/${folder}/${uuid}.${ext}`;
  } else if (policyOpts.programId) {
    filePath = `programs/${policyOpts.programId}/criteria/${uuid}.${ext}`;
  } else {
    let companyId = "unknown";
    try {
      const currentUser = await getCurrentUser();
      if (currentUser?.profile?.company_id) companyId = currentUser.profile.company_id;
    } catch (_) {}
    filePath = `companies/${companyId}/general/${uuid}.${ext}`;
  }

  const key = await uploadFileToS3(file, filePath);
  return { link_url: key, original_filename: sanitizeFilename(file.name) };
}

// 기존 호출부 호환용 별칭
export const uploadGuidanceFile = uploadFile;

// 미리보기(새 탭 열기)용 S3 Presigned URL.
export async function getGuidanceDownloadUrl(linkUrl) {
  if (!linkUrl) throw new Error("파일을 찾을 수 없습니다.");
  return await getS3DownloadUrl(linkUrl);
}

// 보관된 실제 첨부 파일을 S3 Presigned URL 로 새 탭에서 연다.
export async function downloadStoredFile(linkUrl) {
  if (!linkUrl) throw new Error("파일을 찾을 수 없습니다.");
  const s3Url = await getS3DownloadUrl(linkUrl);
  window.open(s3Url, "_blank", "noopener,noreferrer");
}

export const deleteUploadedFile = remote.mockDeleteUploadedFile;

// 더 이상 쓰지 않는 레거시 업로드 API (uploadExpenseDocumentFile 로 대체됨).
export async function uploadDocumentFile() {
  throw new Error("uploadDocumentFile is deprecated. Use uploadExpenseDocumentFile instead.");
}
export async function markDocumentUploaded() {
  throw new Error("markDocumentUploaded is deprecated.");
}
