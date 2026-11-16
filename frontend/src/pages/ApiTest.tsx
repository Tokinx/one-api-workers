import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import { apiClient } from '@/api/client'
import { Channel, Token } from '@/types'
import { AutoCompleteInput, type AutoCompleteOption } from '@/components/ui/autocomplete'
import {
  Bot,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Edit3,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { PageContainer } from '@/components/ui/page-container'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, copyToClipboard } from '@/lib/utils'
import {
  channelSupportsModel,
  getChannelModels,
  getChannelsForToken,
  getModelNamesForChannels,
  parseChannelConfig,
  parseTokenConfig,
} from '@/lib/channel-models'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from 'react-i18next'

type RequestBodyShape = Record<string, unknown>
type ChatEndpoint = '/v1/chat/completions' | '/v1/messages'
type MessageRole = 'user' | 'assistant'
type MessageStatus = 'idle' | 'streaming' | 'success' | 'error'

type PlaygroundMessage = {
  id: string
  role: MessageRole
  content: string
  createdAt: number
  updatedAt?: number
  status: MessageStatus
  error?: string
  model?: string
  channelKey?: string
  rawResponse?: unknown
  rawResponseText?: string
}

type SendConversationOptions = {
  baseMessages?: PlaygroundMessage[]
  userMessage?: PlaygroundMessage
}

const chatEndpoints: ChatEndpoint[] = ['/v1/chat/completions', '/v1/messages']

const playgroundParamKeys = [
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'stream',
  'max_tokens',
  'seed',
] as const

type PlaygroundParamKey = typeof playgroundParamKeys[number]
type PlaygroundParams = Partial<Record<PlaygroundParamKey, number | boolean>>

type ParamDefinition = {
  key: PlaygroundParamKey
  type: 'number' | 'boolean'
  min?: number
  max?: number
  step?: number
  translationKey: string
}

const paramDefinitions: ParamDefinition[] = [
  { key: 'temperature', type: 'number', min: 0, max: 2, step: 0.1, translationKey: 'apiTest.temperature' },
  { key: 'top_p', type: 'number', min: 0, max: 1, step: 0.1, translationKey: 'apiTest.topP' },
  { key: 'frequency_penalty', type: 'number', min: -2, max: 2, step: 0.1, translationKey: 'apiTest.frequencyPenalty' },
  { key: 'presence_penalty', type: 'number', min: -2, max: 2, step: 0.1, translationKey: 'apiTest.presencePenalty' },
  { key: 'stream', type: 'boolean', translationKey: 'apiTest.stream' },
  { key: 'max_tokens', type: 'number', min: 1, step: 1, translationKey: 'apiTest.maxTokens' },
  { key: 'seed', type: 'number', step: 1, translationKey: 'apiTest.seed' },
]

const endpointParamKeys: Record<ChatEndpoint, PlaygroundParamKey[]> = {
  '/v1/chat/completions': [...playgroundParamKeys],
  '/v1/messages': ['temperature', 'top_p', 'stream', 'max_tokens'],
}

const initialParams: PlaygroundParams = {
  temperature: 0.7,
  stream: true,
  max_tokens: 1024,
}

const createMessageId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const extractParamsFromBody = (body: RequestBodyShape | null | undefined): PlaygroundParams => {
  const params: PlaygroundParams = {}

  for (const key of playgroundParamKeys) {
    const value = body?.[key]
    if (typeof value === 'number' || typeof value === 'boolean') {
      params[key] = value
    }
  }

  return params
}

const buildAdvancedBody = (params: PlaygroundParams) => {
  const body: RequestBodyShape = {}
  for (const key of playgroundParamKeys) {
    const value = params[key]
    if (value !== undefined) {
      body[key] = value
    }
  }
  return JSON.stringify(body, null, 2)
}

const stringifyRawResponse = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value, null, 2)
}

const parseAssistantContent = (endpoint: ChatEndpoint, result: unknown): string => {
  if (!result || typeof result !== 'object') {
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
  }

  const payload = result as Record<string, unknown>
  if (endpoint === '/v1/messages') {
    const blocks = Array.isArray(payload.content) ? payload.content : []
    const text = blocks
      .map((block) => {
        if (typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string') {
          return block.text
        }
        return ''
      })
      .filter(Boolean)
      .join('')
    return text || JSON.stringify(result, null, 2)
  }

  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined
  if (typeof choice === 'object' && choice !== null) {
    if ('message' in choice && typeof choice.message === 'object' && choice.message !== null && 'content' in choice.message && typeof choice.message.content === 'string') {
      return choice.message.content
    }
    if ('text' in choice && typeof choice.text === 'string') {
      return choice.text
    }
  }

  return JSON.stringify(result, null, 2)
}

