import { getAdminCredentialScopeToken } from "@/lib/admin-auth";

const CACHE_PREFIX = "one-api-cache";
const CACHE_VERSION = 1;

export interface LocalCacheEntry<T> {
  version: number;
  updatedAt: number;
  data: T;
}

const canUseLocalStorage = (): boolean => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const getAdminTokenScope = (): string => {
  if (!canUseLocalStorage()) {
    return "server";
  }

  const adminToken = getAdminCredentialScopeToken();
  let hash = 2166136261;

  for (let index = 0; index < adminToken.length; index += 1) {
    hash ^= adminToken.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `scope-${(hash >>> 0).toString(36)}`;
};

const getStorageKey = (key: string): string => {
  return `${CACHE_PREFIX}:v${CACHE_VERSION}:${getAdminTokenScope()}:${key}`;
};

export const readScopedCache = <T>(key: string): LocalCacheEntry<T> | null => {
  if (!canUseLocalStorage()) {
    return null;
  }

  try {
    const storageKey = getStorageKey(key);
    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      !("updatedAt" in parsed) ||
      !("data" in parsed) ||
      parsed.version !== CACHE_VERSION ||
      typeof parsed.updatedAt !== "number"
    ) {
      window.localStorage.removeItem(storageKey);
      return null;
    }

    return parsed as LocalCacheEntry<T>;
  } catch {
    window.localStorage.removeItem(getStorageKey(key));
    return null;
  }
};

export const writeScopedCache = <T>(key: string, data: T): LocalCacheEntry<T> | null => {
  if (!canUseLocalStorage()) {
    return null;
  }

  const entry: LocalCacheEntry<T> = {
    version: CACHE_VERSION,
    updatedAt: Date.now(),
    data,
  };

  try {
    window.localStorage.setItem(getStorageKey(key), JSON.stringify(entry));
    return entry;
  } catch {
    return null;
  }
};

export const clearScopedCacheByPrefix = (prefix: string): void => {
  if (!canUseLocalStorage()) {
    return;
  }

  const storageKeyPrefix = getStorageKey(prefix);
  const keysToRemove: string[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(storageKeyPrefix)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => {
    window.localStorage.removeItem(key);
  });
};
