import test from "node:test";
import assert from "node:assert/strict";
import { detectKnownQuestionCategory, findQuestionTags, parseQuestionRequirements, questionCoverage } from "../src/lib/knowledge-questions";
import type { Corpus } from "../src/lib/types";
import { spawnSync } from "node:child_process";

test("requirements retain each numbered question and repeated technical topic in its category", () => {
  const input = `PART I: Sample questions
1. Identity, personality, and self-discovery
1. Which qualities feel natural to me?
2. Which qualities would I like to express?
2. Life purpose and direction
1. Which direction feels meaningful?
Coordinates and readings
Details about the framework.
- Related Energies
- Boundaries
Changing conditions
Details about a second section.
- Related Energies`;
  const entries = parseQuestionRequirements(input);
  assert.equal(entries.length, 6);
  assert.deepEqual(entries.map(entry => entry.text), [
    "Which qualities feel natural to me?", "Which qualities would I like to express?", "Which direction feels meaningful?",
    "Related Energies", "Boundaries", "Related Energies",
  ]);
  assert.equal(entries[0].category, "Identity, personality, and self-discovery");
  assert.equal(entries[2].category, "Life purpose and direction");
  assert.equal(entries[3].category, "Coordinates and readings");
  assert.equal(entries[5].category, "Changing conditions");
  assert.notEqual(entries[3].id, entries[5].id);
  assert.deepEqual(parseQuestionRequirements(input), entries);
});

test("exact normalized profile questions route by category rather than guessing from generic wording", () => {
  const profile = parseQuestionRequirements(`1. Career and employment
1. Which direction feels meaningful?
2. Health, vitality, and personal wellbeing
1. Where might I need more balance?`);
  assert.deepEqual(findQuestionTags("  WHICH direction feels meaningful! ", profile), ["career"]);
  assert.deepEqual(findQuestionTags("Where might I need more balance?", profile), ["wellbeing"]);
  assert.deepEqual(findQuestionTags("Which direction feels meaningful to a stranger?", profile), []);
  assert.deepEqual(findQuestionTags("How does declination work?", profile), []);
  assert.deepEqual(findQuestionTags("Which career themes are described?", []), ["career"]);
  assert.deepEqual(detectKnownQuestionCategory("8. What someone else thinks, feels, and wants"), ["relationship"]);
});

const evidenceText = "The sample method combines two named chart ingredients before applying its boundary rule.";
const corpus: Corpus = {
  version: 1, importedAt: "", snapshotDate: "", warnings: [], edges: [],
  sources: [{ id: "source-1", title: "Synthetic handbook", filename: "synthetic.txt", layer: "uploaded", format: "txt", characters: evidenceText.length, pages: 1, sha256: "synthetic", importedAt: "", provenance: "Synthetic test", originalAvailable: true, content: evidenceText }],
  passages: [{ id: "passage-1", sourceId: "source-1", sourceTitle: "Synthetic handbook", page: 7, section: "Methods", lineStart: 1, lineEnd: 1, text: evidenceText }],
  nodes: [{ id: "teaching-1", label: "Combining ingredients", aliases: ["Ingredient combination"], community: "Methods", description: evidenceText, type: "teaching", layer: "uploaded", sourceIds: ["source-1"], degree: 0, applicationTags: ["career"], evidence: [{ passageId: "passage-1", sourceId: "source-1", page: 7, quote: "combines two named chart ingredients" }] }],
};

test("coverage returns candidate evidence and scoped exact-passage links without declaring questions answered", () => {
  const entries = questionCoverage(corpus, `1. Career and employment
1. Which conditions could help my work?
Methods
- Ingredient combinations
- Unrecorded technique`, { brainId: "brain-example", pending: false });
  assert.equal(entries[0].status, "candidate");
  assert.deepEqual(entries[0].nodeIds, ["teaching-1"]);
  assert.equal(entries[1].status, "candidate");
  assert.equal(entries[2].status, "not-found");
  assert.deepEqual(entries[2].evidence, []);
  assert.equal(entries[0].evidence[0].page, 7);
  assert.equal(entries[0].evidence[0].quote, "combines two named chart ingredients");
  assert.equal(entries[0].evidence[0].href, "/api/passage?id=passage-1&brain=brain-example");
  assert.match(entries[0].warnings.join(" "), /not.*answer|not.*coverage|not.*proof/i);
});

test("unverified, mismatched, and document-only nodes never become coverage evidence", () => {
  for (const badNode of [
    { ...corpus.nodes[0], type: "document" },
    { ...corpus.nodes[0], evidence: [] },
    { ...corpus.nodes[0], evidence: [{ ...corpus.nodes[0].evidence![0], quote: "This fabricated statement has no source support." }] },
    { ...corpus.nodes[0], evidence: [{ ...corpus.nodes[0].evidence![0], page: 100 }] },
    { ...corpus.nodes[0], evidence: [{ ...corpus.nodes[0].evidence![0], sourceId: "another-brain" }] },
  ]) {
    const result = questionCoverage({ ...corpus, nodes: [badNode] }, "Methods\n- Ingredient combination", { pending: true });
    assert.equal(result[0].status, "pending");
    assert.deepEqual(result[0].nodeIds, []);
    assert.deepEqual(result[0].evidence, []);
  }
});

