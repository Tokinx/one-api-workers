import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { apiClient } from '@/api/client'
import { AudioTestResponse, Channel, TestResponse, Token } from '@/types'
import { AutoCompleteInput, type AutoCompleteOption } from '@/components/ui/autocomplete'
import { Send, Clock, CheckCircle, XCircle, Copy, Download } from 'lucide-react'
import { PageContainer } from '@/components/ui/page-container'
import { cn, copyToClipboard } from '@/lib/utils'
import { getModelNamesForToken, parseTokenConfig } from '@/lib/channel-models'
import { useTranslation } from 'react-i18next'

const requestTemplates: Record<string, any> = {
  '/v1/chat/completions': {
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'user',
        content: 'Hello, how are you?',
      },
    ],
    temperature: 0.7,
    max_tokens: 100,
  },
  '/v1/messages': {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: 'Hello, Claude!',
      },
    ],
  },
  '/v1/responses': {
    model: 'gpt-4o-mini',
    input: 'Hello, Responses API!',
  },
  '/v1/audio/speech': {
    model: 'gpt-4o-mini-tts',
    input: 'The quick brown fox jumped over the lazy dog',
    voice: 'alloy',
  },
  '/v1/completions': {
    model: 'gpt-3.5-turbo-instruct',
    prompt: 'Once upon a time',
    max_tokens: 100,
    temperature: 0.7,
  },
}

const buildRequestBody = (endpoint: string, model = '') => {
  const template = requestTemplates[endpoint] || {}
  const { model: _templateModel, ...rest } = template

  return JSON.stringify(
    model ? { ...rest, model } : rest,
    null,
    2
  )
}

