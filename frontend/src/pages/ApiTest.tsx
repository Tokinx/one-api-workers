import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { Bot, CheckCircle, ChevronDown, ChevronRight, Clock, Code2, Copy, Edit3, RefreshCw, Save, Send, Square, User, X } from 'lucide-react'
import { PageContainer } from '@/components/ui/page-container'
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

export function ApiTest() {
  const { t } = useTranslation()
  const { addToast } = useToast()
  const abortControllerRef = useRef<AbortController | null>(null)
  const messageListRef = useRef<HTMLDivElement | null>(null)

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
  const [isLoading, setIsLoading] = useState(false)
  const [responseTime, setResponseTime] = useState<number>(0)
  const [statusCode, setStatusCode] = useState<number | null>(null)
  const [tokens, setTokens] = useState<Token[]>([])
  const [channels, setChannels] = useState<Channel[]>([])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
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

  const handleCopyMessages = async () => {
    try {
      await copyToClipboard(JSON.stringify(messages, null, 2))
      addToast(t('common.copiedToClipboard'), 'success')
    } catch {
      addToast(t('common.copyFailed'), 'error')
    }
  }

  const rawResponseContent = rawResponseMessage
    ? rawResponseMessage.rawResponseText || stringifyRawResponse(rawResponseMessage.rawResponse)
    : ''

  const handleCopyRawResponse = async () => {
    if (!rawResponseContent) {
      return
    }

    try {
      await copyToClipboard(rawResponseContent)
      addToast(t('common.copiedToClipboard'), 'success')
    } catch {
      addToast(t('common.copyFailed'), 'error')
    }
  }

  return (
    <PageContainer
      title={t('apiTest.title')}
      description={t('apiTest.description')}
    >
      <Dialog open={!!rawResponseMessage} onOpenChange={(open) => !open && setRawResponseMessage(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('apiTest.rawResponse')}</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[70vh] overflow-auto rounded-lg bg-muted/50 p-4 text-sm font-mono whitespace-pre-wrap break-words scrollbar-thin">
            {rawResponseContent}
          </pre>
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={handleCopyRawResponse}>
              <Copy className="h-4 w-4" />
              {t('common.copy')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-4 min-h-[calc(100vh-12rem)]">
        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <h3 className="font-semibold text-sm">{t('apiTest.playgroundParams')}</h3>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('apiTest.apiToken')}</Label>
              <AutoCompleteInput
                value={apiToken}
                onChange={handleTokenChange}
                placeholder="sk-..."
                inputClassName="font-mono"
                options={tokenOptions}
                emptyText={t('apiTest.noMatchingTokens')}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('apiTest.model')}</Label>
              <AutoCompleteInput
                value={modelValue}
                onChange={handleModelChange}
                placeholder={apiToken ? t('apiTest.modelPlaceholder') : t('apiTest.selectTokenFirst')}
                inputClassName="font-mono"
                options={modelOptions}
                maxOptions={availableModelNames.length}
                emptyText={apiToken ? t('apiTest.noMatchingModels') : t('apiTest.selectTokenFirst')}
                disabled={!apiToken}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('apiTest.channel')}</Label>
              <AutoCompleteInput
                value={channelKey}
                onChange={handleChannelChange}
                placeholder={apiToken ? t('apiTest.autoChannel') : t('apiTest.selectTokenFirst')}
                inputClassName="font-mono"
                options={channelOptions}
                maxOptions={availableChannels.length}
                emptyText={apiToken ? t('apiTest.noMatchingChannels') : t('apiTest.selectTokenFirst')}
                disabled={!apiToken}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('apiTest.endpoint')}</Label>
              <Select value={endpoint} onChange={(event) => setEndpoint(event.target.value as ChatEndpoint)}>
                {chatEndpoints.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </Select>
            </div>

            <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
              <div className="grid grid-cols-1 gap-3">
                {visibleParamDefinitions.map((param) => (
                  <div key={param.key} className="space-y-2">
                    <Label className="text-xs text-muted-foreground">{t(param.translationKey)}</Label>
                    {param.type === 'boolean' ? (
                      <div className="flex h-10 items-center justify-between rounded-md border border-input bg-card px-3">
                        <span className="text-sm">{playgroundParams[param.key] === true ? t('common.enabled') : t('common.disabled')}</span>
                        <Switch
                          checked={playgroundParams[param.key] === true}
                          onCheckedChange={(checked) => applyParamToRequestBody(param.key, checked)}
                        />
                      </div>
                    ) : (
                      <Input
                        type="number"
                        min={param.min}
                        max={param.max}
                        step={param.step}
                        value={typeof playgroundParams[param.key] === 'number' ? String(playgroundParams[param.key]) : ''}
                        onChange={(event) => handleNumberParamChange(param.key, event.target.value)}
                        className="font-mono"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left text-sm font-medium"
                onClick={() => setRequestBodyOpen((open) => !open)}
              >
                <span>{t('apiTest.requestBody')}</span>
                {requestBodyOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {requestBodyOpen && (
                <Textarea
                  value={requestBody}
                  onChange={(event) => handleRequestBodyChange(event.target.value)}
                  rows={10}
                  className="font-mono text-sm"
                />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-[640px]">
          <CardContent className="flex h-full min-h-[640px] flex-col p-0">
            <div className="flex items-center justify-between border-b p-4">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-sm">{t('apiTest.conversation')}</h3>
              </div>
              <div className="flex items-center gap-2">
                {statusCode && (
                  <>
                    <Badge variant={statusCode === 200 ? 'success' : 'destructive'} className="text-xs">
                      {statusCode === 200 ? <CheckCircle className="h-3 w-3 mr-1" /> : <X className="h-3 w-3 mr-1" />}
                      {statusCode}
                    </Badge>
                    <Badge variant="outline" className="text-xs font-mono">
                      <Clock className="h-3 w-3 mr-1" />
                      {responseTime}ms
                    </Badge>
                  </>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopyMessages} title={t('apiTest.copyResponse')}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div ref={messageListRef} className="flex-1 space-y-4 overflow-y-auto p-5 scrollbar-thin">
              {messages.length === 0 ? (
                <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center text-muted-foreground/50">
                  <Bot className="mb-3 h-12 w-12" />
                  <p className="text-sm">{t('apiTest.conversationEmpty')}</p>
                </div>
              ) : (
                messages.map((message) => {
                  const isUser = message.role === 'user'
                  const isEditing = editingMessageId === message.id

                  return (
                    <div key={message.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[84%] space-y-2 rounded-2xl border p-3', isUser ? 'bg-primary text-primary-foreground' : 'bg-muted/60')}>
                        <div className="flex items-center justify-between gap-3 text-xs opacity-80">
                          <div className="flex items-center gap-2">
                            {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                            <span>{isUser ? t('apiTest.user') : t('apiTest.assistant')}</span>
                            {message.status === 'streaming' && <Badge variant="outline" className="text-[10px]">{t('apiTest.streaming')}</Badge>}
                            {message.status === 'error' && <Badge variant="destructive" className="text-[10px]">{t('apiTest.responseFailed')}</Badge>}
                          </div>
                          <div className="flex items-center gap-1">
                            {message.model && <span className="font-mono">{message.model}</span>}
                            {message.channelKey && <span className="font-mono">@{message.channelKey}</span>}
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="space-y-2">
                            <Textarea value={editingContent} onChange={(event) => setEditingContent(event.target.value)} rows={4} />
                            <div className="flex justify-end gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => setEditingMessageId(null)}>
                                <X className="h-3.5 w-3.5" />
                                {t('common.cancel')}
                              </Button>
                              <Button type="button" size="sm" onClick={saveEditedMessage}>
                                <Save className="h-3.5 w-3.5" />
                                {t('common.save')}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content || (message.status === 'streaming' ? t('apiTest.streaming') : '')}</div>
                        )}

                        {!isEditing && (
                          <div className={cn('flex flex-wrap gap-2', isUser ? 'justify-end' : 'justify-start')}>
                            {isUser && (
                              <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => startEditingMessage(message)} disabled={isLoading}>
                                <Edit3 className="h-3.5 w-3.5" />
                                {t('apiTest.editMessage')}
                              </Button>
                            )}
                            {!isUser && (message.rawResponse || message.rawResponseText) && (
                              <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setRawResponseMessage(message)}>
                                <Code2 className="h-3.5 w-3.5" />
                                {t('apiTest.viewRawResponse')}
                              </Button>
                            )}
                            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => retryFromMessage(message.id)} disabled={isLoading}>
                              <RefreshCw className="h-3.5 w-3.5" />
                              {t('apiTest.retryMessage')}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <form onSubmit={handleSubmit} className="border-t p-4">
              <div className="flex gap-3">
                <Textarea
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder={t('apiTest.messagePlaceholder')}
                  rows={3}
                  className="min-h-[76px] resize-none"
                  disabled={isLoading}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      void sendConversation()
                    }
                  }}
                />
                {isLoading ? (
                  <Button type="button" variant="outline" className="self-end" onClick={handleStopStreaming}>
                    <Square className="h-4 w-4" />
                    {t('apiTest.stopGeneration')}
                  </Button>
                ) : (
                  <Button type="submit" className="self-end" disabled={!inputValue.trim()}>
                    <Send className="h-4 w-4" />
                    {t('apiTest.send')}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
