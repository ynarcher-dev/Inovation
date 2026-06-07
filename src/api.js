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

// 보관된 첨부 파일(S3) 한 건을 내려받아 base64 로 반환한다.
// AI 검토(예: 예산 검토에 사업계획서 첨부)에 파일 바이트를 함께 보낼 때 사용한다.
//   반환: { data_base64, mime_type } (없으면 null)
export async function fetchStoredFileBase64(linkUrl) {
  if (!linkUrl) return null;
  const s3Url = await getS3DownloadUrl(linkUrl);
  const res = await fetch(s3Url);
  if (!res.ok) throw new Error("S3에서 파일을 가져오지 못했습니다.");
  const blob = await res.blob();
  const dataUrl = await readFileAsDataUrl(blob);
  return { data_base64: dataUrlToBase64(dataUrl), mime_type: blob.type || "" };
}

// JSZip 동적 로드(빌드 도구가 없는 프로젝트 — 필요 시에만 CDN(ESM)에서 import). pdf.js 로드 방식과 동일.
let jsZipPromise = null;
function loadJsZip() {
  if (!jsZipPromise) {
    jsZipPromise = import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")
      .then((mod) => mod.default || mod)
      .catch((err) => {
        jsZipPromise = null; // 다음 시도에서 다시 로드할 수 있게 캐시를 비운다.
        throw new Error("압축 모듈(JSZip)을 불러오지 못했습니다. 네트워크 연결을 확인해주세요.");
      });
  }
  return jsZipPromise;
}

// Blob 을 지정한 파일명으로 즉시 내려받는다(a[download]).
function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 다운로드 시작 후 약간의 여유를 두고 object URL 을 해제한다.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 보관된 여러 파일(S3)을 받아 ZIP 한 개로 내려받는다.
//  files: [{ link_url, name, originalName }]
//   - name: 확장자를 제외한 최종 파일명 베이스. originalName 의 확장자를 붙인다.
//   - 같은 name 이 여러 건이면 " (2)", " (3)" 을 붙여 충돌을 피한다.
//  반환: ZIP 에 담긴 파일 수(0이면 대상 없음 — 호출부에서 안내).
async function downloadStoredFilesAsZip(files, zipName) {
  const valid = (files || []).filter((f) => f?.link_url);
  if (!valid.length) return 0;

  const JSZip = await loadJsZip();
  const zip = new JSZip();
  const usedNames = new Map(); // 동일 파일명 충돌 방지 카운터

  let added = 0;
  for (const f of valid) {
    let blob;
    try {
      const url = await getS3DownloadUrl(f.link_url);
      const res = await fetch(url);
      if (!res.ok) continue; // 한 파일 실패가 전체를 막지 않도록 건너뛴다.
      blob = await res.blob();
    } catch (_) {
      continue;
    }
    const stem = sanitizeFilename(f.name || "file");
    const ext = getFileExtension(f.originalName || f.name || "");
    const count = (usedNames.get(stem) || 0) + 1;
    usedNames.set(stem, count);
    const fname = (count > 1 ? `${stem} (${count})` : stem) + (ext ? `.${ext}` : "");
    zip.file(fname, blob);
    added += 1;
  }
  if (!added) throw new Error("파일을 내려받지 못했습니다. 잠시 후 다시 시도해주세요.");

  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(zipBlob, zipName);
  return added;
}

