# 전체 코드리뷰 보완 작업지시서

작성일: 2026-06-05  
대상: `Inovation-main` 정적 프론트엔드, mock API, Supabase Edge Function/Schema

## 리뷰 요약

현재 프로젝트는 mock 기반 화면 흐름은 빠르게 검증할 수 있는 상태지만, 운영 전환 관점에서는 보안 경계, Supabase 스키마 검증, AI Edge Function 방어 로직, 테스트 자동화가 부족하다. 아래 작업은 다른 에이전트가 독립 단위로 처리할 수 있도록 우선순위와 완료 기준을 분리했다.

검증 참고:
- `node --check` 전체 JS 파일 문법 검사: 통과
- 300라인 초과 주요 파일: `src/pages/admin/program-management.js`, `src/pages/founder/dashboard.js`, `src/services/mock/company.mock.js`, `src/pages/founder/expense-new.js`, `supabase/functions/ai-review/index.ts`, `src/api.js`, `supabase_schema.sql`

## P0-01. Supabase 스키마 실행 가능성 검증 및 RLS 정책 보강

### 현상/위험
- `supabase_schema.sql`에 DDL, trigger, RLS 정책이 포함되어 있으나 실제 DB에 재실행 가능한지 자동 검증이 없다.
- 일부 `CREATE TABLE` 선언과 주석이 붙어 보이는 구간이 있어 SQL 실행 실패 또는 의도치 않은 주석 처리 가능성을 반드시 확인해야 한다.
- `support_programs`, `support_program_budgets`는 `USING (true)`로 비로그인 전체 조회가 허용된다. 지원사업/예산 항목이 공개 데이터인지 정책 결정이 필요하다.
- founder/admin별 INSERT/UPDATE/DELETE 정책이 충분히 분리되어 있는지 검증 근거가 없다.

### 작업 범위
- `supabase_schema.sql`을 Supabase SQL editor 또는 로컬 Postgres 호환 환경에서 처음부터 끝까지 실행 검증한다.
- 모든 table 생성, index, trigger, function, RLS policy가 정상 생성되는지 확인한다.
- 공개 조회가 필요한 테이블과 로그인 사용자만 조회 가능한 테이블을 분류하고 RLS 정책을 수정한다.
- founder는 본인 회사/신청/파일만, admin은 배정 사업만, super_admin은 전체 접근 가능하도록 정책을 정리한다.
- destructive한 `DROP TABLE` 초기화 스크립트와 운영 migration 스크립트를 분리한다.

### 완료 기준
- 빈 DB에서 스키마 적용이 오류 없이 완료된다.
- 운영용 migration에는 무조건적인 `DROP TABLE`이 없다.
- 역할별 SELECT/INSERT/UPDATE/DELETE 테스트 케이스가 문서화된다.
- RLS 우회가 가능한 anon 요청이 없는지 확인된다.

### 검증 방법
- Supabase SQL 실행 로그 캡처 또는 migration dry-run 결과 첨부
- founder/admin/super_admin/anonymous 계정별 CRUD smoke test

## P0-02. AI Edge Function 인증/남용 방지 강화

### 현상/위험
- `supabase/functions/ai-review/index.ts`는 `Access-Control-Allow-Origin: *`와 anon key 호출 구조를 사용한다.
- 클라이언트 오류 메시지에는 `verify_jwt=false` 설정 안내가 있어 운영에서 인증이 꺼진 배포가 유도될 수 있다.
- 요청 본문 크기, 파일 MIME, base64 길이, rate limit, 사용자 권한 검증이 없다.
- AI provider API 비용이 외부 요청에 의해 소진될 수 있다.

### 작업 범위
- Edge Function에서 JWT 검증을 기본값으로 사용하고, 요청자의 role/program/company 권한을 확인한다.
- 허용 origin을 환경 변수 기반 allowlist로 제한한다.
- `document.data_base64` 최대 크기, MIME allowlist, provider/model allowlist를 추가한다.
- 요청 실패와 provider 오류를 사용자 메시지와 내부 로그로 분리한다.
- 비용 보호를 위해 사용자/회사/기능별 rate limit 또는 최소한 서버 측 요청 횟수 제한 설계를 추가한다.

