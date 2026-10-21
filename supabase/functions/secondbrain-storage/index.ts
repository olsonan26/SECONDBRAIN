import { createHandler } from "./handler.ts";
import { tokenSha256 } from "./auth-config.ts";

const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || keys.default;
if (!serviceKey) throw new Error("Server storage credential is unavailable");
Deno.serve(createHandler({ url: Deno.env.get("SUPABASE_URL")!, serviceKey, tokenSha256 }));
