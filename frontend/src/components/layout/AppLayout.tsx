import { ReactNode, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/store/auth'
import { useToast } from '@/components/ui/use-toast'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Menu, RotateCcw, Zap } from 'lucide-react'
import { parseUtcTimestamp } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { getLocaleString } from '@/i18n'

interface AppLayoutProps {
  children: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [adminToken, setAdminToken] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [challengeExpiresAt, setChallengeExpiresAt] = useState<string | null>(null)
  const [authError, setAuthError] = useState('')
  const [authStep, setAuthStep] = useState<'token' | 'verification'>('token')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const {
    startLogin,
    verifyLogin,
    showAuthModal,
    closeAuthModal,
    isAuthenticated,
    isLoading: isAuthLoading,
  } = useAuthStore()
  const { addToast } = useToast()

  const resetAuthDialog = () => {
    setAdminToken('')
    setVerificationCode('')
    setChallengeId(null)
    setChallengeExpiresAt(null)
    setAuthError('')
    setAuthStep('token')
    setIsSubmitting(false)
  }

  const handleCloseAuthModal = () => {
    resetAuthDialog()
    closeAuthModal()
  }

  const finalizeLogin = () => {
    resetAuthDialog()
    setIsMobileNavOpen(false)
    addToast(t('auth.loginSuccess'), 'success')
    navigate('/dashboard', { replace: true })
  }

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setIsSubmitting(true)

    try {
      if (authStep === 'token') {
        const loginResult = await startLogin(adminToken)

        if (loginResult.requiresVerification) {
          setAuthStep('verification')
          setChallengeId(loginResult.challengeId)
          setChallengeExpiresAt(loginResult.challengeExpiresAt)
          setVerificationCode('')
          addToast(t('auth.verificationSent'), 'success')
          return
        }

        finalizeLogin()
        return
      }

      if (!challengeId) {
        throw new Error(t('auth.sessionMissing'))
      }

      await verifyLogin(challengeId, verificationCode)
      finalizeLogin()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : t('auth.loginFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResendVerificationCode = async () => {
    if (!adminToken.trim()) {
      setAuthError(t('auth.reenterToken'))
      setAuthStep('token')
      return
    }

    setAuthError('')
    setIsSubmitting(true)

    try {
      const loginResult = await startLogin(adminToken)
      if (!loginResult.requiresVerification) {
        finalizeLogin()
        return
      }

      setAuthStep('verification')
      setChallengeId(loginResult.challengeId)
      setChallengeExpiresAt(loginResult.challengeExpiresAt)
      setVerificationCode('')
      addToast(t('auth.verificationResent'), 'success')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : t('auth.loginFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const challengeExpiresText = (() => {
    const date = challengeExpiresAt ? parseUtcTimestamp(challengeExpiresAt) : null
    return date
      ? date.toLocaleString(getLocaleString(), { hour12: false })
      : ''
  })()

  return (
    <div className="flex">
      {isAuthenticated && !isAuthLoading && (
        <Sidebar
          className="hidden lg:flex sticky top-0 h-screen overflow-hidden"
          collapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
          showCollapseToggle
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {isAuthenticated && !isAuthLoading && (
          <header className="flex items-center justify-between border-b bg-card/80 backdrop-blur-sm px-4 py-2.5 lg:hidden sticky top-0 z-30">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setIsMobileNavOpen(true)}
              aria-label={t('sidebar.openSidebar')}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
                <Zap className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="font-semibold text-sm tracking-tight">One API on Workers</span>
            </div>
            <div className="h-9 w-9" />
          </header>
        )}

        <main className="flex-1 bg-background gradient-mesh grid-pattern">
          <div className="mx-auto max-w-7xl w-full">
            {children}
          </div>
        </main>
      </div>

      {isAuthenticated && !isAuthLoading && isMobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsMobileNavOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 shadow-2xl">
            <Sidebar
              onNavigate={() => setIsMobileNavOpen(false)}
              onClose={() => setIsMobileNavOpen(false)}
              collapsed={false}
              showCollapseToggle={false}
            />
          </div>
        </div>
      )}

      {/* Auth Dialog */}
      <Dialog open={showAuthModal} onOpenChange={(open) => !open && handleCloseAuthModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('auth.title')}</DialogTitle>
            <DialogDescription>
              {authStep === 'token'
                ? t('auth.descToken')
                : t('auth.descVerification')}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAuthSubmit}>
            <div className="space-y-4">
              {authStep === 'token' ? (
                <div className="space-y-2">
                  <Label className="block" htmlFor="adminToken">{t('auth.tokenLabel')}</Label>
                  <Input
                    id="adminToken"
                    type="password"
                    placeholder={t('auth.tokenPlaceholder')}
                    value={adminToken}
                    onChange={(e) => setAdminToken(e.target.value)}
                    required
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="block" htmlFor="verificationCode">{t('auth.verificationLabel')}</Label>
                  <Input
                    id="verificationCode"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder={t('auth.verificationPlaceholder')}
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                  />
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{challengeExpiresText ? t('auth.verificationExpiry', { time: challengeExpiresText }) : t('auth.verificationDefault')}</span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-foreground hover:text-muted-foreground"
                      onClick={handleResendVerificationCode}
                      disabled={isSubmitting}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t('auth.resend')}
                    </button>
                  </div>
                </div>
              )}

              {authError && (
                <Alert variant="destructive">
                  <AlertDescription>{authError}</AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter className="mt-6 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={authStep === 'verification'
                  ? () => {
                    setAuthStep('token')
                    setVerificationCode('')
                    setChallengeId(null)
                    setChallengeExpiresAt(null)
                    setAuthError('')
                  }
                  : handleCloseAuthModal}
                className='mr-0'
              >
                {authStep === 'verification' ? t('auth.backToPrevious') : t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? authStep === 'verification'
                    ? t('auth.verifying')
                    : t('auth.sending')
                  : authStep === 'verification'
                    ? t('auth.verifyAndLogin')
                    : t('auth.login')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
