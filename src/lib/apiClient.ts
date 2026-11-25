export async function fetchApiJson<T = Record<string, unknown>>(
  url: string,
  accessToken: string | null,
  options: RequestInit = {},
  timeoutMs = 60000
): Promise<{ status: number; ok: boolean; data: T }> {
  const maxStartingRetries = 4;

  for (let attempt = 0; attempt <= maxStartingRetries; attempt++) {
    const headers = new Headers(options.headers);
    if (accessToken) {
      headers.set('X-Drive-Access-Token', accessToken);
    }
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        ...options,
        headers,
        signal: options.signal ?? controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error('Request timed out. Please try again.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    const rawText = await res.text();
    if (!rawText) {
      return {
        status: res.status,
        ok: res.ok,
        data: {} as T,
      };
    }

    try {
      const parsed = JSON.parse(rawText);
      return {
        status: res.status,
        ok: res.ok,
        data: (parsed || {}) as T,
      };
    } catch {
      const isStartingPage =
        rawText.includes('Starting Server') || rawText.includes('starting server');
      if (isStartingPage && attempt < maxStartingRetries) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      if (isStartingPage) {
        throw new Error('The server is still starting up. Please try again in a few seconds.');
      }

      const snippet = rawText
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140);
      throw new Error(
        `Server returned an unexpected response (HTTP ${res.status})${snippet ? `: ${snippet}` : '.'}`
      );
    }
  }

  throw new Error('The server is still starting up. Please try again.');
}
