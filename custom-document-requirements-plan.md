# 예산 항목별 커스텀 첨부서류 및 AI 검토 기능 기획

## 1. 목적

운영사업 관리 화면의 예산/비목 구조를 기준으로, 각 예산 항목마다 요구되는 첨부서류를 관리자가 직접 설정할 수 있도록 한다.

창업자는 지출 신청 시 선택한 예산 항목에 따라 필요한 첨부서류를 업로드하고, 제출 전 AI 검토를 통해 보완 필요 여부를 1차로 확인한다.

이 기능은 서비스의 핵심 설정 기능으로, 사업별/비목별/승인 단계별로 다른 서류 요구사항을 유연하게 관리하는 것을 목표로 한다.

## 2. 핵심 요구사항

### 2.1 예산 항목별 첨부서류 커스터마이즈

관리자는 `운영사업 관리 > 예산/비목 구조 관리`에서 예산 항목을 생성/삭제할 수 있다.

각 예산 항목에는 여러 개의 첨부서류 요구사항을 추가할 수 있어야 한다.

예시:

```txt
예산 항목: 홍보비 > 콘텐츠 제작

- 견적서
- 계약서
- 결과보고서
- 세금계산서
```

관리자는 첨부서류를 하나씩 추가, 수정, 삭제 또는 비활성화할 수 있어야 한다.

이미 창업자가 업로드한 이력이 있는 첨부서류는 완전 삭제보다 비활성화 처리를 우선한다. 과거 신청 건의 이력을 보존하기 위해서다.

### 2.2 사전승인/최종승인 단계 구분

첨부서류는 제출 단계별로 다르게 설정할 수 있어야 한다.

단계 구분:

```txt
사전승인 단계
최종승인 단계
사전/최종 공통
```

예시:

```txt
견적서       : 사전승인 / 필수
계약서       : 사전승인 / 필수
검수확인서   : 최종승인 / 필수
세금계산서   : 최종승인 / 필수
사업자등록증 : 공통 / 선택
```

창업자 화면에서는 현재 신청 단계에 맞는 첨부서류만 표시한다.

상태 기준 예시:

```txt
draft, pre_approval_revision
=> 사전승인 서류 표시

pre_approved, final_approval_revision
=> 최종승인 서류 표시

phase = both
=> 양쪽 단계 모두 표시
```

### 2.3 필수첨부/선택첨부 구분

관리자는 각 첨부서류마다 필수 여부를 설정할 수 있어야 한다.

구분:

```txt
필수첨부
선택첨부
```

필수첨부 서류는 해당 단계 제출 전에 업로드 여부를 검증한다.

선택첨부 서류는 업로드하지 않아도 제출을 막지 않는다.

예시:

```txt
견적서     : 필수첨부
참고자료   : 선택첨부
비교견적서 : 조건부 필수첨부
```

조건부 필수첨부는 후속 확장 항목으로 둔다. 예를 들어 공급가액 500만 원 이상일 때만 비교견적서를 필수로 요구하는 방식이다.

### 2.4 AI 검토 기능

창업자는 첨부파일 업로드 후 `AI검토` 버튼을 눌러 해당 파일의 보완 필요 여부를 확인할 수 있다.

AI 검토 결과는 승인/반려를 자동 결정하지 않는다. 창업자에게 제출 전 보완 가능성을 알려주는 1차 필터링 역할이다.

AI 검토 결과는 코멘트 영역에 텍스트로 표시한다.

예시:

```txt
AI 검토 결과

보완 필요:
- 견적서의 공급가액이 신청 금액과 일치하지 않습니다.
- 업체명이 지출 신청서의 거래처명과 다릅니다.
- 발행일자가 확인되지 않습니다.

제출 전 위 항목을 확인해주세요.
```

문제가 없을 경우:

```txt
AI 검토 결과

제출 가능:
업로드된 파일에서 주요 항목이 확인되었습니다.
관리자 최종 검토 전 참고용 결과입니다.
```

## 3. 관리자 화면 설계

대상 화면:

```txt
admin/program-management.html
```

