-- =================================================================
-- [주의] 지정된 3개 계정을 제외한 모든 사용자 및 종속 데이터를 정리하는 스크립트
-- =================================================================
-- 이 스크립트는 Supabase 대시보드의 SQL Editor에서 실행하시면 됩니다.
-- 실행 전에 반드시 백업을 해두시거나 실행 대상을 확인해 주세요.

-- 1. 지정된 3개 이메일 계정을 제외한 모든 사용자 계정 삭제
-- (auth.users에서 삭제되면 ON DELETE CASCADE 설정에 의해 public.profiles 및 public.company_members 등이 자동으로 함께 삭제됩니다.)
DELETE FROM auth.users
WHERE email NOT IN (
  'admin@ynarcher.com',
  'founder@ynarcher.com',
  'charmander24@naver.com'
) OR email IS NULL;

-- 2. 소속된 멤버(company_members)가 하나도 남지 않은 모든 기업 삭제
-- (companies에서 삭제되면 ON DELETE CASCADE 설정에 의해 해당 기업의 예산 배정, 예산 제출안, 지출 신청, 업로드된 파일 등이 자동으로 삭제됩니다.)
DELETE FROM public.companies
WHERE id NOT IN (
  SELECT DISTINCT company_id 
  FROM public.company_members
);
