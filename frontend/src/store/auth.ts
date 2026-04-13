import { create } from 'zustand'
import { apiClient } from '@/api/client'
import { clearScopedCacheByPrefix } from '@/lib/local-cache'
import { type AdminLoginResponse } from '@/types'
import {
  clearAdminCredentials,
  getStoredAdminCredential,
  storeAdminSessionToken,
} from '@/lib/admin-auth'

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  showAuthModal: boolean
  startLogin: (token: string) => Promise<AdminLoginResponse>
  verifyLogin: (challengeId: string, code: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  openAuthModal: () => void
  closeAuthModal: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isLoading: true,
  error: null,
  showAuthModal: false,

  startLogin: async (token: string) => {
    set({ isLoading: true, error: null })

    try {
      const response = await apiClient.startAdminLogin(token)
      const loginResult = response.data as AdminLoginResponse

      if (!loginResult) {
        throw new Error('登录响应无效')
      }

      if (loginResult.sessionToken) {
        storeAdminSessionToken(loginResult.sessionToken)
        set({ isAuthenticated: true, isLoading: false, showAuthModal: false })
        return loginResult
      }

      if (!loginResult.requiresVerification || !loginResult.challengeId) {
        throw new Error('登录响应缺少验证码挑战信息')
      }

      set({ isAuthenticated: false, isLoading: false })
      return loginResult
    } catch (error) {
      clearAdminCredentials()
      set({
        isAuthenticated: false,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      })
      throw error
    }
  },

  verifyLogin: async (challengeId: string, code: string) => {
    set({ isLoading: true, error: null })

    try {
      const response = await apiClient.verifyAdminLogin(challengeId, code)
      const loginResult = response.data as AdminLoginResponse

      if (!loginResult.sessionToken) {
        throw new Error('登录响应缺少会话令牌')
      }

      storeAdminSessionToken(loginResult.sessionToken)
      set({ isAuthenticated: true, isLoading: false, showAuthModal: false })
    } catch (error) {
      clearAdminCredentials()
      set({
        isAuthenticated: false,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      })
      throw error
    }
  },

  logout: async () => {
    try {
      await apiClient.logoutAdmin()
    } catch {
      // ignore logout errors and clear local state anyway
    }

    clearScopedCacheByPrefix('analytics:')
    clearScopedCacheByPrefix('usage-logs:')
    clearAdminCredentials()
    set({ isAuthenticated: false, error: null })
  },

  checkAuth: async () => {
    if (!getStoredAdminCredential()) {
      set({ isAuthenticated: false, isLoading: false })
      return
    }

    set({ isLoading: true })
    try {
      await apiClient.checkAuth()
      set({ isAuthenticated: true, isLoading: false })
    } catch (error) {
      clearAdminCredentials()
      set({ isAuthenticated: false, isLoading: false })
    }
  },

  openAuthModal: () => set({ showAuthModal: true }),
  closeAuthModal: () => set({ showAuthModal: false }),
}))
