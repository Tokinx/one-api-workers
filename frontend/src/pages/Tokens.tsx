import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "@/api/client";
import { Token, TokenConfig, Channel } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useBillingConfig } from "@/hooks/use-billing-config";
import { DEFAULT_BILLING_DISPLAY_DECIMALS, rawBillingToUsd, usdToRawBilling } from "@/lib/billing";
import { formatCurrency, copyToClipboard, generateTokenKey, cn } from "@/lib/utils";
import {
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Copy,
  Sparkles,
  FileJson,
  FileText,
  Key,
  ArrowLeft,
  Check,
  MoreHorizontal,
  AlertCircle,
  Search,
  RotateCcw,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { PageContainer } from "@/components/ui/page-container";
import { useTranslation } from "react-i18next";

type EditMode = "form" | "json";
const UNLIMITED_TOKEN_QUOTA = -1;
const QUOTA_INPUT_PATTERN = /^-?\d*$/;

const formatQuotaInputValue = (value: number): string => {
  if (value === UNLIMITED_TOKEN_QUOTA) {
    return "-1";
  }

  return String(Math.max(0, Math.round(rawBillingToUsd(value))));
};

const parseQuotaInputValue = (value: string): number | null => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return 0;
  }

  if (trimmedValue === "-1") {
    return UNLIMITED_TOKEN_QUOTA;
  }

  const parsed = Number.parseInt(trimmedValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return usdToRawBilling(parsed);
};

const normalizeTokenQuota = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  if (Math.round(parsed) === UNLIMITED_TOKEN_QUOTA) {
    return UNLIMITED_TOKEN_QUOTA;
  }

  return Math.max(0, Math.round(parsed));
};

const isUnlimitedTokenQuota = (value: number): boolean => {
  return value === UNLIMITED_TOKEN_QUOTA;
};

const formatAvailableQuota = (value: number, unlimitedLabel: string): string => {
  if (isUnlimitedTokenQuota(value)) {
    return unlimitedLabel;
  }

  const usdValue = Math.max(0, Math.floor(rawBillingToUsd(value)));
  return `$${usdValue}`;
};

