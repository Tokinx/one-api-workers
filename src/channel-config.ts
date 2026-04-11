export const DEFAULT_CHANNEL_AUTO_RETRY = true;
export const DEFAULT_CHANNEL_AUTO_ROTATE = true;
export const DEFAULT_CHANNEL_ENABLED = true;
export const DEFAULT_CHANNEL_WEIGHT = 0;
export const MAX_CHANNEL_WEIGHT = 5;
export const DEFAULT_CLAUDE_API_VERSION = "2023-06-01";
export const MAX_RETRIES_PER_KEY = 3;
export const MAX_ROTATION_ATTEMPTS = 3;

export type NormalizedChannelConfig = Omit<ChannelConfig, "enabled" | "weight" | "api_keys" | "auto_retry" | "auto_rotate" | "models" | "supported_models" | "deployment_mapper"> & {
    enabled: boolean;
    weight: number;
    api_keys: string[];
    auto_retry: boolean;
    auto_rotate: boolean;
    models: ChannelModelMapping[];
    supported_models: string[];
    deployment_mapper: Record<string, string>;
};

const normalizeChannelWeight = (weight: unknown): number => {
    if (typeof weight !== "number" || !Number.isFinite(weight)) {
        return DEFAULT_CHANNEL_WEIGHT;
    }

    const normalizedWeight = Math.trunc(weight);
    return Math.min(MAX_CHANNEL_WEIGHT, Math.max(DEFAULT_CHANNEL_WEIGHT, normalizedWeight));
};

const normalizeApiKeys = (config: Partial<ChannelConfig>): string[] => {
    const rawKeys = Array.isArray(config.api_keys)
        ? [...config.api_keys]
        : [];

    if (typeof config.api_key === "string") {
        rawKeys.unshift(config.api_key);
    }

    const normalizedKeys: string[] = [];
    const seen = new Set<string>();

    for (const key of rawKeys) {
        const trimmedKey = typeof key === "string" ? key.trim() : "";
        if (!trimmedKey || seen.has(trimmedKey)) {
            continue;
        }
        seen.add(trimmedKey);
        normalizedKeys.push(trimmedKey);
    }

    return normalizedKeys;
};

const normalizeLegacyModels = (config: Partial<ChannelConfig>): ChannelModelMapping[] => {
    const normalizedModels: ChannelModelMapping[] = [];
    const seenNames = new Set<string>();

    const pushModel = (modelId: string, modelName?: string) => {
        const id = modelId.trim();
        const name = (modelName || modelId).trim();

        if (!id || !name || seenNames.has(name)) {
            return;
        }

        seenNames.add(name);
        normalizedModels.push({ id, name });
    };

    if (Array.isArray(config.models)) {
        for (const model of config.models) {
            if (!model || typeof model !== "object") {
                continue;
            }

            const id = typeof model.id === "string" ? model.id : "";
            const name = typeof model.name === "string" ? model.name : id;
            pushModel(id, name);
        }
    }

    const deploymentMapper = config.deployment_mapper || {};
    const supportedModels = Array.isArray(config.supported_models)
        ? config.supported_models
        : [];

    for (const supportedModel of supportedModels) {
        if (typeof supportedModel !== "string") {
            continue;
        }

        pushModel(
            typeof deploymentMapper[supportedModel] === "string"
                ? deploymentMapper[supportedModel]
                : supportedModel,
            supportedModel,
        );
    }

    for (const [modelName, modelId] of Object.entries(deploymentMapper)) {
        if (typeof modelId !== "string") {
            continue;
        }
        pushModel(modelId, modelName);
    }

    return normalizedModels;
};

export const normalizeChannelConfig = (
    config: Partial<ChannelConfig>
): NormalizedChannelConfig => {
    const models = normalizeLegacyModels(config);
    const deploymentMapper = Object.fromEntries(
        models.map((model) => [model.name, model.id])
    );

    return {
        name: config.name || "",
        type: config.type,
        endpoint: config.endpoint || "",
        enabled: config.enabled ?? DEFAULT_CHANNEL_ENABLED,
        weight: normalizeChannelWeight(config.weight),
        api_key: typeof config.api_key === "string" ? config.api_key.trim() : undefined,
        api_keys: normalizeApiKeys(config),
        auto_retry: config.auto_retry ?? DEFAULT_CHANNEL_AUTO_RETRY,
        auto_rotate: config.auto_rotate ?? DEFAULT_CHANNEL_AUTO_ROTATE,
        models,
        supported_models: models.map((model) => model.name),
        deployment_mapper: deploymentMapper,
        model_pricing: config.model_pricing,
    };
};

export const sanitizeChannelConfig = (
    config: Partial<ChannelConfig>
): ChannelConfig => {
    const normalized = normalizeChannelConfig(config);

    return {
        name: normalized.name,
        type: normalized.type,
        endpoint: normalized.endpoint,
        enabled: normalized.enabled,
        weight: normalized.weight,
        api_keys: normalized.api_keys,
        auto_retry: normalized.auto_retry,
        auto_rotate: normalized.auto_rotate,
        models: normalized.models,
        model_pricing: normalized.model_pricing,
    };
};
