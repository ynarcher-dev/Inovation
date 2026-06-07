// config.prod.js - 라이브(운영) 배포용 설정 주입 파일
// 이 파일을 웹 서버의 루트 경로에 업로드하고, 각 HTML 파일의 <head> 상단에서 로드되도록 설정합니다.
window.APP_CONFIG = {
  env: "production",
  
  // 실제 연동된 Supabase 프로젝트 정보로 변경하세요.
  supabaseUrl: "https://kbyuumrgmovngaahycmk.supabase.co", 
  supabaseAnonKey: "sb_publishable_IWbWxOxtH_89WfyHPWzN2w_KMVkjVKN",
  
  // S3 Presigned URL 발급을 담당하는 Supabase Edge Function URL입니다.
  s3FunctionUrl: "https://kbyuumrgmovngaahycmk.supabase.co/functions/v1/s3-presigned-url",

  // 라이브 환경에서는 mock(임시) 데이터를 사용하지 않고 실제 Supabase DB/S3를 사용합니다.
  useMockApi: false, 

  // 로그인 세션에서 JWT 토큰을 가져와 Edge Function 인증에 사용합니다.
  getSupabaseAccessToken: async () => {
    return (await window.supabaseClient?.auth?.getSession())?.data?.session?.access_token || null;
  }
};
