-- 예산 제출안 '덮어쓰기'를 위한 member DELETE 정책.
--   배경: 창업자(member)는 budget_submissions 에 SELECT/INSERT 만 가능했다. 그래서 예산 변경을 다시
--   제출할 때마다 직전 검토 대기 제출안이 삭제되지 못하고 중복으로 쌓여(누적), 검토 화면에서
--   이전 1차/2차 요청값이 계속 남아 보였다.
--   해결: 본인 회사의 '관리자가 아직 결재하지 않은' 제출안(budget_submitted/change_submitted)에 한해 삭제 허용.
--   - 보완요청(*_revision_requested)·승인 등 한 번이라도 결재된 이력은 status 조건으로 보호한다
--     ('보완→재제출→승인' 흐름을 별도 이력으로 보존).
--   - 항목(budget_submission_items)은 FK ON DELETE CASCADE 로 함께 삭제되므로 별도 정책이 필요 없다.

DROP POLICY IF EXISTS "budget_submissions_member_delete_pending" ON public.budget_submissions;
CREATE POLICY "budget_submissions_member_delete_pending" ON public.budget_submissions
    FOR DELETE USING (
        public.is_company_member(company_id)
        AND status IN ('budget_submitted', 'change_submitted')
    );
