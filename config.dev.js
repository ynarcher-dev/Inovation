// config.dev.js - 개발 및 로컬 테스트용 설정 파일
window.APP_CONFIG = {
  env: "development",
  supabaseUrl: "https://kbyuumrgmovngaahycmk.supabase.co",
  supabaseAnonKey: "sb_publishable_IWbWxOxtH_89WfyHPWzN2w_KMVkjVKN",
  s3FunctionUrl: "https://kbyuumrgmovngaahycmk.supabase.co/functions/v1/s3-presigned-url",
  
  // 개발 단계에서는 브라우저의 Mock API(임시 LocalStorage 데이터)를 사용하여 안전하게 개발합니다.
  useMockApi: true,
};
