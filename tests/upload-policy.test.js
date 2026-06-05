import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateUploadFile,
  sanitizeFilename,
  getFileExtension,
  MAX_UPLOAD_BYTES,
} from "../src/domains/upload-policy.js";

test("허용 형식(PDF/이미지/문서)은 통과", () => {
  assert.equal(validateUploadFile({ name: "a.pdf", type: "application/pdf", size: 1000 }).valid, true);
  assert.equal(validateUploadFile({ name: "b.png", type: "image/png", size: 1000 }).valid, true);
  assert.equal(validateUploadFile({ name: "c.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 1000 }).valid, true);
});

test("실행 파일/스크립트는 거부", () => {
  assert.equal(validateUploadFile({ name: "x.exe", type: "application/x-msdownload", size: 1000 }).valid, false);
  assert.equal(validateUploadFile({ name: "x.sh", type: "text/x-sh", size: 1000 }).valid, false);
  assert.equal(validateUploadFile({ name: "x.js", type: "text/javascript", size: 1000 }).valid, false);
});

test("확장자만 위조(.pdf 인데 MIME 실행파일)는 거부", () => {
  const r = validateUploadFile({ name: "evil.pdf", type: "application/x-msdownload", size: 1000 });
  assert.equal(r.valid, false);
});

test("MIME 이 비어 있으면 확장자로 판정", () => {
  assert.equal(validateUploadFile({ name: "a.pdf", type: "", size: 1000 }).valid, true);
  assert.equal(validateUploadFile({ name: "a.exe", type: "", size: 1000 }).valid, false);
});

test("최대 크기 초과는 거부, 빈 파일도 거부", () => {
  assert.equal(validateUploadFile({ name: "a.pdf", type: "application/pdf", size: MAX_UPLOAD_BYTES + 1 }).valid, false);
  assert.equal(validateUploadFile({ name: "a.pdf", type: "application/pdf", size: 0 }).valid, false);
});

test("호출처별 정책 좁히기(이미지/PDF만)", () => {
  const opts = { allowedMime: ["application/pdf"], allowedExt: ["pdf"] };
  assert.equal(validateUploadFile({ name: "a.png", type: "image/png", size: 1000 }, opts).valid, false);
  assert.equal(validateUploadFile({ name: "a.pdf", type: "application/pdf", size: 1000 }, opts).valid, true);
});

test("파일명 정규화: 경로 구분자/제어문자/선행점 제거", () => {
  const traversal = sanitizeFilename("../../etc/passwd");
  assert.ok(!traversal.includes("/"));
  assert.ok(!traversal.startsWith("."));
  const mixed = sanitizeFilename("a/b\\c.pdf");
  assert.ok(!mixed.includes("/") && !mixed.includes("\\"));
  assert.equal(sanitizeFilename(""), "file");
});

test("getFileExtension", () => {
  assert.equal(getFileExtension("a.b.PDF"), "pdf");
  assert.equal(getFileExtension("noext"), "");
});