export function Tokens({ createMode = false, editRoute = false }: { createMode?: boolean; editRoute?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { key: routeKey } = useParams<{ key: string }>();
  const isRouteEdit = editRoute && Boolean(routeKey);
  const [view, setView] = useState<"list" | "form">(createMode || isRouteEdit ? "form" : "list");
  const [editMode, setEditMode] = useState<EditMode>("form");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formData, setFormData] = useState<TokenConfig>({
    name: "",
    channel_keys: [],
    total_quota: 0,
  });
  const [tokenKey, setTokenKey] = useState(() => (createMode ? generateTokenKey() : ""));
  const [jsonValue, setJsonValue] = useState("");
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [quotaInputValue, setQuotaInputValue] = useState(() => formatQuotaInputValue(0));

  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { data: billingConfig } = useBillingConfig();
  const displayDecimals = billingConfig?.displayDecimals ?? DEFAULT_BILLING_DISPLAY_DECIMALS;

  const tokenQuotaOptions = [
    { label: t('tokens.quotaUnlimited'), value: UNLIMITED_TOKEN_QUOTA },
    { label: "$10", value: usdToRawBilling(10) },
    { label: "$20", value: usdToRawBilling(20) },
    { label: "$50", value: usdToRawBilling(50) },
    { label: "$100", value: usdToRawBilling(100) },
  ] as const;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["tokens"],
    queryFn: async () => {
      const response = await apiClient.getTokens();
      return response.data as Token[];
    },
  });

  useEffect(() => {
    const loadChannels = async () => {
      try {
        const response = await apiClient.getChannels();
        const channels = response.data as Channel[];
        setAvailableChannels(channels.map((c) => c.key));
      } catch (error) {
        console.error("Failed to load channels:", error);
      }
    };
    loadChannels();
  }, []);

  const openTokenForEdit = useCallback((token: Token) => {
    setEditingKey(token.key);
    setTokenKey(token.key);
    const config = typeof token.value === "string" ? JSON.parse(token.value) : token.value;
    const normalizedConfig = {
      ...config,
      channel_keys: config.channel_keys || [],
      total_quota: normalizeTokenQuota(config.total_quota),
    };
    setFormData(normalizedConfig);
    setJsonValue(JSON.stringify(normalizedConfig, null, 2));
    setSelectedChannels(normalizedConfig.channel_keys);
    setQuotaInputValue(formatQuotaInputValue(normalizedConfig.total_quota));
    setView("form");
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClick = () => setOpenMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async ({ key, config }: { key: string; config: any }) => {
      return apiClient.saveToken(key, config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
      addToast(editingKey ? t('tokens.updateSuccess') : t('tokens.addSuccess'), "success");
      closeForm();
    },
    onError: (error: any) => {
      addToast(t('common.saveFailed', { message: error.message }), "error");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => {
      return apiClient.deleteToken(key);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
      addToast(t('tokens.deleteSuccess'), "success");
    },
    onError: (error: any) => {
      addToast(t('common.deleteFailed', { message: error.message }), "error");
    },
  });

  const resetUsageMutation = useMutation({
    mutationFn: async (key: string) => {
      return apiClient.resetTokenUsage(key);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
      addToast(t('tokens.resetSuccess'), "success");
    },
    onError: (error: any) => {
      addToast(t('tokens.resetFailed', { message: error.message }), "error");
    },
  });

  const resetForm = useCallback(() => {
    setFormData({ name: "", channel_keys: [], total_quota: 0 });
    setTokenKey("");
    setJsonValue("");
    setSelectedChannels([]);
    setEditingKey(null);
    setEditMode("form");
    setQuotaInputValue(formatQuotaInputValue(0));
  }, []);

  useEffect(() => {
    if (createMode) {
      resetForm();
      setTokenKey(generateTokenKey());
      setView("form");
      return;
    }

    if (isRouteEdit) {
      if (isLoading) {
        setView("form");
        return;
      }

      const targetToken = data?.find((token) => token.key === routeKey);
      if (!targetToken) {
        resetForm();
        setView("list");
        addToast(t('tokens.notFound'), "error");
        navigate("/tokens", { replace: true });
        return;
      }

      openTokenForEdit(targetToken);
      return;
    }

    resetForm();
    setView("list");
  }, [addToast, createMode, data, isLoading, isRouteEdit, navigate, openTokenForEdit, resetForm, routeKey, t]);

  const closeForm = () => {
    resetForm();
    setView("list");

    if (createMode || isRouteEdit) {
      navigate("/tokens", { replace: true });
    }
  };

  const handleAdd = () => {
    resetForm();
    navigate("/tokens/new");
  };

  const handleEdit = (token: Token) => {
    navigate(`/tokens/edit/${encodeURIComponent(token.key)}`);
  };

  const handleDelete = (key: string) => {
    if (confirm(t('tokens.deleteConfirm'))) {
      deleteMutation.mutate(key);
    }
  };

  const handleResetUsage = (key: string) => {
    if (confirm(t('tokens.resetConfirm'))) {
      resetUsageMutation.mutate(key);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await copyToClipboard(text);
      addToast(t('common.copiedToClipboard'), "success");
    } catch {
      addToast(t('common.copyFailed'), "error");
    }
  };

  const handleSave = () => {
    if (!tokenKey) {
      addToast(t('tokens.fillTokenKey'), "error");
      return;
    }

    let config: any;
    if (editMode === "form") {
      if (!formData.name) {
        addToast(t('tokens.fillTokenName'), "error");
        return;
      }
      config = {
        ...formData,
        channel_keys: selectedChannels,
        total_quota: normalizeTokenQuota(formData.total_quota),
      };
    } else {
      try {
        config = JSON.parse(jsonValue);
        config.total_quota = normalizeTokenQuota(config.total_quota);
      } catch {
        addToast(t('common.jsonFormatError'), "error");
        return;
      }
    }

    saveMutation.mutate({ key: tokenKey, config });
  };

  const toggleEditMode = () => {
    if (editMode === "form") {
      const config = {
        ...formData,
        channel_keys: selectedChannels,
        total_quota: normalizeTokenQuota(formData.total_quota),
      };
      setJsonValue(JSON.stringify(config, null, 2));
      setEditMode("json");
    } else {
      try {
        const config = JSON.parse(jsonValue);
        const normalizedConfig = {
          ...config,
          total_quota: normalizeTokenQuota(config.total_quota),
        };
        setFormData(normalizedConfig);
        setSelectedChannels(normalizedConfig.channel_keys || []);
        setQuotaInputValue(formatQuotaInputValue(normalizedConfig.total_quota));
        setEditMode("form");
      } catch {
        addToast(t('common.jsonFormatError'), "error");
      }
    }
  };

  const toggleChannel = (channelKey: string) => {
    setSelectedChannels((prev) =>
      prev.includes(channelKey) ? prev.filter((k) => k !== channelKey) : [...prev, channelKey],
    );
  };

  const filteredData = data?.filter((token) => {
    if (!searchQuery) return true;
    const config = typeof token.value === "string" ? JSON.parse(token.value) : token.value;
    return (
      config.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      token.key.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  // List View
  if (view === "list") {
    return (
      <PageContainer
        title={t('tokens.title')}
        description={t('tokens.description')}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            </Button>
            <Button size="sm" onClick={handleAdd}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">{t('common.add')}</span>
            </Button>
          </div>
        }
      >
        {/* Search */}
        {data && data.length > 0 && (
          <div className="mb-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('tokens.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">{t('common.loading')}</span>
            </div>
          </div>
        ) : !data || data.length === 0 ? (
          <Card className="">
            <CardContent className="flex flex-col items-center justify-center py-16 px-4">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Key className="h-7 w-7 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">{t('tokens.emptyTitle')}</h3>
              <p className="text-muted-foreground text-sm text-center max-w-sm mb-6">
                {t('tokens.emptyDescription')}
              </p>
              <Button onClick={handleAdd} size="lg">
                <Plus className="h-4 w-4 mr-2" />
                {t('tokens.addToken')}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="divide-y">
              {filteredData?.map((token) => {
                const config = typeof token.value === "string" ? JSON.parse(token.value) : token.value;
                const channelKeys = config.channel_keys || [];
                const usedQuota = token.usage || 0;
                const totalQuota = normalizeTokenQuota(config.total_quota);
                const availableQuota = isUnlimitedTokenQuota(totalQuota)
                  ? UNLIMITED_TOKEN_QUOTA
                  : Math.max(totalQuota - usedQuota, 0);
                const usagePercent = isUnlimitedTokenQuota(totalQuota)
                  ? 0
                  : totalQuota > 0
                    ? Math.min(100, (usedQuota / totalQuota) * 100)
                    : usedQuota > 0
                      ? 100
                      : 0;
                const isMenuOpen = openMenu === token.key;

                return (
                  <div key={token.key} className="p-4 hover:bg-muted/30 transition-colors">
                    {/* Mobile Layout */}
                    <div className="md:hidden space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{config.name}</div>
                          <button
                            onClick={() => handleCopy(token.key)}
                            className="text-xs text-muted-foreground hover:text-foreground font-mono flex items-center gap-1.5 mt-0.5"
                          >
                            {token.key.slice(0, 16)}...
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="relative">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenu(isMenuOpen ? null : token.key);
                            }}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                          {isMenuOpen && (
                            <div className="absolute right-0 top-full mt-1 w-32 bg-popover border rounded-lg shadow-lg py-1 z-10">
                              <button
                                className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
                                onClick={() => handleEdit(token)}
                              >
                                <Pencil className="h-4 w-4" />
                                {t('common.edit')}
                              </button>
                              <button
                                className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
                                onClick={() => handleResetUsage(token.key)}
                              >
                                <RotateCcw className="h-4 w-4" />
                                {t('tokens.resetQuota')}
                              </button>
                              <button
                                className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 text-destructive"
                                onClick={() => handleDelete(token.key)}
                              >
                                <Trash2 className="h-4 w-4" />
                                {t('common.delete')}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-muted-foreground">
                          {t('tokens.channels')}:{" "}
                          <span className="text-foreground">
                            {channelKeys.length === 0 ? t('tokens.channelsAll') : t('tokens.channelsCount', { count: channelKeys.length })}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          {t('tokens.usedAvailable')}:{" "}
                          <span className="text-foreground">
                            {formatCurrency(usedQuota, displayDecimals)}/{formatAvailableQuota(availableQuota, t('common.unlimited'))}
                          </span>
                        </span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            usagePercent > 90 ? "bg-destructive" : usagePercent > 70 ? "bg-warning" : "bg-primary",
                          )}
                          style={{ width: `${usagePercent}%` }}
                        />
                      </div>
                    </div>

                    {/* Desktop Layout */}
                    <div className="hidden md:flex md:items-center md:gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{config.name}</span>
                          <span className="text-xs text-muted-foreground font-mono">
                            {token.key.slice(0, 12)}...{token.key.slice(-4)}
                          </span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleCopy(token.key)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="w-24 text-sm text-center flex-shrink-0">
                        <span className="px-2 py-1 rounded-md bg-muted text-muted-foreground">
                          {channelKeys.length === 0 ? t('tokens.channelsAll') : t('tokens.channelsCountWithUnit', { count: channelKeys.length })}
                        </span>
                      </div>
                      <div className="w-48 flex-shrink-0">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted-foreground">
                            {formatCurrency(usedQuota, displayDecimals)} / {formatAvailableQuota(availableQuota, t('common.unlimited'))}
                          </span>
                          <span
                            className={cn(
                              "font-medium",
                              usagePercent > 90
                                ? "text-destructive"
                                : usagePercent > 70
                                  ? "text-warning"
                                  : "text-muted-foreground",
                            )}
                          >
                            {usagePercent.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              usagePercent > 90 ? "bg-destructive" : usagePercent > 70 ? "bg-warning" : "bg-primary",
                            )}
                            style={{ width: `${usagePercent}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleEdit(token)}
                          title={t('common.edit')}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleResetUsage(token.key)}
                          title={t('tokens.resetQuota')}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(token.key)}
                          title={t('common.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredData?.length === 0 && searchQuery && (
                <div className="p-8 text-center text-muted-foreground">{t('tokens.noMatchingTokens')}</div>
              )}
            </div>
          </Card>
        )}
      </PageContainer>
    );
  }

  if (isRouteEdit && isLoading && !editingKey) {
    return (
      <div className="p-4 md:p-6 lg:p-8 animate-in">
        <div className="max-w-2xl mx-auto flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">{t('tokens.loadingToken')}</span>
          </div>
        </div>
      </div>
    );
  }

  // Form View
  return (
    <div className="p-4 md:p-6 lg:p-8 animate-in">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Button variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground" onClick={closeForm}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('common.back')}
          </Button>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight">{editingKey ? t('tokens.editToken') : t('tokens.addToken')}</h1>
            <Button variant="outline" size="sm" onClick={toggleEditMode}>
              {editMode === "form" ? <FileJson className="h-4 w-4 mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
              {editMode === "form" ? t('common.json') : t('common.form')}
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          {/* Token Key Section */}
          <Card>
            <CardContent className="p-5">
              <h3 className="font-medium mb-1">{t('tokens.tokenKey')}</h3>
              <p className="text-sm text-muted-foreground mb-3">{t('tokens.tokenKeyDesc')}</p>
              <div className="flex gap-2">
                <Input
                  value={tokenKey}
                  onChange={(e) => setTokenKey(e.target.value)}
                  placeholder="sk-xxxxxxxxxxxxxxxx"
                  disabled={!!editingKey}
                  className="font-mono text-sm"
                />
                {!editingKey && (
                  <Button type="button" variant="outline" onClick={() => setTokenKey(generateTokenKey())}>
                    <Sparkles className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {editMode === "form" ? (
            <>
              {/* Basic Info */}
              <Card>
                <CardContent className="p-5">
                  <h3 className="font-medium mb-4">{t('tokens.basicInfo')}</h3>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-sm">
                        {t('tokens.tokenNameRequired')} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder={t('tokens.tokenNamePlaceholder')}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Channel Access */}
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-medium">{t('tokens.channelAccess')}</h3>
                      <p className="text-sm text-muted-foreground">
                        {selectedChannels.length === 0
                          ? t('tokens.channelAccessAll')
                          : t('tokens.channelAccessSelected', { count: selectedChannels.length })}
                      </p>
                    </div>
                  </div>
                  {availableChannels.length === 0 ? (
                    <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
                      <AlertCircle className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{t('tokens.noChannels')}</p>
                        <p className="text-xs text-muted-foreground">{t('tokens.noChannelsHint')}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {availableChannels.map((channelKey) => (
                        <label
                          key={channelKey}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                            selectedChannels.includes(channelKey)
                              ? "border-primary bg-primary/5"
                              : "border-transparent bg-muted/50 hover:bg-muted",
                          )}
                        >
                          <Checkbox
                            checked={selectedChannels.includes(channelKey)}
                            onCheckedChange={() => toggleChannel(channelKey)}
                          />
                          <span className="text-sm font-medium">{channelKey}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Quota */}
              <Card>
                <CardContent className="p-5">
                  <h3 className="font-medium mb-1">{t('tokens.quota')}</h3>
                  <p className="text-sm text-muted-foreground mb-4">{t('tokens.quotaHint')}</p>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={quotaInputValue}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          if (!QUOTA_INPUT_PATTERN.test(nextValue)) {
                            return;
                          }

                          setQuotaInputValue(nextValue);

                          if (nextValue === "-") {
                            return;
                          }

                          const parsedQuota = parseQuotaInputValue(nextValue);
                          if (parsedQuota === null) {
                            return;
                          }

                          setFormData({ ...formData, total_quota: parsedQuota });
                        }}
                        onBlur={() => {
                          setQuotaInputValue(formatQuotaInputValue(normalizeTokenQuota(formData.total_quota)));
                        }}
                        placeholder={t('tokens.quotaPlaceholder')}
                      />
                      <ButtonGroup
                        aria-label={t('tokens.quota')}
                        value={normalizeTokenQuota(formData.total_quota)}
                        options={tokenQuotaOptions}
                        onValueChange={(value) => {
                          setFormData({ ...formData, total_quota: value });
                          setQuotaInputValue(formatQuotaInputValue(value));
                        }}
                        className="h-10 items-center flex-nowrap"
                        buttonClassName="h-full w-full text-sm data-[state=on]:bg-green-100! data-[state=on]:text-white"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="p-5">
                <h3 className="font-medium mb-4">{t('channels.jsonConfig')}</h3>
                <Textarea
                  value={jsonValue}
                  onChange={(e) => setJsonValue(e.target.value)}
                  rows={14}
                  className="font-mono text-sm"
                  placeholder='{"name": "Token Name", "channel_keys": [], "total_quota": -1}'
                />
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="outline" onClick={closeForm}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t('common.saving')}
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  {t('tokens.saveToken')}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
