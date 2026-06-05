# 사업비 집행 도우미 개발 가이드

이 문서는 프로젝트를 유지보수하기 쉽게 개발하기 위한 기본 규칙을 정리합니다. 새 기능을 추가하거나 기존 기능을 수정할 때는 아래 원칙을 먼저 확인합니다.

## 개발 원칙

- 기능 추가보다 데이터 흐름과 상태 흐름의 일관성을 우선합니다.
- 화면에서 직접 `localStorage`를 조작하지 않습니다. mock 단계에서도 `src/api.js`와 `src/services/mock/*`를 통해 처리합니다.
- founder와 admin 양쪽에 영향을 주는 기능은 한쪽만 수정하지 않습니다.
- 같은 기능을 처리하는 페이지나 컴포넌트를 중복해서 만들지 않습니다.
- 첨부서류 업로드 기능은 별도 재설계 대상입니다. 임시 패치로 끼워 넣지 않습니다.

## 코드 크기 규칙

- 페이지 JS 파일은 500줄 이하를 목표로 합니다.
- 500줄을 넘기면 다음 단위로 분리합니다.
  - 렌더링 함수: `src/components/*`
  - 도메인 상태/규칙: `src/domains/*`
  - mock 데이터 처리: `src/services/mock/*`
  - 페이지별 DOM 헬퍼: `src/dom/*`
- 단일 함수는 80줄 이하를 목표로 합니다.
- 같은 조건문이나 상태 매핑이 2곳 이상 반복되면 공통 상수 또는 helper로 분리합니다.
- HTML 문자열이 길어지면 컴포넌트 함수로 분리합니다.

## 폴더 역할

- `admin/`: admin HTML 진입점만 둡니다.
- `founder/`: founder HTML 진입점만 둡니다.
- `src/pages/`: 페이지 초기화, 이벤트 바인딩, API 호출 흐름을 담당합니다.
- `src/components/`: 재사용 가능한 UI 렌더링 함수를 둡니다.
- `src/domains/`: 상태값, 라벨, 전환 규칙, 검증 규칙을 둡니다.
- `src/services/mock/`: mock 데이터의 생성, 조회, 수정, 삭제를 담당합니다.
- `src/dom/`: 특정 페이지의 DOM 조작 helper를 둡니다.

## 페이지 작성 규칙

- 페이지 파일은 다음 순서를 유지합니다.
  - import
  - 페이지 전용 상수
  - 작은 helper 함수
  - render 함수
  - event binding 함수
  - `try { mountShell(); ... } catch`
- 페이지 파일 안에서 복잡한 HTML 테이블을 직접 만들지 않습니다. 컴포넌트로 분리합니다.
- 페이지 파일 안에서 mock storage key를 직접 참조하지 않습니다.
- `window.alert`, `window.confirm`, `window.prompt`는 임시 UX로만 사용하고, 반복 사용되면 modal/helper로 분리합니다.
- 페이지 이동 URL은 helper 함수로 분리합니다.

## 상태 관리 규칙

- 가입 승인 상태와 예산 승인 상태를 섞지 않습니다.
  - 가입 승인: `approval_status`
  - 예산 승인: `budget_status`
- 지출 상태 라벨과 순서는 `src/domains/status.js`를 기준으로 합니다.
- 예산 상태 라벨과 예산 가능 여부는 `src/domains/budget/budget-status.js`를 기준으로 합니다.
- 새 상태값을 추가하면 founder 화면, admin 화면, mock service, table/badge 컴포넌트를 함께 점검합니다.

## API/Mock 규칙

- 화면은 `src/api.js`만 호출합니다.
- `src/api.js`는 mock service 함수를 export하는 경계 역할을 합니다.
- mock 데이터 수정 로직은 `src/services/mock/*`에 둡니다.
- 데이터 구조 변경 시 `src/services/mock/seed.js`의 `DATA_VERSION`을 올려 기존 local mock 데이터를 재시드합니다.
- mock service 함수 이름은 실제 API로 바꾸기 쉬운 동사형으로 작성합니다.

## Founder/Admin 동기화 규칙

founder에서 새 기능을 만들면 admin에서 다음 항목을 확인합니다.

- 목록에 표시되는가?
- 상세에서 조회되는가?
- 승인/보완/반려 등 관리 액션이 필요한가?
- 검토 이력에 기록되어야 하는가?
- 상태 배지와 필터에 반영되어야 하는가?

