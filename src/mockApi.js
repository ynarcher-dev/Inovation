// 배럴(barrel): mock API 를 도메인별 파일(src/services/mock)로 분리하고,
// 기존 import 경로("./mockApi.js")와 export 이름을 그대로 유지하기 위해 재노출한다.
// 새 코드는 가급적 services/mock 의 개별 모듈을 직접 import 한다.

export {
  STORAGE_KEYS,
  load,
  save,
  uuid,
  mockStoreFile,
  mockGetFile,
} from "./services/mock/storage.mock.js";

export { initMockData } from "./services/mock/seed.js";

export {
  mockGetCurrentUser,
  mockSignIn,
  mockSignUpFounder,
  mockSignOut,
  mockVerifyCurrentPassword,
  mockChangePassword,
  mockDeleteFounderAccount,
} from "./services/mock/auth.mock.js";

export {
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
} from "./services/mock/support-program.mock.js";

export {
  mockGetAdminAccounts,
  mockCreateAdminAccount,
  mockDeleteAdminAccount,
  mockResetAdminPassword,
  mockUpdateAdminPrograms,
} from "./services/mock/admin-account.mock.js";
