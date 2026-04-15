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
  Languages,
  Moon,
  Sun,
  LogOut,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { changeLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/i18n";

type NavGroup = "overview" | "management" | "tools" | "system";

interface NavItem {
  titleKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: NavGroup;
}

const navItemDefs: NavItem[] = [
  { titleKey: "sidebar.dashboard", href: "/dashboard", icon: BarChart3, group: "overview" },
  { titleKey: "sidebar.channels", href: "/channels", icon: LinkIcon, group: "management" },
  { titleKey: "sidebar.tokens", href: "/tokens", icon: Key, group: "management" },
  { titleKey: "sidebar.pricing", href: "/pricing", icon: DollarSign, group: "management" },
  { titleKey: "sidebar.usageLogs", href: "/usage-logs", icon: FileText, group: "tools" },
  { titleKey: "sidebar.apiTest", href: "/api-test", icon: TestTube2, group: "tools" },
  { titleKey: "sidebar.settings", href: "/settings", icon: SlidersHorizontal, group: "system" },
];

const groupOrder: NavGroup[] = ["overview", "management", "tools", "system"];

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
  const { t, i18n } = useTranslation();
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

  const langLabels: Record<SupportedLanguage, string> = {
    "zh-CN": t("language.zhCN"),
    "zh-TW": t("language.zhTW"),
    "en": t("language.en"),
  };

  const cycleLang = () => {
    const currentIndex = SUPPORTED_LANGUAGES.indexOf(i18n.language as SupportedLanguage);
    const nextIndex = (currentIndex + 1) % SUPPORTED_LANGUAGES.length;
    changeLanguage(SUPPORTED_LANGUAGES[nextIndex]);
  };

  const currentLangLabel = langLabels[i18n.language as SupportedLanguage] || langLabels["zh-CN"];

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
    onNavigate?.();
  };

  const NavLink = ({ item }: { item: NavItem }) => {
    const isActive = location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);
    const title = t(item.titleKey);
    return (
      <Link
        to={item.href}
        onClick={() => onNavigate?.()}
        title={collapsed ? title : undefined}
        className={cn(
          "group relative flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-all duration-150",
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
        {!collapsed && <span>{title}</span>}
      </Link>
    );
  };

  const groupedNavItems = (() => {
    const groups: Record<NavGroup, NavItem[]> = {
      overview: [],
      management: [],
      tools: [],
      system: [],
    };
    navItemDefs.forEach((item) => {
      groups[item.group].push(item);
    });
    return groups;
  })();

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
        {groupOrder.map((group) => (
          <div key={group} className={cn("space-y-1", group !== groupOrder[0] && "mt-3 pt-3 border-t border-border/30")}>
            {groupedNavItems[group].map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className={cn("p-2.5 border-t", collapsed && "p-2")}>
        {/* Action Buttons */}
        <div className={cn("flex gap-1 mb-2", collapsed ? "flex-col items-center" : "")}>
          <button
            type="button"
            title={collapsed ? (theme === "dark" ? t('sidebar.lightMode') : t('sidebar.darkMode')) : undefined}
            className={cn(
              "flex items-center justify-center rounded-md transition-colors duration-150",
              collapsed
                ? "w-10 h-9 hover:bg-muted text-muted-foreground hover:text-foreground"
                : "flex-1 h-8 gap-1.5 px-2.5 hover:bg-muted/70 text-muted-foreground hover:text-foreground text-[11px] font-medium",
            )}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {!collapsed && <span>{theme === "dark" ? t('sidebar.lightMode') : t('sidebar.darkMode')}</span>}
          </button>

          <button
            type="button"
            title={collapsed ? currentLangLabel : undefined}
            className={cn(
              "flex items-center justify-center rounded-md transition-colors duration-150",
              collapsed
                ? "w-10 h-9 hover:bg-muted text-muted-foreground hover:text-foreground"
                : "flex-1 h-8 gap-1.5 px-2.5 hover:bg-muted/70 text-muted-foreground hover:text-foreground text-[11px] font-medium",
            )}
            onClick={cycleLang}
          >
            <Languages className="h-3.5 w-3.5" />
            {!collapsed && <span>{currentLangLabel}</span>}
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
                  collapsed
                    ? "w-10 h-9 hover:bg-muted text-muted-foreground hover:text-foreground"
                    : "flex-1 h-8 gap-1.5 px-2.5 hover:bg-muted/70 text-muted-foreground hover:text-foreground text-[11px] font-medium",
                )}
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-3.5 w-3.5" />
                ) : (
                  <>
                    <PanelLeftClose className="h-3.5 w-3.5" />
                    <span>{t('sidebar.collapse')}</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Logout Button */}
        <button
          type="button"
          title={collapsed ? t('sidebar.logout') : undefined}
          className={cn(
            "flex items-center justify-center gap-2 w-full rounded-md text-[13px] font-medium transition-all duration-150",
            collapsed ? "h-9" : "h-9 px-3",
            "bg-destructive/8 text-destructive hover:bg-destructive/15",
          )}
          onClick={handleLogout}
        >
          <LogOut className="h-3.5 w-3.5" />
          {!collapsed && <span>{t('sidebar.logout')}</span>}
        </button>
      </div>
    </aside>
  );
}
