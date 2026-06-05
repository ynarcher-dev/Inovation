-- ==========================================
-- 1. 테이블 초기화 (필요시 기존 테이블 드롭)
-- ==========================================
DROP TABLE IF EXISTS public.uploaded_files CASCADE;
DROP TABLE IF EXISTS public.ai_criteria_documents CASCADE;
DROP TABLE IF EXISTS public.budget_document_requirements CASCADE;
DROP TABLE IF EXISTS public.guidance_items CASCADE;
DROP TABLE IF EXISTS public.expense_reviews CASCADE;
DROP TABLE IF EXISTS public.expense_requests CASCADE;
DROP TABLE IF EXISTS public.budget_submission_items CASCADE;
DROP TABLE IF EXISTS public.budget_submissions CASCADE;
DROP TABLE IF EXISTS public.company_budget_allocations CASCADE;
DROP TABLE IF EXISTS public.company_members CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.companies CASCADE;
DROP TABLE IF EXISTS public.support_program_budgets CASCADE;
DROP TABLE IF EXISTS public.support_programs CASCADE;
DROP TABLE IF EXISTS public.ai_settings CASCADE;

-- ==========================================
-- 2. 테이블 생성 (DDL)
-- ==========================================

-- 2.1 AI 설정 테이블
CREATE TABLE public.ai_settings (
    id integer PRIMARY KEY DEFAULT 1,
    openai_api_key_configured boolean NOT NULL DEFAULT false,
    openai_model text NOT NULL DEFAULT 'gpt-4o',
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT chk_single_row CHECK (id = 1)
);

