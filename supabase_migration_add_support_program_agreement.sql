-- ============================================================================
-- support_programs 에 협약 기간(agreement_start_date / agreement_end_date) 컬럼 추가
--   목적: 협약 기간을 기업별이 아니라 '신규사업(지원사업)' 단위로 한 번만 세팅하고,
--         해당 사업에 참가한 모든 기업의 화면(기업 상세 / 창업자 대시보드)에 노출한다.
--   배경: 기존에는 companies.agreement_start_date/end_date 만 있고 이를 세팅할 UI 가
--         없어 화면에 항상 '-'(미정) 으로 표시되었다. 신규사업 관리 화면에서 입력받는다.
-- ============================================================================

ALTER TABLE public.support_programs ADD COLUMN IF NOT EXISTS agreement_start_date date;
ALTER TABLE public.support_programs ADD COLUMN IF NOT EXISTS agreement_end_date   date;
