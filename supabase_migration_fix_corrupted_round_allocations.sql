-- [데이터 보정] 옛 승인 버그로 오염된 확정 배정의 1차/2차 분리값 복구.
--
-- 배경: reviewBudgetSubmission 의 옛 버전이 승인 시 company_budget_allocations 에
--   round1_allocated_amount = requested_allocated_amount(=1차+2차 총액) 로 쓰고
--   round2_allocated_amount 는 갱신하지 않았다(0 유지). 트리거 calculate_total_allocation 이
--   allocated_amount = round1 + round2 를 자동 계산하므로 결과적으로
--   round1 = 총액, round2 = 0, allocated = 총액 으로 굳어버렸다.
--   → 2차 값이 0원으로 보이고, 2차가 미승인으로 재표시되며, 이후 변경 검토표에서 1차가 거대한
--     감액으로 표시되는 증상.
--
-- 복구 원리: 승인된 제출안 항목(budget_submission_items)에는 requested_round1/round2 분리값이
--   그대로 남아 있다. 회사별 '가장 최근에 승인된 제출안'의 항목 값으로 확정 배정을 다시 쓴다.
--   allocated_amount 는 트리거가 round1+round2 로 자동 재계산하므로 건드리지 않는다.
--
-- 안전장치:
--   - 값이 실제로 다른 행만 UPDATE(IS DISTINCT FROM) → 재실행해도 no-op(멱등).
--   - 코드 픽스(분리 저장) 적용 이후 1회 실행 권장. 이미 정상인 행은 변경되지 않는다.

-- ── STEP 1. (먼저 실행) 무엇이 어떻게 바뀌는지 미리보기 ──────────────────────────────
-- 이 SELECT 로 영향 받는 행/이전·이후 값을 확인한 뒤 STEP 2 를 실행하세요.
WITH latest_approved AS (
    SELECT DISTINCT ON (bs.company_id) bs.id AS submission_id, bs.company_id
    FROM public.budget_submissions bs
    WHERE bs.status IN ('budget_approved', 'change_approved')
    ORDER BY bs.company_id, bs.reviewed_at DESC NULLS LAST, bs.submitted_at DESC
),
src AS (
    SELECT
        la.company_id,
        bsi.support_program_budget_id,
        COALESCE(bsi.requested_round2_allocated_amount, 0) AS r2,
        COALESCE(
            bsi.requested_round1_allocated_amount,
            bsi.requested_allocated_amount - COALESCE(bsi.requested_round2_allocated_amount, 0)
        ) AS r1
    FROM latest_approved la
    JOIN public.budget_submission_items bsi
        ON bsi.budget_submission_id = la.submission_id
)
SELECT
    cba.company_id,
    cba.support_program_budget_id,
    cba.round1_allocated_amount AS old_round1,
    cba.round2_allocated_amount AS old_round2,
    src.r1                       AS new_round1,
    src.r2                       AS new_round2
FROM public.company_budget_allocations cba
JOIN src
    ON cba.company_id = src.company_id
   AND cba.support_program_budget_id = src.support_program_budget_id
WHERE cba.round1_allocated_amount IS DISTINCT FROM src.r1
   OR cba.round2_allocated_amount IS DISTINCT FROM src.r2;

-- ── STEP 2. (확인 후 실행) 실제 보정 ────────────────────────────────────────────────
WITH latest_approved AS (
    SELECT DISTINCT ON (bs.company_id) bs.id AS submission_id, bs.company_id
    FROM public.budget_submissions bs
    WHERE bs.status IN ('budget_approved', 'change_approved')
    ORDER BY bs.company_id, bs.reviewed_at DESC NULLS LAST, bs.submitted_at DESC
),
src AS (
    SELECT
        la.company_id,
        bsi.support_program_budget_id,
        COALESCE(bsi.requested_round2_allocated_amount, 0) AS r2,
        COALESCE(
            bsi.requested_round1_allocated_amount,
            bsi.requested_allocated_amount - COALESCE(bsi.requested_round2_allocated_amount, 0)
        ) AS r1
    FROM latest_approved la
    JOIN public.budget_submission_items bsi
        ON bsi.budget_submission_id = la.submission_id
)
UPDATE public.company_budget_allocations cba
SET round1_allocated_amount = src.r1,
    round2_allocated_amount = src.r2,
    updated_at = now()
FROM src
WHERE cba.company_id = src.company_id
  AND cba.support_program_budget_id = src.support_program_budget_id
  AND (cba.round1_allocated_amount IS DISTINCT FROM src.r1
       OR cba.round2_allocated_amount IS DISTINCT FROM src.r2);

-- ── STEP 3. (권장) 승인 이력의 총 승인액 기본값(0) 복구 ─────────────────────────────
-- 예전 승인 로직은 budget_submission_items.approved_allocated_amount 를 갱신하지 않아
-- 승인 완료 이력이 0원 승인처럼 보이고, 1차 금액이 감액된 것처럼 표시될 수 있었다.
UPDATE public.budget_submission_items bsi
SET approved_allocated_amount = bsi.requested_allocated_amount
FROM public.budget_submissions bs
WHERE bs.id = bsi.budget_submission_id
  AND bs.status IN ('budget_approved', 'change_approved')
  AND COALESCE(bsi.approved_allocated_amount, 0) = 0
  AND COALESCE(bsi.requested_allocated_amount, 0) <> 0;
