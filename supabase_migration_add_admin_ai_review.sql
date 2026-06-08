-- 관리자 2차 AI 서류검토 결과 저장용 컬럼 추가
-- 창업가(신청자)의 1차 검토 결과(ai_review_*)는 그대로 두고,
-- 관리자가 다시 실행한 검토 결과는 admin_ai_* 컬럼에 분리 저장한다.
-- 이렇게 분리하면 관리자 재검토가 창업가 화면(ai_review_* 만 읽음)에 반영되지 않는다.

ALTER TABLE public.uploaded_files
  ADD COLUMN IF NOT EXISTS admin_ai_review_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS admin_ai_review_comment text,
  ADD COLUMN IF NOT EXISTS admin_ai_check_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS admin_ai_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_ai_reviewed_at timestamptz;

-- 기존 chk_ai_review_status 와 동일한 값 집합으로 제약(중복 적용 방지)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_admin_ai_review_status'
  ) THEN
    ALTER TABLE public.uploaded_files
      ADD CONSTRAINT chk_admin_ai_review_status
      CHECK (admin_ai_review_status IN ('not_requested', 'pending', 'passed', 'needs_revision', 'failed'));
  END IF;
END $$;
