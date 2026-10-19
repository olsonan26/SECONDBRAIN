import "server-only";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { scrypt as scryptCallback, timingSafeEqual, randomBytes, createHash } from "node:crypto";
import { promisify } from "node:util";
import { readRecord, updateRecord, isCloud } from "./storage";

const scrypt = promisify(scryptCallback);
export type Account = { name: string; role: "owner" | "member"; salt: string; hash: string };
type BrainSession = { username: string; name: string; role: "owner" | "member"; credentialVersion: string; issuedAt: number };
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

function accounts(): Record<string, Account> {
  try { return JSON.parse(process.env.BRAIN_USERS_JSON || "{}"); } catch { return {}; }
}
export function sessionReady() { return (process.env.BRAIN_SESSION_SECRET?.length ?? 0) >= 32 && Object.keys(accounts()).length > 0; }

export async function getSession() {
  if (!sessionReady()) throw new HttpError(503, "Workspace access has not been configured yet.");
  return getIronSession<BrainSession>(await cookies(), {
    cookieName: "secondbrain_session",
    password: process.env.BRAIN_SESSION_SECRET!, ttl: 60 * 60 * 12,
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" }
  });
}
export async function currentUser() {
  if (!sessionReady()) return null;
  const session = await getSession();
  if (!session.username || !session.issuedAt || Date.now() - session.issuedAt > 12 * 60 * 60 * 1000) return null;
  const account = accounts()[session.username];
  if (!account || session.credentialVersion !== account.hash.slice(0, 24)) return null;
  return { name: account.name, role: account.role };
}
export async function requireUser(owner = false) {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Please sign in to your workspace.");
  if (owner && user.role !== "owner") throw new HttpError(403, "Only the workspace owner can change this setting.");
  return user;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const target = new URL(request.url);
  const host = request.headers.get("host") || target.host;
  let accepted = false;
  try { accepted = Boolean(origin && new URL(origin).host === host); } catch { accepted = false; }
  if (!accepted) throw new HttpError(403, "Request origin was not accepted.");
}

const attempts = new Map<string, { count: number; since: number }>();
export async function login(request: Request, username: string, password: string) {
  const identity = createHash("sha256").update(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local").digest("hex").slice(0, 32);
  const now = Date.now();
  const key = `limits/login-${identity}.json`;
  const current = isCloud() ? (await readRecord<{ count: number; since: number }>(key))?.value : attempts.get(identity);
  if (current && now - current.since < 15 * 60 * 1000 && current.count >= 8) throw new HttpError(429, "Too many sign-in attempts. Try again in 15 minutes.");
  const next = { count: (current && now - current.since < 15 * 60 * 1000 ? current.count : 0) + 1, since: current && now - current.since < 15 * 60 * 1000 ? current.since : now };
  if (isCloud()) await updateRecord(key, next, old => now - old.since < 15 * 60 * 1000 ? { ...old, count: old.count + 1 } : next);
  else attempts.set(identity, next);
  const account = accounts()[username.trim().toLowerCase()];
  const derived = await scrypt(password, account?.salt ?? "unknown-account-salt", 64) as Buffer;
  const expected = account ? Buffer.from(account.hash, "hex") : randomBytes(64);
  if (!account || expected.length !== derived.length || !timingSafeEqual(expected, derived)) throw new HttpError(401, "The username or password is incorrect.");
  const session = await getSession();
  session.username = username.trim().toLowerCase(); session.name = account.name; session.role = account.role;
  session.credentialVersion = account.hash.slice(0, 24); session.issuedAt = now;
  await session.save();
  return { name: account.name, role: account.role };
}
