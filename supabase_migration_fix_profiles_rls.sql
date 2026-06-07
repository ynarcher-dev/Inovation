-- ==========================================
-- [보안 수정] profiles 테이블 RLS 재적용
-- ==========================================
--
-- 배경(2026-06-07 QA에서 발견):
--   라이브 DB의 public.profiles 가 익명(anon publishable key)으로 전체 조회되고,
--   익명 INSERT 시도가 RLS 거부(42501)가 아니라 FK 위반(23503)으로 떨어졌다.
--   => profiles 에 RLS 가 (사실상) 비활성 상태였다. (다른 테이블 companies/expense_requests/
--      company_members/support_programs/ai_settings 는 익명 INSERT 가 42501 로 정상 차단됨)
--
-- 영향(왜 위험한가):
--   - 공개 anon 키(클라이언트 JS 에 포함)만으로 전체 사용자 실명/역할/연락처/UUID 노출.
--   - RLS 가 쓰기를 막지 못하므로, 가입한 일반 사용자가 자신의 auth.users id 로
--     profiles.role 을 'super_admin' 으로 PATCH 하는 권한 상승이 가능.
--
-- 이 스크립트는 커밋된 supabase_schema.sql §4.2 의 정책을 그대로 재적용한다(멱등).
-- Supabase 대시보드 > SQL Editor 또는 supabase CLI 로 실행한다.
--
-- 참고: profiles 를 참조하는 is_admin()/is_super_admin() 는 SECURITY DEFINER 이며
--   postgres(소유자, BYPASSRLS) 권한으로 실행되므로 RLS 재귀가 발생하지 않는다.
--   동일 함수를 쓰는 companies 등 다른 테이블이 RLS 활성 상태로 정상 동작 중인 것이 그 근거다.
-- ==========================================

BEGIN;

-- 1) RLS 재활성화 (+ 테이블 소유자도 우회하지 못하도록 FORCE)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

-- 2) 혹시 라이브에 추가됐을 수 있는 임시 허용 정책 제거(이름 불문 전수 정리)
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles;', pol.policyname);
  END LOOP;
END $$;

-- 3) 정식 정책 재생성 (supabase_schema.sql §4.2 와 동일)
--    - 본인 프로필: 본인만 조회/수정 (role/program_ids 자가 변경은 서버 service_role 로 제한 권장)
CREATE POLICY "profiles_self_select" ON public.profiles
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);
--    - 관리자: 전체 조회 / 슈퍼관리자: 전체 관리
CREATE POLICY "profiles_admin_select" ON public.profiles
    FOR SELECT USING (public.is_admin());
CREATE POLICY "profiles_super_admin_all" ON public.profiles
    FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

COMMIT;

-- ==========================================
-- 검증 (실행 후 확인)
-- ==========================================
-- (a) RLS 활성/강제 여부 — relrowsecurity, relforcerowsecurity 모두 t 여야 한다.
--   SELECT relname, relrowsecurity, relforcerowsecurity
--   FROM pg_class WHERE relname = 'profiles';
--
-- (b) 정책 목록 — self_select / self_update / admin_select / super_admin_all 4개여야 한다.
--   SELECT policyname, cmd, qual FROM pg_policies
--   WHERE schemaname='public' AND tablename='profiles' ORDER BY policyname;
--
-- (c) 익명 차단 재확인(anon 키로): 아래가 빈 배열([])을 반환해야 한다(현재는 5행 노출).
--   curl 'https://<ref>.supabase.co/rest/v1/profiles?select=id' \
--     -H 'apikey: <anon>' -H 'Authorization: Bearer <anon>'
