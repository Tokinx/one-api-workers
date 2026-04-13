import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { Channel, PricingConfig, PricingModel, Token } from "@/types";
import { MultiSelectAutoCompleteInput, type AutoCompleteOption } from "@/components/ui/autocomplete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  getChannelModels,
  isChannelEnabled,
  isChannelModelEnabled,
  parseChannelConfig,
  parseTokenConfig,
} from "@/lib/channel-models";
import { cn } from "@/lib/utils";
import { Check, FileJson, FileText, RefreshCw, Search } from "lucide-react";
import { PageContainer } from "@/components/ui/page-container";

type EditMode = "cards" | "json";
type PricingField = "input" | "output" | "cache" | "request";
type PricingRow = {
  model: string;
  input: number;
  output: number;
  cache: number;
  request: number;
};
type ChannelRef = {
  key: string;
  label: string;
  type: string;
  keywords: string[];
};
type TokenRef = {
  key: string;
  label: string;
  keywords: string[];
};

const PRICING_DECIMALS = 6;
const PRICING_INPUT_STEP = "0.000001";
const DEFAULT_REQUEST_VALUE = 1;
type BuildPricingRowsOptions = {
  sortConfiguredFirst?: boolean;
};

const FIELD_META: Array<{
  key: PricingField;
  label: string;
  placeholder: string;
}> = [
  {
    key: "input",
    label: "输入倍率",
    placeholder: "0.000000",
  },
  {
    key: "output",
    label: "输出倍率",
    placeholder: "0.000000",
  },
  {
    key: "cache",
    label: "缓存倍率",
    placeholder: "0.000000",
  },
  {
    key: "request",
    label: "按次",
    placeholder: "1.000000",
  },
];

const normalizePricingNumber = (value: unknown, fallback = 0): number => {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : fallback;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Number(parsed.toFixed(PRICING_DECIMALS));
};

const normalizePricingEntry = (pricing?: Partial<PricingModel> | null): PricingRow => ({
  model: "",
  input: normalizePricingNumber(pricing?.input, 0),
  output: normalizePricingNumber(pricing?.output, 0),
  cache: normalizePricingNumber(pricing?.cache, 0),
  request: normalizePricingNumber(pricing?.request, DEFAULT_REQUEST_VALUE),
});

const sanitizePricingEntry = (pricing: PricingRow): Partial<PricingModel> | null => {
  const normalized = {
    input: normalizePricingNumber(pricing.input, 0),
    output: normalizePricingNumber(pricing.output, 0),
    cache: normalizePricingNumber(pricing.cache, 0),
    request: normalizePricingNumber(pricing.request, 0),
  };

  const filtered = Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value > 0),
  ) as Partial<PricingModel>;

  return Object.keys(filtered).length > 0 ? filtered : null;
};

const normalizePricingConfig = (config?: PricingConfig | null): PricingConfig => {
  if (!config) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(config)
      .map(([model, pricing]) => {
        const normalizedModel = model.trim();
        if (!normalizedModel) {
          return null;
        }

        const sanitized = sanitizePricingEntry({
          model: normalizedModel,
          ...normalizePricingEntry(pricing),
        });

        if (!sanitized) {
          return null;
        }

        return [normalizedModel, sanitized] as const;
      })
      .filter((entry): entry is readonly [string, Partial<PricingModel>] => entry !== null),
  );
};

const createDefaultPricingRow = (model: string, pricing?: Partial<PricingModel> | null): PricingRow => {
  const normalized = normalizePricingEntry(pricing);
  return {
    model,
    input: normalized.input,
    output: normalized.output,
    cache: normalized.cache,
    request: normalized.request,
  };
};