기존 예산/비목 구조 관리 영역에 선택된 예산 항목의 첨부서류 설정 패널을 추가한다.

### 3.1 첨부서류 설정 패널

예산 항목을 클릭하면 오른쪽 또는 하단에 해당 항목의 첨부서류 목록을 표시한다.

표시 항목:

```txt
서류명
제출 단계
필수 여부
AI 검토 사용 여부
활성 상태
수정/삭제
```

추가 폼:

```txt
서류명
설명
제출 단계: 사전승인 / 최종승인 / 공통
필수 여부: 필수첨부 / 선택첨부
AI 검토: 사용 / 미사용
정렬 순서
```

### 3.2 관리자 사용 흐름

```txt
1. 운영사업 선택
2. 예산/비목 항목 선택
3. 첨부서류 추가 클릭
4. 서류명 입력
5. 제출 단계 선택
6. 필수/선택 여부 선택
7. AI 검토 사용 여부 선택
8. 저장
```

## 4. 창업자 화면 설계

대상 화면:

```txt
founder/expense-new.html
founder/expense-detail.html
```

창업자가 지출 신청에서 예산 항목을 선택하면, 해당 예산 항목에 설정된 첨부서류 요구사항을 조회해 업로드 UI를 동적으로 생성한다.

### 4.1 사전승인 단계

`draft`, `pre_approval_revision` 상태에서는 사전승인 서류를 보여준다.

```txt
사전승인 첨부서류

[필수] 견적서          파일 선택 / AI검토
[필수] 계약서          파일 선택 / AI검토
[선택] 참고자료        파일 선택
```

필수 서류가 누락된 경우 사전승인 제출을 막는다.

### 4.2 최종승인 단계

`pre_approved`, `final_approval_revision` 상태에서는 최종승인 서류를 보여준다.

```txt
최종승인 첨부서류

[필수] 세금계산서      파일 선택 / AI검토
[필수] 검수확인서      파일 선택 / AI검토
[선택] 결과 이미지     파일 선택
```

필수 서류가 누락된 경우 최종승인 제출을 막는다.

## 5. 데이터 구조 제안

### 5.1 첨부서류 요구사항

```js
{
  id: "req-1",
  support_program_id: "prog-1",
  support_program_budget_id: "b-1",
  title: "견적서",
  description: "거래처가 발행한 견적서를 첨부해주세요.",
  phase: "pre",
  required: true,
  ai_review_enabled: true,
  active: true,
  sort_order: 10,
  created_by: "admin-uid",
  created_at: "2026-06-04T10:00:00Z",
  updated_at: "2026-06-04T10:00:00Z"
}
```

`phase` 값:

```txt
pre   : 사전승인 단계
final : 최종승인 단계
both  : 사전/최종 공통
```

`required` 값:

```txt
true  : 필수첨부
false : 선택첨부
```

### 5.2 업로드 파일

```js
{
  id: "file-1",
  expense_request_id: "exp-1",
  requirement_id: "req-1",
  support_program_budget_id: "b-1",
  phase: "pre",
  original_filename: "견적서.pdf",
  mime_type: "application/pdf",
  size_bytes: 523000,
  link_url: "storage:...",
  uploaded_by: "founder-uid",
  ai_review_status: "needs_revision",
  ai_review_comment: "공급가액이 신청 금액과 일치하지 않습니다.",
  ai_check_result: {
    vendor_name: "ABC 디자인",
    amount: 5000000,
    issue_date: "2026-06-01",
    has_seal: true
  },
  created_at: "2026-06-04T10:10:00Z"
}
```

`ai_review_status` 값:

```txt
not_requested
pending
passed
needs_revision
failed
```

## 6. API 함수 제안

관리자용:

```js
getBudgetDocumentRequirements(budgetId)
createBudgetDocumentRequirement(input)
updateBudgetDocumentRequirement(id, input)
deleteBudgetDocumentRequirement(id)
deactivateBudgetDocumentRequirement(id)
```

창업자용:

```js
getExpenseDocumentRequirements(expenseRequestId, phase)
uploadExpenseDocumentFile(expenseRequestId, requirementId, phase, file)
deleteExpenseDocumentFile(fileId)
requestAiDocumentReview(fileId)
```

