const commonDocs = [
  ["estimate", "견적서"],
  ["vendor_business_license", "거래처 사업자등록증"],
  ["vendor_bankbook", "거래처 통장사본"],
];

const typeDocs = {
  general_service: [
    ["contract", "계약서"],
    ["task_order", "과업지시서"],
    ["appropriateness_review", "사업비 집행 적정성 심의표"],
  ],
  facility: [
    ["contract", "계약서"],
    ["appropriateness_review", "사업비 집행 적정성 심의표"],
  ],
  material: [
    ["delivery_statement", "거래명세서"],
  ],
  maintenance: [
    ["maintenance_quote", "유지보수 견적서"],
    ["maintenance_scope", "유지보수 범위 확인서"],
  ],
  advertising: [
    ["contract_or_order", "계약서 또는 주문서"],
    ["result_plan", "광고 계획서"],
  ],
  ip: [
    ["contract", "계약서"],
    ["ip_plan", "지식재산권 취득 계획서"],
  ],
  education: [
    ["education_info", "교육 안내자료"],
    ["education_application", "교육 참가 신청서"],
  ],
  rent: [
    ["rental_contract", "임차 계약서"],
  ],
  utility: [
    ["bill", "청구서 또는 고지서"],
    ["payment_receipt", "납부 영수증"],
  ],
};

export const standardBudgetCategories = [
  "일반수용비",
  "공공요금 및 제세",
  "임차료",
  "시설장비 유지비",
  "시설비",
  "일반용역비",
  "재료비",
];

export const expenseTypeOptions = [
  { value: "general_service", label: "외주용역/개발/디자인", budgetCategory: "일반용역비", reason: "외부 업체가 과업을 수행하고 결과물을 납품하는 지출입니다." },
  { value: "facility", label: "시설 공사/인테리어", budgetCategory: "시설비", reason: "공사, 시설 설치, 시설 개선 성격의 지출입니다." },
  { value: "material", label: "시제품 재료 구매", budgetCategory: "재료비", reason: "시제품 제작에 직접 투입되는 재료 구입입니다." },
  { value: "maintenance", label: "시설/장비 유지보수", budgetCategory: "시설장비 유지비", reason: "기존 시설 또는 장비의 수리, 점검, 유지보수 지출입니다." },
  { value: "advertising", label: "광고/홍보/콘텐츠 제작", budgetCategory: "일반수용비", reason: "광고료, 홍보물, 콘텐츠 제작 등 일반수용비 성격의 지출입니다." },
  { value: "ip", label: "특허/상표/지식재산권", budgetCategory: "일반수용비", reason: "출원, 등록, 수수료 등 지식재산권 관련 일반수용비입니다." },
  { value: "education", label: "교육훈련", budgetCategory: "일반수용비", reason: "사업화를 위한 기술/경영 교육 수강 비용입니다." },
  { value: "rent", label: "장비 임차", budgetCategory: "임차료", reason: "장비를 구매하지 않고 일정 기간 빌려 사용하는 비용입니다." },
  { value: "utility", label: "공공요금/제세/보험", budgetCategory: "공공요금 및 제세", reason: "우편, 전기, 보험료 등 공공요금 및 제세 성격의 지출입니다." },
];

export function getExpenseTypeMeta(expenseType) {
  return expenseTypeOptions.find((option) => option.value === expenseType) || expenseTypeOptions[0];
}

export function getExpenseTypesForBudgetCategory(budgetCategory) {
  return expenseTypeOptions.filter((option) => option.budgetCategory === budgetCategory);
}

