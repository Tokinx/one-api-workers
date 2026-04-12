import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "@/api/client";
import { Channel, ChannelConfig, ChannelModelMapping } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  FileJson,
  FileText,
  Link as LinkIcon,
  ArrowLeft,
  Check,
  MoreHorizontal,
  Search,
  Globe,
  Cpu,
} from "lucide-react";
import { PageContainer } from "@/components/ui/page-container";

type EditMode = "form" | "json";
type ModelEditorMode = "visual" | "json";
type ModelRow = { id: string; name: string; enabled: boolean };
type FetchedModelCandidate = { id: string; label: string };

const channelTypes = [
  { value: "openai", label: "OpenAI" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "claude", label: "Claude" },
  { value: "gemini", label: "Gemini" },
  { value: "openai-audio", label: "OpenAI Audio" },
  { value: "claude-to-openai", label: "Claude → OpenAI" },
  { value: "azure-openai", label: "Azure OpenAI" },
  { value: "azure-openai-audio", label: "Azure OpenAI Audio" },
  { value: "azure-openai-responses", label: "Azure OpenAI Responses" },
];

const channelWeightOptions = Array.from({ length: 6 }, (_, weight) => ({
  value: String(weight),
  label: `权重 ${weight}`,
}));

const createEmptyModelRow = (): ModelRow => ({
  id: "",
  name: "",
  enabled: true,
});

const createDefaultChannelFormData = (): ChannelConfig => ({
  name: "",
  type: "openai",
  endpoint: "",
  enabled: true,
  weight: 0,
  api_keys: [],
  auto_retry: true,
  auto_rotate: true,
  models: [],
});

const normalizeChannelWeight = (weight: number | undefined): number => {
  if (typeof weight !== "number" || !Number.isFinite(weight)) {
    return 0;
  }

  return Math.min(5, Math.max(0, Math.trunc(weight)));
};

const parseApiKeys = (value: string): string[] => {
  const seen = new Set<string>();

  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => {
      if (seen.has(line)) {
        return false;
      }
      seen.add(line);
      return true;
    });
};

const formatApiKeys = (apiKeys?: string[]): string => {
  return (apiKeys || []).join("\n");
};

const normalizeModels = (models?: ChannelModelMapping[]): ChannelModelMapping[] => {
  if (!Array.isArray(models)) {
    return [];
  }

  return models
    .map((model) => ({
      id: typeof model?.id === "string" ? model.id.trim() : "",
      name: typeof model?.name === "string" ? model.name.trim() : "",
      enabled: model?.enabled !== false,
    }))
    .filter((model) => model.id.length > 0)
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
      enabled: model.enabled,
    }));
};

const getChannelModels = (config: ChannelConfig): ChannelModelMapping[] => {
  const normalizedModels = normalizeModels(config.models);
  if (normalizedModels.length > 0) {
    return normalizedModels;
  }

  const deploymentMapper = config.deployment_mapper || {};
  const supportedModels = Array.isArray(config.supported_models) ? config.supported_models : [];
  const legacyModels: ChannelModelMapping[] = [];
  const seenNames = new Set<string>();

  const pushModel = (id: string, name?: string, enabled = true) => {
    const normalizedId = id.trim();
    const normalizedName = (name || id).trim();

    if (!normalizedId || !normalizedName || seenNames.has(normalizedName)) {
      return;
    }

    seenNames.add(normalizedName);
    legacyModels.push({
      id: normalizedId,
      name: normalizedName,
      enabled,
    });
  };

  supportedModels.forEach((modelName) => {
    const normalizedName = typeof modelName === "string" ? modelName.trim() : "";
    if (!normalizedName) {
      return;
    }
    pushModel(deploymentMapper[normalizedName] || normalizedName, normalizedName);
  });

  Object.entries(deploymentMapper).forEach(([modelName, modelId]) => {
    if (typeof modelId !== "string") {
      return;
    }
    pushModel(modelId, modelName);
  });

  return legacyModels;
};

const normalizeChannelFormConfig = (config: ChannelConfig): ChannelConfig => {
  const legacyApiKey = typeof config.api_key === "string" ? config.api_key.trim() : "";
  const rawApiKeys = Array.isArray(config.api_keys) ? config.api_keys : [];
  const mergedKeys = parseApiKeys([legacyApiKey, ...rawApiKeys].join("\n"));
  const models = getChannelModels(config);

  return {
    ...config,
    api_key: undefined,
    enabled: config.enabled ?? true,
    weight: normalizeChannelWeight(config.weight),
    api_keys: mergedKeys,
    auto_retry: config.auto_retry ?? true,
    auto_rotate: config.auto_rotate ?? true,
    models,
    supported_models: undefined,
    deployment_mapper: undefined,
  };
};

const parseChannelValue = (channel: Channel): ChannelConfig => {
  if (typeof channel.value !== "string") {
    return channel.value;
  }

  try {
    return JSON.parse(channel.value) as ChannelConfig;
  } catch {
    return createDefaultChannelFormData();
  }
};

const buildChannelValue = (source: Channel["value"], config: ChannelConfig): Channel["value"] => {
  return typeof source === "string" ? JSON.stringify(config) : config;
};

const isEmptyModelRow = (row: ModelRow): boolean => {
  return !row.id.trim() && !row.name.trim();
};