// 사업계획서(1차/2차)를 ZIP 한 개로 내려받는다. 파일명: "(기업명)_사업계획서_(n차)".
//  - 승인된 제출에 연결된 계획서만 포함한다(미승인 첨부/연결 id 없는 레거시는 승인으로 간주).
//  company: detail.company, budgetSubmissions: detail.budgetSubmissions
//  반환: ZIP 에 담긴 파일 수(0이면 다운로드할 승인된 계획서 없음).
export async function downloadBusinessPlansZip(company, budgetSubmissions = []) {
  const safeCompany = sanitizeFilename(company?.name || "기업");
  const plans = company?.business_plans || {};
  const approvedIds = new Set(
    (budgetSubmissions || [])
      .filter((s) => ["budget_approved", "change_approved"].includes(s.status))
      .map((s) => s.id),
  );
  const rounds = [
    { key: "round1", label: "1차" },
    { key: "round2", label: "2차" },
  ];
  const files = [];
  for (const r of rounds) {
    const plan = plans[r.key];
    if (!plan?.original_filename || !plan.link_url) continue;
    const approved = !plan.budget_submission_id || approvedIds.has(plan.budget_submission_id);
    if (!approved) continue; // 승인 전(검토 중) 계획서는 일괄 다운로드에 포함하지 않는다.
    files.push({
      link_url: plan.link_url,
      name: `${safeCompany}_사업계획서_${r.label}`,
      originalName: plan.original_filename,
    });
  }
  if (!files.length) return 0;
  return downloadStoredFilesAsZip(files, `${safeCompany}_사업계획서.zip`);
}

// 한 지출 신청의 모든 증빙 첨부파일을 모아 ZIP 한 개로 내려받는다.
//  - 사전승인/최종승인 단계에 업로드된 파일을 모두 포함한다.
//  - 파일명 정책: "(기업명)_(파일 제목)_(지출 제목)_(총액)"  예) "딜챗2_견적서_사무용품 구매_1100000원"
//    · 파일 제목 = 첨부서류 대분류(견적서 등). 같은 제목이 여러 건이면 "(2)","(3)" 을 붙인다. 확장자는 원본 유지.
//  expense: 지출 신청 객체(또는 id 문자열). 객체면 company_name/title/총액을 파일명에 사용한다.
//  반환: ZIP 에 담긴 파일 수(0이면 첨부가 없는 것 — 호출부에서 안내).
export async function downloadExpenseEvidenceZip(expense) {
  const expenseId = typeof expense === "string" ? expense : expense?.id;
  if (!expenseId) throw new Error("지출 신청 정보를 찾을 수 없습니다.");
  const exp = typeof expense === "object" && expense ? expense : {};
  const companyName = exp.company_name || exp.companyName || "기업";
  const expenseTitle = exp.title || "지출";
  const totalAmount = Number(
    exp.total_amount != null ? exp.total_amount : Number(exp.amount_supply || 0) + Number(exp.vat_amount || 0),
  );

  // 사전/최종 단계의 첨부 요구사항을 모아 실제 업로드된 파일만 추린다.
  const reqLists = await Promise.all(
    ["pre", "final"].map((phase) => remote.getExpenseDocumentRequirements(expenseId, phase)),
  );
  const seenFileIds = new Set();
  const withFiles = reqLists.flat().filter((r) => {
    if (!r?.file?.link_url || seenFileIds.has(r.file.id)) return false;
    seenFileIds.add(r.file.id);
    return true;
  });
  if (!withFiles.length) return 0;

  const safeCompany = sanitizeFilename(companyName);
  const safeTitle = sanitizeFilename(expenseTitle);
  const totalStr = `${Math.round(totalAmount).toLocaleString("ko-KR")}원`;
  // (기업명)_(파일 제목=첨부서류 대분류)_(신청명)_(금액)
  const files = withFiles.map((req) => ({
    link_url: req.file.link_url,
    name: `${safeCompany}_${sanitizeFilename(req.title || "증빙서류")}_${safeTitle}_${totalStr}`,
    originalName: req.file.original_filename,
  }));
  return downloadStoredFilesAsZip(files, `${safeCompany}_${safeTitle}_증빙서류.zip`);
}

export const deleteUploadedFile = remote.mockDeleteUploadedFile;

// 더 이상 쓰지 않는 레거시 업로드 API (uploadExpenseDocumentFile 로 대체됨).
export async function uploadDocumentFile() {
  throw new Error("uploadDocumentFile is deprecated. Use uploadExpenseDocumentFile instead.");
}
export async function markDocumentUploaded() {
  throw new Error("markDocumentUploaded is deprecated.");
}
