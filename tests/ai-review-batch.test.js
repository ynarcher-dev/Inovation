import { test } from "node:test";
import assert from "node:assert/strict";
import { batchReviewMessage } from "../src/components/expense/DocumentPhasePanel.js";

test("전부 검토됐으면 토스트를 띄우지 않는다", () => {
  assert.equal(batchReviewMessage({ reviewed: 3, skipped: [] }, { emptyText: "없음" }), "");
});

test("검토 대상이 아예 없으면 emptyText", () => {
  assert.equal(batchReviewMessage({ reviewed: 0, skipped: [] }, { emptyText: "없음" }), "없음");
});

test("일부만 형식 미지원이면 검토 건수와 제외 파일명을 함께 알린다", () => {
  const msg = batchReviewMessage({ reviewed: 3, skipped: ["견적서.hwp"] }, { emptyText: "없음" });
  assert.match(msg, /3건 검토 완료/);
  assert.match(msg, /견적서\.hwp/);
});

test("검토 가능한 파일이 하나도 없으면 이유를 밝힌다", () => {
  const msg = batchReviewMessage({ reviewed: 0, skipped: ["a.hwp", "b.xlsx"] }, { emptyText: "없음" });
  assert.match(msg, /형식 미지원 2건/);
  assert.notEqual(msg, "없음");
});

test("제외 파일이 많으면 3건까지만 나열한다", () => {
  const msg = batchReviewMessage({ reviewed: 1, skipped: ["a", "b", "c", "d", "e"] }, {});
  assert.match(msg, /a, b, c 외 2건/);
});
