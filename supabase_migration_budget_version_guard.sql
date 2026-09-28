-- 예산 버전 충돌 방지 + 최신 승인본 재보완 + 기존 병목 상태 복구
-- Supabase SQL Editor에서 한 번 실행한다.

BEGIN;

-- 구버전 프런트가 과거 제출을 다시 결재하려 해도 DB에서 차단한다.
CREATE OR REPLACE FUNCTION public.guard_latest_budget_submission_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest_submission_id uuid;
BEGIN
  -- 이미 결재된 버전의 결재 정보 덮어쓰기도 허용하지 않는다.
  IF OLD.status NOT IN ('budget_submitted', 'change_submitted')
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.review_comment IS DISTINCT FROM OLD.review_comment
     ) THEN
    RAISE EXCEPTION '이미 검토가 완료된 예산 버전입니다.';
  END IF;

  IF OLD.status IN ('budget_submitted', 'change_submitted')
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
     ) THEN
    SELECT id
      INTO v_latest_submission_id
      FROM public.budget_submissions
     WHERE company_id = OLD.company_id
     ORDER BY submitted_at DESC, created_at DESC, id DESC
     LIMIT 1;

    IF v_latest_submission_id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION '최신 예산 버전만 검토할 수 있습니다.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_latest_budget_submission_review
  ON public.budget_submissions;
CREATE TRIGGER trg_guard_latest_budget_submission_review
BEFORE UPDATE OF status, reviewed_at, review_comment
ON public.budget_submissions
FOR EACH ROW
EXECUTE FUNCTION public.guard_latest_budget_submission_review();

-- 최신 승인본의 이력과 확정 예산을 보존하고 새 변경 보완 버전을 만든다.
CREATE OR REPLACE FUNCTION public.request_budget_revision_after_approval(
  p_submission_id uuid,
  p_comment text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.budget_submissions%ROWTYPE;
  v_latest_submission_id uuid;
  v_new_submission_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION '승인 후 보완요청 권한이 없습니다.';
  END IF;

  IF NULLIF(BTRIM(p_comment), '') IS NULL THEN
    RAISE EXCEPTION '승인 후 보완요청 사유를 입력해야 합니다.';
  END IF;

  SELECT *
    INTO v_source
    FROM public.budget_submissions
   WHERE id = p_submission_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '예산 제출안을 찾을 수 없습니다.';
  END IF;

  -- 회사 단위 잠금으로 동시 재보완 요청을 직렬화한다.
  PERFORM 1
    FROM public.companies
   WHERE id = v_source.company_id
   FOR UPDATE;

  SELECT id
    INTO v_latest_submission_id
    FROM public.budget_submissions
   WHERE company_id = v_source.company_id
   ORDER BY submitted_at DESC, created_at DESC, id DESC
   LIMIT 1;

  IF v_latest_submission_id IS DISTINCT FROM p_submission_id THEN
    RAISE EXCEPTION '최신 승인 버전에서만 보완요청할 수 있습니다.';
  END IF;

  IF v_source.status NOT IN ('budget_approved', 'change_approved') THEN
    RAISE EXCEPTION '승인 완료된 최신 버전만 다시 보완요청할 수 있습니다.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.company_budget_allocations
     WHERE company_id = v_source.company_id
  ) THEN
    RAISE EXCEPTION '복사할 확정 예산이 없습니다.';
  END IF;

  INSERT INTO public.budget_submissions (
    company_id,
    type,
    status,
    reason,
    submitted_by,
    reviewed_by,
    reviewed_at,
    review_comment
  )
  VALUES (
    v_source.company_id,
    'change',
    'change_revision_requested',
    BTRIM(p_comment),
    auth.uid(),
    auth.uid()::text,
    now(),
    BTRIM(p_comment)
  )
  RETURNING id INTO v_new_submission_id;

  INSERT INTO public.budget_submission_items (
    budget_submission_id,
    support_program_budget_id,
    previous_allocated_amount,
    requested_allocated_amount,
    approved_allocated_amount,
    requested_round1_allocated_amount,
    requested_round2_allocated_amount
  )
  SELECT
    v_new_submission_id,
    allocation.support_program_budget_id,
    allocation.allocated_amount,
    allocation.allocated_amount,
    0,
    allocation.round1_allocated_amount,
    allocation.round2_allocated_amount
  FROM public.company_budget_allocations allocation
  WHERE allocation.company_id = v_source.company_id;

  UPDATE public.companies
     SET budget_status = 'change_revision_requested'
   WHERE id = v_source.company_id;

  RETURN jsonb_build_object(
    'company_id', v_source.company_id,
    'submission_id', v_new_submission_id,
    'budget_status', 'change_revision_requested'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_budget_revision_after_approval(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_budget_revision_after_approval(uuid, text) TO authenticated;

-- 현재 병목 상태 복구: 회사 전역 상태를 실제 최신 제출 상태와 동기화한다.
WITH latest_submission AS (
  SELECT DISTINCT ON (company_id)
         company_id,
         status
    FROM public.budget_submissions
   ORDER BY company_id, submitted_at DESC, created_at DESC, id DESC
)
UPDATE public.companies company
   SET budget_status = latest.status
  FROM latest_submission latest
 WHERE company.id = latest.company_id
   AND company.budget_status IS DISTINCT FROM latest.status;

COMMIT;

-- 실행 후 불일치가 0건인지 확인한다.
WITH latest_submission AS (
  SELECT DISTINCT ON (company_id)
         company_id,
         id AS submission_id,
         status
    FROM public.budget_submissions
   ORDER BY company_id, submitted_at DESC, created_at DESC, id DESC
)
SELECT
  company.id AS company_id,
  company.name AS company_name,
  company.budget_status AS company_status,
  latest.submission_id,
  latest.status AS latest_submission_status
FROM public.companies company
JOIN latest_submission latest ON latest.company_id = company.id
WHERE company.budget_status IS DISTINCT FROM latest.status
ORDER BY company.name;