export function generateChecklist(input) {
  const amountSupply = Number(input.amount_supply || 0);
  const expenseType = input.expense_type || "";
  const docs = new Map(commonDocs.map(([document_type, label]) => [document_type, { document_type, label, required: true, status: "missing" }]));

  if (amountSupply >= 5000000) {
    docs.set("comparative_estimate", {
      document_type: "comparative_estimate",
      label: "비교견적서",
      required: true,
      status: "missing",
    });
  }

  for (const [document_type, label] of typeDocs[expenseType] || []) {
    docs.set(document_type, { document_type, label, required: true, status: "missing" });
  }

  if (expenseType === "utility") {
    docs.set("tax_invoice_exception_note", {
      document_type: "tax_invoice_exception_note",
      label: "세금계산서 대체증빙 사유",
      required: false,
      status: "missing",
    });
  }

  if (input.advance_payment_requested) {
    docs.set("advance_payment_request", {
      document_type: "advance_payment_request",
      label: "선금 신청서",
      required: true,
      status: "missing",
    });
    docs.set("advance_payment_plan", {
      document_type: "advance_payment_plan",
      label: "선금 사용 계획서",
      required: true,
      status: "missing",
    });
  }

  return Array.from(docs.values());
}

export function generateWarnings(input) {
  const warnings = [];
  const amountSupply = Number(input.amount_supply || 0);
  const vatAmount = Number(input.vat_amount || 0);

  if (vatAmount > 0) {
    warnings.push({
      code: "VAT_EXCLUDED",
      severity: "warning",
      message: "부가세는 사업비 집행 대상이 아니므로 공급가액 기준으로 신청해야 합니다.",
    });
  }
  if (amountSupply >= 5000000) {
    warnings.push({
      code: "COMPARATIVE_ESTIMATE_REQUIRED",
      severity: "warning",
      message: "공급가액 500만원 이상이므로 비교견적서가 필요합니다.",
    });
  }
  if (amountSupply >= 20000000 && input.expense_type === "general_service") {
    warnings.push({
      code: "HIGH_VALUE_SERVICE",
      severity: "danger",
      message: "공급가액 2,000만원 이상 일반용역비는 고액 계약 검토가 필요합니다.",
    });
  }
  if (input.expense_type === "utility") {
    warnings.push({
      code: "ALTERNATIVE_EVIDENCE_ALLOWED",
      severity: "info",
      message: "공공요금 및 제세는 세금계산서 대신 고지서/청구서/납부영수증이 대체증빙이 될 수 있습니다.",
    });
  }
  return warnings;
}

export const documentActionMeta = {
  pre_approval_request: {
    action: "generate",
    button: "자동작성",
    description: "입력한 신청 정보로 사전승인 신청서를 자동 작성합니다.",
  },
  inspection_report: {
    action: "generate",
    button: "자동작성",
    description: "납품일, 검수자, 납품 사진 정보를 바탕으로 검수조서를 작성합니다.",
  },
  advance_payment_request: {
    action: "generate",
    button: "자동작성",
    description: "계약 정보와 선금 신청 금액을 바탕으로 선금 신청서를 작성합니다.",
  },
  advance_payment_plan: {
    action: "generate",
    button: "자동작성",
    description: "선금 사용 계획을 입력해 선금 사용 계획서를 작성합니다.",
  },
  appropriateness_review: {
    action: "form",
    button: "작성하기",
    description: "외주용역/시설비 집행 적정성을 체크폼으로 검토합니다.",
  },
  result_report: {
    action: "form",
    button: "작성하기",
    description: "과업 수행 결과와 결과물을 작성합니다.",
  },
  settlement_statement: {
    action: "form",
    button: "작성하기",
    description: "정산 내역을 화면에서 입력하거나 엑셀 파일을 업로드합니다.",
  },
  tax_invoice_exception_note: {
    action: "form",
    button: "사유 작성",
    description: "세금계산서 제출이 어려운 공공요금/제세 항목의 대체증빙 사유를 작성합니다.",
  },
};

export function getDocumentActionMeta(documentType) {
  return documentActionMeta[documentType] || {
    action: "upload",
    button: "업로드",
    description: "해당 서류 파일을 PDF, 이미지, 엑셀 또는 문서 파일로 업로드합니다.",
  };
}