-- 2.2 운영사업 테이블
CREATE TABLE public.support_programs (
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

-- 2.3 운영사업별 표준 예산 비목 템플릿 테이블
CREATE TABLE public.support_program_budgets (
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
CREATE INDEX idx_sp_budgets_program ON public.support_program_budgets(support_program_id);

-- 2.4 기업 정보 테이블
CREATE TABLE public.companies (
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

-- 2.5 사용자 프로필 테이블 (Supabase Auth 연동)
CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'founder' CONSTRAINT chk_user_role CHECK (role IN ('super_admin', 'admin', 'founder')),
    name text NOT NULL,
    company_name text,
    phone text,
    program_ids uuid[], -- 일반관리자의 경우 담당 사업 ID 배열
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 2.6 기업 소속원 테이블
CREATE TABLE public.company_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    member_role text NOT NULL DEFAULT 'owner' CONSTRAINT chk_member_role CHECK (member_role IN ('owner', 'member')),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(company_id, user_id)
);

-- 2.7 기업별 비목 확정 예산 배정 테이블
CREATE TABLE public.company_budget_allocations (
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

-- 2.8 예산 제출 이력 테이블
CREATE TABLE public.budget_submissions (
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

-- 2.9 예산 제출별 항목 요청 테이블
CREATE TABLE public.budget_submission_items (
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

-- 2.10 지출 신청 테이블
CREATE TABLE public.expense_requests (
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
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 2.11 지출 결재/검토 이력 테이블
CREATE TABLE public.expense_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_request_id uuid NOT NULL REFERENCES public.expense_requests(id) ON DELETE CASCADE,
    reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    decision text NOT NULL, -- approved, revision_requested, rejected
    comment text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 2.12 운영사업 안내자료 테이블
CREATE TABLE public.guidance_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    content text,
    link_url text,
    active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    support_program_id uuid NOT NULL REFERENCES public.support_programs(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 2.13 비목별 첨부서류 요구조건 설정 테이블
CREATE TABLE public.budget_document_requirements (
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

-- 2.14 운영사업 공통 AI 검토 기준 문서 테이블
CREATE TABLE public.ai_criteria_documents (
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

-- 2.15 지출 신청별 업로드 파일 정보 테이블
CREATE TABLE public.uploaded_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_request_id uuid NOT NULL REFERENCES public.expense_requests(id) ON DELETE CASCADE,
    requirement_id uuid REFERENCES public.budget_document_requirements(id) ON DELETE SET NULL,
    support_program_budget_id uuid REFERENCES public.support_program_budgets(id) ON DELETE SET NULL,
    phase text NOT NULL CONSTRAINT chk_uploaded_file_phase CHECK (phase IN ('pre', 'final')),
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    link_url text NOT NULL, -- S3 URL 또는 Key
    uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ai_review_status text NOT NULL DEFAULT 'not_requested' CONSTRAINT chk_ai_review_status CHECK (ai_review_status IN ('not_requested', 'pending', 'passed', 'failed')),
    ai_review_comment text,
    ai_check_result jsonb NOT NULL DEFAULT '{}'::jsonb,
    cleared boolean NOT NULL DEFAULT false,
    user_review_comment text,
    user_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);


-- ==========================================
-- 3. 트리거 정의 (Triggers & Functions)
-- ==========================================

-- 3.1 Supabase Auth 회원가입 시 public.profiles 자동 생성 트리거
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, role, name, company_name, phone)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'role', 'founder'),
    COALESCE(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'founder_name', '사용자'),
    new.raw_user_meta_data->>'company_name',
    new.raw_user_meta_data->>'phone'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
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

CREATE OR REPLACE TRIGGER on_allocation_amount_change
  BEFORE INSERT OR UPDATE ON public.company_budget_allocations
  FOR EACH ROW EXECUTE FUNCTION public.calculate_total_allocation();


-- ==========================================
-- 4. 로우 레벨 보안 정책 (Row Level Security - RLS)
-- ==========================================

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

-- 4.1 공용 또는 비로그인 조회 허용 정책 (운영사업, 예산안 템플릿 등)
CREATE POLICY "누구나 사업 목록을 볼 수 있음" ON public.support_programs FOR SELECT USING (true);
CREATE POLICY "누구나 표준 비목을 볼 수 있음" ON public.support_program_budgets FOR SELECT USING (true);

-- 4.2 프로필 정책
CREATE POLICY "자신의 프로필은 본인이 관리" ON public.profiles
    FOR ALL USING (auth.uid() = id);

CREATE POLICY "관리자는 모든 프로필을 볼 수 있음" ON public.profiles
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
    );

-- 4.3 기업(companies) RLS 정책
CREATE POLICY "창업자는 본인 기업만 조회 및 수정" ON public.companies
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.company_members 
            WHERE company_members.company_id = companies.id AND company_members.user_id = auth.uid()
        )
    );

CREATE POLICY "관리자는 전체 기업 조회 가능" ON public.companies
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
    );

CREATE POLICY "일반관리자는 담당 사업의 기업만 수정 가능" ON public.companies
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role = 'admin' AND (companies.support_program_id = ANY(program_ids))
        )
    );

CREATE POLICY "최고관리자는 모든 기업 제어 허용" ON public.companies
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    );

-- 4.4 지출 신청(expense_requests) RLS 정책
CREATE POLICY "창업자는 본인 기업의 지출 신청 제어" ON public.expense_requests
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.company_members 
            WHERE company_members.company_id = expense_requests.company_id AND company_members.user_id = auth.uid()
        )
    );

CREATE POLICY "관리자는 모든 지출 신청 조회 및 결재 가능" ON public.expense_requests
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
    );

-- 4.5 첨부파일(uploaded_files) RLS 정책
CREATE POLICY "창업자는 본인 기업의 업로드 파일 관리" ON public.uploaded_files
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.expense_requests er
            JOIN public.company_members cm ON cm.company_id = er.company_id
            WHERE er.id = uploaded_files.expense_request_id AND cm.user_id = auth.uid()
        )
    );

CREATE POLICY "관리자는 모든 업로드 파일 조회 및 심사 가능" ON public.uploaded_files
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
    );
