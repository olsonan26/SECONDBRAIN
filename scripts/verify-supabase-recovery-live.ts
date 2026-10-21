import { chromium, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

async function main() {
  const origin=process.env.BRAIN_VERIFY_ORIGIN??"https://secondbrain-nu-nine.vercel.app";
  const recoveryId="5c9e08c7-21fd-4c8e-95a1-1c6830ff092d";
  const oldId="a2f66ffe-ae02-40eb-a264-a5697dcb6c5b";
  const access=readFileSync("ACCESS-PRIVATE.txt","utf8");
  const hash=(bytes:string|Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
  const photo=JSON.parse(readFileSync("private/astrology-photos/1-OvR9q2Zf3LZAimp-rLguz3LjZhXx42z.ocr.json","utf8"));
  const passageId=`photo-${photo.sha256.slice(0,28)}`;
  const browser=await chromium.launch({headless:true,executablePath:"C:/Users/olson/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"});
  let sharedSettings="";
  try {
    const anonymous=await browser.newContext();
    assert.equal((await anonymous.request.get(`${origin}/api/workspace`)).status(),401);
    await anonymous.close();
    for(const name of ["Alex","Peter"]) {
      const credentials=access.match(new RegExp(`${name}: username ([^\\r\\n]+)\\r?\\nPassword: ([^\\r\\n]+)`)); assert.ok(credentials);
      const context=await browser.newContext({viewport:{width:name==="Peter"?390:1440,height:950}});
      const login=await context.request.post(`${origin}/api/auth/login`,{headers:{Origin:origin},data:{username:credentials[1],password:credentials[2]}});
      assert.equal(login.status(),200,`${name} sign-in failed`);
      const response=await context.request.get(`${origin}/api/workspace?brain=main`); assert.equal(response.status(),200);
      const main=await response.json();
      assert.equal(main.stats.sources,74); assert.equal(main.stats.passages,2348); assert.equal(main.stats.nodes,565); assert.equal(main.stats.edges,825);
      assert.equal(main.recovery.pendingCloudRecovery,true); assert.equal(main.recovery.extractionBlocked,true);
      assert.equal(main.settings.provider,"openrouter"); assert.equal(main.settings.connected,true); assert.ok(main.settings.writingInstructions.length>4000);
      const settingsHash=hash(JSON.stringify(main.settings)); if(sharedSettings) assert.equal(settingsHash,sharedSettings); sharedSettings=settingsHash;
      const astro=await (await context.request.get(`${origin}/api/workspace?brain=${recoveryId}`)).json();
      assert.equal(astro.brain.name,"Astrology (recovered sources)"); assert.equal(astro.stats.sources,3); assert.equal(astro.stats.passages,2749); assert.equal(astro.stats.teachings,0);
      assert.ok(!astro.brains.some((b:{id:string})=>b.id===oldId),"Old live brain must not be impersonated by source recovery");
      const coverage=await (await context.request.get(`${origin}/api/knowledge/coverage?brain=${recoveryId}`)).json();
      assert.equal(coverage.totalEntries,493);
      const jobs=await (await context.request.get(`${origin}/api/knowledge/jobs?brain=${recoveryId}`)).json(); assert.equal(jobs.jobs.length,0);
      const blocked=await context.request.post(`${origin}/api/knowledge/jobs?brain=${recoveryId}`,{headers:{Origin:origin},data:{sourceIds:["upload-5bd9e58b62009b1fedbc"],budgetUsd:10}});
      assert.equal(blocked.status(),name==="Alex"?409:403);
      const spending=await (await context.request.get(`${origin}/api/spending?brain=${recoveryId}`)).json();
      assert.equal(spending.historyIncomplete,true); assert.equal(spending.extraction.trackedUsd,null);
      const passage=await (await context.request.get(`${origin}/api/passage?brain=${recoveryId}&id=${passageId}`)).json();
      assert.equal(passage.image.sha256,photo.sha256);
      assert.equal((await context.request.get(`${origin}/api/source-image?brain=main&passage=${passageId}`)).status(),404);
      if(name==="Alex") {
        const image=await context.request.get(`${origin}/api/source-image?brain=${recoveryId}&passage=${passageId}`); assert.equal(image.status(),200); assert.equal(hash(await image.body()),photo.sha256);
        for(const [id,sha] of [["upload-5bd9e58b62009b1fedbc","a821e6e585aa027d1d2a1a6dc0b6814a1169ebc6d8d75e1212e91dff72737a69"],["upload-8504c3a96b79a0f19dfa","9d5fb55cf6d4f2134ed780c2694503d2dde42bdad68add60ff35acef0237161d"]]) {
          const pdf=await context.request.get(`${origin}/api/original?brain=${recoveryId}&id=${id}`);assert.equal(pdf.status(),200);assert.equal(hash(await pdf.body()),sha);
        }
      }
      const page=await context.newPage(); const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
      await page.goto(`${origin}/?brain=${oldId}`); await page.waitForURL(`**/?brain=${recoveryId}`);
      await expect(page.getByRole("status",{name:"Recovery status"})).toBeVisible();
      await page.getByRole("button",{name:"Knowledge extraction",exact:true}).click();
      await expect(page.getByText("New AI scanning is locked while the previous scan checkpoint and spending ledger await recovery.", {exact:false})).toBeVisible();
      await expect(page.getByRole("region",{name:"Model spending"})).toContainText("Unavailable");
      await expect(page.getByRole("button",{name:"Refresh spending"})).toBeEnabled({timeout:20000});
      await expect(page.getByText("Loading saved extraction progress…",{exact:true})).not.toBeVisible({timeout:20000});
      assert.deepEqual(errors,[]);
      mkdirSync("private/migration/local-source-recovery",{recursive:true});
      await page.screenshot({path:`private/migration/local-source-recovery/${name.toLowerCase()}-live.png`,fullPage:true});
      console.log(JSON.stringify({account:name,signIn:true,mainSources:74,mainNodes:565,recoveredAstrologyPassages:2749,requirements:493,sharedSettings:true,extractionSafelyBlocked:true,historicalSpendNotReset:true,originalPdfsVerified:name==="Alex",originalImageVerified:name==="Alex",paidModelCalls:0,uiErrors:errors.length}));
      await context.close();
    }
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Live recovery verification failed");process.exitCode=1;});
