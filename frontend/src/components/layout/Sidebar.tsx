import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Link as LinkIcon,
  Key,
  DollarSign,
  BarChart3,
  FileText,
  TestTube2,
  GitBranch,
  Moon,
  Sun,
  LogOut,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Zap,
} from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useState } from "react";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { title: "总览看板", href: "/dashboard", icon: BarChart3 },
  { title: "使用日志", href: "/usage-logs", icon: FileText },
  { title: "渠道管理", href: "/channels", icon: LinkIcon },
  { title: "令牌管理", href: "/tokens", icon: Key },
  { title: "定价管理", href: "/pricing", icon: DollarSign },
  { title: "API 测试", href: "/api-test", icon: TestTube2 },
];

interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  showCollapseToggle?: boolean;
}

export function Sidebar({
  className,
  onNavigate,
  onClose,
  collapsed = false,
  onToggleCollapse,
  showCollapseToggle = false,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("theme");
      const isDark = savedTheme === "dark" || (!savedTheme && document.documentElement.classList.contains("dark"));
      if (isDark) {
        document.documentElement.classList.add("dark");
      }
      return isDark ? "dark" : "light";
    }
    return "light";
  });

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/", { replace: true });
    onNavigate?.();
  };

  const NavLink = ({ item }: { item: NavItem }) => {
    const isActive = location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);
    return (
      <Link
        to={item.href}
        onClick={() => onNavigate?.()}
        title={collapsed ? item.title : undefined}
        className={cn(
          "group relative flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150",
          collapsed && "justify-center px-0 w-10 h-10 mx-auto",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/80",
        )}
      >
        <item.icon
          className={cn(
            "h-[17px] w-[17px] flex-shrink-0",
            !isActive && "group-hover:scale-105 transition-transform duration-150",
          )}
        />
        {!collapsed && <span>{item.title}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        "bg-card border-r flex flex-col h-full transition-all duration-300 ease-out",
        collapsed ? "w-[68px]" : "w-60",
        className,
      )}
    >
      {/* Header */}
      <div
        className={cn("h-14 flex items-center border-b px-2", collapsed ? "justify-center px-0" : "justify-between")}
      >
        {collapsed ? (
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
            <Zap className="h-4 w-4 text-white" />
          </div>
        ) : (
          <>
            <div className="w-full flex items-center justify-center gap-2.5">
                <span className="font-semibold text-[14px] tracking-tight leading-tight">One API on Workers</span>
            </div>
            {onClose && (
              <button
                type="button"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors lg:hidden"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2.5 py-3 overflow-y-auto scrollbar-thin">
        <div className="space-y-1">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div className={cn("p-2.5 border-t", collapsed && "p-2")}>
        {/* Action Buttons */}
        <div className={cn("flex gap-1 mb-2", collapsed ? "flex-col items-center" : "")}>
          <button
            type="button"
            title={collapsed ? (theme === "dark" ? "浅色模式" : "深色模式") : undefined}
            className={cn(
              "flex items-center justify-center rounded-md transition-colors duration-150",
              collapsed
                ? "w-10 h-9 hover:bg-muted text-muted-foreground hover:text-foreground"
                : "flex-1 h-8 gap-1.5 px-2.5 hover:bg-muted/70 text-muted-foreground hover:text-foreground text-[11px] font-medium",
            )}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {!collapsed && <span>{theme === "dark" ? "浅色" : "深色"}</span>}
          </button>

          <a
            href="https://github.com/Tokinx/one-api-workers"
            target="_blank"
            rel="noopener noreferrer"
            title={collapsed ? "GitHub" : undefined}
            className={cn(
              "flex items-center justify-center rounded-md transition-colors duration-150",
              collapsed
                ? "w-10 h-9 hover:bg-muted text-muted-foreground hover:text-foreground"
                : "flex-1 h-8 gap-1.5 px-2.5 hover:bg-muted/70 text-muted-foreground hover:text-foreground text-[11px] font-medium",
            )}
          >
            <GitBranch className="h-3.5 w-3.5" />
            {!collapsed && <span>GitHub</span>}
          </a>

          {/* Collapse Toggle */}
          {showCollapseToggle && (
            <div className={cn("hidden lg:flex", collapsed && "px-0 justify-center")}>
              <button
                type="button"
                onClick={onToggleCollapse}
                className={cn(
                  "flex items-center justify-center rounded-md transition-colors duration-150",
                  collapsed ? "w-10 h-9 hover:bg-muted text-muted-foreground hover:text-foreground" : "flex-1 h-8 gap-1.5 px-2.5 hover:bg-muted/70 text-muted-foreground hover:text-foreground text-[11px] font-medium",
                )}
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-3.5 w-3.5" />
                ) : (
                  <>
                    <PanelLeftClose className="h-3.5 w-3.5" />
                    <span>收起</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Logout Button */}
        <button
          type="button"
          title={collapsed ? "退出登录" : undefined}
          className={cn(
            "flex items-center justify-center gap-2 w-full rounded-lg text-[13px] font-medium transition-all duration-150",
            collapsed ? "h-9" : "h-9 px-3",
            "bg-destructive/8 text-destructive hover:bg-destructive/15",
          )}
          onClick={handleLogout}
        >
          <LogOut className="h-3.5 w-3.5" />
          {!collapsed && <span>退出登录</span>}
        </button>
      </div>
    </aside>
  );
}
