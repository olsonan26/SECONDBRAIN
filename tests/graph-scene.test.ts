import assert from "node:assert/strict";
import test from "node:test";
import { createGraphScene, GRAPH_SCENE_LIMIT } from "../src/lib/graph-scene";
import type { GraphEdge, GraphNode } from "../src/lib/types";

const node = (id: string, degree = 0): GraphNode => ({ id, label: id, type: "teaching", layer: "uploaded", community: "Astrology", sourceIds: ["book"], description: "A distinct teaching", degree });
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target, relation: "explains", confidence: "EXTRACTED", score: 1, sourceIds: ["book"] });

test("large graph overview is bounded without mutating or discarding stored knowledge", () => {
  const nodes = Array.from({ length: 2300 }, (_, index) => node(`n${index}`, index));
  const scene = createGraphScene(nodes, [], null);
  assert.equal(scene.nodes.length, GRAPH_SCENE_LIMIT);
  assert.equal(scene.candidateCount, 2300);
  assert.equal(nodes.length, 2300);
  assert.equal(scene.nodes[0].id, "n2299");
});

test("selecting a teaching outside the overview brings that exact teaching and neighbors into focus", () => {
  const nodes = Array.from({ length: 2300 }, (_, index) => node(`n${index}`, index));
  const scene = createGraphScene(nodes, [edge("n0", "n2299"), edge("n2298", "n2299")], "n0");
  assert.equal(scene.focused, true);
  assert.deepEqual(scene.nodes.map(item => item.id), ["n0", "n2299"]);
  assert.deepEqual(scene.edges.map(item => item.id), ["n0-n2299"]);
});

test("unknown selection falls back to an honest graph overview", () => {
  const scene = createGraphScene([node("first"), node("second")], [edge("first", "second")], "missing");
  assert.equal(scene.focused, false);
  assert.equal(scene.nodes.length, 2);
  assert.equal(scene.edges.length, 1);
});

test("a highly connected selected node stays pinned even when its neighborhood exceeds the scene limit", () => {
  const nodes = [node("hub"), ...Array.from({ length: 2100 }, (_, index) => node(`n${index}`, index))];
  const edges = nodes.slice(1).map(item => edge("hub", item.id));
  const scene = createGraphScene(nodes, edges, "hub");
  assert.equal(scene.nodes[0].id, "hub");
  assert.equal(scene.nodes.length, GRAPH_SCENE_LIMIT);
  assert.equal(scene.candidateCount, 2101);
  assert.equal(scene.edges.length, GRAPH_SCENE_LIMIT - 1);
});