const ensureTrailingEmptyModelRow = (rows: ModelRow[]): ModelRow[] => {
  const meaningfulRows = rows.filter((row) => !isEmptyModelRow(row));
  return [...meaningfulRows, createEmptyModelRow()];
};

const buildRowsFromModels = (models: ChannelModelMapping[]): ModelRow[] => {
  return ensureTrailingEmptyModelRow(
    models.map((model) => ({
      id: model.id,
      name: model.name,
      enabled: model.enabled !== false,
    })),
  );
};

const serializeModels = (models: ChannelModelMapping[]): string => {
  return JSON.stringify(models, null, 2);
};

const validateModels = (models: ChannelModelMapping[]): string | null => {
  if (models.length === 0) {
    return "请至少配置一个模型";
  }

  const names = new Set<string>();
  for (const model of models) {
    if (names.has(model.name)) {
      return `模型名称重复：${model.name}`;
    }
    names.add(model.name);
  }

  return null;
};

const parseModelsFromRows = (rows: ModelRow[]): { models: ChannelModelMapping[]; error?: string } => {
  const activeRows = rows.filter((row) => !isEmptyModelRow(row));

  for (const row of activeRows) {
    if (!row.id.trim()) {
      return { models: [], error: "模型 ID 不能为空" };
    }
  }

  const models = activeRows.map((row) => {
    const id = row.id.trim();
    const name = row.name.trim() || id;
    return { id, name, enabled: row.enabled !== false };
  });

  const validationError = validateModels(models);
  if (validationError) {
    return { models: [], error: validationError };
  }

  return { models };
};

const parseModelsFromJson = (value: string): { models: ChannelModelMapping[]; error?: string } => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return { models: [], error: "模型 JSON 格式错误" };
  }

  if (!Array.isArray(parsed)) {
    return { models: [], error: "模型 JSON 必须是数组" };
  }

  const models: ChannelModelMapping[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      return { models: [], error: "模型 JSON 项必须是对象" };
    }

    const id = typeof (item as ChannelModelMapping).id === "string" ? (item as ChannelModelMapping).id.trim() : "";
    const rawName =
      typeof (item as ChannelModelMapping).name === "string" ? (item as ChannelModelMapping).name.trim() : "";

    if (!id) {
      return { models: [], error: "模型 JSON 中的 id 不能为空" };
    }

    models.push({
      id,
      name: rawName || id,
      enabled: (item as ChannelModelMapping).enabled !== false,
    });
  }

  const validationError = validateModels(models);
  if (validationError) {
    return { models: [], error: validationError };
  }

  return { models };
};

const normalizeFetchedModelCandidates = (models: ChannelModelMapping[]): FetchedModelCandidate[] => {
  const candidates: FetchedModelCandidate[] = [];
  const seenIds = new Set<string>();

  models.forEach((model) => {
    const id = typeof model.id === "string" ? model.id.trim() : "";
    const label = typeof model.name === "string" ? model.name.trim() : "";

    if (!id || seenIds.has(id)) {
      return;
    }

    seenIds.add(id);
    candidates.push({
      id,
      label: label || id,
    });
  });

  return candidates;
};

const buildInitialFetchedModelSelection = (
  candidates: FetchedModelCandidate[],
  currentModels: ChannelModelMapping[],
): string[] => {
  const currentModelIds = new Set(currentModels.map((model) => model.id));
  const matchedIds = candidates
    .filter((candidate) => currentModelIds.has(candidate.id))
    .map((candidate) => candidate.id);

  return matchedIds.length > 0 ? matchedIds : candidates.map((candidate) => candidate.id);
};

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, "");

const joinPath = (...segments: string[]): string => {
  const cleanedSegments = segments.map((segment) => trimSlashes(segment)).filter((segment) => segment.length > 0);

  return `/${cleanedSegments.join("/")}`;
};

const getChannelRequestPreviewPath = (type: string | undefined): string => {
  switch (type) {
    case "claude":
      return "/v1/messages";
    case "openai-audio":
    case "azure-openai-audio":
      return "/v1/audio/speech";
    case "openai-responses":
    case "azure-openai-responses":
      return "/v1/responses";
    case "openai":
    case "azure-openai":
    case "claude-to-openai":
    default:
      return "/v1/chat/completions";
  }
};

const isGeminiChannelType = (type: string | undefined): boolean => {
  return type === "gemini";
};

const isOpenAIStyleChannelType = (type: string | undefined): boolean => {
  return ["openai", "openai-audio", "openai-responses", "claude-to-openai"].includes(type || "");
};

const isAzureChannelType = (type: string | undefined): boolean => {
  return ["azure-openai", "azure-openai-audio", "azure-openai-responses"].includes(type || "");
};

const buildPrefixedEndpointPreview = (endpoint: string, requestPath: string, prefixToStrip = "/v1"): string => {
  const targetUrl = new URL(endpoint);
  const currentBasePath = trimSlashes(targetUrl.pathname);
  const normalizedPrefix = trimSlashes(prefixToStrip);
  const baseAlreadyContainsPrefix = normalizedPrefix.length > 0 && currentBasePath.endsWith(normalizedPrefix);
  const explicitBasePath = endpoint.endsWith("/");

  let normalizedRequestPath = requestPath;
  if ((baseAlreadyContainsPrefix || explicitBasePath) && normalizedRequestPath.startsWith(prefixToStrip)) {
    normalizedRequestPath = normalizedRequestPath.slice(prefixToStrip.length);
  }

  targetUrl.pathname = joinPath(currentBasePath, normalizedRequestPath);
  return targetUrl.toString();
};

