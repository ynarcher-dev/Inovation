-- ============================================================================
-- 지출결의서 텍스트 템플릿(expense_voucher_settings) 싱글톤 테이블 추가
--   목적: 기업 상세 > 예산 사용 현황의 '지출결의' 버튼이 생성하는 텍스트(자사 결재시스템
--         복붙용)를 코드 하드코딩 대신 관리자가 직접 조립하고 서버에 공유 저장한다.
--   배경: 증빙 '파일명 정리기'(evidence_filename_settings)와 동일한 패턴. 다만 출력은
--         순수 텍스트이며, {첨부목록} 토큰은 파일명 정리기 규칙대로 첨부 파일명을 나열한다.
--   구조: 단일 행(id=1) + 관리자 전용 RLS(public.is_admin()).
--         template - 토큰({기업명},{거래처},{총액},{첨부목록} 등)을 포함한 지출결의서 본문
--   Supabase 대시보드 > SQL Editor 또는 supabase CLI 로 실행한다(멱등).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.expense_voucher_settings (
  id          bigint PRIMARY KEY DEFAULT 1,
  template    text NOT NULL DEFAULT E'[지출결의서]\n\n기업명: {기업명}\n대표자: {대표자}\n건명: {신청제목}\n예산항목: {예산항목}\n거래처: {거래처} ({사업자번호})\n공급가액: {공급가액}\n부가세: {부가세}\n합계: {총액}\n지출사유: {적요}\n신청일: {제출일}\n\n[첨부서류]\n{첨부목록}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_voucher_settings_singleton CHECK (id = 1)
);

ALTER TABLE public.expense_voucher_settings ENABLE ROW LEVEL SECURITY;

-- 관리자만 읽기/쓰기(관리자 화면 전용 — 창업자 read 정책 불필요).
DROP POLICY IF EXISTS "expense_voucher_settings_admin_all" ON public.expense_voucher_settings;
CREATE POLICY "expense_voucher_settings_admin_all" ON public.expense_voucher_settings
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- 기본 행(id=1) 시드. 이미 있으면 건드리지 않는다.
INSERT INTO public.expense_voucher_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- 검증:
--   SELECT id, template FROM public.expense_voucher_settings;  -- 1행
