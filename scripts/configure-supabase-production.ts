import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { supabaseRead } from "../src/lib/supabase-storage";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
async function main() {
  assert.equal(process.env.BRAIN_SUPABASE_URL,"https://gocduruhpoyshixuqhrc.supabase.co");
  assert.ok(process.env.BRAIN_SUPABASE_GATEWAY_TOKEN);
  const manifest=JSON.parse(await readFile("private/migration/local-source-recovery/manifest.json","utf8"));
  assert.equal(manifest.complete,true,"A complete source-recovery import is required before production configuration");
  assert.equal(manifest.completeLegacyCloudState,false);
  assert.equal(manifest.records.length,8); assert.equal(manifest.originals.length,2);
  for(const expected of manifest.records) {
    const record=await supabaseRead(expected.key); assert.ok(record);
    assert.equal(createHash("sha256").update(canonical(record.value)).digest("hex"),expected.sha256,"Destination changed after verification; configuration stopped");
  }
  if(!process.argv.includes("--apply")) {console.log(JSON.stringify({ready:true,productionChanged:false}));return;}
  const cli="C:/Users/olson/AppData/Local/npm-cache/_npx/69f9afb961c37556/node_modules/vercel/dist/index.js";
  for(const [name,value,sensitive] of [
    ["BRAIN_SUPABASE_URL",process.env.BRAIN_SUPABASE_URL,false],
    ["BRAIN_SUPABASE_GATEWAY_TOKEN",process.env.BRAIN_SUPABASE_GATEWAY_TOKEN,true],
    ["BRAIN_STORAGE_BACKEND","supabase",false],
  ] as const) {
    const result=spawnSync(process.execPath,[cli,"env","add",name,"production","--force","--yes",sensitive?"--sensitive":"--no-sensitive","--project","prj_Jixqn3z8O7f1TGIyqdzLbBvxGFSv","--scope","alex-olsons-projects-43241a84"],{input:value,encoding:"utf8",windowsHide:true,timeout:60000});
    assert.equal(result.status,0,`Could not configure ${name}; credentials and provider output were not printed`);
    console.log(JSON.stringify({configured:name,target:"production",sensitive}));
  }
  console.log(JSON.stringify({configured:true,requiresNewDeployment:true,legacyStoreUntouched:true,sessionSecretUnchanged:true}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Production configuration stopped");process.exitCode=1;});