### 완료 기준
- 인증 없는 요청은 401/403으로 차단된다.
- 허용되지 않은 origin, MIME, 과대 파일, 미지원 provider/model 요청이 4xx로 거절된다.
- Edge Function 설정 문서에서 `verify_jwt=false` 안내가 제거된다.
- AI API key는 Supabase Secret에서만 읽고 클라이언트 저장소에는 절대 저장하지 않는다.

### 검증 방법
- `curl` 또는 Supabase function invoke로 anonymous/JWT/권한 없음/권한 있음 케이스 테스트
- 5MB 이상 파일, 실행 파일 MIME, 잘못된 provider 요청 테스트

## P0-03. mock API에서 실제 Supabase API 전환 경계 정리

### 현상/위험
- `src/api.js`는 대부분 mock service를 그대로 export하며, 실제 Supabase 설정값이 있어도 데이터 API는 mock에 머문다.
- 인증도 `src/auth.js`에서 mock user/localStorage 기반이다.
- 운영 전환 시 화면은 동작하지만 데이터는 브라우저 저장소에 남는 혼합 상태가 발생할 수 있다.

### 작업 범위
- `src/api.js`에 mock/remote adapter 선택 기준을 명시한다.
- `CONFIG.useMockApi` 또는 빌드/런타임 플래그를 추가해 mock과 Supabase 호출을 명확히 분리한다.
- 실제 Supabase 전환 대상 API 목록을 작성한다.
- 인증, 회사, 예산 제출, 지출 신청, 첨부파일, AI 설정 순서로 remote adapter 작업 계획을 만든다.

### 완료 기준
- mock 모드와 remote 모드가 코드상 명확히 구분된다.
- 운영 배포에서 mock storage가 사용되면 화면 상단 또는 콘솔 경고가 표시된다.
- README 또는 별도 문서에 전환 순서와 미구현 API가 정리된다.

### 검증 방법
- mock 모드 smoke test
- remote 모드에서 미구현 API 호출 시 명확한 오류 메시지 확인

## P1-01. XSS 방어 기준 정리 및 렌더링 감사

### 현상/위험
- 다수 페이지에서 `innerHTML`/`insertAdjacentHTML`을 사용한다.
- 일부 컴포넌트는 `escapeHtml`을 적용하지만 전체 사용처가 일관되게 검증되어 있지 않다.
- 사용자 입력값(회사명, 제목, 메모, 첨부 문서명, AI 응답)이 HTML로 섞일 가능성이 있다.

### 작업 범위
- `innerHTML`/template string 렌더링 사용처를 전수 점검한다.
- 사용자 입력, DB/mock 데이터, AI 응답은 반드시 `escapeHtml`을 통과하도록 수정한다.
- 신뢰 가능한 정적 HTML과 동적 데이터 삽입을 구분하는 렌더링 가이드라인을 추가한다.
- 가능하면 반복 테이블/리스트 컴포넌트에 escape 책임을 집중시킨다.

### 완료 기준
- 동적 문자열 삽입 지점마다 escape 여부가 확인된다.
- AI 응답 raw text는 HTML로 직접 삽입되지 않는다.
- `<script>alert(1)</script>` 같은 입력값이 화면에서 텍스트로만 표시된다.

### 검증 방법
- 회사명/지출 제목/메모/AI comment에 XSS 테스트 문자열 입력 후 화면 확인
- `rg -n "innerHTML|insertAdjacentHTML"` 결과를 체크리스트로 남김

## P1-02. 지출 신청/예산 검증을 서비스 계층으로 이동

### 현상/위험
- `src/pages/founder/expense-new.js`에서 필수값, 잔액, 필수 첨부 검증이 화면 로직에 많이 포함되어 있다.
- mock service의 `mockCreateExpense`, `mockUpdateExpenseRequest`, `mockSubmitExpenseRequest`는 화면에서 이미 검증되었다는 가정이 크다.
- 직접 API 호출 또는 remote API 전환 시 서버/서비스 계층 검증 누락으로 예산 초과, 음수 금액, 필수 서류 누락이 생길 수 있다.

