import { getSupabase } from "./supabaseClient.js";
import { generateChecklist } from "./rulesEngine.js";

const manualLinks = [
  { label: "사업화지원금 주요 비목 및 산정기준", href: "/docs/(000) 2025년 체육인 새싹 사업화지원금 주요 비목 및 산정기준.pdf" },
  { label: "사업비 집행 유의사항 안내", href: "/docs/체육인창업지원(새싹) 사업 집행 유의사항 안내(예비창업자)_1013_최종.pdf" },
  { label: "회계 교육자료", href: "/docs/(000) 2025년 체육인 직업안정사업(창업보육) 회계 교육자료_260129.pdf" },
];

function calculateBudgetSummary(items, expenses) {
  return items.map((item) => {
    const related = expenses.filter((expense) => expense.budget_category === item.budget_category);
    const approvedAmount = related
      .filter((expense) => ["pre_approved", "executing", "execution_submitted", "inspection_submitted", "settlement_submitted", "completed"].includes(expense.status))
      .reduce((sum, expense) => sum + Number(expense.amount_supply || 0), 0);
    const pendingAmount = related
      .filter((expense) => ["pre_approval_submitted", "pre_approval_revision_requested"].includes(expense.status))
      .reduce((sum, expense) => sum + Number(expense.amount_supply || 0), 0);
    return {
      ...item,
      approved_amount: approvedAmount,
      pending_amount: pendingAmount,
      remaining_amount: Number(item.allocated_amount || 0) - approvedAmount - pendingAmount,
    };
  });
}

export async function getFounderDashboard() {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase 설정이 필요합니다.");

  const { data: memberships, error: membershipError } = await supabase
    .from("company_members")
    .select("company_id, companies(*)")
    .limit(1);
  if (membershipError) throw membershipError;
  const company = memberships?.[0]?.companies;
  if (!company) return { company: null, expenses: [] };

  const { data: expenses, error: expenseError } = await supabase
    .from("expense_requests")
    .select("*")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false });
  if (expenseError) throw expenseError;

  const { data: businessPlans, error: planError } = await supabase
    .from("business_plans")
    .select("*, business_plan_items(*)")
    .eq("company_id", company.id)
    .eq("status", "final")
    .order("created_at", { ascending: false })
    .limit(1);
  if (planError) throw planError;
  const plan = businessPlans?.[0];
  const businessPlanItems = plan?.business_plan_items || [];

  return {
    company: { ...company, business_plan: plan },
    expenses: expenses || [],
    businessPlanItems,
    budgetSummary: calculateBudgetSummary(businessPlanItems, expenses || []),
    manualLinks,
  };
}

export async function getAdminDashboard() {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase 설정이 필요합니다.");

  const [
    { data: expenses, error: expenseError },
    { data: companiesData, count, error: countError },
    { data: businessPlans, error: planError },
  ] = await Promise.all([
    supabase
      .from("expense_requests")
      .select("*, companies(name, representative_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("companies")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false }),
    supabase
      .from("business_plans")
      .select("company_id, business_plan_items(*)")
      .eq("status", "final"),
  ]);
  if (expenseError) throw expenseError;
  if (countError) throw countError;
  if (planError) throw planError;

  const expensesRows = expenses || [];
  const companies = (companiesData || []).map((company) => {
    const planItems = businessPlans?.find((plan) => plan.company_id === company.id)?.business_plan_items || [];
    const companyExpenses = expensesRows.filter((expense) => expense.company_id === company.id);
    return {
      ...company,
      budgetSummary: calculateBudgetSummary(planItems, companyExpenses),
      expense_count: companyExpenses.length,
    };
  });
  const totalApprovedAmount = expensesRows
    .filter((expense) => ["pre_approved", "executing", "execution_submitted", "inspection_submitted", "settlement_submitted", "completed"].includes(expense.status))
    .reduce((sum, expense) => sum + Number(expense.amount_supply || 0), 0);

  return {
    companyCount: count || 0,
    companies,
    totalSupportAmount: companies.reduce((sum, company) => sum + Number(company.support_total_amount || 0), 0),
    totalApprovedAmount,
    totalIssueCount: 0,
    expenses: expensesRows.map((row) => ({
      ...row,
      company_name: row.companies?.name,
      representative_name: row.companies?.representative_name,
    })),
  };
}

export async function approveCompany(companyId, adminUserId) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase 설정이 필요합니다.");

  const { data, error } = await supabase
    .from("companies")
    .update({
      approval_status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: adminUserId,
    })
    .eq("id", companyId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getAdminCompanyDetail(companyId) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase 설정이 필요합니다.");

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .single();
  if (companyError) throw companyError;

  const { data: expenses, error: expenseError } = await supabase
    .from("expense_requests")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (expenseError) throw expenseError;

  const { data: businessPlans, error: planError } = await supabase
    .from("business_plans")
    .select("*, business_plan_items(*)")
    .eq("company_id", companyId)
    .eq("status", "final")
    .order("created_at", { ascending: false })
    .limit(1);
  if (planError) throw planError;
  const plan = businessPlans?.[0];
  const businessPlanItems = plan?.business_plan_items || [];

  return {
    company: { ...company, business_plan: plan },
    businessPlanItems,
    budgetSummary: calculateBudgetSummary(businessPlanItems, expenses || []),
    expenses: expenses || [],
    reviewHistory: [],
  };
}

export async function getExpenseDetail(id) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase 설정이 필요합니다.");

  const [{ data: expense, error: expenseError }, { data: documents, error: docError }, { data: files, error: fileError }, { data: reviews, error: reviewError }] = await Promise.all([
    supabase.from("expense_requests").select("*, companies(name, representative_name)").eq("id", id).single(),
    supabase.from("required_documents").select("*").eq("expense_request_id", id).order("created_at"),
    supabase.from("uploaded_files").select("*").eq("expense_request_id", id).order("created_at", { ascending: false }),
    supabase.from("reviews").select("*").eq("expense_request_id", id).order("created_at", { ascending: false }),
  ]);

  if (expenseError) throw expenseError;
  if (docError) throw docError;
  if (fileError) throw fileError;
  if (reviewError) throw reviewError;

  return {
    expense: {
      ...expense,
      company_name: expense.companies?.name,
      representative_name: expense.companies?.representative_name,
    },
    documents: documents || [],
    files: files || [],
    reviews: reviews || [],
  };
}

