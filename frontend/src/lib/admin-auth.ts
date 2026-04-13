export const ADMIN_SESSION_TOKEN_KEY = "adminSessionToken";
export const LEGACY_ADMIN_TOKEN_KEY = "adminToken";
export const ADMIN_SESSION_HEADER = "x-admin-session";
export const LEGACY_ADMIN_TOKEN_HEADER = "x-admin-token";

const canUseLocalStorage = (): boolean => {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
};

export const getStoredAdminSessionToken = (): string | null => {
  if (!canUseLocalStorage()) {
    return null;
  }

  const value = window.localStorage.getItem(ADMIN_SESSION_TOKEN_KEY);
  return value && value.trim().length > 0 ? value.trim() : null;
};

export const getStoredLegacyAdminToken = (): string | null => {
  if (!canUseLocalStorage()) {
    return null;
  }

  const value = window.localStorage.getItem(LEGACY_ADMIN_TOKEN_KEY);
  return value && value.trim().length > 0 ? value.trim() : null;
};

export const getStoredAdminCredential = (): { headerName: string; token: string } | null => {
  const sessionToken = getStoredAdminSessionToken();
  if (sessionToken) {
    return {
      headerName: ADMIN_SESSION_HEADER,
      token: sessionToken,
    };
  }

  const legacyToken = getStoredLegacyAdminToken();
  if (legacyToken) {
    return {
      headerName: LEGACY_ADMIN_TOKEN_HEADER,
      token: legacyToken,
    };
  }

  return null;
};

export const storeAdminSessionToken = (token: string): void => {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);
  window.localStorage.setItem(ADMIN_SESSION_TOKEN_KEY, token);
};

export const clearAdminCredentials = (): void => {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.removeItem(ADMIN_SESSION_TOKEN_KEY);
  window.localStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);
};

export const getAdminCredentialScopeToken = (): string => {
  return getStoredAdminSessionToken()
    || getStoredLegacyAdminToken()
    || "anonymous";
};
