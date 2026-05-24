# 체육인 창업지원 사업비 집행 도우미

체육인 직업안정사업/창업지원 새싹 과정의 사업화지원금 사전승인, 집행 증빙, 검수, 정산을 돕는 웹 시스템 개발 저장소입니다.

## 현재 문서

- `update.md`: 앞으로 반영할 개발 항목과 최근 변경 기록
- `rules.md`: 업데이트 과정에서도 임의로 바꾸면 안 되는 고정 규칙
- `docs/`: 사업비 집행 지침, 양식, 루모스V2 참고자료 원문

## 목표

- 창업자는 복잡한 사업비 절차를 화면 안내에 따라 진행합니다.
- 관리자는 창업자별 진행 상태, 누락 서류, 위험 항목을 확인합니다.
- Gemini API는 문서 분류, 금액 추출, 누락 점검, 규정 Q&A를 보조합니다.

## 권장 스택

- Frontend: HTML5 + CSS + ESM JavaScript
- Auth/DB: Supabase Auth + PostgreSQL
- File Storage: Cloudflare R2 private bucket
- Backend: Supabase Edge Functions 또는 Node.js API
- AI: Gemini API

## 다음 개발 단계

1. Supabase 스키마와 RLS 정책 작성
2. HTML5+ESM 기본 앱 구조 생성
3. 로그인 및 역할별 라우팅 구현
4. 창업자 지출 신청/체크리스트 MVP 구현
5. 관리자 검토 화면 구현
6. R2 파일 업로드와 Gemini 문서 분석 연결

## 로컬 실행

정적 파일 서버로 실행합니다.

```powershell
python -m http.server 8080
```

브라우저에서 `http://localhost:8080`을 엽니다.

현재 Supabase URL과 publishable key는 `src/config.js`에 설정되어 있습니다.

로그인 화면은 Supabase Auth 계정으로 동작합니다.

초기 계정:

```text
관리자 ID: admin
창업자 ID: founder
비밀번호: yna123
```

`admin`은 내부적으로 `admin@yna.local`, `founder`는 `founder@yna.local`로 매핑됩니다.

창업자 신규 가입은 `/signup.html`에서 진행합니다. 가입한 기업은 `승인 대기` 상태로 생성되며, 관리자가 `/admin/dashboard.html`의 전체 기업 모니터링 목록에서 승인해야 지출 신청을 생성할 수 있습니다.

## Supabase 설정

`supabase/schema.sql`을 Supabase SQL editor에서 실행하거나, CLI 로그인을 완료한 뒤 migration을 적용하면 MVP용 테이블, 인덱스, RLS 정책이 생성됩니다.

```powershell
supabase login
supabase link --project-ref vqdftooqzpmkqboztasc
supabase db push
```

`supabase login`에는 publishable key가 아니라 Supabase dashboard에서 생성한 access token이 필요합니다. 보통 `sbp_...` 형태입니다.

## Cloudflare R2 업로드 설정

파일 업로드는 Supabase Edge Function이 Cloudflare R2 presigned PUT URL을 발급하고, 브라우저가 해당 URL로 직접 업로드하는 방식입니다. R2 secret key는 브라우저에 노출하지 않습니다.

Edge Function 배포:

```powershell
supabase functions deploy create-upload-url
```

Edge Function 환경변수:

```text
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ENDPOINT=https://your-cloudflare-account-id.r2.cloudflarestorage.com
R2_BUCKET=your-private-bucket
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

R2 bucket CORS 예시:

```json
[
  {
    "AllowedOrigins": ["http://127.0.0.1:8080", "http://localhost:8080"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

## 실제 사용자 생성

1. Supabase Dashboard > Authentication > Users에서 사용자를 생성합니다.
2. 생성된 사용자의 `user_id`를 확인합니다.
3. SQL editor에서 `profiles`, `companies`, `company_members`에 연결 데이터를 넣습니다.

예시:

```sql
insert into public.companies (id, name, representative_name, support_total_amount)
values ('00000000-0000-0000-0000-000000000001', 'ABC스포츠', '김대표', 30000000)
on conflict do nothing;

insert into public.profiles (user_id, role, name, company_name)
values ('AUTH_USER_ID_HERE', 'founder', '김대표', 'ABC스포츠');

insert into public.company_members (company_id, user_id)
values ('00000000-0000-0000-0000-000000000001', 'AUTH_USER_ID_HERE');
```