export async function createExpense(input, user) {
  const checklist = generateChecklist(input);
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase 설정이 필요합니다.");

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("approval_status")
    .eq("id", input.company_id)
    .single();
  if (companyError) throw companyError;
  if (company?.approval_status !== "approved") {
    throw new Error("관리자 승인 완료 후 지출 신청을 생성할 수 있습니다.");
  }

  const { data, error } = await supabase
    .from("expense_requests")
    .insert({
      ...input,
      founder_id: user.id,
      total_amount: Number(input.amount_supply || 0) + Number(input.vat_amount || 0),
    })
    .select("id")
    .single();
  if (error) throw error;

  const docs = checklist.map((item) => ({
    expense_request_id: data.id,
    document_type: item.document_type,
    label: item.label,
    required: item.required,
    status: item.status,
  }));
  const { error: docsError } = await supabase.from("required_documents").insert(docs);
  if (docsError) throw docsError;
  return data;
}

export async function submitExpenseRequest(id) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase 설정이 필요합니다.");

  const { data, error } = await supabase
    .from("expense_requests")
    .update({ status: "pre_approval_submitted", submitted_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function reviewExpenseRequest(id, decision, comment, reviewerId) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase 설정이 필요합니다.");

  const statusMap = {
    approved: "pre_approved",
    rejected: "rejected",
    revision_requested: "pre_approval_revision_requested",
  };
  const { error: reviewError } = await supabase.from("reviews").insert({
    expense_request_id: id,
    reviewer_id: reviewerId,
    decision,
    comment,
  });
  if (reviewError) throw reviewError;

  const { data, error } = await supabase
    .from("expense_requests")
    .update({ status: statusMap[decision], approved_at: decision === "approved" ? new Date().toISOString() : null })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markDocumentUploaded(expenseRequestId, documentType) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase 설정이 필요합니다.");

  const { error } = await supabase
    .from("required_documents")
    .update({ status: "uploaded" })
    .eq("expense_request_id", expenseRequestId)
    .eq("document_type", documentType);
  if (error) throw error;
  return { ok: true };
}

export async function uploadDocumentFile(expenseRequestId, documentType, file, user) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error("Supabase 설정이 필요합니다.");
  if (!file) throw new Error("업로드할 파일을 선택해야 합니다.");

  const { data: signedUrl, error: functionError } = await supabase.functions.invoke("create-upload-url", {
    body: {
      expense_request_id: expenseRequestId,
      document_type: documentType,
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    },
  });
  if (functionError) throw functionError;
  if (!signedUrl?.upload_url) throw new Error("R2 업로드 URL을 받지 못했습니다.");

  const uploadResponse = await fetch(signedUrl.upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`R2 업로드 실패: ${uploadResponse.status}`);
  }

  const { error: fileError } = await supabase.from("uploaded_files").insert({
    expense_request_id: expenseRequestId,
    document_type: documentType,
    s3_bucket: signedUrl.s3_bucket,
    s3_key: signedUrl.s3_key,
    original_filename: file.name,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    uploaded_by: user.id,
  });
  if (fileError) throw fileError;

  await markDocumentUploaded(expenseRequestId, documentType);
  return {
    s3_bucket: signedUrl.s3_bucket,
    s3_key: signedUrl.s3_key,
    original_filename: file.name,
  };
}
