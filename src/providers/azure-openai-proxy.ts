import { Context } from "hono"
import { checkoutUsageData, handleStreamResponse } from "./shared/openai-stream-utils"
import { buildAzureTargetUrl } from "./shared/azure-target-url"
import {
    buildUpstreamRequestHeaders,
    OPENAI_COMPAT_UPSTREAM_HEADER_ALLOWLIST,
} from "./shared/upstream-request-headers"

const buildProxyRequest = (
    request: Request,
    reqJson: any,
    config: ChannelConfig
): Request => {
    const targetUrl = buildAzureTargetUrl(request, config.endpoint)
    const apiKey = config.api_key || ""

    const targetHeaders = buildUpstreamRequestHeaders(request, {
        allowHeaders: OPENAI_COMPAT_UPSTREAM_HEADER_ALLOWLIST,
        overrideHeaders: {
            "api-key": apiKey,
        },
    })

    return new Request(targetUrl, {
        method: request.method,
        headers: targetHeaders,
        body: JSON.stringify(reqJson),
    })
}

export default {
    async fetch(
        c: Context<HonoCustomType>,
        config: ChannelConfig,
        requestBody: any,
        saveUsage: (usage: Usage) => Promise<void>,
        trackingState: RequestTrackingState,
    ): Promise<Response> {
        const { stream } = requestBody;

        if (stream) {
            requestBody.stream_options = {
                ...(requestBody.stream_options || {}),
                include_usage: true,
            }
        }

        const proxyRequest = buildProxyRequest(c.req.raw, requestBody, config)
        const response = await fetch(proxyRequest)
        trackingState.upstreamStatus = response.status

        if (stream) {
            const [streamForClient, streamForServer] = response.body?.tee() || []
            c.executionCtx.waitUntil(handleStreamResponse(c, streamForServer, saveUsage))
            return new Response(streamForClient, {
                headers: response.headers,
                status: response.status,
                statusText: response.statusText,
            })
        }

        if (response.ok) {
            await checkoutUsageData(saveUsage, response, requestBody)
        }

        return response
    }
}