const buildAzureEndpointPreview = (endpoint: string, requestPath: string): string => {
  const targetUrl = new URL(endpoint);
  const currentBasePath = trimSlashes(targetUrl.pathname);
  const normalizedRequestPath = requestPath.replace(/^\/v1/, "");
  const explicitBasePath = endpoint.endsWith("/");
  const azureBasePath = currentBasePath.endsWith("openai/v1")
    ? currentBasePath
    : currentBasePath.endsWith("openai")
      ? explicitBasePath
        ? currentBasePath
        : joinPath(currentBasePath, "v1")
      : explicitBasePath
        ? joinPath(currentBasePath, "openai")
        : joinPath(currentBasePath, "openai/v1");

  targetUrl.pathname = joinPath(azureBasePath, normalizedRequestPath);
  return targetUrl.toString();
};

const buildClaudeEndpointPreview = (endpoint: string, requestPath: string): string => {
  return buildPrefixedEndpointPreview(endpoint, requestPath);
};

const buildGeminiEndpointPreview = (endpoint: string, requestPath: string): string => {
  const targetUrl = new URL(endpoint);
  const currentBasePath = trimSlashes(targetUrl.pathname);
  const normalizedRequestPath = requestPath.replace(/^\/v1(?=\/|$)/, "");
  const geminiBasePath = currentBasePath.endsWith("v1beta/openai")
    ? currentBasePath
    : currentBasePath.endsWith("v1beta")
      ? joinPath(currentBasePath, "openai")
      : currentBasePath.endsWith("openai")
        ? currentBasePath
        : joinPath(currentBasePath, "v1beta/openai");

  targetUrl.pathname = joinPath(geminiBasePath, normalizedRequestPath);
  return targetUrl.toString();
};

const buildFallbackEndpointPreview = (endpoint: string, requestPath: string): string => {
  const normalizedEndpoint = endpoint.trim().replace(/\/+$/, "");
  return `${normalizedEndpoint}${requestPath}`;
};

const getChannelEndpointPlaceholder = (type: string | undefined): string => {
  switch (type) {
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta/openai/";
    case "azure-openai":
    case "azure-openai-audio":
    case "azure-openai-responses":
      return "https://your-resource.openai.azure.com/";
    case "claude":
      return "https://api.anthropic.com/v1/";
    default:
      return "https://api.openai.com/v1/";
  }
};

const getChannelEndpointPreview = (type: string | undefined, endpoint: string): string => {
  const trimmedEndpoint = endpoint.trim();
  const requestPath = getChannelRequestPreviewPath(type);
  if (!trimmedEndpoint) {
    return requestPath;
  }

  try {
    if (type === "claude") {
      return buildClaudeEndpointPreview(trimmedEndpoint, requestPath);
    }

    if (isGeminiChannelType(type)) {
      return buildGeminiEndpointPreview(trimmedEndpoint, requestPath);
    }

    if (isAzureChannelType(type)) {
      return buildAzureEndpointPreview(trimmedEndpoint, requestPath);
    }

    if (isOpenAIStyleChannelType(type)) {
      return buildPrefixedEndpointPreview(trimmedEndpoint, requestPath);
    }
  } catch {
    return buildFallbackEndpointPreview(trimmedEndpoint, requestPath);
  }

  return buildFallbackEndpointPreview(trimmedEndpoint, requestPath);
};

