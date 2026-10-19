import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { modelConnection, modelError, credentialError, modelCredential } from "../src/lib/model-provider";

test("OpenRouter requests use its endpoint and namespaced model without leaking to DeepSeek", () => {
  const connection = modelConnection({ provider: "openrouter", model: "deepseek/deepseek-v4.1-flash-1017", apiKey: "sk-or-test-placeholder" });
  assert.equal(connection.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(connection.headers.Authorization, "Bearer sk-or-test-placeholder");
  assert.deepEqual(connection.options, { reasoning: { effort: "none" } });
  assert.equal(connection.label, "OpenRouter");
});

test("direct DeepSeek remains an explicitly separate connection", () => {
  const connection = modelConnection({ provider: "deepseek", model: "deepseek-flash", apiKey: "sk-test-placeholder" });
  assert.equal(connection.url, "https://api.deepseek.com/chat/completions");
  assert.equal(connection.label, "DeepSeek");
  assert.throws(() => modelConnection({ provider: "deepseek", model: "deepseek-flash", apiKey: "sk-or-test-placeholder" }), /OpenRouter key/);
});

test("provider credential errors distinguish key mismatch from credit exhaustion", () => {
  assert.match(credentialError("deepseek", "sk-or-test-placeholder")!, /select OpenRouter/);
  assert.equal(credentialError("openrouter", "sk-or-test-placeholder"), null);
  assert.match(modelError("OpenRouter", 401), /OpenRouter API key/);
  assert.doesNotMatch(modelError("OpenRouter", 401), /balance/);
  assert.match(modelError("OpenRouter", 402), /credit|balance/);
  assert.match(modelError("OpenRouter", 429), /rate limit/i);
});

test("provider selection never reuses another provider's environment key", () => {
  const env = { DEEPSEEK_API_KEY: "direct-placeholder", OPENROUTER_API_KEY: "router-placeholder" };
  assert.equal(modelCredential("openrouter", undefined, env), "router-placeholder");
  assert.equal(modelCredential("deepseek", undefined, env), "direct-placeholder");
  assert.equal(modelCredential("openrouter", undefined, { DEEPSEEK_API_KEY: "direct-placeholder" }), undefined);
  assert.equal(modelCredential("openrouter", "saved-placeholder", env), "saved-placeholder");
});

test("real generation and evidence-review calls use the same provider and preserve writing guidance", () => {
  // server-only is intentionally empty under react-server conditions. Mock only
  // the HTTP boundary, not the production generation/validation implementation.
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    const module = await import('./src/lib/model.ts');
    const {generateGrounded} = module.default || module;
    const citation = {number:1,id:'p1',sourceId:'s1',sourceTitle:'Test notes',page:1,section:'',lineStart:1,lineEnd:1,text:'The notes describe a period of reflection and study.',score:1};
    for (const provider of ['openrouter','deepseek']) {
      const calls=[]; let rejectHeadline=false;
      globalThis.fetch=async (url,options)=> {
        calls.push({url,options,body:JSON.parse(options.body)});
        const value = calls.length===1 ? {title:'Reflection and Study',paragraphs:[{text:'A period of reflection invites study.',citations:[1],evidence:[{citation:1,quote:'a period of reflection and study'}]}]} : {checks:JSON.parse(JSON.parse(options.body).messages[1].content).paragraphs.map(p=>({index:p.index,supported:!(rejectHeadline && p.index===1)}))};
        return Response.json({choices:[{message:{content:JSON.stringify(value)}}]});
      };
      const settings={provider,model:provider==='openrouter'?'deepseek/deepseek-v4.1-flash-1017':'deepseek-flash',apiKey:provider==='openrouter'?'sk-or-test-placeholder':'sk-test-placeholder',writingInstructions:'Specific editorial rule for integration testing.'};
      const output=await generateGrounded('Explain the notes', [citation], settings, true);
      assert.equal(output.title,'Reflection and Study');
      assert.doesNotMatch(output.text,/\\[1\\]/);
      assert.deepEqual(output.evidenceMap,[{paragraphIndex:0,citations:[1]}]);
      assert.equal(calls.length,2);
      assert.ok(calls.every(c=>c.url===(provider==='openrouter'?'https://openrouter.ai/api/v1/chat/completions':'https://api.deepseek.com/chat/completions')));
      assert.ok(calls.every(c=>c.body.model===settings.model));
      assert.ok(calls.every(c=>c.options.headers.Authorization==='Bearer '+settings.apiKey));
      assert.ok(calls[0].body.messages[0].content.includes(settings.writingInstructions));
      assert.ok(calls[0].body.messages[0].content.includes('Format the article in clean Markdown'));
      assert.ok(calls[0].body.messages[0].content.includes('self-contained editorial voice'));
      assert.ok(calls[0].body.messages[0].content.includes('Do not say "the source material"'));
      assert.ok(calls[0].body.messages[0].content.includes('Use ONLY the supplied excerpts'));
      assert.ok(calls[1].body.messages[0].content.includes('skeptical evidence reviewer'));
      const review=JSON.parse(calls[1].body.messages[1].content);
      assert.equal(review.paragraphs.length,2);
      assert.match(review.paragraphs[1].text,/Article headline: Reflection and Study/);
      calls.length=0; rejectHeadline=true;
      await assert.rejects(()=>generateGrounded('Explain the notes',[citation],settings,true),/source-support review/);
      calls.length=0; rejectHeadline=false;
      const answer=await generateGrounded('Explain the notes',[citation],settings,false);
      assert.match(answer.text,/\\[1\\]/);
    }
  `], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
