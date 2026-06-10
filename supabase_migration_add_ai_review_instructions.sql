-- AI 관리에서 설정하는 전역 추가 검토 지침.
-- 예산 심사와 지출 증빙 검토 프롬프트에 공통 적용한다.

ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS review_instructions text NOT NULL DEFAULT '';

ALTER TABLE public.ai_settings
  DROP CONSTRAINT IF EXISTS chk_ai_review_instructions_length;

ALTER TABLE public.ai_settings
  ADD CONSTRAINT chk_ai_review_instructions_length
  CHECK (char_length(review_instructions) <= 4000);
