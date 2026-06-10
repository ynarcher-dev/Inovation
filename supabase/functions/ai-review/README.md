# ai-review Edge Function 보안/운영 가이드

이 함수는 외부 AI provider(OpenAI/Google/Anthropic)를 호출하므로 **비용 남용/무단 호출**의 직접 표적이다. 아래 방어가 코드와 설정에 적용되어 있다.

## 1. 인증/권한 (T4)

- `supabase/config.toml` 의 `verify_jwt = true` → 게이트웨이가 JWT 를 1차 검증한다. **절대 false 로 배포하지 않는다.**
- 함수 코드도 `Authorization: Bearer <jwt>` 를 직접 검증하고(`auth.getUser`), `profiles.role` 을 확인한다.
- 허용 역할은 `AI_ALLOWED_ROLES`(기본 `founder,admin,super_admin`). 그 외 역할/미인증은 **401/403** 으로 차단.
- `founder`는 `document_review`, `document_batch_review`만 호출할 수 있으며 예산 심사·기준 추출은 관리자 역할만 가능하다.

> ⚠️ 전환 의존성: 현재 프론트 인증은 mock(localStorage)이라 실제 access_token 이 없다.
> AI 기능을 켜려면 **실제 Supabase Auth 전환(P0-03/T6)** 이 선행돼야 하며,
> 클라이언트는 `window.APP_CONFIG.getSupabaseAccessToken()` 로 토큰을 주입한다(`src/services/ai-agent.js`).

## 2. 남용 방지 (T5)

| 항목 | 환경변수 | 기본값 |
|------|----------|--------|
| 허용 origin allowlist | `ALLOWED_ORIGINS` | (미설정 시 전체 허용 + 경고 로그) |
| 호출 허용 역할 | `AI_ALLOWED_ROLES` | `founder,admin,super_admin` |
| base64 최대 길이 | `AI_MAX_BASE64_LEN` | `7000000` (~5MB) |
| 일괄 요청 전체 base64 최대 길이 | `AI_MAX_REQUEST_BASE64_LEN` | `25000000` |
| 허용 MIME | `AI_ALLOWED_MIME` | `application/pdf,image/png,image/jpeg,image/jpg,image/webp` |
| 사용자별 분당 요청 | `AI_RATE_PER_MIN` | `10` |
| provider/model allowlist | 코드 내 `MODEL_ALLOWLIST` | provider별 고정 목록 |

- 과대 파일 → **413**, 미허용 MIME → **415**, 미허용 provider/model → **400**, rate limit 초과 → **429**.
- 오류 분리: 검증 실패는 사용자에게 status+메시지로 반환, provider/예기치 못한 오류는 `console.error` 내부 로그 + 사용자에겐 일반 메시지(502).

> rate limit 은 인메모리(인스턴스별, 베스트 에포트)다. 강한 보장이 필요하면
> Postgres 카운터 테이블 또는 Upstash/Redis 기반으로 승격한다.

## 3. API Key 취급

- provider API key 는 **Supabase Secret(`OPENAI_API_KEY` 등)** 에서만 `Deno.env.get` 으로 읽는다.
- 클라이언트/localStorage 에 키 원문을 **절대 저장하지 않는다.** (AI 설정은 등록 여부 플래그만 보관 — T9 참고)

## 4. 배포 / 검증

```bash
# Secret 등록 (origin allowlist 포함)
supabase secrets set OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=... GOOGLE_API_KEY=...
supabase secrets set ALLOWED_ORIGINS="https://app.example.com,https://admin.example.com"

# 배포 (config.toml 의 verify_jwt=true 반영)
supabase functions deploy ai-review
```

### 거절 케이스 점검 (curl)
```bash
URL="https://<ref>.functions.supabase.co/ai-review"

# 1) 미인증 → 401
curl -i -X POST "$URL" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"type":"budget_submission_review","payload":{"submission":{"items":[1]}}}'

# 2) 권한 없음(허용 목록에 없는 역할 JWT) → 403
curl -i -X POST "$URL" -H "Authorization: Bearer $FOUNDER_JWT" -H "apikey: $ANON" ...

# 3) 과대 파일(>5MB base64) → 413 / 실행파일 MIME → 415
# 4) 미지원 model → 400
curl -i -X POST "$URL" -H "Authorization: Bearer $ADMIN_JWT" -H "apikey: $ANON" \
  -d '{"type":"document_review","model":"gpt-x-evil","payload":{"document":{"mime_type":"application/pdf","data_base64":"AAAA"}}}'
```
