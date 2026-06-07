// 앱 전역 설정.
// 환경별 값은 배포 파일 수정이 아니라 window.APP_CONFIG 주입으로 덮어쓴다.
// (index.html 보다 먼저 로드되는 <script>에서 window.APP_CONFIG = {...} 형태로 주입)
const appConfig = typeof window !== "undefined" ? window.APP_CONFIG : null;

const isLocal = typeof window !== "undefined" && 
  (window.location.hostname === "localhost" || 
   window.location.hostname === "127.0.0.1" || 
   window.location.hostname.startsWith("192.168."));

export const CONFIG = {
  supabaseUrl: appConfig?.supabaseUrl || "https://kbyuumrgmovngaahycmk.supabase.co",
  supabaseAnonKey: appConfig?.supabaseAnonKey || "sb_publishable_IWbWxOxtH_89WfyHPWzN2w_KMVkjVKN",
  apiBaseUrl: appConfig?.apiBaseUrl || "/api",

  // 데이터 API 모드. true=브라우저 mock(localStorage/IndexedDB), false=실제 Supabase.
  // 로컬 개발 환경과 배포 환경 모두 실제 Supabase/S3 라이브 서버에 연결하도록 false로 설정합니다.
  useMockApi: appConfig?.useMockApi ?? false,

  // 배포 환경 구분. window.APP_CONFIG.env = "production" 등으로 주입한다.
  env: appConfig?.env || (isLocal ? "development" : "production"),

  s3FunctionUrl: appConfig?.s3FunctionUrl || "https://kbyuumrgmovngaahycmk.supabase.co/functions/v1/s3-presigned-url",
};

export const hasSupabaseConfig = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

// mock 모드 여부 단일 진입점. 화면/서비스 계층은 이 값으로 mock/remote 를 분기한다.
export const isMockApi = CONFIG.useMockApi === true;
export const isProduction = CONFIG.env === "production";