export function Channels({ createMode = false, editRoute = false }: { createMode?: boolean; editRoute?: boolean }) {
  const navigate = useNavigate();
  const { key: routeKey } = useParams<{ key: string }>();
  const isRouteEdit = editRoute && Boolean(routeKey);
  const [view, setView] = useState<"list" | "form">(createMode || isRouteEdit ? "form" : "list");
  const [editMode, setEditMode] = useState<EditMode>("form");
  const [modelEditorMode, setModelEditorMode] = useState<ModelEditorMode>("visual");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formData, setFormData] = useState<ChannelConfig>(createDefaultChannelFormData());
  const [channelKey, setChannelKey] = useState("");
  const [jsonValue, setJsonValue] = useState("");
  const [apiKeysInput, setApiKeysInput] = useState("");
  const [modelRows, setModelRows] = useState<ModelRow[]>([createEmptyModelRow()]);
  const [modelJsonValue, setModelJsonValue] = useState("[]");
  const [searchQuery, setSearchQuery] = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isFetchedModelsDialogOpen, setIsFetchedModelsDialogOpen] = useState(false);
  const [fetchedModelCandidates, setFetchedModelCandidates] = useState<FetchedModelCandidate[]>([]);
  const [selectedFetchedModelIds, setSelectedFetchedModelIds] = useState<string[]>([]);
  const [fetchedModelsSearchQuery, setFetchedModelsSearchQuery] = useState("");

  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const applyModels = (models: ChannelModelMapping[]) => {
    const normalizedModels = normalizeModels(models);
    setFormData((prev) => ({ ...prev, models: normalizedModels }));
    setModelRows(buildRowsFromModels(normalizedModels));
    setModelJsonValue(serializeModels(normalizedModels));
  };

  const resolveCurrentModels = (): { models: ChannelModelMapping[]; error?: string } => {
    return modelEditorMode === "visual" ? parseModelsFromRows(modelRows) : parseModelsFromJson(modelJsonValue);
  };

  const getCurrentConfiguredModels = (): ChannelModelMapping[] => {
    const result = resolveCurrentModels();
    return result.error ? normalizeModels(formData.models) : result.models;
  };

  const loadFormConfig = (config: ChannelConfig) => {
    const normalizedConfig = normalizeChannelFormConfig(config);
    setFormData(normalizedConfig);
    setApiKeysInput(formatApiKeys(normalizedConfig.api_keys));
    setModelRows(buildRowsFromModels(normalizedConfig.models || []));
    setModelJsonValue(serializeModels(normalizedConfig.models || []));
    setModelEditorMode("visual");
    return normalizedConfig;
  };

  const openChannelForEdit = useCallback((channel: Channel) => {
    setEditingKey(channel.key);
    setChannelKey(channel.key);
    const rawConfig = parseChannelValue(channel);
    const normalizedConfig = loadFormConfig(rawConfig);
    setJsonValue(JSON.stringify(normalizedConfig, null, 2));
    setView("form");
  }, []);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const response = await apiClient.getChannels();
      return response.data as Channel[];
    },
  });

  useEffect(() => {
    const handleClick = () => setOpenMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async ({ key, config }: { key: string; config: ChannelConfig }) => {
      return apiClient.saveChannel(key, config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      addToast(editingKey ? "渠道更新成功" : "渠道添加成功", "success");
      closeForm();
    },
    onError: (error: Error) => {
      addToast("保存失败：" + error.message, "error");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => {
      return apiClient.deleteChannel(key);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      addToast("渠道已删除", "success");
    },
    onError: (error: Error) => {
      addToast("删除失败：" + error.message, "error");
    },
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ channel, enabled }: { channel: Channel; enabled: boolean }) => {
      const config = normalizeChannelFormConfig(parseChannelValue(channel));
      return apiClient.saveChannel(channel.key, { ...config, enabled });
    },
    onMutate: async ({ channel, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ["channels"] });
      const previousChannels = queryClient.getQueryData<Channel[]>(["channels"]);

      queryClient.setQueryData<Channel[]>(["channels"], (current) => {
        if (!current) {
          return current;
        }

        return current.map((item) => {
          if (item.key !== channel.key) {
            return item;
          }

          const config = normalizeChannelFormConfig(parseChannelValue(item));
          return {
            ...item,
            value: buildChannelValue(item.value, { ...config, enabled }),
          };
        });
      });

      return { previousChannels };
    },
    onSuccess: (_, { enabled }) => {
      addToast(enabled ? "渠道已启用" : "渠道已停用", "success");
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previousChannels) {
        queryClient.setQueryData(["channels"], context.previousChannels);
      }
      addToast("更新渠道状态失败：" + error.message, "error");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });

  const fetchModelsMutation = useMutation({
    mutationFn: async (config: ChannelConfig) => {
      return apiClient.fetchChannelModels(config);
    },
    onSuccess: (response) => {
      const candidates = normalizeFetchedModelCandidates((response.data as ChannelModelMapping[]) || []);
      if (candidates.length === 0) {
        addToast("未获取到可选模型", "error");
        return;
      }

      const currentModels = getCurrentConfiguredModels();
      setFetchedModelCandidates(candidates);
      setSelectedFetchedModelIds(buildInitialFetchedModelSelection(candidates, currentModels));
      setFetchedModelsSearchQuery("");
      setIsFetchedModelsDialogOpen(true);
    },
    onError: (error: Error) => {
      addToast("获取模型失败：" + error.message, "error");
    },
  });

  const resetForm = useCallback(() => {
    setFormData(createDefaultChannelFormData());
    setChannelKey("");
    setJsonValue("");
    setApiKeysInput("");
    setModelRows([createEmptyModelRow()]);
    setModelJsonValue("[]");
    setModelEditorMode("visual");
    setIsFetchedModelsDialogOpen(false);
    setFetchedModelCandidates([]);
    setSelectedFetchedModelIds([]);
    setFetchedModelsSearchQuery("");
    setEditingKey(null);
    setEditMode("form");
  }, []);

  useEffect(() => {
    if (createMode) {
      resetForm();
      setView("form");
      return;
    }

    if (isRouteEdit) {
      if (isLoading) {
        setView("form");
        return;
      }

      const targetChannel = data?.find((channel) => channel.key === routeKey);
      if (!targetChannel) {
        resetForm();
        setView("list");
        addToast("未找到对应渠道", "error");
        navigate("/channels", { replace: true });
        return;
      }

      openChannelForEdit(targetChannel);
      return;
    }

    resetForm();
    setView("list");
  }, [addToast, createMode, data, isLoading, isRouteEdit, navigate, openChannelForEdit, resetForm, routeKey]);

  const closeForm = () => {
    resetForm();
    setView("list");

    if (createMode || isRouteEdit) {
      navigate("/channels", { replace: true });
    }
  };

  const handleAdd = () => {
    resetForm();
    navigate("/channels/new");
  };

  const handleEdit = (channel: Channel) => {
    navigate(`/channels/edit/${encodeURIComponent(channel.key)}`);
  };

  const handleDelete = (key: string) => {
    if (confirm("确定要删除此渠道吗？")) {
      deleteMutation.mutate(key);
    }
  };

  const handleToggleEnabled = (channel: Channel, enabled: boolean) => {
    toggleEnabledMutation.mutate({ channel, enabled });
  };

  const handleFetchModels = () => {
    const apiKeys = parseApiKeys(apiKeysInput);

    if (!formData.type || !formData.endpoint || apiKeys.length === 0) {
      addToast("请先填写渠道类型、API 端点和 API 密钥", "error");
      return;
    }

    const config = normalizeChannelFormConfig({
      ...formData,
      api_keys: apiKeys,
    });

    fetchModelsMutation.mutate(config);
  };

  const filteredFetchedModelCandidates = useMemo(() => {
    const query = fetchedModelsSearchQuery.trim().toLowerCase();
    if (!query) {
      return fetchedModelCandidates;
    }

    return fetchedModelCandidates.filter((candidate) =>
      `${candidate.id} ${candidate.label}`.toLowerCase().includes(query),
    );
  }, [fetchedModelCandidates, fetchedModelsSearchQuery]);

  const toggleFetchedModelSelection = (modelId: string, checked: boolean) => {
    setSelectedFetchedModelIds((current) => {
      if (checked) {
        return current.includes(modelId) ? current : [...current, modelId];
      }

      return current.filter((item) => item !== modelId);
    });
  };

  const handleApplyFetchedModels = () => {
    const selectedIdSet = new Set(selectedFetchedModelIds);
    const currentModelsById = new Map(getCurrentConfiguredModels().map((model) => [model.id, model]));
    const selectedModels = fetchedModelCandidates
      .filter((candidate) => selectedIdSet.has(candidate.id))
      .map(
        (candidate) =>
          currentModelsById.get(candidate.id) || {
            id: candidate.id,
            name: candidate.id,
            enabled: true,
          },
      );

    if (selectedModels.length === 0) {
      addToast("请至少选择一个模型", "error");
      return;
    }

    applyModels(selectedModels);
    setIsFetchedModelsDialogOpen(false);
    addToast(`已写入 ${selectedModels.length} 个模型`, "success");
  };

  const handleSave = () => {
    if (!channelKey) {
      addToast("请填写渠道标识", "error");
      return;
    }

    const apiKeys = parseApiKeys(apiKeysInput);
    const modelResult = resolveCurrentModels();

    if (modelResult.error) {
      addToast(modelResult.error, "error");
      return;
    }

    if (!formData.name || !formData.endpoint || apiKeys.length === 0) {
      addToast("请填写所有必填字段", "error");
      return;
    }

    let config: ChannelConfig;
    if (editMode === "form") {
      config = normalizeChannelFormConfig({
        ...formData,
        api_key: undefined,
        api_keys: apiKeys,
        models: modelResult.models,
      });
    } else {
      try {
        config = normalizeChannelFormConfig(JSON.parse(jsonValue));
      } catch {
        addToast("JSON 格式错误", "error");
        return;
      }

      const validationError = validateModels(config.models || []);
      if (validationError) {
        addToast(validationError, "error");
        return;
      }
    }

    saveMutation.mutate({ key: channelKey, config });
  };

  const toggleEditMode = () => {
    if (editMode === "form") {
      const modelResult = resolveCurrentModels();
      if (modelResult.error) {
        addToast(modelResult.error, "error");
        return;
      }

      const config = normalizeChannelFormConfig({
        ...formData,
        api_key: undefined,
        api_keys: parseApiKeys(apiKeysInput),
        models: modelResult.models,
      });
      setJsonValue(JSON.stringify(config, null, 2));
      setEditMode("json");
      return;
    }

    try {
      const config = normalizeChannelFormConfig(JSON.parse(jsonValue));
      const validationError = validateModels(config.models || []);
      if (validationError) {
        addToast(validationError, "error");
        return;
      }

      loadFormConfig(config);
      setEditMode("form");
    } catch {
      addToast("JSON 格式错误", "error");
    }
  };

  const toggleModelEditorMode = () => {
    if (modelEditorMode === "visual") {
      const result = parseModelsFromRows(modelRows);
      if (result.error) {
        addToast(result.error, "error");
        return;
      }

      setModelJsonValue(serializeModels(result.models));
      setModelEditorMode("json");
      return;
    }

    const result = parseModelsFromJson(modelJsonValue);
    if (result.error) {
      addToast(result.error, "error");
      return;
    }

    applyModels(result.models);
    setModelEditorMode("visual");
  };

  const setModelEditorModeWithSync = (nextMode: ModelEditorMode) => {
    if (nextMode === modelEditorMode) {
      return;
    }

    toggleModelEditorMode();
  };

  const updateModelRowsState = (nextRows: ModelRow[]) => {
    const normalizedRows = ensureTrailingEmptyModelRow(nextRows);
    setModelRows(normalizedRows);
    const result = parseModelsFromRows(normalizedRows);
    if (!result.error) {
      setFormData((prev) => ({ ...prev, models: result.models }));
      setModelJsonValue(serializeModels(result.models));
    }
  };

  const updateModelRow = (index: number, field: keyof ModelRow, value: string) => {
    const nextRows = [...modelRows];
    const previousRow = nextRows[index] || createEmptyModelRow();
    const nextRow = {
      ...previousRow,
      [field]: value,
    };

    if (field === "id" && (!previousRow.name.trim() || previousRow.name.trim() === previousRow.id.trim())) {
      nextRow.name = value;
    }

    nextRows[index] = nextRow;
    updateModelRowsState(nextRows);
  };

  const removeModelRow = (index: number) => {
    const meaningfulRows = modelRows.filter((row) => !isEmptyModelRow(row));
    if (meaningfulRows.length === 0) {
      updateModelRowsState([createEmptyModelRow()]);
      return;
    }

    const nextRows = modelRows.filter((_, rowIndex) => rowIndex !== index);
    updateModelRowsState(nextRows);
  };

  const getTypeLabel = (type: string) => {
    return channelTypes.find((item) => item.value === type)?.label || type;
  };

  const filteredData = data?.filter((channel) => {
    if (!searchQuery) return true;
    const rawConfig = parseChannelValue(channel);
    const config = normalizeChannelFormConfig(rawConfig);
    return (
      config.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      channel.key.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });
  const endpointPreview = getChannelEndpointPreview(formData.type, formData.endpoint);
  const endpointPlaceholder = getChannelEndpointPlaceholder(formData.type);

  if (view === "list") {
    return (
      <PageContainer
        title="渠道管理"
        description="配置 AI 服务商接口，管理模型和负载均衡策略"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            </Button>
            <Button size="sm" onClick={handleAdd}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">添加</span>
            </Button>
          </div>
        }
      >
        {data && data.length > 0 && (
          <div className="mb-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索渠道..."
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
              <span className="text-sm text-muted-foreground">加载中...</span>
            </div>
          </div>
        ) : !data || data.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 px-4">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <LinkIcon className="h-7 w-7 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">添加您的第一个渠道</h3>
              <p className="text-muted-foreground text-sm text-center max-w-sm mb-6">
                连接到 AI 服务商（如 OpenAI、Gemini、Azure、Claude），用于代理和转发 API 请求。
              </p>
              <Button onClick={handleAdd} size="lg">
                <Plus className="h-4 w-4 mr-2" />
                添加渠道
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="divide-y">
              {filteredData?.map((channel) => {
                const rawConfig = parseChannelValue(channel);
                const config = normalizeChannelFormConfig(rawConfig);
                const modelCount = (config.models || []).length;
                const enabledModelCount = (config.models || []).filter((model) => model.enabled !== false).length;
                const modelSummary =
                  enabledModelCount === modelCount ? `${modelCount} 个模型` : `${enabledModelCount}/${modelCount} 启用`;
                const isMenuOpen = openMenu === channel.key;
                const isEnabled = config.enabled !== false;
                const isToggling =
                  toggleEnabledMutation.isPending && toggleEnabledMutation.variables?.channel.key === channel.key;

                return (
                  <div key={channel.key} className="p-4 hover:bg-muted/30 transition-colors">
                    <div className="md:hidden space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{config.name}</div>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">{channel.key}</div>
                        </div>
                        <div className="relative">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenu(isMenuOpen ? null : channel.key);
                            }}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                          {isMenuOpen && (
                            <div className="absolute right-0 top-full mt-1 w-32 bg-popover border rounded-lg shadow-lg py-1 z-10">
                              <button
                                className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
                                onClick={() => handleEdit(channel)}
                              >
                                <Pencil className="h-4 w-4" />
                                编辑
                              </button>
                              <button
                                className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 text-destructive"
                                onClick={() => handleDelete(channel.key)}
                              >
                                <Trash2 className="h-4 w-4" />
                                删除
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground text-xs">
                          {getTypeLabel(config.type)}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-500 text-xs">
                          {modelSummary}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 text-xs">
                          {config.weight ?? 0}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
                        <div>
                          <div className="text-sm font-medium">运行状态</div>
                          <div
                            className={cn(
                              "mt-1 text-xs font-medium",
                              isEnabled
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {isEnabled ? "已启用" : "已停用"}
                          </div>
                        </div>
                        <Switch
                          checked={isEnabled}
                          disabled={isToggling}
                          onCheckedChange={(checked) => handleToggleEnabled(channel, checked)}
                          aria-label={`${config.name || channel.key} 渠道启用开关`}
                        />
                      </div>
                    </div>

                    <div className="hidden md:flex md:items-center md:gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{config.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{channel.key}</div>
                      </div>
                      <div className="flex items-center">
                        <span className="px-2 py-1 rounded-md bg-muted text-muted-foreground text-xs font-medium whitespace-nowrap">
                          {getTypeLabel(config.type)}
                        </span>
                      </div>
                      <div className="w-40 text-sm text-muted-foreground truncate font-mono" title={config.endpoint}>
                        {config.endpoint.replace(/^https?:\/\//, "").split("/")[0]}
                      </div>
                      {/* <div className="w-20 text-sm text-center flex-shrink-0">
                        <span className="text-muted-foreground">{} 模型</span>
                      </div> */}
                      <div className="text-xs text-center flex-shrink-0">
                        <span className="text-indigo-500 bg-indigo-500/10 px-3 h-6 rounded-full flex items-center justify-center">
                          {modelSummary}
                        </span>
                      </div>
                      <div className="text-xs text-center flex-shrink-0">
                        <span className="text-amber-600 bg-amber-500/10 w-6 h-6 rounded-full flex items-center justify-center">
                          {config.weight ?? 0}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 flex-shrink-0">
                        <Switch
                          checked={isEnabled}
                          disabled={isToggling}
                          onCheckedChange={(checked) => handleToggleEnabled(channel, checked)}
                          aria-label={`${config.name || channel.key} 渠道启用开关`}
                        />
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button variant="ghost" className="w-8 h-8" size="sm" onClick={() => handleEdit(channel)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-8 h-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(channel.key)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredData?.length === 0 && searchQuery && (
                <div className="p-8 text-center text-muted-foreground">未找到匹配的渠道</div>
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
        <div className="max-w-4xl mx-auto flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">加载渠道中...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 animate-in">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Button variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground" onClick={closeForm}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回列表
          </Button>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight">{editingKey ? "编辑渠道" : "添加渠道"}</h1>
            <Button variant="outline" size="sm" onClick={toggleEditMode}>
              {editMode === "form" ? <FileJson className="h-4 w-4 mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
              {editMode === "form" ? "JSON" : "表单"}
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="p-5">
              <h3 className="font-medium">渠道标识</h3>
              <p className="text-sm text-muted-foreground mb-4">用于内部识别的唯一标识</p>
              <Input
                value={channelKey}
                onChange={(e) => setChannelKey(e.target.value)}
                placeholder="例如：azure-gpt4-east"
                disabled={!!editingKey}
                className="font-mono text-sm"
              />
            </CardContent>
          </Card>

          {editMode === "form" ? (
            <>
              <Card>
                <CardContent className="p-5">
                  <h3 className="font-medium mb-4">基本信息</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm">
                        渠道名称 <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="例如：Azure GPT-4 东部"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm">
                        渠道类型 <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={formData.type}
                        onChange={(e) => setFormData({ ...formData, type: e.target.value as ChannelConfig["type"] })}
                      >
                        {channelTypes.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm">渠道权重</Label>
                      <Select
                        value={String(formData.weight ?? 0)}
                        onChange={(event) =>
                          setFormData({
                            ...formData,
                            weight: normalizeChannelWeight(Number(event.target.value)),
                          })
                        }
                      >
                        {channelWeightOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                      <p className="text-xs text-muted-foreground">相同模型权重优先，相同权重随机分配。</p>
                    </div>
                    <div className="">
                      <Label className="text-sm">渠道状态</Label>
                      <div className="h-10 flex items-center gap-3 mb-2 rounded-md px-3 border border-input hover:border-muted-foreground/30">
                        <span
                          className={cn(
                            "text-sm font-medium",
                            formData.enabled !== false
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-amber-600 dark:text-amber-400",
                          )}
                        >
                          {formData.enabled !== false ? "已启用" : "已停用"}
                        </span>
                        <Switch
                          checked={formData.enabled !== false}
                          onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
                          aria-label="渠道状态开关"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        停用后不会参与请求选路，也不会出现在可用模型列表中。
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-4">
                    <div>
                      <h3 className="font-medium flex items-center gap-2">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                        连接配置
                      </h3>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-sm flex items-center gap-2">
                        API 端点 <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        value={formData.endpoint}
                        onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                        placeholder={endpointPlaceholder}
                      />
                      <p className="text-xs text-muted-foreground">预览：{endpointPreview || formData.type}</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm">
                        API 密钥 <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        value={apiKeysInput}
                        onChange={(e) => {
                          setApiKeysInput(e.target.value);
                          setFormData({ ...formData, api_keys: parseApiKeys(e.target.value) });
                        }}
                        placeholder={"sk-xxx\nsk-yyy"}
                        rows={5}
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground">
                        可配置多个密钥，每行一个，请求会随机选取一个密钥发起调用。
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="flex items-start gap-3 p-4 rounded-lg border bg-muted/30 cursor-pointer">
                        <Checkbox
                          className="mt-0.5"
                          checked={formData.auto_retry ?? true}
                          onCheckedChange={(checked) => setFormData({ ...formData, auto_retry: checked })}
                        />
                        <div>
                          <div className="text-sm font-medium">自动重试</div>
                          <p className="mt-1 text-xs text-muted-foreground">单个密钥遇可重试错误时，自动重试 x3</p>
                        </div>
                      </label>
                      <label className="flex items-start gap-3 p-4 rounded-lg border bg-muted/30 cursor-pointer">
                        <Checkbox
                          className="mt-0.5"
                          checked={formData.auto_rotate ?? true}
                          onCheckedChange={(checked) => setFormData({ ...formData, auto_rotate: checked })}
                        />
                        <div>
                          <div className="text-sm font-medium">自动轮换</div>
                          <p className="mt-1 text-xs text-muted-foreground">单个密钥多次失败后，自动轮换密钥 x3</p>
                        </div>
                      </label>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-4">
                    <div>
                      <h3 className="font-medium flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-muted-foreground" />
                        模型配置
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        外部使用模型名称调用，程序会自动映射到渠道模型 ID。
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant={modelEditorMode === "visual" ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setModelEditorModeWithSync("visual")}
                      >
                        可视化
                      </Button>
                      <Button
                        type="button"
                        variant={modelEditorMode === "json" ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setModelEditorModeWithSync("json")}
                      >
                        JSON
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleFetchModels}
                        disabled={fetchModelsMutation.isPending}
                      >
                        <RefreshCw className={cn("h-4 w-4", fetchModelsMutation.isPending && "animate-spin")} />
                        获取模型列表
                      </Button>
                    </div>
                  </div>

                  {modelEditorMode === "visual" ? (
                    <div className="space-y-2">
                      <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px] md:gap-2 text-xs font-medium text-muted-foreground">
                        <div>模型 ID</div>
                        <div>模型名称</div>
                        <div className="text-center">状态 / 删除</div>
                      </div>
                      {modelRows.map((row, index) => {
                        const canDelete = !isEmptyModelRow(row);

                        return (
                          <div
                            key={index}
                            className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px] gap-2"
                          >
                            <Input
                              value={row.id}
                              onChange={(e) => updateModelRow(index, "id", e.target.value)}
                              placeholder="模型ID，例如：gpt-4.1-mini"
                              className="text-sm"
                            />
                            <Input
                              value={row.name}
                              onChange={(e) => updateModelRow(index, "name", e.target.value)}
                              placeholder="模型名称，默认等于模型ID"
                              className="text-sm"
                            />
                            <div className="flex h-10 items-center justify-center gap-2">
                              <Switch
                                checked={row.enabled !== false}
                                onCheckedChange={(checked) => {
                                  const nextRows = [...modelRows];
                                  nextRows[index] = { ...row, enabled: checked };
                                  updateModelRowsState(nextRows);
                                }}
                                disabled={!canDelete}
                                aria-label={`模型 ${row.name || row.id || index} 启用开关`}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive justify-self-start md:justify-self-center"
                                onClick={() => removeModelRow(index)}
                                disabled={!canDelete}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Textarea
                        value={modelJsonValue}
                        onChange={(e) => setModelJsonValue(e.target.value)}
                        rows={12}
                        className="font-mono text-sm"
                        placeholder='[{"id":"gpt-4.1-mini","name":"gpt-4.1-mini","enabled":true}]'
                      />
                      <p className="text-xs text-muted-foreground">
                        JSON 结构为数组，每项包含 `id`、`name`、`enabled`。
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="p-5">
                <h3 className="font-medium mb-4">JSON 配置</h3>
                <Textarea
                  value={jsonValue}
                  onChange={(e) => setJsonValue(e.target.value)}
                  rows={18}
                  className="font-mono text-sm"
                  placeholder='{"name":"Azure OpenAI","type":"azure-openai","endpoint":"https://example.openai.azure.com/","enabled":true,"weight":0,"api_keys":["sk-1","sk-2"],"auto_retry":true,"auto_rotate":true,"models":[{"id":"gpt-4.1-mini","name":"gpt-4.1-mini","enabled":true}]}'
                />
              </CardContent>
            </Card>
          )}

          <Dialog open={isFetchedModelsDialogOpen} onOpenChange={setIsFetchedModelsDialogOpen}>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>选择要写入的模型</DialogTitle>
                <DialogDescription>
                  先从上游模型列表中批量勾选，再写入当前渠道配置。已存在且 ID 相同的模型会保留原有别名和启用状态。
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={fetchedModelsSearchQuery}
                      onChange={(event) => setFetchedModelsSearchQuery(event.target.value)}
                      placeholder="搜索模型 ID 或展示名称"
                      className="pl-9"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      已选 {selectedFetchedModelIds.length} / {fetchedModelCandidates.length}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setSelectedFetchedModelIds(fetchedModelCandidates.map((candidate) => candidate.id))
                      }
                    >
                      全选
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setSelectedFetchedModelIds([])}>
                      清空
                    </Button>
                  </div>
                </div>

                <div className="max-h-[55vh] overflow-y-auto rounded-lg border">
                  {filteredFetchedModelCandidates.length > 0 ? (
                    <div className="divide-y">
                      {filteredFetchedModelCandidates.map((candidate) => {
                        const checked = selectedFetchedModelIds.includes(candidate.id);

                        return (
                          <label
                            key={candidate.id}
                            className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
                          >
                            <Checkbox
                              className="mt-0.5"
                              checked={checked}
                              onCheckedChange={(nextChecked) => toggleFetchedModelSelection(candidate.id, nextChecked)}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-sm text-foreground break-all">{candidate.id}</div>
                              {candidate.label !== candidate.id && (
                                <div className="mt-1 text-xs text-muted-foreground break-all">{candidate.label}</div>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-4 py-12 text-center text-sm text-muted-foreground">没有匹配的模型</div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-3">
                  <Button type="button" variant="outline" onClick={() => setIsFetchedModelsDialogOpen(false)}>
                    取消
                  </Button>
                  <Button type="button" onClick={handleApplyFetchedModels}>
                    写入所选模型
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="outline" onClick={closeForm}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  保存渠道
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