admin에서 새 관리 기능을 만들면 founder에서 다음 항목을 확인합니다.

- founder 화면에 결과가 반영되는가?
- founder가 다음 액션을 이해할 수 있는 안내가 있는가?
- 승인 전/승인 후 노출 규칙이 분리되어 있는가?

## 사업계획서/예산 규칙

- 사업계획서는 `company.business_plans.round1`, `company.business_plans.round2` 구조를 기준으로 합니다.
- 레거시 `company.business_plan`은 호환용으로만 사용합니다.
- 예산안은 제출만으로 확정 예산에 반영하지 않습니다.
- 확정 예산은 admin 승인 후에만 `ALLOCATIONS`에 반영합니다.
- 감액 시 이미 승인되었거나 검토 중인 지출 금액보다 낮출 수 없습니다.
- 2차 예산은 승인 전에는 지출 가능 예산으로 취급하지 않습니다.

## Guidance 관리 규칙

- founder에 노출되는 안내자료는 프로그램별 `support_program_id`가 있어야 합니다.
- 프로그램별 안내자료 관리는 `program-management`를 기준으로 합니다.
- 별도 guidance 관리 페이지를 유지할 경우에도 반드시 프로그램 선택을 포함해야 합니다.

## 리팩토링 기준

아래 조건 중 하나라도 맞으면 기능 추가 전에 리팩토링을 먼저 고려합니다.

- 페이지 JS가 500줄을 넘는다.
- 같은 화면 문자열이나 상태 라벨이 여러 파일에 반복된다.
- admin/founder 중 한쪽만 데이터 구조 변경을 알고 있다.
- 화면에서 storage를 직접 읽거나 쓴다.
- 하나의 함수가 렌더링, 검증, 저장, 이동을 모두 처리한다.
- 같은 테이블이 다른 파일에서 조금씩 다르게 구현되어 있다.

## 변경 전 체크리스트

- 이 변경이 founder와 admin 중 어디까지 영향을 주는가?
- 상태값이 추가되거나 바뀌는가?
- mock seed 데이터도 바뀌어야 하는가?
- 기존 브라우저 localStorage 데이터와 호환되어야 하는가?
- 페이지 파일이 500줄을 넘지 않는가?

## 변경 후 체크리스트

- 관련 페이지를 브라우저에서 직접 열어본다.
- founder와 admin 양쪽의 데이터 반영을 확인한다.
- `npm run check`로 전체 JS 문법을 확인한다(개별 파일은 `node --check <file>`).
- 도메인 규칙을 바꿨으면 `npm test`로 회귀 테스트를 돌린다.
- 새로 만든 helper나 component가 한 가지 책임만 가지는지 확인한다.
- 임시로 둔 코드는 주석으로 표시하고 후속 작업 문서에 남긴다.

## 로컬 검증 / 테스트

별도 의존성 설치가 필요 없다(Node 내장 test runner 사용, Node 18+ 권장 / 개발은 v20+).

| 명령 | 설명 |
|------|------|
| `npm test` | 도메인/서비스 단위 테스트(`tests/*.test.js`) 실행 |
| `npm run check` | `src`/`scripts`/`tests` 전체 JS `node --check` 일괄 검사 |

- 테스트 대상은 브라우저 전역(`window`/`document`)에 의존하지 않는 순수 도메인 모듈이다.
  - `src/domains/expense/expense-validation.js` — 지출 상태 전이/필드·예산·첨부 검증
  - `src/domains/expense/rules-engine.js` — 필수 서류/경고 규칙
- 새 도메인 규칙을 추가하면 같은 위치에 테스트를 추가한다.
- SQL 검증 절차는 [supabase/RLS_TEST_MATRIX.md](supabase/RLS_TEST_MATRIX.md) 참고.

## 환경 설정 / 배포

- 환경별 값은 배포 파일 수정이 아니라 `window.APP_CONFIG` 주입으로 덮어쓴다. 샘플은 [docs/deploy-config.md](docs/deploy-config.md).
- mock/실제 Supabase 전환 순서는 [docs/api-migration.md](docs/api-migration.md).
- 렌더링/XSS 가이드는 [docs/rendering-xss-guidelines.md](docs/rendering-xss-guidelines.md).

