import { CONFIG } from "../config.js";

async function getAuthToken() {
  try {
    const provider = window.APP_CONFIG?.getSupabaseAccessToken;
    if (typeof provider === "function") return (await provider()) || null;
  } catch (_) {
    /* ignore and treat as unauthenticated */
  }
  try {
    const supabase = window.supabaseClient;
    if (supabase) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) return session.access_token;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

// S3 Presigned URL 요청 헬퍼
async function requestPresignedUrl(action, filePath, mimeType, filename) {
  const token = await getAuthToken();
  const headers = {
    "Content-Type": "application/json",
    apikey: CONFIG.supabaseAnonKey,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(CONFIG.s3FunctionUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, filePath, mimeType, filename }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `S3 Presigned URL 발급 실패 (${response.status})`);
  }
  return data.url;
}

/**
 * 파일을 S3에 직접 업로드합니다 (Presigned PUT).
 * @param {File} file 업로드할 파일 객체
 * @param {string} filePath S3 저장 경로 (Key)
 * @returns {Promise<string>} 업로드된 S3 파일의 경로 (Key)
 */
export async function uploadFileToS3(file, filePath) {
  const uploadUrl = await requestPresignedUrl("upload", filePath, file.type);

  // S3에 이진 데이터 업로드
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error(`S3 파일 업로드에 실패했습니다. (HTTP ${response.status})`);
  }

  return filePath;
}

/**
 * S3 파일을 열람/다운로드하기 위한 Presigned GET URL을 발급받습니다.
 * @param {string} filePath S3 파일 경로 (Key)
 * @param {string} [filename] 다운로드 시 사용할 파일명
 * @returns {Promise<string>} Presigned GET URL
 */
export async function getS3DownloadUrl(filePath, filename) {
  return await requestPresignedUrl("download", filePath, undefined, filename);
}
