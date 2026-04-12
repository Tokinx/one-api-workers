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
import { Menu, Zap } from 'lucide-react'

interface AppLayoutProps {
  children: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate()
  const [adminToken, setAdminToken] = useState('')
  const [authError, setAuthError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const { login, showAuthModal, closeAuthModal, isAuthenticated, isLoading: isAuthLoading } = useAuthStore()
  const { addToast } = useToast()

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setIsLoading(true)

    try {
      await login(adminToken)
      setAdminToken('')
      setIsMobileNavOpen(false)
      addToast('登录成功', 'success')
      navigate('/dashboard', { replace: true })
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '管理员令牌无效')
    } finally {
      setIsLoading(false)
    }
  }

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
      <Dialog open={showAuthModal} onOpenChange={(open) => !open && closeAuthModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>管理员身份验证</DialogTitle>
            <DialogDescription>
              请输入管理员令牌以访问管理功能
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAuthSubmit}>
            <div className="space-y-4">
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
                onClick={closeAuthModal}
                className='mr-0'
              >
                取消
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? '验证中...' : '登录'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
