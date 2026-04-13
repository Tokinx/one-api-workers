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

interface AppLayoutProps {
  children: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
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
    addToast('登录成功', 'success')
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
          addToast('验证码已发送到 Telegram', 'success')
          return
        }

        finalizeLogin()
        return
      }

      if (!challengeId) {
        throw new Error('验证码会话不存在，请重新获取')
      }

      await verifyLogin(challengeId, verificationCode)
      finalizeLogin()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '管理员令牌无效')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResendVerificationCode = async () => {
    if (!adminToken.trim()) {
      setAuthError('请先重新输入管理员令牌')
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
      addToast('验证码已重新发送到 Telegram', 'success')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '验证码发送失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  const challengeExpiresText = (() => {
    const date = challengeExpiresAt ? parseUtcTimestamp(challengeExpiresAt) : null
    return date
      ? date.toLocaleString('zh-CN', { hour12: false })
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
              aria-label="打开侧边栏"
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
            <DialogTitle>管理员身份验证</DialogTitle>
            <DialogDescription>
              {authStep === 'token'
                ? '请输入管理员令牌以访问管理功能'
                : '验证码已发送到 Telegram，请输入 6 位数字验证码完成登录'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAuthSubmit}>
            <div className="space-y-4">
              {authStep === 'token' ? (
                <div className="space-y-2">
                  <Label className="block" htmlFor="adminToken">管理员令牌</Label>
                  <Input
                    id="adminToken"
                    type="password"
                    placeholder="请输入管理员令牌"
                    value={adminToken}
                    onChange={(e) => setAdminToken(e.target.value)}
                    required
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="block" htmlFor="verificationCode">Telegram 验证码</Label>
                  <Input
                    id="verificationCode"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="请输入 6 位验证码"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                  />
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{challengeExpiresText ? `验证码有效期至 ${challengeExpiresText}` : '验证码 5 分钟内有效'}</span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-foreground hover:text-muted-foreground"
                      onClick={handleResendVerificationCode}
                      disabled={isSubmitting}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      重新发送
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
                {authStep === 'verification' ? '返回上一步' : '取消'}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? authStep === 'verification'
                    ? '验证中...'
                    : '发送中...'
                  : authStep === 'verification'
                    ? '验证并登录'
                    : '登录'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
