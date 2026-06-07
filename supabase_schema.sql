-- ==========================================
-- 운영용 스키마 (재실행 가능 / 비파괴)
-- ==========================================
--
-- 이 파일은 빈 DB 또는 기존 DB에 여러 번 실행해도 안전하도록 작성되었다.
--   - 테이블: CREATE TABLE IF NOT EXISTS (기존 테이블은 건드리지 않음)
--   - 인덱스: CREATE INDEX IF NOT EXISTS
--   - 함수:   CREATE OR REPLACE
--   - 트리거/정책: DROP ... IF EXISTS 후 재생성
--
-- 주의:
--   - 이 파일에는 무조건적인 DROP TABLE 이 없다.
--   - 개발 DB를 완전히 비우려면 supabase/reset_dev.sql 을 별도로 실행한다.
--   - 이미 존재하는 테이블의 컬럼 변경은 supabase/migrations/* 로 처리한다.
-- ==========================================


-- ==========================================
-- 1. 테이블 생성 (DDL)
-- ==========================================

-- 1.1 AI 설정 테이블
CREATE TABLE IF NOT EXISTS public.ai_settings (
    id integer PRIMARY KEY DEFAULT 1,
    enabled boolean NOT NULL DEFAULT false,
    provider text NOT NULL DEFAULT 'openai',
    openai_api_key_configured boolean NOT NULL DEFAULT false,
    openai_model text NOT NULL DEFAULT 'gpt-4o',
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT chk_single_row CHECK (id = 1)
);

-- 1.2 운영사업 테이블
CREATE TABLE IF NOT EXISTS public.support_programs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    code text NOT NULL UNIQUE,
    active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    level_labels jsonb NOT NULL DEFAULT '{"1": "대분류", "2": "중분류", "3": "소분류"}'::jsonb,
    description text,
    memo text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 1.3 운영사업별 표준 예산 비목 템플릿 테이블
CREATE TABLE IF NOT EXISTS public.support_program_budgets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    support_program_id uuid NOT NULL REFERENCES public.support_programs(id) ON DELETE CASCADE,
    parent_id uuid REFERENCES public.support_program_budgets(id) ON DELETE CASCADE,
    level integer NOT NULL,
    title text NOT NULL,
    budget_category text,
    allocated_amount numeric NOT NULL DEFAULT 0,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sp_budgets_program ON public.support_program_budgets(support_program_id);

-- 1.4 기업 정보 테이블
CREATE TABLE IF NOT EXISTS public.companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    representative_name text NOT NULL,
    business_number text NOT NULL,
    support_total_amount numeric NOT NULL DEFAULT 0,
    self_payment_required_amount numeric NOT NULL DEFAULT 0,
    self_payment_paid boolean NOT NULL DEFAULT false,
    agreement_start_date date,
    agreement_end_date date,
    support_program_id uuid REFERENCES public.support_programs(id) ON DELETE SET NULL,
    approval_status text NOT NULL DEFAULT 'pending' CONSTRAINT chk_company_approval CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    budget_status text NOT NULL DEFAULT 'not_submitted' CONSTRAINT chk_budget_status CHECK (budget_status IN ('not_submitted', 'budget_submitted', 'budget_revision_requested', 'budget_approved', 'change_submitted', 'change_revision_requested', 'change_approved')),
    business_plans jsonb NOT NULL DEFAULT '{}'::jsonb, -- { "round1": { "original_filename": "...", "link_url": "...", "updated_at": "..." }, "round2": ... }
    internal_memo text,
    phone text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    approved_at timestamp with time zone
);

-- 1.5 사용자 프로필 테이블 (Supabase Auth 연동)
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'founder' CONSTRAINT chk_user_role CHECK (role IN ('super_admin', 'admin', 'founder')),
    name text NOT NULL,
    company_name text,
    phone text,
    program_ids uuid[], -- 일반관리자의 경우 담당 사업 ID 배열
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 1.6 기업 소속원 테이블
CREATE TABLE IF NOT EXISTS public.company_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    member_role text NOT NULL DEFAULT 'owner' CONSTRAINT chk_member_role CHECK (member_role IN ('owner', 'member')),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(company_id, user_id)
);

-- 1.7 기업별 비목 확정 예산 배정 테이블
CREATE TABLE IF NOT EXISTS public.company_budget_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    support_program_budget_id uuid NOT NULL REFERENCES public.support_program_budgets(id) ON DELETE CASCADE,
    round1_allocated_amount numeric NOT NULL DEFAULT 0,
    round2_allocated_amount numeric NOT NULL DEFAULT 0,
    allocated_amount numeric NOT NULL DEFAULT 0, -- round1 + round2 (트리거로 자동 계산됨)
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(company_id, support_program_budget_id)
);

-- 1.8 예산 제출 이력 테이블
CREATE TABLE IF NOT EXISTS public.budget_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    type text NOT NULL CONSTRAINT chk_submission_type CHECK (type IN ('initial', 'change')),
    status text NOT NULL CONSTRAINT chk_submission_status CHECK (status IN ('budget_submitted', 'budget_revision_requested', 'budget_approved', 'change_submitted', 'change_revision_requested', 'change_approved')),
    reason text,
    submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    submitted_at timestamp with time zone NOT NULL DEFAULT now(),
    reviewed_by text,
    reviewed_at timestamp with time zone,
    review_comment text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 1.9 예산 제출별 항목 요청 테이블
CREATE TABLE IF NOT EXISTS public.budget_submission_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_submission_id uuid NOT NULL REFERENCES public.budget_submissions(id) ON DELETE CASCADE,
    support_program_budget_id uuid NOT NULL REFERENCES public.support_program_budgets(id) ON DELETE CASCADE,
    previous_allocated_amount numeric NOT NULL DEFAULT 0,
    requested_allocated_amount numeric NOT NULL DEFAULT 0,
    approved_allocated_amount numeric NOT NULL DEFAULT 0,
    requested_round1_allocated_amount numeric DEFAULT 0,
    requested_round2_allocated_amount numeric DEFAULT 0,
    UNIQUE(budget_submission_id, support_program_budget_id)
);

-- 1.10 지출 신청 테이블
CREATE TABLE IF NOT EXISTS public.expense_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    founder_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    business_plan_item_id uuid REFERENCES public.company_budget_allocations(id) ON DELETE SET NULL,
    title text NOT NULL,
    expense_type text NOT NULL,
    budget_category text,
    amount_supply numeric NOT NULL DEFAULT 0,
    vat_amount numeric NOT NULL DEFAULT 0,
    total_amount numeric NOT NULL DEFAULT 0,
    vendor_name text,
    vendor_business_number text,
    purpose text,
    advance_payment_requested boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'draft' CONSTRAINT chk_expense_status CHECK (status IN ('draft', 'pre_approval_submitted', 'pre_approval_revision', 'pre_approved', 'final_approval_submitted', 'final_approval_revision', 'final_approved', 'rejected')),
    expected_completion_date date,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    final_submitted_at timestamp with time zone,
    final_approved_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_requests_company ON public.expense_requests(company_id);

-- 1.11 지출 결재/검토 이력 테이블
CREATE TABLE IF NOT EXISTS public.expense_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_request_id uuid NOT NULL REFERENCES public.expense_requests(id) ON DELETE CASCADE,
    reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    decision text NOT NULL, -- approved, revision_requested, rejected
    comment text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 1.12 운영사업 안내자료 테이블
CREATE TABLE IF NOT EXISTS public.guidance_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    content text,
    link_url text,
    active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    support_program_id uuid NOT NULL REFERENCES public.support_programs(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 1.13 비목별 첨부서류 요구조건 설정 테이블
CREATE TABLE IF NOT EXISTS public.budget_document_requirements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    support_program_id uuid NOT NULL REFERENCES public.support_programs(id) ON DELETE CASCADE,
    support_program_budget_id uuid NOT NULL REFERENCES public.support_program_budgets(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text,
    phase text NOT NULL CONSTRAINT chk_doc_req_phase CHECK (phase IN ('pre', 'final', 'both')),
    required boolean NOT NULL DEFAULT true,
    ai_review_enabled boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 1.14 운영사업 공통 AI 검토 기준 문서 테이블
CREATE TABLE IF NOT EXISTS public.ai_criteria_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    support_program_id uuid NOT NULL REFERENCES public.support_programs(id) ON DELETE CASCADE,
    title text NOT NULL,
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    link_url text NOT NULL,
    extracted_criteria_text text,
    extraction_status text NOT NULL DEFAULT 'pending' CONSTRAINT chk_extraction_status CHECK (extraction_status IN ('pending', 'processing', 'completed', 'failed')),
    active boolean NOT NULL DEFAULT true,
    uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 1.15 지출 신청별 업로드 파일 정보 테이블
CREATE TABLE IF NOT EXISTS public.uploaded_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_request_id uuid NOT NULL REFERENCES public.expense_requests(id) ON DELETE CASCADE,
    requirement_id uuid REFERENCES public.budget_document_requirements(id) ON DELETE SET NULL,
    support_program_budget_id uuid REFERENCES public.support_program_budgets(id) ON DELETE SET NULL,
    phase text NOT NULL CONSTRAINT chk_uploaded_file_phase CHECK (phase IN ('pre', 'final')),
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    link_url text NOT NULL, -- Storage object path 또는 key
    uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ai_review_status text NOT NULL DEFAULT 'not_requested' CONSTRAINT chk_ai_review_status CHECK (ai_review_status IN ('not_requested', 'pending', 'passed', 'failed')),
    ai_review_comment text,
    ai_check_result jsonb NOT NULL DEFAULT '{}'::jsonb,
    cleared boolean NOT NULL DEFAULT false,
    user_review_comment text,
    user_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_expense ON public.uploaded_files(expense_request_id);

ALTER TABLE public.support_programs ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;



-- ==========================================
-- 2. 보안 헬퍼 함수 (RLS 재귀 방지)
-- ==========================================
-- RLS 정책 안에서 public.profiles 를 직접 조회하면, profiles 자신에 대한
-- 정책이 다시 평가되어 "infinite recursion detected in policy" 오류가 난다.
-- 아래 함수들은 SECURITY DEFINER 로 RLS 를 우회해 역할/소속을 판정한다.
-- search_path 를 고정해 함수 하이재킹을 방지한다.

CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_check text;
BEGIN
  -- 무한 재귀 호출 방지를 위한 세션 변수 체크
  v_check := current_setting('my.is_admin_check', true);
  IF v_check IS NOT NULL AND v_check <> '' THEN
    RETURN v_check::boolean;
  END IF;

  -- 임시로 세션 변수 설정 (재귀 방지용 플래그)
  PERFORM set_config('my.is_admin_check', 'false', true);

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  ) INTO v_is_admin;

  -- 최종 권한 결과를 세션 변수에 저장해 재사용
  PERFORM set_config('my.is_admin_check', v_is_admin::text, true);

  RETURN v_is_admin;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_super boolean;
  v_check text;
BEGIN
  -- 무한 재귀 호출 방지를 위한 세션 변수 체크
  v_check := current_setting('my.is_super_admin_check', true);
  IF v_check IS NOT NULL AND v_check <> '' THEN
    RETURN v_check::boolean;
  END IF;

  -- 임시로 세션 변수 설정 (재귀 방지용 플래그)
  PERFORM set_config('my.is_super_admin_check', 'false', true);

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin'
  ) INTO v_is_super;

  -- 최종 권한 결과를 세션 변수에 저장해 재사용
  PERFORM set_config('my.is_super_admin_check', v_is_super::text, true);

  RETURN v_is_super;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_company_member(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_id = cid AND user_id = auth.uid()
  );
$$;

-- 일반관리자(admin)가 해당 운영사업 담당인지 판정. super_admin 은 항상 true.
CREATE OR REPLACE FUNCTION public.admin_handles_program(pid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (
        role = 'super_admin'
        OR (role = 'admin' AND pid = ANY(COALESCE(program_ids, ARRAY[]::uuid[])))
      )
  );
$$;


-- ==========================================
-- 3. 트리거 정의 (Triggers & Functions)
-- ==========================================

-- 3.1 Supabase Auth 회원가입 시 public.profiles 자동 생성 트리거
--  보안: 회원가입자가 raw_user_meta_data 로 role 을 직접 지정하지 못하게 한다.
--  자가가입은 항상 'founder' 로 고정한다. admin/super_admin 승격은
--  service_role(서버) 또는 관리자 콘솔 전용 경로에서만 수행한다.
--
--  창업자 자가가입(is_founder_signup = true)인 경우, 회사(companies)와
--  소속(company_members)까지 이 트리거 안에서 원자적으로 생성한다.
--  - companies/company_members 에는 founder 가 직접 INSERT 할 수 있는 RLS
--    정책이 없으므로(설계상 의도), SECURITY DEFINER 인 이 트리거가 유일한
--    생성 경로다. 클라이언트에서 직접 insert 하지 않는다.
--  - 이메일 확인이 켜져 있어 가입 직후 세션이 없어도 동작한다.
--  - role 은 항상 'founder' 로 고정되며, 회사는 항상 'pending' 으로 생성된다.
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3.2 확정 예산 테이블(company_budget_allocations) 총액 계산 트리거
CREATE OR REPLACE FUNCTION public.calculate_total_allocation()
RETURNS trigger AS $$
BEGIN
  new.allocated_amount := new.round1_allocated_amount + new.round2_allocated_amount;
  new.updated_at := now();
  RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_allocation_amount_change ON public.company_budget_allocations;
CREATE TRIGGER on_allocation_amount_change
  BEFORE INSERT OR UPDATE ON public.company_budget_allocations
  FOR EACH ROW EXECUTE FUNCTION public.calculate_total_allocation();


-- ==========================================
-- 4. 로우 레벨 보안 정책 (Row Level Security - RLS)
-- ==========================================
-- 정책 분류 원칙
--   - founder      : 본인이 소속된 회사의 데이터만 (company_members 기준)
--   - admin        : 담당 운영사업(program_ids)에 속한 회사의 데이터만
--   - super_admin  : 전체
--   - anon(비로그인): 가입 화면에 필요한 '활성 운영사업/표준 비목'만 조회

-- RLS 활성화
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_program_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_budget_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_submission_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guidance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_document_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_criteria_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

-- ---- 4.1 운영사업 / 표준 비목 (가입 화면용 공개 조회) ----
-- 비로그인 사용자는 '활성' 사업과 그 표준 비목만 볼 수 있다.
-- (memo 등 내부 컬럼은 클라이언트에서 조회하지 않는다. 추후 내부 메모는 별도 admin 전용 테이블로 분리 권장.)
DROP POLICY IF EXISTS "support_programs_public_select_active" ON public.support_programs;
CREATE POLICY "support_programs_public_select_active" ON public.support_programs
    FOR SELECT USING (active = true);
DROP POLICY IF EXISTS "support_programs_admin_all" ON public.support_programs;
CREATE POLICY "support_programs_admin_all" ON public.support_programs
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "sp_budgets_public_select" ON public.support_program_budgets;
CREATE POLICY "sp_budgets_public_select" ON public.support_program_budgets
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.support_programs sp WHERE sp.id = support_program_id AND sp.active = true)
    );
DROP POLICY IF EXISTS "sp_budgets_admin_all" ON public.support_program_budgets;
CREATE POLICY "sp_budgets_admin_all" ON public.support_program_budgets
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- 4.2 프로필 ----
-- 본인 프로필은 본인이 조회/수정. 단, role/program_ids 자가 변경은 서버(service_role)로 제한 권장.
DROP POLICY IF EXISTS "profiles_self_select" ON public.profiles;
CREATE POLICY "profiles_self_select" ON public.profiles
    FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_admin_select" ON public.profiles;
CREATE POLICY "profiles_admin_select" ON public.profiles
    FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS "profiles_super_admin_all" ON public.profiles;
CREATE POLICY "profiles_super_admin_all" ON public.profiles
    FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---- 4.3 기업 소속원 ----
DROP POLICY IF EXISTS "company_members_self_select" ON public.company_members;
CREATE POLICY "company_members_self_select" ON public.company_members
    FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "company_members_admin_all" ON public.company_members;
CREATE POLICY "company_members_admin_all" ON public.company_members
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- 4.4 기업(companies) ----
DROP POLICY IF EXISTS "companies_member_select" ON public.companies;
CREATE POLICY "companies_member_select" ON public.companies
    FOR SELECT USING (public.is_company_member(id));
DROP POLICY IF EXISTS "companies_member_update" ON public.companies;
CREATE POLICY "companies_member_update" ON public.companies
    FOR UPDATE USING (public.is_company_member(id));
DROP POLICY IF EXISTS "companies_admin_select" ON public.companies;
CREATE POLICY "companies_admin_select" ON public.companies
    FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS "companies_admin_update" ON public.companies;
CREATE POLICY "companies_admin_update" ON public.companies
    FOR UPDATE USING (public.admin_handles_program(support_program_id));
DROP POLICY IF EXISTS "companies_super_admin_all" ON public.companies;
CREATE POLICY "companies_super_admin_all" ON public.companies
    FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---- 4.5 확정 예산 배정 / 예산 제출 / 제출 항목 ----
DROP POLICY IF EXISTS "allocations_member_select" ON public.company_budget_allocations;
CREATE POLICY "allocations_member_select" ON public.company_budget_allocations
    FOR SELECT USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS "allocations_admin_all" ON public.company_budget_allocations;
CREATE POLICY "allocations_admin_all" ON public.company_budget_allocations
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "budget_submissions_member_select" ON public.budget_submissions;
CREATE POLICY "budget_submissions_member_select" ON public.budget_submissions
    FOR SELECT USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS "budget_submissions_member_insert" ON public.budget_submissions;
CREATE POLICY "budget_submissions_member_insert" ON public.budget_submissions
    FOR INSERT WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS "budget_submissions_admin_all" ON public.budget_submissions;
CREATE POLICY "budget_submissions_admin_all" ON public.budget_submissions
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "budget_submission_items_member_select" ON public.budget_submission_items;
CREATE POLICY "budget_submission_items_member_select" ON public.budget_submission_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.budget_submissions bs
            WHERE bs.id = budget_submission_id AND public.is_company_member(bs.company_id)
        )
    );
DROP POLICY IF EXISTS "budget_submission_items_member_insert" ON public.budget_submission_items;
CREATE POLICY "budget_submission_items_member_insert" ON public.budget_submission_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.budget_submissions bs
            WHERE bs.id = budget_submission_id AND public.is_company_member(bs.company_id)
        )
    );
DROP POLICY IF EXISTS "budget_submission_items_admin_all" ON public.budget_submission_items;
CREATE POLICY "budget_submission_items_admin_all" ON public.budget_submission_items
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- 4.6 지출 신청(expense_requests) ----
DROP POLICY IF EXISTS "expense_requests_member_all" ON public.expense_requests;
CREATE POLICY "expense_requests_member_all" ON public.expense_requests
    FOR ALL USING (public.is_company_member(company_id))
    WITH CHECK (public.is_company_member(company_id));
DROP POLICY IF EXISTS "expense_requests_admin_all" ON public.expense_requests;
CREATE POLICY "expense_requests_admin_all" ON public.expense_requests
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- 4.7 지출 검토 이력(expense_reviews) ----
DROP POLICY IF EXISTS "expense_reviews_member_select" ON public.expense_reviews;
CREATE POLICY "expense_reviews_member_select" ON public.expense_reviews
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.expense_requests er
            WHERE er.id = expense_request_id AND public.is_company_member(er.company_id)
        )
    );
DROP POLICY IF EXISTS "expense_reviews_admin_all" ON public.expense_reviews;
CREATE POLICY "expense_reviews_admin_all" ON public.expense_reviews
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- 4.8 안내자료(guidance_items) ----
-- 로그인 사용자는 활성 안내자료 조회 가능, 관리자만 변경.
DROP POLICY IF EXISTS "guidance_items_auth_select" ON public.guidance_items;
CREATE POLICY "guidance_items_auth_select" ON public.guidance_items
    FOR SELECT TO authenticated USING (active = true);
DROP POLICY IF EXISTS "guidance_items_admin_all" ON public.guidance_items;
CREATE POLICY "guidance_items_admin_all" ON public.guidance_items
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- 4.9 첨부서류 요구조건(budget_document_requirements) ----
DROP POLICY IF EXISTS "doc_requirements_auth_select" ON public.budget_document_requirements;
CREATE POLICY "doc_requirements_auth_select" ON public.budget_document_requirements
    FOR SELECT TO authenticated USING (active = true);
DROP POLICY IF EXISTS "doc_requirements_admin_all" ON public.budget_document_requirements;
CREATE POLICY "doc_requirements_admin_all" ON public.budget_document_requirements
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- 4.10 AI 검토 기준 문서(ai_criteria_documents) : 관리자 전용 ----
DROP POLICY IF EXISTS "ai_criteria_admin_all" ON public.ai_criteria_documents;
CREATE POLICY "ai_criteria_admin_all" ON public.ai_criteria_documents
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- 4.11 첨부파일(uploaded_files) ----
DROP POLICY IF EXISTS "uploaded_files_member_all" ON public.uploaded_files;
CREATE POLICY "uploaded_files_member_all" ON public.uploaded_files
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.expense_requests er
            WHERE er.id = expense_request_id AND public.is_company_member(er.company_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.expense_requests er
            WHERE er.id = expense_request_id AND public.is_company_member(er.company_id)
        )
    );
DROP POLICY IF EXISTS "uploaded_files_admin_all" ON public.uploaded_files;
CREATE POLICY "uploaded_files_admin_all" ON public.uploaded_files
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- 4.12 AI 설정(ai_settings) : 관리자 전용 ----
-- 단일 행 설정. Secret 등록 여부 플래그만 보관하며, 실제 키는 저장하지 않는다.
DROP POLICY IF EXISTS "ai_settings_admin_all" ON public.ai_settings;
CREATE POLICY "ai_settings_admin_all" ON public.ai_settings
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
