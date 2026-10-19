import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const envPath=path.join(process.cwd(),".env.local");
if(existsSync(envPath)){console.log("Existing .env.local preserved. Local access is already configured.");process.exit(0);}
const secret=randomBytes(48).toString("base64url");
const accounts:Record<string,unknown>={};
const access:string[]=["SECONDBRAIN PRIVATE ACCESS","Keep this file private. It is ignored by Git and Vercel uploads.","Local URL: http://localhost:3000",""];
for(const [username,name,role] of [["alex","Alex","owner"],["peter","Peter","member"]]){
  const password=randomBytes(18).toString("base64url"),salt=randomBytes(16).toString("hex");
  accounts[username]={name,role,salt,hash:scryptSync(password,salt,64).toString("hex")};
  access.push(`${name}: username ${username}`,`Password: ${password}`,"");
}
writeFileSync(envPath,`BRAIN_SESSION_SECRET=${secret}\nBRAIN_USERS_JSON='${JSON.stringify(accounts)}'\n`,{mode:0o600});
writeFileSync(path.join(process.cwd(),"ACCESS-PRIVATE.txt"),access.join("\n"),{mode:0o600});
console.log("Created private local credentials for Alex and Peter. See ACCESS-PRIVATE.txt; no credentials were printed.");
