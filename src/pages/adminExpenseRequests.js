import { mountShell, setText, showError } from "../app.js";
import { getAdminDashboard } from "../api.js";
import { requireRole } from "../auth.js";
import { ExpenseTable } from "../components/ExpenseTable.js";

try {
  mountShell();
  const user = await requireRole(["admin", "super_admin"]);
  if (user) {
    const { expenses } = await getAdminDashboard();
    setText("[data-user-name]", user.profile.name);
    document.querySelector("[data-expense-table]").innerHTML = ExpenseTable(expenses, { admin: true });
  }
} catch (error) {
  showError(error);
}
