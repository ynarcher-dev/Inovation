import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { S3Client, PutObjectCommand, GetObjectCommand } from "https://esm.sh/@aws-sdk/client-s3@3.600.0";
import { getSignedUrl } from "https://esm.sh/@aws-sdk/s3-request-presigner@3.600.0";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function corsHeadersFor(origin: string | null): Record<string, string> {
  let allowOrigin = "*";
  if (ALLOWED_ORIGINS.length > 0) {
    allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : "null";
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function isOriginAllowed(origin: string | null): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true;
  return !!origin && ALLOWED_ORIGINS.includes(origin);
}

async function authenticateRequest(req: Request): Promise<{ userId: string; role: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    throw new HttpError(401, "로그인이 필요합니다. (인증 토큰 없음)");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    console.error("[s3-presigned-url] SUPABASE_URL/ANON_KEY 환경변수가 없습니다.");
    throw new HttpError(500, "서버 구성 오류로 요청을 처리할 수 없습니다.");
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    throw new HttpError(401, "인증에 실패했습니다. 다시 로그인해주세요.");
  }
  const userId = userData.user.id;

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  if (profileErr || !profile) {
    throw new HttpError(403, "사용자 프로필을 확인할 수 없습니다.");
  }
  const role = String(profile.role || "").toLowerCase();

  return { userId, role };
}

// S3 경로 권한 검증
async function validatePathPermission(
  userId: string,
  role: string,
  filePath: string,
  action: "upload" | "download"
): Promise<void> {
  // admin 이나 super_admin 은 모든 경로 접근 가능
  if (role === "admin" || role === "super_admin") return;

  // 창업자(founder) 권한 체크
  // 경로가 companies/{company_id}/로 시작하는 경우 해당 회사 소속원이어야 함
  const companyMatch = filePath.match(/^companies\/([a-f0-9-]+)\//i);
  if (companyMatch) {
    const companyId = companyMatch[1];
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // RLS 우회하여 소속 멤버 확인
    if (!supabaseServiceKey) {
      console.error("[s3-presigned-url] SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
      throw new HttpError(500, "서버 구성 오류로 권한 검증에 실패했습니다.");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: member, error: memberErr } = await supabase
      .from("company_members")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .maybeSingle();

    if (memberErr || !member) {
      throw new HttpError(403, "해당 회사 데이터에 접근할 권한이 없습니다.");
    }
    return;
  }

  // 창업자는 그 외 경로(안내자료, 타회사 등)에 업로드 불가
  if (action === "upload") {
    throw new HttpError(403, "이 경로에 파일을 업로드할 권한이 없습니다.");
  }
}

function jsonResponse(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    if (!isOriginAllowed(origin)) {
      return new Response("origin not allowed", { status: 403, headers: corsHeadersFor(origin) });
    }
    return new Response("ok", { headers: corsHeadersFor(origin) });
  }

  if (req.method !== "POST") return jsonResponse({ error: "POST 요청만 지원합니다." }, 405, origin);
  if (!isOriginAllowed(origin)) {
    return jsonResponse({ error: "허용되지 않은 origin입니다." }, 403, origin);
  }

  try {
    const { userId, role } = await authenticateRequest(req);
    const { action, filePath, mimeType, filename } = await req.json();

    if (!action || !filePath) {
      throw new HttpError(400, "action과 filePath가 입력되어야 합니다.");
    }
    if (action !== "upload" && action !== "download") {
      throw new HttpError(400, "지원하지 않는 작업 유형입니다.");
    }

    // 경로 접근 권한 검사
    await validatePathPermission(userId, role, filePath, action);

    // AWS 설정 검증
    const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
    const region = Deno.env.get("AWS_REGION");
    const bucketName = Deno.env.get("AWS_S3_BUCKET_NAME");

    if (!accessKeyId || !secretAccessKey || !region || !bucketName) {
      console.error("[s3-presigned-url] AWS 자격증명 환경변수가 누락되었습니다.");
      throw new HttpError(500, "서버의 AWS 스토리지 자격 증명이 설정되지 않았습니다.");
    }

    const s3Client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    let presignedUrl = "";
    if (action === "upload") {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: filePath,
        ContentType: mimeType || "application/octet-stream",
      });
      // 업로드 URL 유효시간: 10분
      presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 });
    } else {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: filePath,
        ResponseContentDisposition: filename
          ? `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
          : undefined,
      });
      // 다운로드 URL 유효시간: 15분 (900초)
      presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
    }

    return jsonResponse({
      url: presignedUrl,
      filePath,
    }, 200, origin);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, error.status, origin);
    }
    console.error("[s3-presigned-url] 처리 실패:", error);
    return jsonResponse({ error: "S3 Presigned URL 생성 중 오류가 발생했습니다." }, 502, origin);
  }
});
