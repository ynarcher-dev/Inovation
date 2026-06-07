-- ============================================================
-- 마이그레이션: 창업자 자가가입 RLS 위반 수정
--
-- 문제: 클라이언트가 companies 에 직접 INSERT 했으나 founder INSERT 를
--       허용하는 RLS 정책이 없어 "new row violates row-level security
--       policy for table companies" 로 실패했다.
-- 해결: handle_new_user(SECURITY DEFINER) 트리거가 회원가입 메타데이터로
--       프로필 + 회사 + 소속을 원자적으로 생성하도록 확장한다.
--
-- 적용: Supabase Dashboard > SQL Editor 에 붙여넣고 실행.
--       (supabase_schema.sql 의 3.1 함수와 동일 내용)
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_name                text := COALESCE(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'founder_name', '사용자');
  v_company_name        text := new.raw_user_meta_data->>'company_name';
  v_phone               text := new.raw_user_meta_data->>'phone';
  v_business_number     text := COALESCE(new.raw_user_meta_data->>'business_number', '');
  v_support_program_id  uuid;
  v_company_id          uuid;
BEGIN
  -- 1. 프로필은 항상 founder 로 생성
  INSERT INTO public.profiles (id, role, name, company_name, phone)
  VALUES (new.id, 'founder', v_name, v_company_name, v_phone);

  -- 2. 창업자 자가가입인 경우에만 회사 + 소속 생성
  IF COALESCE(new.raw_user_meta_data->>'is_founder_signup', 'false') = 'true' THEN
    BEGIN
      v_support_program_id := NULLIF(new.raw_user_meta_data->>'support_program_id', '')::uuid;
    EXCEPTION WHEN others THEN
      v_support_program_id := NULL;
    END;

    INSERT INTO public.companies (
      name, representative_name, business_number,
      support_program_id, approval_status, budget_status, phone
    )
    VALUES (
      COALESCE(NULLIF(v_company_name, ''), '미입력 회사'),
      v_name,
      v_business_number,
      v_support_program_id,
      'pending',
      'not_submitted',
      v_phone
    )
    RETURNING id INTO v_company_id;

    INSERT INTO public.company_members (company_id, user_id, member_role)
    VALUES (v_company_id, new.id, 'owner');
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 트리거는 기존 것을 그대로 재사용한다(함수 본문만 교체됨).
-- 안전을 위해 재생성:
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
