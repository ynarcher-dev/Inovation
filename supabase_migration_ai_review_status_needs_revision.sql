-- ==========================================
-- [제약 수정] uploaded_files.ai_review_status 에 needs_revision 허용
-- ==========================================
-- 배경(2026-06-07):
--   AI 문서검토 결과는 normalizeDocumentReviewResult 에서 'passed' 또는
--   'needs_revision' 으로 정규화되고, mockSaveAiDocumentReviewResult 가
--   uploaded_files.ai_review_status 에 그 값을 그대로 저장한다.
--   그러나 컬럼 CHECK 제약(chk_ai_review_status)은
--     ('not_requested', 'pending', 'passed', 'failed')
--   만 허용해 'needs_revision' 이 빠져 있다.
--   → 서류가 '보완 필요'로 판정되는 순간 PATCH /uploaded_files 가
--     400 (check constraint 위반)으로 실패한다. (passed 는 정상)
--   UI(DocumentPhasePanel AI_STATUS) 전반이 needs_revision 을 정식 상태로
--   사용하므로, 제약에 이 값을 추가해 코드와 정렬한다.
--
-- 값을 넓히기만 하므로 기존 데이터 위반 없음.
-- Supabase 대시보드 > SQL Editor 또는 supabase CLI 로 실행한다.
-- ==========================================

ALTER TABLE public.uploaded_files
  DROP CONSTRAINT IF EXISTS chk_ai_review_status;

ALTER TABLE public.uploaded_files
  ADD CONSTRAINT chk_ai_review_status
  CHECK (ai_review_status IN ('not_requested', 'pending', 'passed', 'needs_revision', 'failed'));

-- 검증:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint WHERE conname = 'chk_ai_review_status';
