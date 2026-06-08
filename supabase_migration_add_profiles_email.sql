-- ============================================================================
-- profiles 에 로그인 이메일(email) 컬럼 추가 + 가입 트리거 동기화 + 기존 사용자 백필
--   목적: 관리자 '가입신청 관리' 화면에서 가입자 ID(로그인 이메일)를 노출한다.
--   배경: 로그인 이메일은 auth.users.email 에만 있고, 브라우저 클라이언트는
--         auth 스키마를 조회할 수 없다. 따라서 public.profiles 에 email 을 복제해 둔다.
-- ============================================================================

-- 1) 컬럼 추가 (멱등)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- 2) 신규 가입 시 auth.users.email 을 profiles.email 에 함께 저장하도록 트리거 갱신
--    (기존 본문에 email 저장만 추가. 나머지 로직은 동일하게 유지)
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
  -- 1. 프로필은 항상 founder 로 생성 (로그인 이메일 포함)
  INSERT INTO public.profiles (id, role, name, company_name, phone, email)
  VALUES (new.id, 'founder', v_name, v_company_name, v_phone, new.email);

  -- 2. 창업자 자가가입인 경우에만 회사 + 소속 생성
  IF COALESCE(new.raw_user_meta_data->>'is_founder_signup', 'false') = 'true' THEN
    -- 잘못된 uuid 문자열은 NULL 로 안전 처리
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

-- 3) 기존 사용자 백필: auth.users.email 을 profiles.email 로 채운다.
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id
  AND p.email IS DISTINCT FROM u.email;
