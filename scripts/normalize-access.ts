import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";

// Some environment pull tools preserve an extra layer of shell quotes.
// Normalize only the account configuration, without exposing credential values.
const access = readFileSync("ACCESS-PRIVATE.txt", "utf8");
const accounts: Record<string, unknown> = {};
for (const [name, role] of [["Alex", "owner"], ["Peter", "member"]]) {
  const match = access.match(new RegExp(`${name}: username ([^\\r\\n]+)\\r?\\nPassword: ([^\\r\\n]+)`));
  if (!match) throw new Error("Private access file is missing an account.");
  const salt = randomBytes(16).toString("hex");
  accounts[match[1]] = { name, role, salt, hash: scryptSync(match[2], salt, 64).toString("hex") };
}
const current = readFileSync(".env.local", "utf8");
const normalized = current.replace(/^BRAIN_USERS_JSON=.*$/m, `BRAIN_USERS_JSON=${JSON.stringify(accounts)}`);
writeFileSync(".env.local", normalized, { mode: 0o600 });
console.log("Private account configuration validated and normalized. Credential values were not printed.");