type IconActionButtonProps = Omit<ButtonProps, 'size' | 'aria-label'> & {
  label: string
  tooltip?: string
}

/** Compact icon-only button paired with a tooltip and accessible label. */
function IconActionButton({
  label,
  tooltip,
  className,
  type = 'button',
  variant = 'ghost',
  children,
  ...props
}: IconActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type={type}
          variant={variant}
          size="icon"
          aria-label={label}
          className={cn('h-7 w-7 [&_svg]:size-3.5 focus-visible:ring-2 focus-visible:ring-primary/30', className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip || label}</TooltipContent>
    </Tooltip>
  )
}

export function ApiTest() {
  const { t } = useTranslation()
  const { addToast } = useToast()
  const abortControllerRef = useRef<AbortController | null>(null)
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const copyTimerRef = useRef<number | null>(null)
  const lastCopyAnnouncementRef = useRef('')

  const baseId = useId()
  const tokenInputId = `${baseId}-token`
  const modelInputId = `${baseId}-model`
  const channelInputId = `${baseId}-channel`
  const endpointSelectId = `${baseId}-endpoint`
  const streamSwitchId = `${baseId}-stream`

  const [endpoint, setEndpoint] = useState<ChatEndpoint>('/v1/chat/completions')
  const [apiToken, setApiToken] = useState('')
  const [modelValue, setModelValue] = useState('')
  const [channelKey, setChannelKey] = useState('')
  const [playgroundParams, setPlaygroundParams] = useState<PlaygroundParams>(initialParams)
  const [requestBody, setRequestBody] = useState(buildAdvancedBody(initialParams))
  const [requestBodyOpen, setRequestBodyOpen] = useState(false)
  const [messages, setMessages] = useState<PlaygroundMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [rawResponseMessage, setRawResponseMessage] = useState<PlaygroundMessage | null>(null)
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null)
  const [copyAnnouncement, setCopyAnnouncement] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [responseTime, setResponseTime] = useState<number>(0)
  const [statusCode, setStatusCode] = useState<number | null>(null)
  const [tokens, setTokens] = useState<Token[]>([])
  const [channels, setChannels] = useState<Channel[]>([])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [tokenResponse, channelResponse] = await Promise.all([
          apiClient.getTokens(),
          apiClient.getChannels(),
        ])

        setTokens((tokenResponse.data as Token[]) || [])
        setChannels((channelResponse.data as Channel[]) || [])
      } catch (error) {
        console.error('Failed to load playground options:', error)
      }
    }

    loadOptions()
  }, [])

  useEffect(() => {
    messageListRef.current?.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages])

  const tokenChannels = useMemo(
    () => apiToken ? getChannelsForToken(apiToken, tokens, channels).filter((channel) => parseChannelConfig(channel).enabled !== false) : [],
    [apiToken, tokens, channels]
  )

  const selectedChannel = useMemo(
    () => tokenChannels.find((channel) => channel.key === channelKey),
    [channelKey, tokenChannels]
  )

  const availableModelNames = useMemo(() => {
    if (!apiToken) {
      return []
    }
    if (selectedChannel) {
      const config = parseChannelConfig(selectedChannel)
      return getChannelModels(config)
        .filter((model) => model.enabled !== false)
        .map((model) => model.name)
        .sort()
    }
    return getModelNamesForChannels(tokenChannels)
  }, [apiToken, selectedChannel, tokenChannels])

  const availableChannels = useMemo(
    () => tokenChannels.filter((channel) => channelSupportsModel(channel, modelValue)),
    [modelValue, tokenChannels]
  )

  const enabledParamKeys = useMemo(() => endpointParamKeys[endpoint], [endpoint])
  const visibleParamDefinitions = useMemo(
    () => paramDefinitions.filter((param) => enabledParamKeys.includes(param.key)),
    [enabledParamKeys]
  )

  const tokenOptions: AutoCompleteOption[] = tokens.map((token) => {
    const tokenConfig = parseTokenConfig(token)

    return {
      value: token.key,
      label: tokenConfig.name || token.key,
      description: token.key,
      keywords: [token.key, tokenConfig.name || ''],
    }
  })

  const modelOptions: AutoCompleteOption[] = availableModelNames.map((model) => ({ value: model }))

  const channelOptions: AutoCompleteOption[] = availableChannels.map((channel) => {
    const config = parseChannelConfig(channel)
    return {
      value: channel.key,
      label: config.name || channel.key,
      description: channel.key,
      keywords: [channel.key, config.name || '', config.type || ''],
    }
  })

  const handleTokenChange = (nextToken: string) => {
    setApiToken(nextToken)
    setModelValue('')
    setChannelKey('')
  }

  const handleModelChange = (nextModel: string) => {
    setModelValue(nextModel)
    if (channelKey) {
      const channel = tokenChannels.find((item) => item.key === channelKey)
      if (channel && !channelSupportsModel(channel, nextModel)) {
        setChannelKey('')
      }
    }
  }

  const handleChannelChange = (nextChannelKey: string) => {
    setChannelKey(nextChannelKey)
    if (!nextChannelKey || !modelValue) {
      return
    }

    const channel = tokenChannels.find((item) => item.key === nextChannelKey)
    if (channel && !channelSupportsModel(channel, modelValue)) {
      setModelValue('')
    }
  }

  const syncParamsFromRequestBody = (jsonText: string): RequestBodyShape => {
    const parsedBody = JSON.parse(jsonText) as RequestBodyShape
    setPlaygroundParams((current) => ({
      ...current,
      ...extractParamsFromBody(parsedBody),
    }))
    return parsedBody
  }

  const applyParamToRequestBody = (key: PlaygroundParamKey, value: number | boolean | undefined) => {
    setPlaygroundParams((current) => ({
      ...current,
      [key]: value,
    }))

    try {
      const parsedBody = JSON.parse(requestBody) as RequestBodyShape
      if (value === undefined) {
        delete parsedBody[key]
      } else {
        parsedBody[key] = value
      }
      setRequestBody(JSON.stringify(parsedBody, null, 2))
    } catch {
      // Keep parameter state while the user fixes advanced JSON.
    }
  }

  const handleNumberParamChange = (key: PlaygroundParamKey, value: string) => {
    if (value === '') {
      applyParamToRequestBody(key, undefined)
      return
    }

    const numericValue = Number(value)
    if (!Number.isNaN(numericValue)) {
      applyParamToRequestBody(key, numericValue)
    }
  }

  const handleRequestBodyChange = (value: string) => {
    setRequestBody(value)
    try {
      syncParamsFromRequestBody(value)
    } catch {
      // Advanced JSON can be temporarily invalid while typing.
    }
  }

  const normalizeAdvancedBody = (): RequestBodyShape => {
    const parsedBody = requestBody.trim() ? JSON.parse(requestBody) as RequestBodyShape : {}
    delete parsedBody.model
    delete parsedBody.messages
    delete parsedBody.stream

    for (const key of playgroundParamKeys) {
      if (parsedBody[key] === undefined || parsedBody[key] === '') {
        delete parsedBody[key]
      }
    }

    return parsedBody
  }

  const buildRequestPayload = (conversationMessages: PlaygroundMessage[]) => {
    const advancedBody = normalizeAdvancedBody()
    const cleanMessages = conversationMessages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .filter((message) => message.status !== 'error')
      .filter((message) => message.content.trim().length > 0)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }))

    return {
      ...advancedBody,
      model: modelValue,
      stream: playgroundParams.stream === true,
      messages: cleanMessages,
    }
  }

  const extractStreamingTextFromData = (data: string) => {
    if (!data || data === '[DONE]') {
      return ''
    }

    try {
      const payload = JSON.parse(data) as Record<string, unknown>
      if (endpoint === '/v1/messages') {
        const delta = payload.delta
        if (typeof delta === 'object' && delta !== null && 'text' in delta && typeof delta.text === 'string') {
          return delta.text
        }
        return ''
      }

      const choices = payload.choices
      const choice = Array.isArray(choices) ? choices[0] : undefined
      if (typeof choice === 'object' && choice !== null && 'delta' in choice && typeof choice.delta === 'object' && choice.delta !== null && 'content' in choice.delta && typeof choice.delta.content === 'string') {
        return choice.delta.content
      }
    } catch {
      return ''
    }

    return ''
  }

  const extractStreamingText = (chunk: string, lineBuffer: string) => {
    let text = ''
    const combined = `${lineBuffer}${chunk}`
    const lines = combined.split(/\r?\n/)
    const nextLineBuffer = combined.endsWith('\n') || combined.endsWith('\r') ? '' : lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) {
        continue
      }

      text += extractStreamingTextFromData(trimmed.slice(5).trim())
    }

    return { text, lineBuffer: nextLineBuffer }
  }

  const updateMessage = (messageId: string, updater: (message: PlaygroundMessage) => PlaygroundMessage) => {
    setMessages((current) => current.map((message) => message.id === messageId ? updater(message) : message))
  }

  const sendConversation = async ({ baseMessages = messages, userMessage }: SendConversationOptions = {}) => {
    if (!apiToken) {
      addToast(t('apiTest.tokenRequired'), 'error')
      return
    }
    if (!modelValue) {
      addToast(t('apiTest.modelRequired'), 'error')
      return
    }

    const nextUserMessage = userMessage || {
      id: createMessageId(),
      role: 'user' as const,
      content: inputValue.trim(),
      createdAt: Date.now(),
      status: 'success' as const,
      model: modelValue,
      channelKey: channelKey || undefined,
    }

    if (!nextUserMessage.content.trim()) {
      return
    }

    let conversationMessages = [...baseMessages, nextUserMessage]
    const assistantMessage: PlaygroundMessage = {
      id: createMessageId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      status: playgroundParams.stream === true ? 'streaming' : 'idle',
      model: modelValue,
      channelKey: channelKey || undefined,
    }
    conversationMessages = [...conversationMessages, assistantMessage]

    let body: RequestBodyShape
    try {
      body = buildRequestPayload(conversationMessages.filter((message) => message.id !== assistantMessage.id))
    } catch {
      addToast(t('apiTest.bodyJsonError'), 'error')
      return
    }

    setInputValue('')
    setMessages(conversationMessages)
    setIsLoading(true)
    setStatusCode(null)

    const startTime = Date.now()
    const isStreaming = body.stream === true

    try {
      if (isStreaming) {
        const controller = new AbortController()
        abortControllerRef.current = controller
        let rawResponseText = ''
        let streamLineBuffer = ''
        const result = await apiClient.testApiStream(endpoint, apiToken, body, {
          channelKey: channelKey || undefined,
          signal: controller.signal,
          onChunk: (chunk) => {
            rawResponseText += chunk
            const parsed = extractStreamingText(chunk, streamLineBuffer)
            streamLineBuffer = parsed.lineBuffer
            if (!parsed.text) {
              updateMessage(assistantMessage.id, (message) => ({
                ...message,
                rawResponseText,
                status: 'streaming',
              }))
              return
            }
            updateMessage(assistantMessage.id, (message) => ({
              ...message,
              content: `${message.content}${parsed.text}`,
              rawResponseText,
              status: 'streaming',
            }))
          },
        })
        setStatusCode(result.status)
        updateMessage(assistantMessage.id, (message) => ({
          ...message,
          content: message.content || t('apiTest.emptyReadableResponse'),
          rawResponseText,
          status: 'success',
        }))
        return
      }

      updateMessage(assistantMessage.id, (message) => ({ ...message, status: 'idle' }))
      const result = await apiClient.testApi(endpoint, apiToken, body, { channelKey: channelKey || undefined })
      setStatusCode(200)
      updateMessage(assistantMessage.id, (message) => ({
        ...message,
        content: parseAssistantContent(endpoint, result),
        rawResponse: result,
        status: 'success',
      }))
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        updateMessage(assistantMessage.id, (message) => ({ ...message, status: 'error', error: t('apiTest.generationStopped') }))
        return
      }

      const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 500
      const message = error instanceof Error ? error.message : String(error)
      setStatusCode(status)
      updateMessage(assistantMessage.id, (current) => ({
        ...current,
        content: message,
        rawResponse: { error: message, status },
        status: 'error',
        error: message,
      }))
    } finally {
      setResponseTime(Date.now() - startTime)
      abortControllerRef.current = null
      setIsLoading(false)
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    void sendConversation()
  }

  const handleStopStreaming = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsLoading(false)
    addToast(t('apiTest.generationStopped'), 'success')
  }

  const startEditingMessage = (message: PlaygroundMessage) => {
    setEditingMessageId(message.id)
    setEditingContent(message.content)
  }

  const saveEditedMessage = () => {
    if (!editingMessageId) {
      return
    }

    setMessages((current) => {
      const index = current.findIndex((message) => message.id === editingMessageId)
      if (index === -1) {
        return current
      }

      const editedMessage = {
        ...current[index],
        content: editingContent,
        updatedAt: Date.now(),
      }

      return [...current.slice(0, index), editedMessage]
    })
    setEditingMessageId(null)
    setEditingContent('')
  }

  const retryFromMessage = (messageId: string) => {
    const index = messages.findIndex((message) => message.id === messageId)
    if (index === -1) {
      return
    }

    const target = messages[index]
    const userIndex = target.role === 'user'
      ? index
      : [...messages.slice(0, index)].map((message) => message.role).lastIndexOf('user')

    if (userIndex < 0) {
      return
    }

    const baseMessages = messages.slice(0, userIndex)
    const userMessage = {
      ...messages[userIndex],
      id: createMessageId(),
      createdAt: Date.now(),
      model: modelValue,
      channelKey: channelKey || undefined,
      status: 'success' as const,
    }

    void sendConversation({ baseMessages, userMessage })
  }

  const copyWithFeedback = async (targetId: string, text: string) => {
    if (!text) {
      return
    }

    try {
      await copyToClipboard(text)
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
      setCopiedTarget(targetId)
      const baseAnnouncement = t('apiTest.copied')
      const nextAnnouncement = lastCopyAnnouncementRef.current === baseAnnouncement
        ? `${baseAnnouncement}\u00A0`
        : baseAnnouncement
      lastCopyAnnouncementRef.current = nextAnnouncement
      setCopyAnnouncement(nextAnnouncement)
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedTarget(null)
        setCopyAnnouncement('')
      }, 1800)
      addToast(t('common.copiedToClipboard'), 'success')
    } catch {
      addToast(t('common.copyFailed'), 'error')
    }
  }

  const handleResetParams = () => {
    setPlaygroundParams(initialParams)
    setRequestBody(buildAdvancedBody(initialParams))
  }

  const handleClearConversation = () => {
    if (isLoading) {
      return
    }
    setMessages([])
    setEditingMessageId(null)
    setEditingContent('')
    setRawResponseMessage(null)
    setStatusCode(null)
    setResponseTime(0)
  }

  const handleCopyMessages = () => {
    void copyWithFeedback('conversation', JSON.stringify(messages, null, 2))
  }

  const rawResponseContent = rawResponseMessage
    ? rawResponseMessage.rawResponseText || stringifyRawResponse(rawResponseMessage.rawResponse)
    : ''

  const handleCopyRawResponse = () => {
    void copyWithFeedback('raw-response', rawResponseContent)
  }

  const streamParam = visibleParamDefinitions.find((param) => param.type === 'boolean')
  const numericParams = visibleParamDefinitions.filter((param) => param.type === 'number')

  return (
    <PageContainer
      title={t('apiTest.title')}
      description={t('apiTest.description')}
    >
      <TooltipProvider delayDuration={150}>
        <span className="sr-only" role="status" aria-live="polite">
          {copyAnnouncement}
        </span>

        <Dialog open={!!rawResponseMessage} onOpenChange={(open) => !open && setRawResponseMessage(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{t('apiTest.rawResponse')}</DialogTitle>
            </DialogHeader>
            <div className="relative">
              <IconActionButton
                label={t('common.copy')}
                tooltip={copiedTarget === 'raw-response' ? t('apiTest.copied') : t('common.copy')}
                variant="outline"
                className="absolute right-2.5 top-2.5 z-10 bg-card/90 backdrop-blur-sm"
                onClick={handleCopyRawResponse}
              >
                {copiedTarget === 'raw-response' ? (
                  <Check aria-hidden="true" className="text-emerald-500" />
                ) : (
                  <Copy aria-hidden="true" />
                )}
              </IconActionButton>
              <pre className="max-h-[70vh] overflow-auto rounded-lg bg-muted/50 p-4 pr-12 text-xs font-mono whitespace-pre-wrap break-words scrollbar-thin">
                {rawResponseContent}
              </pre>
            </div>
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)] items-start">
          <Card>
            <CardContent className="p-4 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold text-foreground">{t('apiTest.playgroundParams')}</h2>
                <IconActionButton
                  label={t('apiTest.resetParams')}
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={handleResetParams}
                  disabled={isLoading}
                >
                  <RotateCcw aria-hidden="true" />
                </IconActionButton>
              </div>

              <div className="space-y-2.5">
                <div className="space-y-1">
                  <Label htmlFor={tokenInputId} className="text-xs font-medium text-muted-foreground">
                    {t('apiTest.apiToken')}
                  </Label>
                  <AutoCompleteInput
                    id={tokenInputId}
                    value={apiToken}
                    onChange={handleTokenChange}
                    placeholder="sk-..."
                    inputClassName="h-9 font-mono text-xs"
                    options={tokenOptions}
                    emptyText={t('apiTest.noMatchingTokens')}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor={modelInputId} className="text-xs font-medium text-muted-foreground">
                    {t('apiTest.model')}
                  </Label>
                  <AutoCompleteInput
                    id={modelInputId}
                    value={modelValue}
                    onChange={handleModelChange}
                    placeholder={apiToken ? t('apiTest.modelPlaceholder') : t('apiTest.selectTokenFirst')}
                    inputClassName="h-9 font-mono text-xs"
                    options={modelOptions}
                    maxOptions={availableModelNames.length}
                    emptyText={apiToken ? t('apiTest.noMatchingModels') : t('apiTest.selectTokenFirst')}
                    disabled={!apiToken}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor={channelInputId} className="text-xs font-medium text-muted-foreground">
                    {t('apiTest.channel')}
                  </Label>
                  <AutoCompleteInput
                    id={channelInputId}
                    value={channelKey}
                    onChange={handleChannelChange}
                    placeholder={apiToken ? t('apiTest.autoChannel') : t('apiTest.selectTokenFirst')}
                    inputClassName="h-9 font-mono text-xs"
                    options={channelOptions}
                    maxOptions={availableChannels.length}
                    emptyText={apiToken ? t('apiTest.noMatchingChannels') : t('apiTest.selectTokenFirst')}
                    disabled={!apiToken}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor={endpointSelectId} className="text-xs font-medium text-muted-foreground">
                    {t('apiTest.endpoint')}
                  </Label>
                  <Select
                    id={endpointSelectId}
                    value={endpoint}
                    className="h-9 font-mono text-xs"
                    onChange={(event) => setEndpoint(event.target.value as ChatEndpoint)}
                  >
                    {chatEndpoints.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="space-y-2.5 border-t pt-3">
                {streamParam && (
                  <div className="flex items-center justify-between py-0.5">
                    <Label htmlFor={streamSwitchId} className="text-xs font-medium text-muted-foreground">
                      {t(streamParam.translationKey)}
                    </Label>
                    <Switch
                      id={streamSwitchId}
                      checked={playgroundParams[streamParam.key] === true}
                      onCheckedChange={(checked) => applyParamToRequestBody(streamParam.key, checked)}
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {numericParams.map((param) => {
                    const paramId = `${baseId}-${param.key}`
                    return (
                      <div key={param.key} className="space-y-1">
                        <Label htmlFor={paramId} className="text-[11px] text-muted-foreground">
                          {t(param.translationKey)}
                        </Label>
                        <Input
                          id={paramId}
                          type="number"
                          min={param.min}
                          max={param.max}
                          step={param.step}
                          value={typeof playgroundParams[param.key] === 'number' ? String(playgroundParams[param.key]) : ''}
                          onChange={(event) => handleNumberParamChange(param.key, event.target.value)}
                          className="h-8 px-2.5 text-xs font-mono"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    aria-expanded={requestBodyOpen}
                    className="flex flex-1 items-center gap-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setRequestBodyOpen((open) => !open)}
                  >
                    {requestBodyOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span>{t('apiTest.requestBody')}</span>
                  </button>
                  <IconActionButton
                    label={t('apiTest.copyRequestBody')}
                    tooltip={copiedTarget === 'request-body' ? t('apiTest.copied') : t('apiTest.copyRequestBody')}
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => void copyWithFeedback('request-body', requestBody)}
                  >
                    {copiedTarget === 'request-body' ? (
                      <Check aria-hidden="true" className="text-emerald-500" />
                    ) : (
                      <Copy aria-hidden="true" />
                    )}
                  </IconActionButton>
                </div>
                {requestBodyOpen && (
                  <Textarea
                    aria-label={t('apiTest.requestBody')}
                    value={requestBody}
                    onChange={(event) => handleRequestBodyChange(event.target.value)}
                    rows={7}
                    className="font-mono text-xs leading-relaxed"
                  />
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="flex flex-col min-h-[560px] xl:h-[calc(100vh-11rem)] overflow-hidden">
            <CardContent className="flex flex-1 min-h-0 flex-col p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Bot className="h-4 w-4 shrink-0 text-primary dark:text-foreground" aria-hidden="true" />
                  <h2 className="text-sm font-semibold shrink-0">{t('apiTest.conversation')}</h2>
                  {modelValue && (
                    <Badge
                      variant="secondary"
                      className="hidden sm:inline-flex max-w-[220px] truncate px-2 py-0 font-mono text-[11px] font-normal"
                    >
                      {modelValue}{channelKey ? ` @${channelKey}` : ''}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {statusCode !== null && (
                    <>
                      <Badge variant={statusCode === 200 ? 'success' : 'destructive'} className="px-2 py-0 text-[11px]">
                        {statusCode === 200 ? (
                          <CheckCircle className="mr-1 h-3 w-3" aria-hidden="true" />
                        ) : (
                          <X className="mr-1 h-3 w-3" aria-hidden="true" />
                        )}
                        {statusCode}
                      </Badge>
                      <Badge variant="outline" className="px-2 py-0 text-[11px] font-mono">
                        <Clock className="mr-1 h-3 w-3" aria-hidden="true" />
                        {responseTime}ms
                      </Badge>
                    </>
                  )}
                  <IconActionButton
                    label={t('apiTest.copyResponse')}
                    tooltip={copiedTarget === 'conversation' ? t('apiTest.copied') : t('apiTest.copyResponse')}
                    className="text-muted-foreground hover:text-foreground"
                    disabled={messages.length === 0}
                    onClick={handleCopyMessages}
                  >
                    {copiedTarget === 'conversation' ? (
                      <Check aria-hidden="true" className="text-emerald-500" />
                    ) : (
                      <Copy aria-hidden="true" />
                    )}
                  </IconActionButton>
                  <IconActionButton
                    label={t('apiTest.clearConversation')}
                    className="text-muted-foreground hover:text-destructive"
                    disabled={messages.length === 0 || isLoading}
                    onClick={handleClearConversation}
                  >
                    <Trash2 aria-hidden="true" />
                  </IconActionButton>
                </div>
              </div>

              <div ref={messageListRef} className="flex-1 min-h-0 space-y-3 overflow-y-auto p-4 scrollbar-thin">
                {messages.length === 0 ? (
                  <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
                    <Bot className="mb-2.5 h-9 w-9 text-muted-foreground/35" aria-hidden="true" />
                    <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{t('apiTest.conversationEmpty')}</p>
                  </div>
                ) : (
                  messages.map((message, index) => {
                    const isUser = message.role === 'user'
                    const isEditing = editingMessageId === message.id
                    const messageNumber = index + 1
                    const copyTargetId = `message-${message.id}`
                    const actionButtonTone = isUser
                      ? 'h-6 w-6 text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground focus-visible:ring-primary-foreground/40'
                      : 'h-6 w-6 text-muted-foreground hover:bg-muted hover:text-foreground'

                    return (
                      <div key={message.id} className={cn('group/message flex', isUser ? 'justify-end' : 'justify-start')}>
                        <div
                          className={cn(
                            'max-w-[85%] space-y-1.5 rounded-xl border px-3.5 py-2.5',
                            isUser
                              ? 'border-primary/80 bg-primary text-primary-foreground dark:border-border'
                              : 'border-border/60 bg-muted/50 text-foreground',
                          )}
                        >
                          <div className="flex items-center justify-between gap-3 text-[11px]">
                            <div className="flex min-w-0 items-center gap-1.5 opacity-80">
                              {isUser ? (
                                <User className="h-3 w-3 shrink-0" aria-hidden="true" />
                              ) : (
                                <Bot className="h-3 w-3 shrink-0" aria-hidden="true" />
                              )}
                              <span>{isUser ? t('apiTest.user') : t('apiTest.assistant')}</span>
                              {message.status === 'streaming' && (
                                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                                  {t('apiTest.streaming')}
                                </Badge>
                              )}
                              {message.status === 'error' && (
                                <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                                  {t('apiTest.responseFailed')}
                                </Badge>
                              )}
                            </div>
                            {(message.model || message.channelKey) && (
                              <span className="max-w-[180px] truncate font-mono opacity-65">
                                {message.model || ''}{message.channelKey ? ` @${message.channelKey}` : ''}
                              </span>
                            )}
                          </div>

                          {isEditing ? (
                            <div className="space-y-2 pt-0.5">
                              <Textarea
                                aria-label={`${t('apiTest.editMessage')} (${messageNumber})`}
                                value={editingContent}
                                onChange={(event) => setEditingContent(event.target.value)}
                                rows={3}
                                className="min-h-[72px] bg-background text-foreground text-sm"
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') {
                                    event.preventDefault()
                                    setEditingMessageId(null)
                                  } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                    event.preventDefault()
                                    saveEditedMessage()
                                  }
                                }}
                              />
                              <div className="flex justify-end gap-1">
                                <IconActionButton
                                  label={`${t('common.cancel')} (${messageNumber})`}
                                  tooltip={t('common.cancel')}
                                  className={actionButtonTone}
                                  onClick={() => setEditingMessageId(null)}
                                >
                                  <X aria-hidden="true" />
                                </IconActionButton>
                                <IconActionButton
                                  label={`${t('common.save')} (${messageNumber})`}
                                  tooltip={t('common.save')}
                                  className={actionButtonTone}
                                  onClick={saveEditedMessage}
                                >
                                  <Check aria-hidden="true" />
                                </IconActionButton>
                              </div>
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                              {message.content || (message.status === 'streaming' ? t('apiTest.streaming') : '')}
                            </div>
                          )}

                          {!isEditing && (
                            <div
                              className={cn(
                                'flex flex-wrap items-center gap-1 pt-0.5 opacity-75 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100',
                                isUser ? 'justify-end' : 'justify-start',
                              )}
                            >
                              {isUser && (
                                <IconActionButton
                                  label={`${t('apiTest.editMessage')} (${messageNumber})`}
                                  tooltip={t('apiTest.editMessage')}
                                  className={actionButtonTone}
                                  onClick={() => startEditingMessage(message)}
                                  disabled={isLoading}
                                >
                                  <Edit3 aria-hidden="true" />
                                </IconActionButton>
                              )}
                              {message.content && (
                                <IconActionButton
                                  label={`${t('apiTest.copyMessage')} (${messageNumber})`}
                                  tooltip={copiedTarget === copyTargetId ? t('apiTest.copied') : t('apiTest.copyMessage')}
                                  className={actionButtonTone}
                                  onClick={() => void copyWithFeedback(copyTargetId, message.content)}
                                >
                                  {copiedTarget === copyTargetId ? (
                                    <Check
                                      aria-hidden="true"
                                      className={isUser ? 'text-primary-foreground' : 'text-emerald-500'}
                                    />
                                  ) : (
                                    <Copy aria-hidden="true" />
                                  )}
                                </IconActionButton>
                              )}
                              {!isUser && (message.rawResponse || message.rawResponseText) && (
                                <IconActionButton
                                  label={`${t('apiTest.viewRawResponse')} (${messageNumber})`}
                                  tooltip={t('apiTest.viewRawResponse')}
                                  className={actionButtonTone}
                                  onClick={() => setRawResponseMessage(message)}
                                >
                                  <Code2 aria-hidden="true" />
                                </IconActionButton>
                              )}
                              <IconActionButton
                                label={`${t('apiTest.retryMessage')} (${messageNumber})`}
                                tooltip={t('apiTest.retryMessage')}
                                className={actionButtonTone}
                                onClick={() => retryFromMessage(message.id)}
                                disabled={isLoading}
                              >
                                <RefreshCw aria-hidden="true" />
                              </IconActionButton>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <form onSubmit={handleSubmit} className="border-t p-3">
                <div className="flex items-end gap-2 rounded-xl border border-input bg-card px-3 py-2 transition-colors hover:border-muted-foreground/30 focus-within:border-primary/50">
                  <Textarea
                    aria-label={t('apiTest.messagePlaceholder')}
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    placeholder={t('apiTest.messagePlaceholder')}
                    rows={2}
                    className="min-h-[44px] max-h-[160px] flex-1 resize-none border-0 bg-transparent p-0 text-sm leading-relaxed hover:border-transparent focus-visible:border-transparent"
                    disabled={isLoading}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault()
                        void sendConversation()
                      }
                    }}
                  />
                  {isLoading ? (
                    <IconActionButton
                      label={t('apiTest.stopGeneration')}
                      variant="secondary"
                      className="h-8 w-8 shrink-0 rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={handleStopStreaming}
                    >
                      <Square aria-hidden="true" className="fill-current" />
                    </IconActionButton>
                  ) : (
                    <IconActionButton
                      type="submit"
                      label={t('apiTest.send')}
                      tooltip={`${t('apiTest.send')} (Ctrl/⌘ + Enter)`}
                      variant="default"
                      className="h-8 w-8 shrink-0 rounded-lg dark:border dark:border-white/10"
                      disabled={!inputValue.trim()}
                    >
                      <Send aria-hidden="true" />
                    </IconActionButton>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </TooltipProvider>
    </PageContainer>
  )
}
