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
 * @param {(percent: number) => void} [onProgress] 0~100 진행률 콜백. 완료 시 100 을 한 번 더 보낸다.
 * @returns {Promise<string>} 업로드된 S3 파일의 경로 (Key)
 */
export async function uploadFileToS3(file, filePath, onProgress) {
  const uploadUrl = await requestPresignedUrl("upload", filePath, file.type);
  await putBinaryToS3(uploadUrl, file, onProgress);
  return filePath;
}

// S3에 이진 데이터 업로드.
// fetch 는 업로드 진행률을 알려주지 않으므로(ReadableStream 업로드는 브라우저 지원이 고르지 않다) XHR 을 쓴다.
// 용량 상한을 없앤 뒤로는 대용량 첨부가 들어올 수 있어, 진행률 없이는 "멈춘 것처럼" 보인다.
function putBinaryToS3(uploadUrl, file, onProgress) {
  const report = typeof onProgress === "function" ? onProgress : null;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    if (report) {
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable || !e.total) return;
        // 전송이 끝나도 S3 응답까지 시간이 남으므로 99% 에서 멈춰 두고, 완료 시에만 100 을 보낸다.
        report(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (report) report(100);
        resolve();
        return;
      }
      reject(new Error(`S3 파일 업로드에 실패했습니다. (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("S3 파일 업로드에 실패했습니다. (네트워크 오류)"));
    xhr.onabort = () => reject(new Error("업로드가 중단되었습니다."));

    xhr.send(file);
  });
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