### 작업 범위
- 지출 신청 저장/제출 전 검증 함수를 `src/domains/expense` 또는 service 계층으로 분리한다.
- 필수 입력값, 금액 음수/0 처리, VAT/총액 계산, 잔액 초과, 상태 전이, 필수 첨부 검증을 한 곳에서 수행한다.
- 화면은 검증 결과를 표시만 하도록 책임을 줄인다.

### 완료 기준
- 화면을 우회해 `submitExpenseRequest`를 호출해도 잘못된 신청이 저장/제출되지 않는다.
- 검증 실패 사유가 필드 단위로 반환된다.
- founder/admin 양쪽 상태 전이 규칙이 도메인 함수로 공유된다.

### 검증 방법
- draft 제출, 보완 재제출, 최종 승인 제출 케이스 테스트
- 예산 초과/필수 첨부 누락/음수 금액/잘못된 상태 전이 테스트

## P1-03. AI 설정 보안 모델 정리

### 현상/위험
- `src/services/mock/ai-settings.mock.js`는 `api_key_configured`, `api_key_hint`, `edge_function_url`을 localStorage에 저장한다.
- 실제 API key는 저장하지 않더라도 운영 UX에서 클라이언트 저장 상태와 서버 Secret 상태가 불일치할 수 있다.
- provider/model 설정이 클라이언트에서 임의 변경되어 Edge Function에 전달된다.

### 작업 범위
- AI 설정의 source of truth를 서버로 정의한다.
- 클라이언트에는 enabled/provider/model/last_checked 정도만 내려주고 Secret 등록 여부는 서버가 판정한다.
- Edge Function이 provider/model allowlist를 서버 환경 변수 또는 DB 정책으로 검증한다.
- AI 연결 테스트는 서버에서 Secret 존재 여부와 실제 provider 응답을 분리해 반환한다.

### 완료 기준
- localStorage를 삭제해도 서버 AI 설정 상태가 유지된다.
- 클라이언트가 임의 model을 보내도 서버에서 허용 목록 밖이면 차단된다.
- 관리자 화면은 Secret 값 자체를 표시하거나 저장하지 않는다.

### 검증 방법
- localStorage 초기화 후 AI 관리 화면 상태 확인
- 미지원 model/provider 요청 차단 테스트

## P1-04. 파일 업로드 정책 및 저장소 전환 설계

### 현상/위험
- mock 파일은 IndexedDB에 dataURL로 저장된다.
- 파일 크기 제한, 확장자/MIME 검증, 바이러스 검사, 파일명 정규화, 저장소 권한 정책이 없다.
- 다운로드 fallback으로 외부 dummy PDF를 열 수 있어 운영에서 혼란이 생긴다.

### 작업 범위
- 업로드 허용 MIME/확장자/최대 크기 정책을 정의하고 클라이언트와 서버 양쪽에 적용한다.
- Supabase Storage bucket, path 규칙, signed URL 만료 정책을 설계한다.
- 파일명 표시용 값과 저장 key를 분리한다.
- dummy PDF fallback은 개발 모드에서만 동작하도록 제한한다.

### 완료 기준
- 허용되지 않은 파일은 업로드 전/후 모두 차단된다.
- founder는 본인 회사 파일만, admin은 권한 있는 사업 파일만 조회/다운로드 가능하다.
- 운영 모드에서 파일이 없으면 외부 dummy 파일이 열리지 않는다.

### 검증 방법
- PDF/이미지/대용량/실행파일 업로드 테스트
- 다른 회사 파일 URL 접근 테스트

## P2-01. 대형 파일 리팩터링

### 현상/위험
- 프로젝트 README의 500라인 기준을 초과하거나 근접한 파일이 있다.
- `program-management.js`, `dashboard.js`, `company.mock.js`, `expense-new.js`는 화면 상태, 렌더링, 이벤트, 도메인 계산이 섞여 유지보수 비용이 높다.

### 작업 범위
- `src/pages/admin/program-management.js`를 지원사업 CRUD, 예산 항목 트리, 첨부서류 요구사항, AI 기준 문서 관리, 안내자료 관리 단위로 분리한다.
- `src/pages/founder/dashboard.js`를 예산 제출, 사업계획서 업로드, 지출 현황, 알림/배너 단위로 분리한다.
- mock service의 계산/조회/변경 함수를 `_shared.mock.js` 또는 domain helper로 이동한다.

