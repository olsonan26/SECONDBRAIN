import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCorpus, createPassages, originalSourceName, sha256 } from "../scripts/import-brain";
const importedAt = "2026-10-19T00:00:00.000Z";
function fixture() {
  return {
    created_at_utc: "2026-05-14T11:31:36-06:00",
    source_layers: {
      foundation_sources: [{ path: "Sources/Foundation/Lesson.md", name: "Lesson.md", content: "# Lesson\n\nSource PDF: C:\\old\\Numbers 1\\Lesson.pdf\n\n## Page 1\n\nThe foundation source explains the first principle.\n\n## Page 2\n\nThe second page explains its application.\n" }],
      advanced_sources: [{ path: "Sources/Advanced/Other Eye Opeing things - Method.txt.md", name: "Other Eye Opeing things - Method.txt.md", content: "# Method\n\nSource file: Other Eye Opeing things/Method.txt\n\n## Calculation\n\nA documented method explains the advanced calculation.\n" }],
    },
    graph_data: {
      foundation_graph_json: { nodes: [{ id: "same", label: "Foundation", source_file: "Numbers 1/Lesson.pdf", community: 0 }], links: [] },
      advanced_graph_json: {
        nodes: [{ id: "same", label: "Method", source_file: "C:\\stale\\Other Eye Opeing things\\Method.txt", community: 1 }, { id: "other", label: "Application", source_file: "Method.txt" }],
        links: [{ source: "same", target: "other", relation: "explains", confidence: "INFERRED", confidence_score: 0.7, source_file: "Method.txt" }],
      },
    },
  };
}
test("recovers exact source text, metadata, stable IDs and honest provenance", () => {
  const input = fixture(), corpus = buildCorpus(input, importedAt);
  assert.deepEqual(corpus, buildCorpus(input, importedAt));
  assert.equal(corpus.sources.length, 2); assert.equal(corpus.snapshotDate, "2026-05-14");
  assert.equal(corpus.sources[0].content, input.source_layers.foundation_sources[0].content);
  assert.equal(corpus.sources[0].sha256, sha256(input.source_layers.foundation_sources[0].content));
  assert.equal(corpus.sources[0].format, "pdf"); assert.equal(corpus.sources[0].filename, "Lesson.pdf"); assert.equal(corpus.sources[0].pages, 2);
  assert.equal(corpus.sources[1].format, "txt"); assert.equal(corpus.sources[1].pages, 0);
  for (const source of corpus.sources) {
    assert.equal(source.originalAvailable, false); assert.equal(source.characters, source.content!.length);
    assert.match(source.provenance, /Recovered verbatim.*2026-05-14/); assert.match(source.provenance, /has not been verified/);
  }
});
test("passages preserve exact text, source line ranges and page anchors without header noise", () => {
  const corpus = buildCorpus(fixture(), importedAt), passages = corpus.passages.filter(passage => passage.sourceId === corpus.sources[0].id);
  assert.deepEqual(passages.map(passage => passage.page), [1, 2]);
  assert.deepEqual(passages.map(passage => [passage.lineStart, passage.lineEnd]), [[7, 7], [11, 11]]);
  assert.ok(corpus.passages.every(passage => !passage.text.includes("Source PDF:") && !passage.text.includes("Source file:")));
  assert.equal(corpus.passages.find(passage => passage.sourceId === corpus.sources[1].id)?.section, "Calculation");
});
test("long pages chunk into bounded exact substrings with complete paragraph coverage", () => {
  const source = buildCorpus(fixture(), importedAt).sources[0];
  const paragraphs = Array.from({ length: 28 }, (_, i) => `Paragraph ${i}: ${"Exact quotation evidence has stable words and punctuation. ".repeat(8)}`);
  const content = `# Long source\r\n\r\nSource file: Long.txt\r\n\r\n## Page 9\r\n\r\n${paragraphs.join("\r\n\r\n")}\r\n`;
  const passages = createPassages({ ...source, content, characters: content.length }, content);
  assert.ok(passages.length > 5);
  for (const passage of passages) {
    assert.ok(passage.text.length <= 1900); assert.ok(content.includes(passage.text)); assert.equal(passage.page, 9);
    assert.ok(content.split(/\n/).slice(passage.lineStart - 1, passage.lineEnd).join("\n").includes(passage.text));
  }
  for (let i = 0; i < paragraphs.length; i++) assert.ok(passages.some(passage => passage.text.includes(`Paragraph ${i}:`)));
});
test("stale paths map to sources, graph IDs are namespaced, confidence and degrees are preserved", () => {
  const corpus = buildCorpus(fixture(), importedAt);
  assert.deepEqual(corpus.nodes.map(node => node.id), ["foundation:same", "advanced:same", "advanced:other"]);
  assert.deepEqual(corpus.nodes.map(node => node.degree), [0, 1, 1]); assert.ok(corpus.nodes.every(node => node.sourceIds.length === 1));
  assert.equal(corpus.edges[0].confidence, "INFERRED"); assert.equal(corpus.edges[0].score, 0.7);
  assert.deepEqual(corpus.edges[0].sourceIds, [corpus.sources[1].id]); assert.ok(!corpus.warnings.some(warning => warning.startsWith("Unmapped")));
});
test("DOCX comments recover original filenames despite hashed extraction names", () => {
  const source = { path: "Sources/Advanced/Study_ab12cd34.md", name: "Study_ab12cd34.md", content: "<!-- converted from Original study.docx -->\n\nTraining content.\n" };
  assert.equal(originalSourceName(source), "Original study.docx");
  const input = fixture(); input.source_layers.advanced_sources = [source];
  input.graph_data.advanced_graph_json.nodes[0].source_file = "C:\\old\\Original   study.docx";
  input.graph_data.advanced_graph_json.nodes[1].source_file = "Original study.docx";
  input.graph_data.advanced_graph_json.links[0].source_file = "Original study.docx";
  const corpus = buildCorpus(input, importedAt);
  assert.equal(corpus.sources[1].format, "docx"); assert.equal(corpus.sources[1].filename, "Original study.docx");
  assert.ok(corpus.nodes.filter(node => node.layer === "advanced").every(node => node.sourceIds.length === 1));
});
test("unmapped references stay explicit and receive no fabricated source IDs", () => {
  const input = fixture(); input.graph_data.advanced_graph_json.nodes[0].source_file = "Absent document.pdf"; input.graph_data.advanced_graph_json.links[0].source_file = "Absent document.pdf";
  const corpus = buildCorpus(input, importedAt);
  assert.deepEqual(corpus.nodes.find(node => node.id === "advanced:same")?.sourceIds, []); assert.deepEqual(corpus.edges[0].sourceIds, []);
  assert.equal(corpus.warnings.filter(warning => warning.startsWith("Unmapped")).length, 2);
});
test("heading-only sources create no retrieval passages", () => {
  assert.deepEqual(createPassages(buildCorpus(fixture(), importedAt).sources[0], "# A title\n\nSource file: Example.pdf\n\n## Page 1\n\n### A section\n\n---\n"), []);
});
