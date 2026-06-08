-- ============================================================================
-- 증빙 파일명 정리기 설정(evidence_filename_settings) 싱글톤 테이블 추가
--   목적: 기업 상세 > 예산 사용 현황의 '증빙 다운로드' ZIP 안 파일명 규칙(템플릿)을
--         코드 하드코딩 대신 관리자가 직접 조립하고 서버에 공유 저장한다.
--   배경: 기존 downloadExpenseEvidenceZip 은 "(기업명)_(첨부분류)_(신청명)_(총액)" 으로
--         파일명이 고정돼 있어 기관/사업마다 다른 규칙을 쓸 수 없었다.
--   구조: ai_settings 와 동일한 단일 행(id=1) + 관리자 전용 RLS 패턴.
--         template  - 토큰({기업명},{첨부분류},{신청제목},{순번} 등)을 포함한 파일명 규칙
--         seq_start - {순번} 시작값(기본 1)
--         seq_pad   - {순번} 0패딩 자릿수(1 → "1", 2 → "01")
--   Supabase 대시보드 > SQL Editor 또는 supabase CLI 로 실행한다(멱등).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.evidence_filename_settings (
  id          bigint PRIMARY KEY DEFAULT 1,
  template    text NOT NULL DEFAULT '{기업명}_{첨부분류}_{신청제목}_{총액}',
  seq_start   integer NOT NULL DEFAULT 1,
  seq_pad     integer NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_filename_settings_singleton CHECK (id = 1)
);

ALTER TABLE public.evidence_filename_settings ENABLE ROW LEVEL SECURITY;

-- 관리자만 읽기/쓰기(이 설정은 관리자 화면 전용 — 창업자 read 정책 불필요).
DROP POLICY IF EXISTS "evidence_filename_settings_admin_all" ON public.evidence_filename_settings;
CREATE POLICY "evidence_filename_settings_admin_all" ON public.evidence_filename_settings
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- 기본 행(id=1) 시드. 이미 있으면 건드리지 않는다.
INSERT INTO public.evidence_filename_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- 검증:
--   SELECT id, template, seq_start, seq_pad FROM public.evidence_filename_settings;  -- 1행
