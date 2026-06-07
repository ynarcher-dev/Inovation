-- ==========================================
-- [스키마 정렬] ai_settings 에 enabled / provider 컬럼 추가
-- ==========================================
-- 배경(2026-06-07 백엔드 QA):
--   UI/mock 계약은 AI 설정을 { enabled, provider, model } 로 다루는데,
--   라이브 ai_settings 테이블에는 openai_api_key_configured / openai_model 만 있어
--   - updateAiSettings 가 "Could not find the 'enabled' column" 으로 실패하고
--   - AI 사용 토글(enabled)을 저장할 곳이 없어 항상 비활성으로 읽힌다.
--   (remote 어댑터는 model 을 openai_model 컬럼에 저장하도록 함께 수정함)
--
-- 추가 컬럼이므로 기존 데이터에 영향 없음(기본값 보유).
-- Supabase 대시보드 > SQL Editor 또는 supabase CLI 로 실행한다.
-- ==========================================

ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'openai';

-- 검증:
--   SELECT enabled, provider, openai_model FROM public.ai_settings WHERE id = 1;
