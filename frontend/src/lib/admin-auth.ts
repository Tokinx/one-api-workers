export const ADMIN_SESSION_TOKEN_KEY = "adminSessionToken";
export const LEGACY_ADMIN_TOKEN_KEY = "adminToken";

const canUseLocalStorage = (): boolean => {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
};

export const clearAdminCredentials = (): void => {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.removeItem(ADMIN_SESSION_TOKEN_KEY);
  window.localStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);
};

export const getAdminCredentialScopeToken = (): string => {
  if (typeof window === "undefined") {
    return "server";
  }

  return window.location.origin || "anonymous";
};