const buildModelChannelMap = (channels: Channel[]): Map<string, ChannelRef[]> => {
  const channelMap = new Map<string, ChannelRef[]>();

  channels.forEach((channel) => {
    const config = parseChannelConfig(channel);
    if (!isChannelEnabled(config)) {
      return;
    }

    const label = config.name?.trim() || channel.key;
    const type = config.type?.trim() || "";
    const channelRef: ChannelRef = {
      key: channel.key,
      label,
      type,
      keywords: [channel.key, label, type].filter(Boolean),
    };

    getChannelModels(config)
      .filter((model) => isChannelModelEnabled(model))
      .forEach((model) => {
        const next = [...(channelMap.get(model.name) || [])];
        if (!next.some((item) => item.key === channel.key)) {
          next.push(channelRef);
          next.sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
          channelMap.set(model.name, next);
        }
      });
  });

  return channelMap;
};

const buildModelTokenMap = (tokens: Token[], modelChannelMap: Map<string, ChannelRef[]>): Map<string, TokenRef[]> => {
  const tokenMap = new Map<string, TokenRef[]>();

  tokens.forEach((token) => {
    const config = parseTokenConfig(token);
    const allowedChannelKeys = (config.channel_keys || []).filter(Boolean);
    const allowedSet = new Set(allowedChannelKeys);
    const label = config.name?.trim() || token.key;
    const tokenRef: TokenRef = {
      key: token.key,
      label,
      keywords: [token.key, label, ...allowedChannelKeys].filter(Boolean),
    };

    modelChannelMap.forEach((channels, model) => {
      if (channels.length === 0) {
        return;
      }

      const canAccess = allowedSet.size === 0 ? true : channels.some((channel) => allowedSet.has(channel.key));

      if (!canAccess) {
        return;
      }

      const next = [...(tokenMap.get(model) || [])];
      if (!next.some((item) => item.key === token.key)) {
        next.push(tokenRef);
        next.sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
        tokenMap.set(model, next);
      }
    });
  });

  return tokenMap;
};

const buildPricingRows = (
  modelChannelMap: Map<string, ChannelRef[]>,
  config: PricingConfig,
  options: BuildPricingRowsOptions = {},
): PricingRow[] => {
  const { sortConfiguredFirst = true } = options;
  const systemModels = Array.from(modelChannelMap.keys());
  const storedModels = Object.keys(config);
  const modelNames = Array.from(new Set([...systemModels, ...storedModels]));
  const configuredModels = new Set(storedModels);

  return modelNames
    .sort((left, right) => {
      if (sortConfiguredFirst) {
        const leftConfigured = configuredModels.has(left);
        const rightConfigured = configuredModels.has(right);
        if (leftConfigured !== rightConfigured) {
          return leftConfigured ? -1 : 1;
        }
      }

      const leftIsSystem = modelChannelMap.has(left);
      const rightIsSystem = modelChannelMap.has(right);
      if (leftIsSystem !== rightIsSystem) {
        return leftIsSystem ? -1 : 1;
      }
      return left.localeCompare(right, "zh-CN");
    })
    .map((model) => createDefaultPricingRow(model, config[model]));
};

const isCustomPricingRow = (row: PricingRow): boolean => {
  return row.input > 0 || row.output > 0 || row.cache > 0 || row.request !== DEFAULT_REQUEST_VALUE;
};

type MultiSelectAutocompleteFieldProps = {
  label: string;
  placeholder: string;
  selectedValues: string[];
  onChange: (values: string[]) => void;
  options: AutoCompleteOption[];
  emptyText: string;
};

function MultiSelectAutocompleteField({
  label,
  placeholder,
  selectedValues,
  onChange,
  options,
  emptyText,
}: MultiSelectAutocompleteFieldProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</Label>
        {selectedValues.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            清空
          </button>
        )}
      </div>

      <MultiSelectAutoCompleteInput
        values={selectedValues}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        emptyText={emptyText}
        inputClassName="h-10"
        maxOptions={8}
      />
    </div>
  );
}

