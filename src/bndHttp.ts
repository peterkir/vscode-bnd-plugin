import * as http from 'http';
import * as https from 'https';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as vscode from 'vscode';

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 60_000;

export interface ProxySettings {
    /** Value of the VS Code `http.proxy` setting. */
    proxy?: string;
    /** Value of the VS Code `http.proxyStrictSSL` setting. */
    strictSSL?: boolean;
    /** Value of the VS Code `http.proxyAuthorization` setting. */
    authorization?: string;
}

function noProxyEntries(env: NodeJS.ProcessEnv): string[] {
    const raw = env.NO_PROXY ?? env.no_proxy ?? '';
    return raw.split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean);
}

/** Implements the de-facto NO_PROXY semantics: `*`, suffix matching and optional port. */
export function isProxyBypassed(targetUrl: string, env: NodeJS.ProcessEnv = process.env): boolean {
    const entries = noProxyEntries(env);
    if (entries.length === 0) {
        return false;
    }
    if (entries.includes('*')) {
        return true;
    }

    const target = new URL(targetUrl);
    const host = target.hostname.toLowerCase();
    const port = target.port || (target.protocol === 'https:' ? '443' : '80');

    return entries.some(entry => {
        const [entryHost, entryPort] = entry.startsWith('[')
            ? [entry, '']
            : [entry.replace(/:\d+$/, ''), entry.match(/:(\d+)$/)?.[1] ?? ''];
        if (entryPort && entryPort !== port) {
            return false;
        }
        const normalized = entryHost.replace(/^\./, '');
        return host === normalized || host.endsWith(`.${normalized}`);
    });
}

/** Settings take precedence over the environment; protocol-specific variables win over generic ones. */
export function resolveProxyUrl(
    targetUrl: string,
    settings: ProxySettings = {},
    env: NodeJS.ProcessEnv = process.env,
): string | undefined {
    if (isProxyBypassed(targetUrl, env)) {
        return undefined;
    }

    const configured = settings.proxy?.trim();
    if (configured) {
        return configured;
    }

    const isHttps = new URL(targetUrl).protocol === 'https:';
    const candidates = isHttps
        ? [env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy]
        : [env.HTTP_PROXY, env.http_proxy];

    return candidates.map(value => value?.trim()).find(Boolean) || undefined;
}

function proxySettingsFromConfiguration(): ProxySettings {
    const cfg = vscode.workspace.getConfiguration('http');
    return {
        proxy: cfg.get<string>('proxy', ''),
        strictSSL: cfg.get<boolean>('proxyStrictSSL', true),
        authorization: cfg.get<string>('proxyAuthorization', '') || undefined,
    };
}

function createAgent(targetUrl: string, proxyUrl: string | undefined, strictSSL: boolean): http.Agent | undefined {
    if (!proxyUrl) {
        return undefined;
    }
    const options = { rejectUnauthorized: strictSSL };
    return new URL(targetUrl).protocol === 'https:'
        ? new HttpsProxyAgent(proxyUrl, options)
        : new HttpProxyAgent(proxyUrl, options);
}

export interface HttpGetOptions {
    /** Overrides the settings read from the `http.*` configuration section. */
    proxySettings?: ProxySettings;
    /** Receives one line per request describing the resolved proxy. */
    log?: (message: string) => void;
}

function requestOnce(
    targetUrl: string,
    options: HttpGetOptions,
    redirectsLeft: number,
): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const settings = options.proxySettings ?? proxySettingsFromConfiguration();
        const strictSSL = settings.strictSSL !== false;
        const proxyUrl = resolveProxyUrl(targetUrl, settings);
        const parsed = new URL(targetUrl);
        const transport = parsed.protocol === 'https:' ? https : http;

        options.log?.(`GET ${targetUrl}${proxyUrl ? ` via proxy ${proxyUrl}` : ' (direct)'}`);

        const headers: Record<string, string> = {
            'User-Agent': 'vscode-bnd',
            Accept: '*/*',
        };
        if (proxyUrl && settings.authorization) {
            headers['Proxy-Authorization'] = settings.authorization;
        }

        const request = transport.get(
            targetUrl,
            {
                agent: createAgent(targetUrl, proxyUrl, strictSSL),
                headers,
                rejectUnauthorized: strictSSL,
            } as https.RequestOptions,
            response => {
                const status = response.statusCode ?? 0;
                const location = response.headers.location;

                if (status >= 300 && status < 400 && location) {
                    response.resume();
                    if (redirectsLeft <= 0) {
                        reject(new Error(`Too many redirects while fetching ${targetUrl}`));
                        return;
                    }
                    resolve(requestOnce(new URL(location, targetUrl).toString(), options, redirectsLeft - 1));
                    return;
                }

                if (status < 200 || status >= 300) {
                    response.resume();
                    reject(new Error(`Request failed with ${status} ${response.statusMessage ?? ''}`.trim()));
                    return;
                }

                const chunks: Buffer[] = [];
                response.on('data', chunk => chunks.push(chunk as Buffer));
                response.on('error', reject);
                response.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
            },
        );

        request.setTimeout(REQUEST_TIMEOUT_MS, () => {
            request.destroy(new Error(`Request to ${targetUrl} timed out after ${REQUEST_TIMEOUT_MS} ms`));
        });
        request.on('error', error => {
            const detail = proxyUrl ? ` (proxy ${proxyUrl})` : '';
            reject(new Error(`${error.message}${detail}`));
        });
    });
}

/** HTTP GET honouring the VS Code proxy settings and the HTTP(S)_PROXY/NO_PROXY environment. */
export async function httpGet(targetUrl: string, options: HttpGetOptions = {}): Promise<Uint8Array> {
    return requestOnce(targetUrl, options, MAX_REDIRECTS);
}

export async function httpGetText(targetUrl: string, options: HttpGetOptions = {}): Promise<string> {
    return new TextDecoder('utf-8').decode(await httpGet(targetUrl, options));
}
