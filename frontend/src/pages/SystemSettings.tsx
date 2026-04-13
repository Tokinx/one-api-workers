import { useEffect, useMemo, useRef, useState } from "react";
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
import { PageContainer } from "@/components/ui/page-container";
import {
  DEFAULT_SYSTEM_CONFIG,
  PRECISION_OPTIONS,
  clearTelegramSecurityVerification,
  isTelegramSecurityVerified,
  normalizeSystemConfig,
} from "@/lib/system-config";
import type { SystemConfig } from "@/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const AUTO_SAVE_DELAY_MS = 800;

type SaveSource = "auto" | "manual";
type SaveState = "idle" | "saving" | "saved" | "error";

const buildAbsoluteUrl = (pathname: string): string => {
  if (typeof window === "undefined") {
    return pathname;
  }

  const baseUrl = API_BASE_URL ? new URL(API_BASE_URL, window.location.origin) : new URL(window.location.origin);
  return new URL(pathname, baseUrl).toString();
};

const buildSystemConfigSignature = (config: SystemConfig): string => {
  return JSON.stringify(normalizeSystemConfig(config));
};

const formatSaveTime = (value: Date | null): string => {
  if (!value) {
    return "--:--:--";
  }

  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  const seconds = String(value.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

export function SystemSettings() {
  const [systemConfig, setSystemConfig] = useState(DEFAULT_SYSTEM_CONFIG);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const systemConfigQuery = useSystemConfig();
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasHydratedRef = useRef(false);
  const lastSavedSignatureRef = useRef(buildSystemConfigSignature(DEFAULT_SYSTEM_CONFIG));
  const currentSignatureRef = useRef(buildSystemConfigSignature(DEFAULT_SYSTEM_CONFIG));

  const normalizedSystemConfig = useMemo(() => normalizeSystemConfig(systemConfig), [systemConfig]);
  const currentSignature = useMemo(() => buildSystemConfigSignature(normalizedSystemConfig), [normalizedSystemConfig]);

  useEffect(() => {
    currentSignatureRef.current = currentSignature;
  }, [currentSignature]);

  useEffect(() => {
    if (!systemConfigQuery.isFetched || !systemConfigQuery.data) {
      return;
    }

    const normalized = normalizeSystemConfig(systemConfigQuery.data);
    lastSavedSignatureRef.current = buildSystemConfigSignature(normalized);
    hasHydratedRef.current = true;
    setSaveState("idle");
    setLastSavedAt(new Date());
    setSystemConfig(normalized);
  }, [systemConfigQuery.data, systemConfigQuery.isFetched]);

  const saveSystemConfigMutation = useMutation({
    mutationFn: async ({ config }: { config: SystemConfig; source: SaveSource; signature: string }) =>
      apiClient.saveSystemConfig(config),
    onMutate: ({ source }) => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }

      if (source === "auto") {
        setSaveState("saving");
      }
    },
    onSuccess: (response, variables) => {
      const savedConfig = normalizeSystemConfig((response.data as SystemConfig | undefined) ?? variables.config);
      const savedSignature = buildSystemConfigSignature(savedConfig);

      lastSavedSignatureRef.current = savedSignature;
      queryClient.setQueryData(SYSTEM_CONFIG_QUERY_KEY, savedConfig);
      queryClient.setQueryData(BILLING_CONFIG_QUERY_KEY, {
        displayDecimals: savedConfig.displayDecimals,
      });

      if (variables.signature === currentSignatureRef.current) {
        setSystemConfig(savedConfig);
      }

      setSaveState("saved");
      setLastSavedAt(new Date());

      if (variables.source === "manual") {
        addToast("系统设置已保存", "success");
      }
    },
    onError: (error: Error, variables) => {
      setSaveState("error");
      if (variables.source === "manual") {
        addToast(`保存失败：${error.message}`, "error");
      }
    },
  });

  const telegramTestMutation = useMutation({
    mutationFn: async () =>
      apiClient.sendTelegramTestMessage({
        telegramBotToken: normalizedSystemConfig.adminSecurity.telegramBotToken,
        telegramChatId: normalizedSystemConfig.adminSecurity.telegramChatId,
      }),
    onSuccess: (response) => {
      const verification = response.data;
      setSystemConfig((current) => ({
        ...current,
        adminSecurity: {
          ...current.adminSecurity,
          verifiedFingerprint: verification?.verifiedFingerprint || "",
          verifiedAt: verification?.verifiedAt || null,
        },
      }));
      addToast("测试消息已发送，请到 Telegram 查收", "success");
    },
    onError: (error: Error) => {
      addToast(`测试失败：${error.message}`, "error");
    },
  });

  useEffect(() => {
    if (!hasHydratedRef.current) {
      return;
    }

    if (saveSystemConfigMutation.isPending) {
      return;
    }

    if (currentSignature === lastSavedSignatureRef.current) {
      if (saveState === "saving") {
        setSaveState("saved");
      }
      return;
    }

    autoSaveTimerRef.current = setTimeout(() => {
      saveSystemConfigMutation.mutate({
        config: normalizedSystemConfig,
        source: "auto",
        signature: currentSignature,
      });
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [currentSignature, normalizedSystemConfig, saveState, saveSystemConfigMutation]);

  const docsLinks = useMemo(
    () => [
      { label: "Swagger UI", href: buildAbsoluteUrl("/api/docs") },
      { label: "ReDoc", href: buildAbsoluteUrl("/api/redocs") },
      { label: "OpenAPI JSON", href: buildAbsoluteUrl("/api/openapi.json") },
    ],
    [],
  );

  const currentPrecisionOption = PRECISION_OPTIONS.find(
    (option) => option.value === normalizedSystemConfig.displayDecimals,
  );
  const telegramConfigComplete =
    normalizedSystemConfig.adminSecurity.telegramBotToken.trim().length > 0 &&
    normalizedSystemConfig.adminSecurity.telegramChatId.trim().length > 0;
  const telegramSecurityVerified = isTelegramSecurityVerified(normalizedSystemConfig.adminSecurity);

  const saveHint = (() => {
    switch (saveState) {
      case "saving":
        return "自动保存中...";
      case "error":
        return "自动保存失败";
      default:
        return `保存于 ${formatSaveTime(lastSavedAt)}`;
    }
  })();

  const updateTelegramField = (field: "telegramBotToken" | "telegramChatId", value: string) => {
    setSystemConfig((current) => {
      const previousValue = current.adminSecurity[field];
      if (previousValue === value) {
        return current;
      }

      return {
        ...current,
        adminSecurity: clearTelegramSecurityVerification({
          ...current.adminSecurity,
          [field]: value,
        }),
      };
    });
  };

  const handleManualSave = () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    saveSystemConfigMutation.mutate({
      config: normalizedSystemConfig,
      source: "manual",
      signature: currentSignature,
    });
  };

  return (
    <PageContainer
      title="系统设置"
      description="统一管理全局系统设置"
      actions={
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{saveHint}</span>
          <Button
            size="sm"
            onClick={handleManualSave}
            disabled={saveSystemConfigMutation.isPending || systemConfigQuery.isLoading}
          >
            <Check className="mr-1 h-4 w-4" />
            保存
          </Button>
        </div>
      }
    >
      <Card className="space-y-6 border-0 p-6">
        <section className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-muted-foreground/10 p-2 text-muted-foreground">
              <Shield className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold tracking-tight">安全设置</h3>

                  {!telegramSecurityVerified && telegramConfigComplete ? (
                    <p className="text-sm text-amber-600 dark:text-amber-300">
                      当前 Telegram 配置尚未验证，安全开关保持关闭。
                    </p>
                  ) : (
                    <p className="text-sm text-green-600 dark:text-green-300">Telegram 配置已验证，安全开关已开启。</p>
                  )}
                </div>
                <Switch
                  checked={normalizedSystemConfig.adminSecurity.enabled}
                  disabled={!telegramConfigComplete || !telegramSecurityVerified}
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
                value={normalizedSystemConfig.adminSecurity.telegramBotToken}
                onChange={(event) => updateTelegramField("telegramBotToken", event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="telegramChatId">
                Chat ID
              </label>
              <Input
                id="telegramChatId"
                placeholder="-1001234567890"
                value={normalizedSystemConfig.adminSecurity.telegramChatId}
                onChange={(event) => updateTelegramField("telegramChatId", event.target.value)}
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
                    ? "请先填写完整的 Bot Token 和 Chat ID。"
                    : telegramSecurityVerified
                      ? `最近一次验证通过时间：${normalizedSystemConfig.adminSecurity.verifiedAt || "--"}`
                      : "测试通过后，安全开关才会解锁。"}
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
            <div className="mt-0.5 rounded-lg bg-muted-foreground/10 p-2 text-muted-foreground">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold tracking-tight">显示精度设置</h3>
              <p className="text-sm text-muted-foreground">
                页面显示金额保留 {normalizedSystemConfig.displayDecimals} 位小数，示例：$
                {(0).toFixed(normalizedSystemConfig.displayDecimals)}
                {currentPrecisionOption ? `（当前：${currentPrecisionOption.label}）` : ""}
              </p>
            </div>
          </div>
          <div className="flex-1" />
          <div className="inline-flex flex-wrap rounded-md border">
            {PRECISION_OPTIONS.map((option) => {
              const isActive = normalizedSystemConfig.displayDecimals === option.value;
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
            <div className="mt-0.5 rounded-lg bg-muted-foreground/10 p-2 text-muted-foreground">
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
                  checked={normalizedSystemConfig.apiDocs.enabled}
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

          {normalizedSystemConfig.apiDocs.enabled ? (
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
          ) : null}
        </section>
      </Card>
    </PageContainer>
  );
}
