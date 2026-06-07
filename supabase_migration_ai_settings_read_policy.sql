-- ==========================================
-- [RLS 수정] ai_settings 인증 사용자 읽기 허용 (창업자 AI검토 활성화)
-- ==========================================
-- 배경(2026-06-07):
--   ai_settings 의 RLS 정책이 관리자 전용(ai_settings_admin_all, FOR ALL USING is_admin())
--   하나뿐이라, 창업자 세션에서는 이 단일 설정 행을 한 줄도 읽지 못한다.
--   getAiSettings() 는 maybeSingle() 결과가 비면(에러 없이) enabled:false 기본값으로
--   떨어지므로, 관리자가 AI 토글을 켜도 창업자 화면(지출/보완)에서는:
--     1) DocumentPhasePanel 의 AI검토 바·일괄검토 버튼이 항상 숨겨지고,
--     2) 설령 호출돼도 requestDocumentReview 가 enabled/edge_function_url 을 읽지 못해
--        "AI 기능이 비활성화되어 있습니다" 로 실패한다.
--
--   이 테이블에는 실제 API 키가 저장되지 않는다(키는 Edge Function Secret 에만 존재).
--   보관 값은 enabled / provider / model / edge_function_url / api_key_configured(bool)
--   /api_key_hint(마스킹) / memo 뿐이므로, 인증 사용자에게 '읽기 전용'을 열어도
--   실제 비밀은 노출되지 않는다. 쓰기(INSERT/UPDATE/DELETE)는 관리자 전용을 유지한다.
--
-- Supabase 대시보드 > SQL Editor 또는 supabase CLI 로 실행한다.
-- ==========================================

-- 기존 관리자 전용 FOR ALL 정책은 그대로 두고(쓰기 권한 유지),
-- 인증 사용자용 SELECT 정책을 추가한다. (permissive 정책은 OR 로 합쳐진다)
DROP POLICY IF EXISTS "ai_settings_authenticated_read" ON public.ai_settings;
CREATE POLICY "ai_settings_authenticated_read" ON public.ai_settings
    FOR SELECT
    TO authenticated
    USING (true);

-- 검증:
--   -- 창업자 계정으로 로그인한 클라이언트에서:
--   SELECT enabled, provider, openai_model, api_key_configured, edge_function_url
--   FROM public.ai_settings;   -- 1행이 조회되어야 한다(과거엔 0행).
