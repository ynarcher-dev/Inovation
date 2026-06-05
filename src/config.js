// 앱 전역 설정.
// 환경별 값은 배포 파일 수정이 아니라 window.APP_CONFIG 주입으로 덮어쓴다.
// (index.html 보다 먼저 로드되는 <script>에서 window.APP_CONFIG = {...} 형태로 주입)
export const CONFIG = {
  supabaseUrl: window.APP_CONFIG?.supabaseUrl || "https://kbyuumrgmovngaahycmk.supabase.co",
  supabaseAnonKey: window.APP_CONFIG?.supabaseAnonKey || "sb_publishable_IWbWxOxtH_89WfyHPWzN2w_KMVkjVKN",
  apiBaseUrl: window.APP_CONFIG?.apiBaseUrl || "/api",

  // 데이터 API 모드. true=브라우저 mock(localStorage/IndexedDB), false=실제 Supabase.
  // 주입이 없으면 안전하게 mock 모드를 기본값으로 한다.
  // 실제 Supabase 어댑터 구현은 docs/api-migration.md 의 전환 순서를 따른다.
  useMockApi: window.APP_CONFIG?.useMockApi ?? true,

  // 배포 환경 구분. window.APP_CONFIG.env = "production" 등으로 주입한다.
  env: window.APP_CONFIG?.env || "development",
};

export const hasSupabaseConfig = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

// mock 모드 여부 단일 진입점. 화면/서비스 계층은 이 값으로 mock/remote 를 분기한다.
export const isMockApi = CONFIG.useMockApi === true;
export const isProduction = CONFIG.env === "production";
