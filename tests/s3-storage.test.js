// Mock window before imports
globalThis.window = {
  APP_CONFIG: {
    getSupabaseAccessToken: async () => "mock-token-abc",
    s3FunctionUrl: "http://mock-supabase.co/functions/v1/s3-presigned-url",
  },
};

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { uploadFileToS3, getS3DownloadUrl } from "../src/services/s3-storage.js";
import { CONFIG } from "../src/config.js";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.window = {
    APP_CONFIG: {
      getSupabaseAccessToken: async () => "mock-token-abc",
      s3FunctionUrl: "http://mock-supabase.co/functions/v1/s3-presigned-url",
    },
  };
});

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
  delete globalThis.XMLHttpRequest;
});

// 업로드 PUT 은 진행률을 얻기 위해 XHR 을 쓴다. 노드에는 XMLHttpRequest 가 없으므로 최소 구현을 심는다.
// send() 이후 progress → onload 순서를 비동기로 재현해 실제 브라우저 동작을 흉내낸다.
function installMockXhr({ status = 200, progressEvents = [] } = {}) {
  const sent = [];
  globalThis.XMLHttpRequest = class {
    constructor() {
      this.upload = {};
      this.status = 0;
      this.headers = {};
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(key, value) {
      this.headers[key] = value;
    }
    send(body) {
      sent.push({ method: this.method, url: this.url, headers: this.headers, body });
      setTimeout(() => {
        for (const e of progressEvents) this.upload.onprogress?.(e);
        this.status = status;
        this.onload?.();
      }, 0);
    }
  };
  return sent;
}

test("getS3DownloadUrl calls presigned URL endpoint with download action", async () => {
  let calledUrl = "";
  let calledOptions = null;

  globalThis.fetch = async (url, options) => {
    calledUrl = url;
    calledOptions = options;
    return {
      ok: true,
      json: async () => ({ url: "https://mock-s3-presigned-get-url" }),
    };
  };

  const url = await getS3DownloadUrl("companies/123/expenses/456/uuid.pdf");
  
  assert.equal(url, "https://mock-s3-presigned-get-url");
  assert.equal(calledUrl, CONFIG.s3FunctionUrl);
  
  const body = JSON.parse(calledOptions.body);
  assert.equal(body.action, "download");
  assert.equal(body.filePath, "companies/123/expenses/456/uuid.pdf");
  assert.equal(calledOptions.headers.Authorization, "Bearer mock-token-abc");
});

test("uploadFileToS3 requests upload presigned URL and performs PUT to S3", async () => {
  const fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return { ok: true, json: async () => ({ url: "https://mock-s3-presigned-put-url" }) };
  };
  const sent = installMockXhr();

  const file = { name: "test.pdf", type: "application/pdf", size: 1000 };
  const resultPath = await uploadFileToS3(file, "companies/123/expenses/456/uuid.pdf");

  assert.equal(resultPath, "companies/123/expenses/456/uuid.pdf");

  // 1) Presigned URL 발급은 fetch 로
  assert.equal(fetchCalls.length, 1);
  assert.ok(fetchCalls[0].url.includes("s3-presigned-url"));
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.action, "upload");
  assert.equal(body.mimeType, "application/pdf");

  // 2) 실제 바이너리 PUT 은 XHR 로
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, "PUT");
  assert.equal(sent[0].url, "https://mock-s3-presigned-put-url");
  assert.equal(sent[0].headers["Content-Type"], "application/pdf");
  assert.equal(sent[0].body, file);
});

test("uploadFileToS3 는 진행률을 보고하고 완료 시 100 으로 끝난다", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ url: "https://mock-s3-presigned-put-url" }) });
  installMockXhr({
    progressEvents: [
      { lengthComputable: true, loaded: 250, total: 1000 },
      { lengthComputable: true, loaded: 1000, total: 1000 },
    ],
  });

  const seen = [];
  await uploadFileToS3({ name: "big.pdf", type: "application/pdf", size: 1000 }, "k.pdf", (p) => seen.push(p));

  // 전송 완료(loaded === total)여도 S3 응답 전에는 99 에서 대기하고, onload 에서만 100 이 된다.
  assert.deepEqual(seen, [25, 99, 100]);
});

test("uploadFileToS3 는 진행률 콜백 없이도 동작한다", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ url: "https://mock-s3-presigned-put-url" }) });
  installMockXhr({ progressEvents: [{ lengthComputable: true, loaded: 500, total: 1000 }] });

  const path = await uploadFileToS3({ name: "a.pdf", type: "application/pdf", size: 1000 }, "k.pdf");
  assert.equal(path, "k.pdf");
});

test("S3 가 2xx 가 아니면 업로드 실패로 거절한다", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ url: "https://mock-s3-presigned-put-url" }) });
  installMockXhr({ status: 403 });

  await assert.rejects(
    () => uploadFileToS3({ name: "a.pdf", type: "application/pdf", size: 1000 }, "k.pdf"),
    /HTTP 403/,
  );
});