export function ApiTest() {
  const { t } = useTranslation()
  const [endpoint, setEndpoint] = useState('/v1/chat/completions')
  const [apiToken, setApiToken] = useState('')
  const [modelValue, setModelValue] = useState('')
  const [requestBody, setRequestBody] = useState(buildRequestBody('/v1/chat/completions'))
  const [isLoading, setIsLoading] = useState(false)
  const [response, setResponse] = useState<any>(null)
  const [responseTime, setResponseTime] = useState<number>(0)
  const [statusCode, setStatusCode] = useState<number | null>(null)

  const { addToast } = useToast()

  const [tokens, setTokens] = useState<Token[]>([])
  const [channels, setChannels] = useState<Channel[]>([])

  const isAudioResponse = (value: TestResponse | { error: string } | null): value is AudioTestResponse => {
    return !!value && value.object === 'audio' && typeof value.url === 'string'
  }

  useEffect(() => {
    return () => {
      if (isAudioResponse(response)) {
        URL.revokeObjectURL(response.url)
      }
    }
  }, [response])

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
        console.error('Failed to load API test options:', error)
      }
    }

    loadOptions()
  }, [])

  const availableModels = useMemo(
    () => getModelNamesForToken(apiToken, tokens, channels),
    [apiToken, tokens, channels]
  )

  const handleEndpointChange = (newEndpoint: string) => {
    setEndpoint(newEndpoint)
    setModelValue('')
    setRequestBody(buildRequestBody(newEndpoint))
  }

  const handleCopyResponse = async () => {
    if (response) {
      try {
        const payload = isAudioResponse(response)
          ? {
              object: response.object,
              contentType: response.contentType,
              size: response.size,
              filename: response.filename,
            }
          : response
        await copyToClipboard(JSON.stringify(payload, null, 2))
        addToast(t('common.copiedToClipboard'), 'success')
      } catch {
        addToast(t('common.copyFailed'), 'error')
      }
    }
  }

  const updateRequestBodyModel = (nextModel: string) => {
    setModelValue(nextModel)

    try {
      const parsedBody = JSON.parse(requestBody)
      if (nextModel) {
        parsedBody.model = nextModel
      } else {
        delete parsedBody.model
      }
      setRequestBody(JSON.stringify(parsedBody, null, 2))
    } catch {
      setRequestBody(buildRequestBody(endpoint, nextModel))
    }
  }

  const handleRequestBodyChange = (value: string) => {
    setRequestBody(value)

    try {
      const parsedBody = JSON.parse(value)
      if (typeof parsedBody?.model === 'string') {
        setModelValue(parsedBody.model)
      } else {
        setModelValue('')
      }
    } catch {
      // Keep the current model selection while the JSON is temporarily invalid.
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!apiToken) {
      addToast(t('apiTest.tokenRequired'), 'error')
      return
    }

    let body: any
    try {
      body = JSON.parse(requestBody)
    } catch {
      addToast(t('apiTest.bodyJsonError'), 'error')
      return
    }

    setIsLoading(true)
    setResponse(null)
    setStatusCode(null)

    const startTime = Date.now()

    try {
      const result = await apiClient.testApi(endpoint, apiToken, body)
      const endTime = Date.now()
      setResponseTime(endTime - startTime)
      setResponse(result)
      setStatusCode(200)
    } catch (error: any) {
      const endTime = Date.now()
      setResponseTime(endTime - startTime)
      setStatusCode(error.status || 500)
      setResponse({ error: error.message })
    } finally {
      setIsLoading(false)
    }
  }

  const tokenOptions: AutoCompleteOption[] = tokens.map((token) => {
    const tokenConfig = parseTokenConfig(token)

    return {
      value: token.key,
      label: tokenConfig.name || token.key,
      description: token.key,
      keywords: [token.key, tokenConfig.name || ''],
    }
  })

  const modelOptions: AutoCompleteOption[] = availableModels.map((model) => ({
    value: model,
  }))

  return (
    <PageContainer
      title={t('apiTest.title')}
      description={t('apiTest.description')}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Request Panel */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <h3 className="font-semibold text-sm">{t('apiTest.request')}</h3>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('apiTest.endpoint')}</Label>
                <Select
                  value={endpoint}
                  onChange={(e) => handleEndpointChange(e.target.value)}
                >
                  <option value="/v1/chat/completions">/v1/chat/completions</option>
                  <option value="/v1/messages">/v1/messages</option>
                  <option value="/v1/responses">/v1/responses</option>
                  <option value="/v1/audio/speech">/v1/audio/speech</option>
                  <option value="/v1/completions">/v1/completions</option>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('apiTest.apiToken')}</Label>
                <AutoCompleteInput
                  value={apiToken}
                  onChange={setApiToken}
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
                  onChange={updateRequestBodyModel}
                  placeholder={t('apiTest.modelPlaceholder')}
                  inputClassName="font-mono"
                  options={modelOptions}
                  maxOptions={availableModels.length}
                  emptyText={t('apiTest.noMatchingModels')}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('apiTest.requestBody')}</Label>
                <Textarea
                  value={requestBody}
                  onChange={(e) => handleRequestBodyChange(e.target.value)}
                  rows={14}
                  className="font-mono text-sm"
                />
              </div>

              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    {t('apiTest.sending')}
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    {t('apiTest.send')}
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Response Panel */}
        <Card className={cn(
          "transition-all duration-300",
          !response && "opacity-60"
        )}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  !statusCode ? "bg-muted-foreground/30" :
                  statusCode === 200 ? "bg-success" : "bg-destructive"
                )} />
                <h3 className="font-semibold text-sm">{t('apiTest.response')}</h3>
              </div>
              {statusCode && (
                <div className="flex items-center gap-2">
                  <Badge variant={statusCode === 200 ? 'success' : 'destructive'} className="text-xs">
                    {statusCode === 200 ? (
                      <><CheckCircle className="h-3 w-3 mr-1" />{statusCode}</>
                    ) : (
                      <><XCircle className="h-3 w-3 mr-1" />{statusCode}</>
                    )}
                  </Badge>
                  <Badge variant="outline" className="text-xs font-mono">
                    <Clock className="h-3 w-3 mr-1" />
                    {responseTime}ms
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleCopyResponse}
                    title={t('apiTest.copyResponse')}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            {response ? (
              isAudioResponse(response) ? (
                <div className="space-y-4 rounded-lg bg-muted/50 p-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">{t('apiTest.audioSuccess')}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {response.contentType} · {response.size} bytes
                    </div>
                  </div>
                  <audio controls src={response.url} className="w-full" />
                  <Button asChild variant="outline" size="sm">
                    <a href={response.url} download={response.filename}>
                      <Download className="h-4 w-4" />
                      {t('apiTest.downloadAudio')}
                    </a>
                  </Button>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words text-sm font-mono bg-muted/50 rounded-lg p-4 max-h-[500px] overflow-y-auto scrollbar-thin">
                  {JSON.stringify(response, null, 2)}
                </pre>
              )
            ) : (
              <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground/40">
                <Send className="h-10 w-10 mb-3" />
                <p className="text-sm">{t('apiTest.responseEmpty')}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
