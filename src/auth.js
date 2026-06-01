import {
  mockGetCurrentUser,
  mockSignIn,
  mockSignUpFounder,
  mockSignOut,
  mockVerifyCurrentPassword,
} from "./mockApi.js";

export function normalizeLoginId(value) {
  const LOGIN_ALIASES = {
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

export function redirectByRole(role) {
  const isSubFolder = window.location.pathname.includes("/admin/") || window.location.pathname.includes("/founder/");
  const base = isSubFolder ? "../" : "./";
  window.location.href = role === "admin" || role === "super_admin"
    ? `${base}admin/dashboard.html`
    : `${base}founder/dashboard.html`;
}

export async function requireRole(allowedRoles) {
  const user = await getCurrentUser();
  if (!user) {
    const isSubFolder = window.location.pathname.includes("/admin/") || window.location.pathname.includes("/founder/");
    window.location.href = isSubFolder ? "../login.html" : "login.html";
    return null;
  }
  if (!allowedRoles.includes(user.profile.role)) {
    redirectByRole(user.profile.role);
    return null;
  }
  return user;
}