### 완료 기준
- 페이지 파일은 500라인 이하를 목표로 한다.
- 각 helper 함수는 단일 책임을 가진다.
- 분리 후 기존 화면 URL과 이벤트 동작이 유지된다.

### 검증 방법
- 관련 페이지 수동 smoke test
- `node --check` 전체 JS 재실행

## P2-02. 자동 테스트/검증 스크립트 추가

### 현상/위험
- 현재 자동 검증은 수동 `node --check` 수준이다.
- 예산/지출/상태 전이처럼 중요한 도메인 규칙에 회귀 테스트가 없다.

### 작업 범위
- 최소 테스트 러너를 도입한다. 정적 ESM 프로젝트이므로 Vitest 또는 Node test runner 중 하나를 선택한다.
- domain/service 단위 테스트를 우선 추가한다.
- `node --check` 전체 JS 검사 스크립트와 SQL lint 또는 migration dry-run 절차를 문서화한다.

### 완료 기준
- `npm test` 또는 명확한 대체 명령으로 핵심 도메인 테스트가 실행된다.
- 예산 제출/승인/감액 방지, 지출 제출/검토/보완 재제출, 필수 첨부 검증 테스트가 포함된다.
- CI가 없더라도 로컬 검증 명령이 README에 기록된다.

### 검증 방법
- 테스트 명령 실행 결과 첨부
- 의도적으로 잘못된 상태 전이를 넣었을 때 테스트 실패 확인

## P2-03. 문자 인코딩 및 문서 품질 표준화

### 현상/위험
- 일부 콘솔 출력에서 한글 주석/문자열이 깨져 보인다.
- 실제 파일은 브라우저/Node에서 동작하지만, 에이전트/터미널/배포 환경에 따라 리뷰와 운영 로그 해석이 어려워질 수 있다.

### 작업 범위
- 모든 소스/문서 파일을 UTF-8로 통일한다.
- `.editorconfig`를 추가해 charset, line ending, indentation을 고정한다.
- README의 중복 제목과 깨질 수 있는 특수문자 사용을 정리한다.
- 한국어 사용자 메시지와 코드 주석이 정상 표시되는지 PowerShell, 브라우저, Git diff에서 확인한다.

### 완료 기준
- 주요 파일이 UTF-8로 저장된다.
- 새 파일 작성 시 인코딩/개행이 일관된다.
- README와 SQL 주석이 깨지지 않고 표시된다.

### 검증 방법
- VS Code/PowerShell/Git diff에서 한글 표시 확인
- `node --check` 전체 JS 재실행

## P2-04. 운영 설정과 공개 설정 분리

### 현상/위험
- `src/config.js`에 Supabase URL과 publishable key 기본값이 하드코딩되어 있다.
- publishable key 자체는 공개 가능하지만, 환경별 설정 분리와 배포 실수 방지 장치가 없다.

### 작업 범위
- `window.APP_CONFIG` 주입 방식 또는 환경별 config 파일 정책을 문서화한다.
- dev/staging/prod 값을 분리하고, prod에서 mock API 사용 여부를 명시적으로 확인한다.
- Supabase project id/key 변경 시 배포 파일 수정이 아닌 환경 주입으로 처리한다.

### 완료 기준
- 환경별 설정값 위치가 명확하다.
- production 배포에 dev/mock 설정이 섞이지 않는다.
- README 또는 deploy 문서에 설정 절차가 있다.

### 검증 방법
- dev/prod config 샘플로 앱 로드 확인
- `window.APP_CONFIG` 미주입 시 fallback 동작 확인

## 권장 작업 순서

1. P0-01 Supabase 스키마/RLS 검증
2. P0-02 AI Edge Function 인증/남용 방지
3. P0-03 mock/remote API 경계 정리
4. P1-02 지출/예산 검증 서비스화
5. P1-01 XSS 렌더링 감사
6. P1-03 AI 설정 보안 모델
7. P1-04 파일 업로드 정책
8. P2-02 자동 테스트
9. P2-01 대형 파일 리팩터링
10. P2-03/P2-04 문서/설정 정리

