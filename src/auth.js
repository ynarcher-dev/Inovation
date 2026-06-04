import {
  mockGetCurrentUser,
  mockSignIn,
  mockSignUpFounder,
  mockSignOut,
  mockVerifyCurrentPassword,
  mockChangePassword,
  mockDeleteFounderAccount,
} from "./mockApi.js";

export function normalizeLoginId(value) {
  const LOGIN_ALIASES = {
    super: "super@yna.local",
    admin: "admin@yna.local",
    founder: "founder@yna.local",
    user: "founder@yna.local",
  };
  const trimmed = String(value || "").trim();
  return LOGIN_ALIASES[trimmed] || trimmed;
}

export const getCurrentUser = mockGetCurrentUser;
export const signIn = mockSignIn;
export const signUpFounder = mockSignUpFounder;
export const signOut = mockSignOut;
export const verifyCurrentPassword = mockVerifyCurrentPassword;
export const changePassword = mockChangePassword;
export const deleteFounderAccount = mockDeleteFounderAccount;

export function redirectByRole(role) {
  const isSubFolder = window.location.pathname.includes("/admin/") || window.location.pathname.includes("/founder/") || window.location.pathname.includes("/auth/");
  const base = isSubFolder ? "../" : "./";
  window.location.href = role === "admin" || role === "super_admin"
    ? `${base}admin/dashboard.html`
    : `${base}founder/dashboard.html`;
}

export async function requireRole(allowedRoles) {
  const user = await getCurrentUser();
  if (!user) {
    const isSubFolder = window.location.pathname.includes("/admin/") || window.location.pathname.includes("/founder/") || window.location.pathname.includes("/auth/");
    window.location.href = isSubFolder ? "../auth/login.html" : "auth/login.html";
    return null;
  }
  if (!allowedRoles.includes(user.profile.role)) {
    redirectByRole(user.profile.role);
    return null;
  }
  return user;
}
