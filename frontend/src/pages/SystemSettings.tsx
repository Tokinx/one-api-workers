import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, FileText, Globe, Shield, SlidersHorizontal } from "lucide-react";

import { apiClient } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { BILLING_CONFIG_QUERY_KEY } from "@/hooks/use-billing-config";
import { SYSTEM_CONFIG_QUERY_KEY, useSystemConfig } from "@/hooks/use-system-config";
import { DEFAULT_SYSTEM_CONFIG, normalizeSystemConfig, PRECISION_OPTIONS } from "@/lib/system-config";
import { PageContainer } from "@/components/ui/page-container";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

const buildAbsoluteUrl = (pathname: string): string => {
  if (typeof window === "undefined") {
    return pathname;
  }

  const baseUrl = API_BASE_URL ? new URL(API_BASE_URL, window.location.origin) : new URL(window.location.origin);

  return new URL(pathname, baseUrl).toString();
};

export function SystemSettings() {
  const [systemConfig, setSystemConfig] = useState(DEFAULT_SYSTEM_CONFIG);

  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const systemConfigQuery = useSystemConfig();

  useEffect(() => {
    if (systemConfigQuery.data) {
      setSystemConfig(normalizeSystemConfig(systemConfigQuery.data));
    }
  }, [systemConfigQuery.data]);

  const saveSystemConfigMutation = useMutation({
    mutationFn: async () => apiClient.saveSystemConfig(normalizeSystemConfig(systemConfig)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_CONFIG_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: BILLING_CONFIG_QUERY_KEY });
      addToast("系统设置已保存", "success");
    },
    onError: (error: Error) => {
      addToast(`保存失败：${error.message}`, "error");
    },
  });

  const telegramTestMutation = useMutation({
    mutationFn: async () =>
      apiClient.sendTelegramTestMessage({
        telegramBotToken: systemConfig.adminSecurity.telegramBotToken,
        telegramChatId: systemConfig.adminSecurity.telegramChatId,
      }),
    onSuccess: () => {
      addToast("测试消息已发送，请到 Telegram 查收", "success");
    },
    onError: (error: Error) => {
      addToast(`测试失败：${error.message}`, "error");
    },
  });

  const docsLinks = useMemo(
    () => [
      { label: "Swagger UI", href: buildAbsoluteUrl("/api/docs") },
      { label: "ReDoc", href: buildAbsoluteUrl("/api/redocs") },
      { label: "OpenAPI JSON", href: buildAbsoluteUrl("/api/openapi.json") },
    ],
    [],
  );

  const currentPrecisionOption = PRECISION_OPTIONS.find((option) => option.value === systemConfig.displayDecimals);
  const telegramConfigComplete =
    systemConfig.adminSecurity.telegramBotToken.trim().length > 0 &&
    systemConfig.adminSecurity.telegramChatId.trim().length > 0;
  const securityEnabled = systemConfig.adminSecurity.enabled && telegramConfigComplete;

  return (
    <PageContainer
      title="系统设置"
      description="统一管理全局系统设置。"
      actions={
        <Button
          size="sm"
          onClick={() => saveSystemConfigMutation.mutate()}
          disabled={saveSystemConfigMutation.isPending || systemConfigQuery.isLoading}
        >
          <Check className="mr-1 h-4 w-4" />
          保存
        </Button>
      }
    >
      <Card className="space-y-6 border-0 p-6">
        <section className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
              <Shield className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold tracking-tight">安全设置</h3>
                  <p className="text-sm text-muted-foreground">
                    绑定 Telegram 后自动开启登录验证和通知功能。
                  </p>
                </div>
                <Switch
                  checked={systemConfig.adminSecurity.enabled}
                  onCheckedChange={(checked) =>
                    setSystemConfig((current) => ({
                      ...current,
                      adminSecurity: {
                        ...current.adminSecurity,
                        enabled: checked,
                      },
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="telegramBotToken">
                Bot Token
              </label>
              <Input
                id="telegramBotToken"
                type="password"
                placeholder="123456789:AA..."
                value={systemConfig.adminSecurity.telegramBotToken}
                onChange={(event) =>
                  setSystemConfig((current) => ({
                    ...current,
                    adminSecurity: {
                      ...current.adminSecurity,
                      telegramBotToken: event.target.value,
                    },
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="telegramChatId">
                Chat ID
              </label>
              <Input
                id="telegramChatId"
                placeholder="-1001234567890"
                value={systemConfig.adminSecurity.telegramChatId}
                onChange={(event) =>
                  setSystemConfig((current) => ({
                    ...current,
                    adminSecurity: {
                      ...current.adminSecurity,
                      telegramChatId: event.target.value,
                    },
                  }))
                }
              />
            </div>
          </div>

          <div className="rounded-md border bg-muted/50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Bot className="h-4 w-4" />
                  发送测试消息
                </div>
                <p className="text-sm text-muted-foreground">
                  {!telegramConfigComplete
                    ? "请确保 Telegram Bot Token 和 Chat ID 已正确填写，测试通过后将启用登录验证和通知功能。"
                    : securityEnabled
                      ? "当前已开启 Telegram 登录验证，管理员必须输入验证码才能登录。"
                      : "Telegram 已配置但尚未启用。可以先发送测试消息确认，再决定是否开启登录验证。"}
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => telegramTestMutation.mutate()}
                disabled={telegramTestMutation.isPending || !telegramConfigComplete}
              >
                {telegramTestMutation.isPending ? "发送中..." : "发送测试消息"}
              </Button>
            </div>
          </div>
        </section>

        <div className="h-px bg-border" />

        <section className="flex items-center gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold tracking-tight">显示精度设置</h3>
              <p className="text-sm text-muted-foreground">
                页面显示金额保留 {systemConfig.displayDecimals} 位小数， 示例：$
                {(0).toFixed(systemConfig.displayDecimals)}
                {currentPrecisionOption ? `（当前：${currentPrecisionOption.label}）` : ""}
              </p>
            </div>
          </div>
          <div className="flex-1" />
          <div className="inline-flex flex-wrap border rounded-md">
            {PRECISION_OPTIONS.map((option) => {
              const isActive = systemConfig.displayDecimals === option.value;
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant={isActive ? "default" : "outline"}
                  onClick={() =>
                    setSystemConfig((current) => ({
                      ...current,
                      displayDecimals: option.value,
                    }))
                  }
                  className="h-8 border-0"
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </section>

        <div className="h-px bg-border" />

        <section className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold tracking-tight">开启接口文档</h3>
                  <p className="text-sm text-muted-foreground">
                    开启后自动暴露 Swagger、ReDoc 与 OpenAPI JSON；关闭后对应路由会直接返回 404。
                  </p>
                </div>
                <Switch
                  checked={systemConfig.apiDocs.enabled}
                  onCheckedChange={(checked) =>
                    setSystemConfig((current) => ({
                      ...current,
                      apiDocs: {
                        ...current.apiDocs,
                        enabled: checked,
                      },
                    }))
                  }
                />
              </div>
            </div>
          </div>

          {systemConfig.apiDocs.enabled ? (
            <div className="grid gap-3 lg:grid-cols-3">
              {docsLinks.map((item) => (
                <div
                  key={item.href}
                  className="flex flex-col gap-3 rounded-md border px-4 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{item.href}</div>
                  </div>
                  <Button asChild variant="outline" className="h-8 px-3">
                    <a href={item.href} target="_blank" rel="noreferrer">
                      打开
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            ""
          )}
        </section>
      </Card>
    </PageContainer>
  );
}
