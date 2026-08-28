import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateUploadFile,
  sanitizeFilename,
  getFileExtension,
  MAX_UPLOAD_BYTES,
  isAiReviewableFilename,
  resolveAiReviewMime,
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

test("용량 상한은 없다 — 빈 파일만 거부", () => {
  assert.equal(MAX_UPLOAD_BYTES, Infinity);
  assert.equal(validateUploadFile({ name: "a.pdf", type: "application/pdf", size: 2 * 1024 * 1024 * 1024 }).valid, true);
  assert.equal(validateUploadFile({ name: "a.pdf", type: "application/pdf", size: 0 }).valid, false);
});

test("호출처가 opts.maxBytes 를 준 경우에만 상한이 걸린다", () => {
  const opts = { maxBytes: 1024 };
  assert.equal(validateUploadFile({ name: "a.pdf", type: "application/pdf", size: 2048 }, opts).valid, false);
  assert.equal(validateUploadFile({ name: "a.pdf", type: "application/pdf", size: 512 }, opts).valid, true);
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

test("hwpx·pptx 는 허용된다", () => {
  assert.equal(validateUploadFile({ name: "a.hwpx", type: "application/hwp+zip", size: 1000 }).valid, true);
  assert.equal(validateUploadFile({ name: "a.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", size: 1000 }).valid, true);
});

test("컨테이너 계열 일반 MIME 은 확장자가 맞으면 통과 (PC 별 MIME 편차 흡수)", () => {
  for (const mime of ["application/zip", "application/x-zip-compressed", "application/octet-stream", ""]) {
    assert.equal(validateUploadFile({ name: "a.hwpx", type: mime, size: 1000 }).valid, true, mime);
    assert.equal(validateUploadFile({ name: "a.hwp", type: mime, size: 1000 }).valid, true, mime);
    assert.equal(validateUploadFile({ name: "a.xlsx", type: mime, size: 1000 }).valid, true, mime);
  }
});

test("브라우저가 렌더할 수 있는 MIME 은 확장자가 맞아도 거부 (저장형 XSS 방지)", () => {
  // 업로드 MIME 이 S3 저장 ContentType 이 되고, 안내자료 미리보기는 attachment 없이 열린다.
  assert.equal(validateUploadFile({ name: "a.hwpx", type: "text/html", size: 1000 }).valid, false);
  assert.equal(validateUploadFile({ name: "a.pdf", type: "image/svg+xml", size: 1000 }).valid, false);
  assert.equal(validateUploadFile({ name: "a.pdf", type: "text/html", size: 1000 }).valid, false);
});

test("매크로 포함 오피스 포맷은 거부", () => {
  for (const name of ["a.docm", "a.xlsm", "a.pptm", "a.xlsb"]) {
    assert.equal(validateUploadFile({ name, type: "", size: 1000 }).valid, false, name);
  }
});

test("zip 은 허용된다", () => {
  for (const mime of ["application/zip", "application/x-zip-compressed", "application/octet-stream", ""]) {
    assert.equal(validateUploadFile({ name: "증빙묶음.zip", type: mime, size: 1000 }).valid, true, mime);
  }
});

test("컨테이너 MIME 을 허용해도 확장자 게이트는 그대로다", () => {
  // zip 을 열어도 확장자 목록 밖은 여전히 막힌다. 압축해 올리는 것과 그대로 올리는 것은 다르다.
  assert.equal(validateUploadFile({ name: "x.exe", type: "application/octet-stream", size: 1000 }).valid, false);
  assert.equal(validateUploadFile({ name: "x.7z", type: "application/zip", size: 1000 }).valid, false);
  assert.equal(validateUploadFile({ name: "x.rar", type: "application/octet-stream", size: 1000 }).valid, false);
  // zip 이라도 렌더 가능한 MIME 이면 거부한다.
  assert.equal(validateUploadFile({ name: "evil.zip", type: "text/html", size: 1000 }).valid, false);
});

test("AI 검토 가능 형식은 PDF·이미지뿐", () => {
  for (const name of ["a.pdf", "a.PNG", "a.jpg", "a.jpeg", "a.webp"]) {
    assert.equal(isAiReviewableFilename(name), true, name);
  }
  for (const name of ["a.hwp", "a.hwpx", "a.xlsx", "a.xls", "a.docx", "a.doc", "a.pptx", "a.zip"]) {
    assert.equal(isAiReviewableFilename(name), false, name);
  }
});

test("AI 검토용 MIME: 저장 ContentType 이 컨테이너 계열이면 확장자로 되살린다", () => {
  // 브라우저가 MIME 을 비워 보내면 S3 에 octet-stream 으로 저장된다.
  // 그대로 보내면 멀쩡한 PDF 가 엣지 함수에서 415 로 거절당한다.
  assert.equal(resolveAiReviewMime("a.pdf", "application/octet-stream"), "application/pdf");
  assert.equal(resolveAiReviewMime("a.pdf", ""), "application/pdf");
  assert.equal(resolveAiReviewMime("a.png", "application/zip"), "image/png");
  // 정상 MIME 은 그대로 둔다.
  assert.equal(resolveAiReviewMime("a.png", "image/png"), "image/png");
  assert.equal(resolveAiReviewMime("a.jpg", "image/jpeg"), "image/jpeg");
});
