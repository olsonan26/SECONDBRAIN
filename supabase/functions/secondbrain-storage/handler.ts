const bucket = "secondbrain-private";
const maxBytes = 20 * 1024 * 1024;
const validKey = (key: unknown): key is string => typeof key === "string" && /^secondbrain\/[a-zA-Z0-9_./-]+$/.test(key) && !key.includes("..") && key.length <= 512;
const originalKey = (key: unknown): key is string => validKey(key) && /^secondbrain\/(?:brains\/[a-zA-Z0-9_-]+\/)?originals\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(key);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Configuration = { url: string; serviceKey: string; tokenSha256: string; fetch?: typeof fetch };

export function createHandler(config: Configuration) {
  const transport = config.fetch ?? fetch;
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  async function upstream(path: string, init: RequestInit = {}) {
    return transport(`${config.url}${path}`, {
      ...init, signal: AbortSignal.timeout(55_000),
      headers: {
        apikey: config.serviceKey,
        ...(!config.serviceKey.startsWith("sb_secret_") ? { Authorization: `Bearer ${config.serviceKey}` } : {}),
        ...init.headers,
      },
    });
  }
  const rpc = (name: string, body: unknown) => upstream(`/rest/v1/rpc/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  async function translate(response: Response) {
    if (response.status === 409) return reply({ error: "Save conflict" }, 409);
    if (!response.ok) return reply({ error: "Private storage request failed" }, 503);
    return response;
  }
  return async (request: Request): Promise<Response> => {
    try {
      // Authenticate before inspecting any object or contacting the database.
      const bearer = request.headers.get("authorization") ?? "";
      if (!/^Bearer [a-zA-Z0-9_-]{43,128}$/.test(bearer) || !/^[a-f0-9]{64}$/.test(config.tokenSha256)) return reply({ error: "Unauthorized" }, 401);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bearer.slice(7)));
      const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      let difference = 0;
      for (let i = 0; i < 64; i++) difference |= actual.charCodeAt(i) ^ config.tokenSha256.charCodeAt(i);
      if (difference !== 0) return reply({ error: "Unauthorized" }, 401);
      const url = new URL(request.url);
      if (request.method === "GET" || request.method === "PUT") {
        const key = url.searchParams.get("key");
        if (!originalKey(key)) return reply({ error: "Invalid original key" }, 400);
        const objectPath = `/storage/v1/object/${request.method === "GET" ? "authenticated/" : ""}${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
        if (request.method === "GET") {
          const result = await upstream(objectPath);
          if (!result.ok) {
            const error = await result.json().catch(() => ({}));
            if (error.code === "NoSuchKey" || error.message === "Object not found") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
            return reply({ error: "Private original is unavailable" }, 503);
          }
          return new Response(result.body, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
        }
        if (Number(request.headers.get("content-length")) > maxBytes) return reply({ error: "Original exceeds storage limit" }, 413);
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength > maxBytes) return reply({ error: "Original exceeds storage limit" }, 413);
        const result = await upstream(objectPath, { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-upsert": "false" }, body: bytes });
        if (!result.ok) {
          const error = await result.json().catch(() => ({}));
          if (result.status === 409 || error.code === "Duplicate" || error.error === "Duplicate" || String(error.statusCode) === "409") return reply({ error: "Original already exists" }, 409);
          return reply({ error: "Private original was not saved" }, 503);
        }
        return reply({ saved: true });
      }
      if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
      if (Number(request.headers.get("content-length")) > maxBytes) return reply({ error: "Record exceeds storage limit" }, 413);
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) return reply({ error: "Record exceeds storage limit" }, 413);
      let body;
      try { body = JSON.parse(text); } catch { return reply({ error: "Invalid JSON" }, 400); }
      if (!body || typeof body !== "object") return reply({ error: "Invalid request" }, 400);
      if (body.op === "initialize") {
        const existing = await upstream(`/storage/v1/bucket/${bucket}`);
        if (existing.ok) {
          const metadata = await existing.json();
          if (metadata.public !== false) return reply({ error: "Bucket must be private" }, 503);
          return reply({ ready: true, private: true });
        }
        const created = await upstream("/storage/v1/bucket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: maxBytes }) });
        if (!created.ok) return reply({ error: "Private bucket initialization failed" }, 503);
        return reply({ ready: true, private: true });
      }
      if (body.op === "list") {
        if (!validKey(body.prefix) || !body.prefix.endsWith("/") || typeof body.after !== "string" || (body.after && (!validKey(body.after) || !body.after.startsWith(body.prefix)))) return reply({ error: "Invalid record prefix" }, 400);
        const result = await rpc("secondbrain_list_records", { p_prefix: body.prefix, p_after: body.after, p_limit: 100 });
        if (!result.ok) return translate(result);
        return reply({ records: await result.json() });
      }
      if (!validKey(body.key) || !body.key.endsWith(".json")) return reply({ error: "Invalid record key" }, 400);
      if (body.op === "read") {
        const result = await rpc("secondbrain_read_record", { p_key: body.key });
        if (!result.ok) return translate(result);
        const records = await result.json();
        return reply({ record: records[0] ?? null });
      }
      if (body.op === "write") {
        if (body.value === undefined || body.value === null || typeof body.checkVersion !== "boolean" || (body.expectedEtag !== null && (typeof body.expectedEtag !== "string" || !uuid.test(body.expectedEtag)))) return reply({ error: "Invalid record version" }, 400);
        const result = await rpc("secondbrain_write_record", { p_key: body.key, p_value: body.value, p_check_version: body.checkVersion, p_expected_version: body.expectedEtag });
        if (!result.ok) return translate(result);
        return reply({ saved: true, etag: await result.json() });
      }
      return reply({ error: "Unknown operation" }, 400);
    } catch {
      return reply({ error: "Private storage is temporarily unavailable" }, 503);
    }
  };
}