test("sensitive domains are candidates only, and missing drawings stay explicit warnings", () => {
  const data = { ...corpus, nodes: [{ ...corpus.nodes[0], applicationTags: ["wellbeing", "relationship"] }] };
  const result = questionCoverage(data, `1. Health, vitality, and personal wellbeing
1. Where could I seek balance?
2. What someone else thinks, feels, and wants
1. What might another person want?`, { warnings: ["Some source drawings are missing and need visual review."] });
  assert.equal(result[0].status, "candidate");
  assert.match(result[0].warnings.join(" "), /not medical diagnoses/);
  assert.match(result[1].warnings.join(" "), /cannot verify.*private thoughts/);
  assert.match(result[1].warnings.join(" "), /drawings are missing/);
});

test("numbered technical topics and duplicate same-category bullets remain distinct and stable", () => {
  const entries = parseQuestionRequirements("1. Method Alpha\n2. Method Beta\n- Step One\n- Step One");
  assert.deepEqual(entries.map(entry => entry.kind), ["topic", "topic", "topic", "topic"]);
  assert.equal(new Set(entries.map(entry => entry.id)).size, 4);
  assert.equal(entries[2].category, "Method Beta");
});

test("question profiles persist privately per brain and coverage respects unfinished extraction", () => {
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { mkdtemp, rm } from 'node:fs/promises';
    import path from 'node:path';
    import os from 'node:os';
    process.env.BLOB_READ_WRITE_TOKEN = ''; process.env.BLOB_STORE_ID = ''; delete process.env.VERCEL;
    const load = async p => { const value = await import(p); return value.default || value; };
    const { saveQuestionProfile, getQuestionProfile, getQuestionCoverage } = await load('./src/lib/knowledge-question-profile.ts');
    const { writeRecord } = await load('./src/lib/storage.ts');
    const { brainKey } = await load('./src/lib/brain-scope.ts');
    const original = process.cwd();
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'secondbrain-question-profile-'));
    process.chdir(temporary);
    const brain = '570f0658-018b-464f-a44b-eab3e7d11689';
    const job = '661160ac-fb5f-4dc3-a2fe-b3c67c693add';
    try {
      const saved = await saveQuestionProfile('1. Career and employment\\n1. Which path could suit this example?', job, brain, ['A diagram needs review.']);
      assert.equal(saved.entries.length, 1);
      assert.equal((await getQuestionProfile(brain)).jobId, job);
      assert.equal(await getQuestionProfile('main'), null);
      assert.equal((await getQuestionCoverage(brain)).entries[0].status, 'pending');
      assert.equal((await getQuestionCoverage('main')).entries.length, 0);
      await writeRecord(brainKey(brain, 'knowledge/jobs/' + job + '.json'), { stage: 'complete', passages: [], warnings: [] });
      const finished = await getQuestionCoverage(brain);
      assert.equal(finished.entries[0].status, 'not-found');
      assert.equal(finished.summary.questions, 1);
      assert.match(finished.warnings.join(' '), /diagram needs review/i);
      const revised = await saveQuestionProfile('1. Updated topic', job, brain);
      assert.equal((await getQuestionProfile(brain)).entries[0].text, revised.entries[0].text);
      assert.equal(await getQuestionProfile('main'), null);
      await saveQuestionProfile('1. Career and employment\\n' + Array.from({ length: 60 }, (_, i) => (i + 1) + '. Example number ' + (i + 1) + '?').join('\\n'), job, brain);
      const firstPage = await getQuestionCoverage(brain);
      assert.equal(firstPage.entries.length, 20);
      assert.equal(firstPage.totalEntries, 60);
      assert.equal(firstPage.summary.questions, 60);
      assert.equal(firstPage.hasMore, true);
      const lastPage = await getQuestionCoverage(brain, { offset: 50, limit: 25 });
      assert.equal(lastPage.entries.length, 10);
      assert.equal(lastPage.hasMore, false);
      const filtered = await getQuestionCoverage(brain, { query: 'number 60' });
      assert.equal(filtered.filteredEntries, 1);
      assert.equal(filtered.entries[0].text, 'Example number 60?');
      const summary = await getQuestionCoverage(brain, { summaryOnly: true });
      assert.equal(summary.entries.length, 60);
      assert.equal(summary.hasMore, false);
      assert.ok(summary.entries.every(entry => entry.evidence.length === 0 && entry.warnings.length === 0));
      assert.equal((await getQuestionCoverage(brain, { limit: 1000 })).entries.length, 25);
    } finally {
      process.chdir(original);
      assert.ok(path.resolve(temporary).startsWith(path.join(os.tmpdir(), 'secondbrain-question-profile-')));
      await rm(temporary, { recursive: true, force: true });
    }
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
