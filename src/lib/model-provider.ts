import type { Settings } from "./types";

export type ModelProvider = Settings["provider"];
export const OPENROUTER_MODEL = "deepseek/deepseek-v4.1-flash-1017";

export function modelCredential(provider: ModelProvider, saved: string | undefined, env: Record<string, string | undefined>) {
  return saved || (provider === "openrouter" ? env.OPENROUTER_API_KEY : env.DEEPSEEK_API_KEY);
}

export function credentialError(provider: ModelProvider, key: string): string | null {
  if (provider === "deepseek" && key.startsWith("sk-or-")) return "This is an OpenRouter key. In Settings, select OpenRouter and use its model identifier; OpenRouter credits cannot be used on the direct DeepSeek endpoint.";
  return null;
}

export function modelConnection(settings: Pick<Settings, "provider" | "model" | "apiKey">) {
  const error = credentialError(settings.provider, settings.apiKey || "");
  if (error) throw new Error(error);
  const openrouter = settings.provider === "openrouter";
  return {
    label: openrouter ? "OpenRouter" : "DeepSeek",
    url: openrouter ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.deepseek.com/chat/completions",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}`,
      ...(openrouter ? { "HTTP-Referer": "https://secondbrain-nu-nine.vercel.app", "X-OpenRouter-Title": "Secondbrain" } : {}) },
    // The bounded JSON tasks need visible answers, not a hidden reasoning budget
    // that can consume the entire output limit. Only apply to compatible models.
    options: openrouter && settings.model.startsWith("deepseek/") ? { reasoning: { effort: "none" } } : {},
  };
}

export function modelError(provider: string, status: number) {
  if (status === 401 || status === 403) return `${provider} authentication failed (${status}). Check the ${provider} API key and its permissions in Settings. Keys from another provider will not work.`;
  if (status === 402) return `${provider} returned 402. Check that provider's available credits and this API key's spending limit.`;
  if (status === 429) return `${provider} rate limit reached. Please wait briefly and try again.`;
  if (status === 400 || status === 404) return `${provider} returned ${status}. Check the model identifier and whether it is available to this account.`;
  return `${provider} returned ${status}. Please try again; if it continues, check the provider's service status.`;
}
