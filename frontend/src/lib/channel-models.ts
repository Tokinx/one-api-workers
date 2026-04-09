import { Channel, ChannelConfig, ChannelModelMapping, Token, TokenConfig } from '@/types'

const normalizeModels = (models?: ChannelModelMapping[]): ChannelModelMapping[] => {
  if (!Array.isArray(models)) {
    return []
  }

  return models
    .map((model) => ({
      id: typeof model?.id === 'string' ? model.id.trim() : '',
      name: typeof model?.name === 'string' ? model.name.trim() : '',
    }))
    .filter((model) => model.id.length > 0)
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
    }))
}

export const parseChannelConfig = (channel: Channel): ChannelConfig => {
  if (typeof channel.value !== 'string') {
    return channel.value
  }

  try {
    return JSON.parse(channel.value) as ChannelConfig
  } catch {
    return {} as ChannelConfig
  }
}

export const parseTokenConfig = (token: Token): TokenConfig => {
  if (typeof token.value !== 'string') {
    return token.value
  }

  try {
    return JSON.parse(token.value) as TokenConfig
  } catch {
    return {} as TokenConfig
  }
}

export const getChannelModels = (config: ChannelConfig): ChannelModelMapping[] => {
  const normalizedModels = normalizeModels(config.models)
  if (normalizedModels.length > 0) {
    return normalizedModels
  }

  const deploymentMapper = config.deployment_mapper || {}
  const supportedModels = Array.isArray(config.supported_models) ? config.supported_models : []
  const models: ChannelModelMapping[] = []
  const seenNames = new Set<string>()

  const pushModel = (id: string, name?: string) => {
    const normalizedId = id.trim()
    const normalizedName = (name || id).trim()

    if (!normalizedId || !normalizedName || seenNames.has(normalizedName)) {
      return
    }

    seenNames.add(normalizedName)
    models.push({
      id: normalizedId,
      name: normalizedName,
    })
  }

  supportedModels.forEach((modelName) => {
    const normalizedName = typeof modelName === 'string' ? modelName.trim() : ''
    if (!normalizedName) {
      return
    }

    pushModel(deploymentMapper[normalizedName] || normalizedName, normalizedName)
  })

  Object.entries(deploymentMapper).forEach(([modelName, modelId]) => {
    if (typeof modelId !== 'string') {
      return
    }

    pushModel(modelId, modelName)
  })

  return models
}

export const getUniqueModelNamesFromChannels = (channels: Channel[]): string[] => {
  const modelNames = new Set<string>()

  channels.forEach((channel) => {
    const config = parseChannelConfig(channel)
    getChannelModels(config).forEach((model) => modelNames.add(model.name))
  })

  return Array.from(modelNames).sort()
}

export const getModelNamesForToken = (tokenKey: string, tokens: Token[], channels: Channel[]): string[] => {
  const matchedToken = tokens.find((token) => token.key === tokenKey)

  if (!matchedToken) {
    return getUniqueModelNamesFromChannels(channels)
  }

  const tokenConfig = parseTokenConfig(matchedToken)
  const allowedChannelKeys = tokenConfig.channel_keys || []
  const targetChannels = allowedChannelKeys.length === 0
    ? channels
    : channels.filter((channel) => allowedChannelKeys.includes(channel.key))

  return getUniqueModelNamesFromChannels(targetChannels)
}
