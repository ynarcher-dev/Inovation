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
});

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
    if (url.includes("s3-presigned-url")) {
      return {
        ok: true,
        json: async () => ({ url: "https://mock-s3-presigned-put-url" }),
      };
    }
    return { ok: true };
  };

  const file = {
    name: "test.pdf",
    type: "application/pdf",
    size: 1000,
  };

  const resultPath = await uploadFileToS3(file, "companies/123/expenses/456/uuid.pdf");

  assert.equal(resultPath, "companies/123/expenses/456/uuid.pdf");
  assert.equal(fetchCalls.length, 2);

  // First call: S3 presigned URL request
  assert.ok(fetchCalls[0].url.includes("s3-presigned-url"));
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.action, "upload");
  assert.equal(body.mimeType, "application/pdf");

  // Second call: PUT binary upload to S3
  assert.equal(fetchCalls[1].url, "https://mock-s3-presigned-put-url");
  assert.equal(fetchCalls[1].options.method, "PUT");
  assert.equal(fetchCalls[1].options.headers["Content-Type"], "application/pdf");
  assert.equal(fetchCalls[1].options.body, file);
});
