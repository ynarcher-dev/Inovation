-- ==========================================
-- [스키마 정렬] ai_settings 에 AI관리 화면 필드 추가
-- ==========================================
-- 배경(2026-06-07):
--   AI관리 화면은 enabled/provider/model 외에 edge_function_url / api_key_configured /
--   api_key_hint / memo 도 저장하는데, ai_settings 테이블에 해당 컬럼이 없어
--   저장이 안 되고(저장 후 화면이 다시 읽으면 빈칸으로 사라짐), AI 호출 시
--   "Edge Function URL을 입력해주세요" / "API Key 미등록" 으로 실패한다.
--   (remote 어댑터 getAiSettings/updateAiSettings 도 이 컬럼들을 읽고/쓰도록 함께 수정)
--
-- 추가 컬럼이므로 기존 데이터에 영향 없음.
-- Supabase 대시보드 > SQL Editor 또는 supabase CLI 로 실행한다.
-- ==========================================

ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS api_key_configured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edge_function_url text,
  ADD COLUMN IF NOT EXISTS api_key_hint text,
  ADD COLUMN IF NOT EXISTS memo text;

-- 검증:
--   SELECT enabled, provider, openai_model, api_key_configured, edge_function_url, api_key_hint, memo
--   FROM public.ai_settings WHERE id = 1;
