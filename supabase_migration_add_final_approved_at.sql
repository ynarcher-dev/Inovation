-- ==========================================
-- [스키마 보정] expense_requests.final_approved_at 컬럼 추가
-- ==========================================
-- 배경(2026-06-07 백엔드 E2E 에서 발견):
--   remote 어댑터 reviewExpenseRequest 가 최종승인 시 final_approved_at 를 기록하고,
--   mock(expense.mock.js) 도 동일 필드를 쓰는데, 라이브 expense_requests 테이블에
--   해당 컬럼이 없어 최종승인이 "Could not find the 'final_approved_at' column" 으로 실패한다.
--   (테이블에는 submitted_at / approved_at / final_submitted_at 만 존재)
--
-- 추가 컬럼이므로 기존 데이터/정책에 영향이 없다(nullable).
-- Supabase 대시보드 > SQL Editor 또는 supabase CLI 로 실행한다.
-- ==========================================

ALTER TABLE public.expense_requests
  ADD COLUMN IF NOT EXISTS final_approved_at timestamp with time zone;

-- 검증:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='expense_requests' AND column_name='final_approved_at';