제출 검증:

```js
validateRequiredDocuments(expenseRequestId, phase)
```

## 7. 제출 검증 규칙

사전승인 제출 시:

```txt
phase = pre 또는 both
required = true
active = true
```

위 조건에 해당하는 서류가 모두 업로드되어 있어야 한다.

최종승인 제출 시:

```txt
phase = final 또는 both
required = true
active = true
```

위 조건에 해당하는 서류가 모두 업로드되어 있어야 한다.

AI 검토가 필수 제출 조건인지 여부는 별도 정책으로 분리한다.

권장 정책:

```txt
파일 업로드는 제출 필수 조건
AI 검토는 제출 전 권장 조건
관리자 최종 판단은 별도
```

향후 필요 시 `ai_review_required` 필드를 추가해 특정 서류는 AI 검토 완료 후에만 제출 가능하도록 확장할 수 있다.

## 8. 구현 단계

### 1단계: 데이터 모델 및 mock API 추가

- `STORAGE_KEYS`에 첨부서류 요구사항 저장소 추가
- 요구사항 CRUD mock API 추가
- 업로드 파일에 `requirement_id`, `phase`, `link_url`, `ai_review_status`, `ai_review_comment` 필드 추가

### 2단계: 관리자 설정 UI 추가

- 예산 항목 선택 시 첨부서류 설정 패널 표시
- 첨부서류 추가/수정/삭제/비활성화 기능 구현
- 제출 단계, 필수 여부, AI 검토 사용 여부 설정 가능하게 구현

### 3단계: 창업자 업로드 UI 추가

- 선택한 예산 항목 기준으로 첨부서류 요구사항 조회
- 현재 승인 단계에 맞는 서류만 표시
- 필수/선택 배지 표시
- 파일 업로드/삭제 기능 구현

### 4단계: 제출 전 필수서류 검증

- 사전승인 제출 시 사전승인 필수서류 검증
- 최종승인 제출 시 최종승인 필수서류 검증
- 누락된 서류명을 사용자에게 안내

### 5단계: AI 검토 기능 추가

- 파일별 `AI검토` 버튼 추가
- AI 검토 결과를 파일 row 하단 코멘트 영역에 표시
- 결과 상태를 `제출 가능`, `보완 필요`, `검토 실패`로 구분

### 6단계: 관리자 상세 화면 연동

- 관리자 지출 상세 화면에서 제출된 파일과 AI 검토 결과 표시
- AI 결과는 참고용임을 명시
- 최종 승인/보완 요청 판단은 관리자가 수행

## 9. 주의사항

첨부서류 요구사항 삭제는 신중해야 한다.

이미 업로드 파일이 연결된 요구사항은 삭제하지 않고 `active = false`로 비활성화하는 것이 안전하다.

AI 검토는 법적/행정적 최종 판단으로 사용하면 안 된다. 창업자의 제출 전 자가 점검과 관리자의 참고 자료로만 사용한다.

실제 운영 환경에서는 파일 저장소, 접근 권한, 개인정보 보호, 파일 용량 제한, 악성 파일 검사, OCR/문서 분석 서버가 필요하다.

현재 정적 mock 구조에서는 MVP 화면 흐름과 데이터 구조 검증까지 구현 가능하다.

## 10. 결론

예산 항목별로 첨부서류를 하나씩 추가하는 커스텀 구조는 구현 가능하다.

사전승인/최종승인 단계별 요구서류 구분도 가능하다.

필수첨부/선택첨부 여부도 각 첨부서류 설정에 포함하면 자연스럽게 처리할 수 있다.

권장 구현 방향은 다음과 같다.

```txt
예산 항목
  -> 첨부서류 요구사항 N개
    -> 제출 단계
    -> 필수 여부
    -> AI 검토 여부
    -> 창업자 업로드 파일
    -> AI 검토 코멘트
```

이 구조로 가면 사업별, 비목별, 승인 단계별로 다른 서류 요구사항을 운영자가 직접 관리할 수 있다.
