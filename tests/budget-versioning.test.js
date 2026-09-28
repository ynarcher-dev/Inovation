import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getActiveBudgetSubmission,
  isApprovedBudgetSubmission,
} from "../src/domains/budget/budget-status.js";

const active = ["budget_submitted", "budget_revision_requested", "change_submitted", "change_revision_requested"];

test("과거 보완 버전은 최신 승인 뒤에 현재 작업 건으로 되살아나지 않는다", () => {
  const rows = [
    { id: "v3", status: "budget_approved" },
    { id: "v2", status: "budget_revision_requested" },
    { id: "v1", status: "budget_revision_requested" },
  ];
  assert.equal(getActiveBudgetSubmission(rows, active), null);
  assert.equal(isApprovedBudgetSubmission(rows[0]), true);
});

test("최신 보완 버전만 현재 작업 건으로 선택한다", () => {
  const rows = [
    { id: "v4", status: "change_revision_requested" },
    { id: "v3", status: "budget_approved" },
  ];
  assert.equal(getActiveBudgetSubmission(rows, active)?.id, "v4");
});

test("과거 검토 대기 버전도 최신 승인을 가리지 못한다", () => {
  const rows = [
    { id: "v3", status: "change_approved" },
    { id: "stale", status: "change_submitted" },
  ];
  assert.equal(getActiveBudgetSubmission(rows, ["budget_submitted", "change_submitted"]), null);
});