export function Pricing() {
  const [editMode, setEditMode] = useState<EditMode>("cards");
  const [jsonValue, setJsonValue] = useState("");
  const [pricingRows, setPricingRows] = useState<PricingRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [selectedTokens, setSelectedTokens] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const pricingQuery = useQuery({
    queryKey: ["pricing"],
    queryFn: async () => {
      const response = await apiClient.getPricing();
      return normalizePricingConfig(response.data as PricingConfig | undefined);
    },
  });

  const channelsQuery = useQuery({
    queryKey: ["channels", "pricing"],
    queryFn: async () => {
      const response = await apiClient.getChannels();
      return response.data as Channel[];
    },
  });

  const tokensQuery = useQuery({
    queryKey: ["tokens", "pricing"],
    queryFn: async () => {
      const response = await apiClient.getTokens();
      return response.data as Token[];
    },
  });

  const modelChannelMap = useMemo(() => buildModelChannelMap(channelsQuery.data || []), [channelsQuery.data]);
  const modelTokenMap = useMemo(
    () => buildModelTokenMap(tokensQuery.data || [], modelChannelMap),
    [modelChannelMap, tokensQuery.data],
  );

  const baseRows = useMemo(
    () => buildPricingRows(modelChannelMap, pricingQuery.data || {}, { sortConfiguredFirst: true }),
    [modelChannelMap, pricingQuery.data],
  );

  useEffect(() => {
    setPricingRows(baseRows);
    setJsonValue(JSON.stringify(pricingQuery.data || {}, null, 2));
  }, [baseRows, pricingQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (config: PricingConfig) => apiClient.savePricing(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pricing"] });
      addToast("定价配置已保存", "success");
    },
    onError: (error: Error) => {
      addToast(`保存失败：${error.message}`, "error");
    },
  });

  const channelOptions = useMemo<AutoCompleteOption[]>(() => {
    return (channelsQuery.data || [])
      .map((channel) => {
        const config = parseChannelConfig(channel);
        if (!isChannelEnabled(config)) {
          return null;
        }

        const label = config.name?.trim() || channel.key;
        return {
          value: channel.key,
          label,
          description: label === channel.key ? undefined : channel.key,
          keywords: [channel.key, label, config.type || ""].filter(Boolean),
        } satisfies AutoCompleteOption;
      })
      .filter((option): option is AutoCompleteOption => option !== null)
      .sort((left, right) => (left.label || left.value).localeCompare(right.label || right.value, "zh-CN"));
  }, [channelsQuery.data]);

  const tokenOptions = useMemo<AutoCompleteOption[]>(() => {
    return (tokensQuery.data || [])
      .map((token) => {
        const config = parseTokenConfig(token);
        const label = config.name?.trim() || token.key;
        const channelKeys = config.channel_keys || [];

        return {
          value: token.key,
          label,
          description: label === token.key ? undefined : token.key,
          keywords: [token.key, label, ...channelKeys].filter(Boolean),
        } satisfies AutoCompleteOption;
      })
      .sort((left, right) => (left.label || left.value).localeCompare(right.label || right.value, "zh-CN"));
  }, [tokensQuery.data]);

  const typeOptions = useMemo<AutoCompleteOption[]>(() => {
    const typeMap = new Map<string, { label: string; channelLabels: string[] }>();

    (channelsQuery.data || []).forEach((channel) => {
      const config = parseChannelConfig(channel);
      if (!isChannelEnabled(config)) {
        return;
      }

      const type = config.type?.trim();
      if (!type) {
        return;
      }

      const label = type;
      const channelLabel = config.name?.trim() || channel.key;
      const current = typeMap.get(type) || { label, channelLabels: [] };

      if (!current.channelLabels.includes(channelLabel)) {
        current.channelLabels.push(channelLabel);
        current.channelLabels.sort((left, right) => left.localeCompare(right, "zh-CN"));
      }

      typeMap.set(type, current);
    });

    return Array.from(typeMap.entries())
      .map(([type, meta]) => ({
        value: type,
        label: meta.label,
        description: meta.channelLabels.join("、"),
        keywords: [type, meta.label, ...meta.channelLabels],
      }))
      .sort((left, right) => (left.label || left.value).localeCompare(right.label || right.value, "zh-CN"));
  }, [channelsQuery.data]);

  const pricingCards = useMemo(() => {
    return pricingRows.map((row) => {
      const channels = modelChannelMap.get(row.model) || [];
      const tokens = modelTokenMap.get(row.model) || [];
      const types = Array.from(new Set(channels.map((channel) => channel.type).filter(Boolean))).sort((left, right) =>
        left.localeCompare(right, "zh-CN"),
      );
      const searchTarget = [
        row.model,
        ...channels.flatMap((channel) => channel.keywords),
        ...tokens.flatMap((token) => token.keywords),
        ...types,
      ]
        .join(" ")
        .toLowerCase();

      return {
        ...row,
        channels,
        tokens,
        types,
        isCustomized: isCustomPricingRow(row),
        searchTarget,
      };
    });
  }, [modelChannelMap, modelTokenMap, pricingRows]);

  useEffect(() => {
    setSelectedChannels((current) =>
      current.filter((value) => channelOptions.some((option) => option.value === value)),
    );
  }, [channelOptions]);

  useEffect(() => {
    setSelectedTokens((current) => current.filter((value) => tokenOptions.some((option) => option.value === value)));
  }, [tokenOptions]);

  useEffect(() => {
    setSelectedTypes((current) => current.filter((value) => typeOptions.some((option) => option.value === value)));
  }, [typeOptions]);

  const filteredCards = useMemo(() => {
    const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase();

    return pricingCards.filter((card) => {
      if (selectedChannels.length > 0 && !card.channels.some((channel) => selectedChannels.includes(channel.key))) {
        return false;
      }

      if (selectedTokens.length > 0 && !card.tokens.some((token) => selectedTokens.includes(token.key))) {
        return false;
      }

      if (selectedTypes.length > 0 && !card.types.some((type) => selectedTypes.includes(type))) {
        return false;
      }

      if (normalizedSearchQuery && !card.searchTarget.includes(normalizedSearchQuery)) {
        return false;
      }

      return true;
    });
  }, [deferredSearchQuery, pricingCards, selectedChannels, selectedTokens, selectedTypes]);

  const handleRefresh = () => {
    pricingQuery.refetch();
    channelsQuery.refetch();
    tokensQuery.refetch();
  };

  const buildConfigFromRows = (rows: PricingRow[]): PricingConfig => {
    return Object.fromEntries(
      rows
        .map((row) => {
          const normalizedModel = row.model.trim();
          if (!normalizedModel) {
            return null;
          }

          const sanitized = sanitizePricingEntry(row);
          if (!sanitized) {
            return null;
          }

          return [normalizedModel, sanitized] as const;
        })
        .filter((entry): entry is readonly [string, Partial<PricingModel>] => entry !== null),
    );
  };

  const handleSave = () => {
    if (editMode === "cards") {
      saveMutation.mutate(buildConfigFromRows(pricingRows));
      return;
    }

    try {
      const parsed = JSON.parse(jsonValue) as PricingConfig;
      saveMutation.mutate(normalizePricingConfig(parsed));
    } catch {
      addToast("JSON 格式错误", "error");
    }
  };

  const toggleEditMode = () => {
    if (editMode === "cards") {
      setJsonValue(JSON.stringify(buildConfigFromRows(pricingRows), null, 2));
      setEditMode("json");
      return;
    }

    try {
      const parsed = normalizePricingConfig(JSON.parse(jsonValue));
      setPricingRows(buildPricingRows(modelChannelMap, parsed, { sortConfiguredFirst: false }));
      setEditMode("cards");
    } catch {
      addToast("JSON 格式错误", "error");
    }
  };

  const updateRow = (model: string, field: PricingField, nextValue: string) => {
    const normalizedValue = normalizePricingNumber(nextValue, 0);

    setPricingRows((current) =>
      current.map((row) => (row.model === model ? { ...row, [field]: normalizedValue } : row)),
    );
  };

  const isFetching = pricingQuery.isFetching || channelsQuery.isFetching || tokensQuery.isFetching;

  return (
    <PageContainer
      title="定价管理"
      description="以模型卡片集中管理全局定价，默认覆盖当前系统模型，并支持按渠道、令牌、类型与关键词快速筛选。"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching}>
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
          <Button variant="outline" size="sm" onClick={toggleEditMode}>
            {editMode === "cards" ? <FileJson className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            <span className="hidden sm:inline ml-1">{editMode === "cards" ? "JSON" : "卡片"}</span>
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
            <Check className="h-4 w-4 mr-1" />
            保存
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <Card className="border-0 p-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MultiSelectAutocompleteField
              label="渠道筛选"
              placeholder="选择渠道"
              selectedValues={selectedChannels}
              onChange={setSelectedChannels}
              options={channelOptions}
              emptyText="没有匹配渠道"
            />

            <MultiSelectAutocompleteField
              label="类型筛选"
              placeholder="选择渠道类型"
              selectedValues={selectedTypes}
              onChange={setSelectedTypes}
              options={typeOptions}
              emptyText="没有匹配类型"
            />

            <MultiSelectAutocompleteField
              label="令牌筛选"
              placeholder="选择令牌"
              selectedValues={selectedTokens}
              onChange={setSelectedTokens}
              options={tokenOptions}
              emptyText="没有匹配令牌"
            />

            <div className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">搜索</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="搜索模型、渠道、令牌或类型"
                  className="h-10 pl-9"
                />
              </div>
            </div>
          </div>

        </Card>

        {editMode === "cards" ? (
          pricingQuery.isLoading || channelsQuery.isLoading || tokensQuery.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-sm text-muted-foreground">正在汇总模型、渠道与令牌信息...</span>
              </div>
            </div>
          ) : pricingCards.length === 0 ? (
            <Card className="border-0 py-16 text-center">
              <CardContent>
                <div className="text-lg font-semibold">暂无可管理模型</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  先在渠道管理中同步模型列表，或者切换到 JSON 模式手动补充价格配置。
                </p>
              </CardContent>
            </Card>
          ) : filteredCards.length === 0 ? (
            <Card className="border-0 py-16 text-center">
              <CardContent>
                <div className="text-lg font-semibold">没有匹配的模型卡片</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  当前筛选条件过严，建议放宽渠道、令牌、类型或关键词。
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredCards.map((card) => (
                <Card key={card.model}>
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="truncate font-mono text-base">{card.model}</CardTitle>
                      </div>
                      <Badge className={cn("w-3 h-3 p-0", card.isCustomized ? "bg-success" : "bg-background")}></Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="px-4 pb-4 space-y-2">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 bg-background/60 px-3 py-2 rounded-lg -mx-2">
                      {FIELD_META.map((field) => (
                        <label key={field.key} className="flex flex-row gap-1 items-center">
                          <span className="flex-shrink-0 text-xs font-medium text-muted-foreground mt-[1px]">
                            {field.label}
                          </span>
                          <Input
                            type="number"
                            min="0"
                            step={PRICING_INPUT_STEP}
                            value={card[field.key]}
                            onChange={(event) => updateRow(card.model, field.key, event.target.value)}
                            placeholder={field.placeholder}
                            className="h-7 font-mono text-sm px-2 border-0 bg-transparent"
                          />
                        </label>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {card.channels.length > 0 ? (
                        card.channels.map((channel) => (
                          <span
                            key={channel.key}
                            className="text-xs text-muted-foreground rounded-sm px-1.5 py-0.5 bg-accent"
                          >
                            {channel.label}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">无匹配渠道</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        ) : (
          <Card className="border-0">
            <CardHeader>
              <CardTitle className="text-lg">JSON 配置</CardTitle>
              <CardDescription>
                只会保存大于 0 的价格字段；切回卡片模式时，会与当前渠道中的模型集合自动合并。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea
                value={jsonValue}
                onChange={(event) => setJsonValue(event.target.value)}
                rows={24}
                className="font-mono text-sm"
                placeholder='{"gpt-4.1": {"input": 0.8, "output": 3.2, "request": 1}}'
              />
              <p className="text-xs text-muted-foreground">
                格式：模型名称 → {"{"} input?: 输入倍率, output?: 输出倍率, cache?: 缓存倍率, request?: 按次 {"}"}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
