import { chromium, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { RECOVERED_ASTROLOGY_ID, ORIGINAL_PHOTO_SOURCE_ID } from "../src/lib/fresh-scan-policy";

async function main() {
  const origin="https://secondbrain-nu-nine.vercel.app";
  const access=readFileSync("ACCESS-PRIVATE.txt","utf8");
  const browser=await chromium.launch({headless:true,executablePath:"C:/Users/olson/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"});
  try {
    for(const name of ["Alex","Peter"]) {
      const credentials=access.match(new RegExp(`${name}: username ([^\\r\\n]+)\\r?\\nPassword: ([^\\r\\n]+)`));assert.ok(credentials);
      const context=await browser.newContext({viewport:{width:1400,height:1000}});
      const login=await context.request.post(`${origin}/api/auth/login`,{headers:{Origin:origin},data:{username:credentials[1],password:credentials[2]}});assert.equal(login.status(),200);
      const workspace=await (await context.request.get(`${origin}/api/workspace?brain=${RECOVERED_ASTROLOGY_ID}`)).json();
      assert.equal(workspace.recovery.extractionBlocked,false);assert.equal(workspace.recovery.pendingCloudRecovery,true);assert.equal(workspace.recovery.freshScan.budgetUsd,10);
      const policy=workspace.recovery.freshScan;
      const jobs=(await (await context.request.get(`${origin}/api/knowledge/jobs?brain=${RECOVERED_ASTROLOGY_ID}`)).json()).jobs;
      const job=jobs.find((j:{id:string})=>j.id===policy.jobId);assert.ok(job);assert.equal(job.budgetUsd,10);assert.equal(job.totalPassages,1028);assert.equal(job.imagePassages,1028);
      assert.deepEqual(job.sourceIds,[ORIGINAL_PHOTO_SOURCE_ID]);
      const main=await (await context.request.get(`${origin}/api/workspace?brain=main`)).json();assert.equal(main.recovery.extractionBlocked,true);assert.equal(main.stats.sources,74);
      const coverage=await (await context.request.get(`${origin}/api/knowledge/coverage?brain=${RECOVERED_ASTROLOGY_ID}`)).json();assert.equal(coverage.totalEntries,493);assert.equal(coverage.jobId,policy.jobId);
      const spending=await (await context.request.get(`${origin}/api/spending?brain=${RECOVERED_ASTROLOGY_ID}`)).json();assert.equal(spending.freshScan,true);assert.equal(spending.historyIncomplete,true);assert.equal(spending.extraction.latestJob.capUsd,10);
      if(name==="Peter") {const denied=await context.request.post(`${origin}/api/knowledge/jobs/${policy.jobId}/resume?brain=${RECOVERED_ASTROLOGY_ID}`,{headers:{Origin:origin},data:{}});assert.equal(denied.status(),403);}
      const page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
      await page.goto(`${origin}/?brain=${RECOVERED_ASTROLOGY_ID}`);await page.getByRole("button",{name:"Knowledge extraction",exact:true}).click();
      await expect(page.getByRole("heading",{name:"Full-book pass 1 of 3"})).toBeVisible({timeout:30000});
      await expect(page.getByText("Scanning locked until recovery",{exact:true})).toHaveCount(0);
      if(name==="Alex") {
        await expect(page.getByRole("button",{name:"Resume",exact:true})).toBeEnabled();
        let interceptedSteps=0;
        // Exercise the real Resume endpoint, but never let verification purchase a model call.
        await context.route("**/api/knowledge/jobs/*/step?**",async route=>{
          interceptedSteps++;
          await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({...job,stage:"paused"})});
        });
        const endpoint=`${origin}/api/knowledge/jobs/${policy.jobId}`;
        try {
          const responsePromise=page.waitForResponse(r=>r.url().includes(`/${policy.jobId}/resume?`)&&r.request().method()==="POST");
          await page.getByRole("button",{name:"Resume",exact:true}).click();
          const response=await responsePromise;
          assert.equal(response.status(),200,"Actual Resume button must succeed");
          assert.deepEqual(response.request().postDataJSON(),{});
          await expect.poll(()=>interceptedSteps).toBeGreaterThan(0);
        } finally {
          await page.close();
          const paused=await context.request.post(`${endpoint}/pause?brain=${RECOVERED_ASTROLOGY_ID}`,{headers:{Origin:origin},data:{}});
          assert.equal(paused.status(),200);
        }
        // A stale browser may still send no body; only optional Resume input accepts that.
        const legacy=await context.request.post(`${endpoint}/resume?brain=${RECOVERED_ASTROLOGY_ID}`,{headers:{Origin:origin}});
        try { assert.equal(legacy.status(),200,"Empty legacy Resume must work"); }
        finally { assert.equal((await context.request.post(`${endpoint}/pause?brain=${RECOVERED_ASTROLOGY_ID}`,{headers:{Origin:origin},data:{}})).status(),200); }
        const malformed=await context.request.post(`${endpoint}/resume?brain=${RECOVERED_ASTROLOGY_ID}`,{headers:{Origin:origin,"Content-Type":"application/json"},data:"{"});
        assert.equal(malformed.status(),400);
        const after=await (await context.request.get(`${endpoint}?brain=${RECOVERED_ASTROLOGY_ID}`)).json();
        assert.equal(after.stage,"paused");
        for(const key of ["costUsd","processedPassages","budgetUsd"]) assert.equal(after[key],job[key],`${key} must remain unchanged`);
        console.log(JSON.stringify({actualResumeVerified:true,legacyResumeVerified:true,malformedJsonRejected:true,paidCallsStarted:0}));
        await context.close();
        continue;
      }
      else await expect(page.getByRole("button",{name:"Resume",exact:true})).toHaveCount(0);
      await expect(page.getByRole("region",{name:"Model spending"})).toContainText("Fresh scan extraction");
      assert.deepEqual(errors,[]);mkdirSync("private/migration/fresh-scan",{recursive:true});await page.screenshot({path:`private/migration/fresh-scan/${name.toLowerCase()}-ready.png`,fullPage:true});
      console.log(JSON.stringify({account:name,unlocked:true,jobId:policy.jobId,stage:job.stage,images:job.imagePassages,priorities:coverage.totalEntries,capUsd:job.budgetUsd,legacyStateStillPending:true,ownerOnlyResume:true,paidCallsStarted:0,browserErrors:errors.length}));
      await context.close();
    }
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Fresh scan live verification failed");process.exitCode=1;});
