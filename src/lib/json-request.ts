export function jsonRequestInit(method: string, body?: unknown, signal?: AbortSignal): RequestInit {
  const payload = body === undefined && method.toUpperCase() === "POST" ? {} : body;
  return {
    method, signal,
    headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  };
}

export async function parseJsonRequest(request: Request, allowEmpty = false): Promise<unknown> {
  const text = await request.text();
  return allowEmpty && !text.trim() ? {} : JSON.parse(text);
}
