// Mock storage 계층: localStorage 헬퍼 + IndexedDB 파일 보관 + 공용 키/uuid.
// mockApi.js(배럴)와 seed/auth/support-program mock 이 공유하는 기반 모듈.

export const STORAGE_KEYS = {
  USERS: "mock_users",
  CURRENT_USER: "mock_current_user",
  COMPANIES: "mock_companies",
  PROFILES: "mock_profiles",
  MEMBERS: "mock_company_members",
  EXPENSES: "mock_expense_requests",
  PLANS: "mock_business_plans",
  PLAN_ITEMS: "mock_business_plan_items",
  PROGRAMS: "mock_support_programs",
  BUDGETS: "mock_support_program_budgets",
  ALLOCATIONS: "mock_company_budget_allocations",
  BUDGET_SUBMISSIONS: "mock_budget_submissions",
  BUDGET_SUBMISSION_ITEMS: "mock_budget_submission_items",
  UPLOADED_FILES: "mock_uploaded_files",
  REVIEWS: "mock_reviews",
  GUIDANCE: "mock_guidance_items",
  FILES: "mock_file_blobs",
  // 예산 항목별 커스텀 첨부서류 요구사항 (custom-document-requirements-plan.md §5.1)
  DOC_REQUIREMENTS: "mock_document_requirements",
  // 운영사업 공통 AI 검토 기준 문서 (custom-document-requirements-plan.md §5.3)
  AI_CRITERIA: "mock_program_ai_criteria",
  AI_SETTINGS: "mock_ai_settings",
};

// IndexedDB Helper functions
const DB_NAME = "MockFileDB";
const STORE_NAME = "files";

function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function dbStoreFile(key, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbGetFile(key) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("IndexedDB get error:", err);
    return null;
  }
}

// 실제 첨부 파일(바이트)을 dataURL 로 보관한다(mock 환경). 다운로드 시 그대로 복원한다.
// 반환 key 는 link_url 로 사용되어 다른 레코드(guidance/business_plan 등)와 연결된다.
export async function mockStoreFile(dataUrl, filename, type) {
  const key = `storage:${uuid()}:${filename}`;
  const fileData = { data: dataUrl, filename, type: type || "application/octet-stream" };
  await dbStoreFile(key, fileData);
  return key;
}

export async function mockGetFile(key) {
  if (!key) return null;
  return await dbGetFile(key);
}

// Helper: load from localStorage
export function load(key, defaultVal = []) {
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : defaultVal;
}

// Helper: save to localStorage
export function save(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

// ----------------------------------------------------
// 현재 사용자 세션: "로그인 유지" 여부에 따라 저장소를 달리한다.
//  - 유지 O: localStorage  (브라우저를 닫아도 로그인 유지)
//  - 유지 X: sessionStorage (탭/브라우저를 닫으면 로그아웃)
// 읽을 때는 sessionStorage 를 우선 확인한다(미유지 로그인이 항상 우선).
// ----------------------------------------------------
export function saveCurrentUser(user, remember) {
  const json = JSON.stringify(user);
  if (remember) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, json);
    sessionStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  } else {
    sessionStorage.setItem(STORAGE_KEYS.CURRENT_USER, json);
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  }
}

export function loadCurrentUser() {
  const raw =
    sessionStorage.getItem(STORAGE_KEYS.CURRENT_USER) ||
    localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
  return raw ? JSON.parse(raw) : null;
}

export function clearCurrentUser() {
  localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  sessionStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
}

// UUID generator
export function uuid() {
  return "uuid-" + Math.random().toString(36).substr(2, 9);
}
