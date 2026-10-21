import type { Corpus, GraphNode, KnowledgeEvidence, Passage, Source } from "./types";

export type ApplicationTag = "identity" | "purpose" | "emotions" | "desire" | "childhood" | "love" | "relationship" | "compatibility" | "breakup" | "marriage" | "intimacy" | "friendship" | "family" | "parenting" | "money" | "career" | "business" | "timing" | "decisions" | "relocation" | "reputation" | "loss" | "wellbeing" | "spirituality";
export interface QuestionRequirement {
  id: string;
  kind: "question" | "topic";
  text: string;
  category: string;
  applicationTags: ApplicationTag[];
  line: number;
}
export interface QuestionCoverageEvidence extends KnowledgeEvidence {
  nodeId: string;
  sourceTitle: string;
  href: string;
}
export interface QuestionCoverageEntry extends QuestionRequirement {
  question: string;
  status: "candidate" | "not-found" | "pending";
  nodeIds: string[];
  evidence: QuestionCoverageEvidence[];
  warnings: string[];
}
export type RequirementInput = string | readonly string[];

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function stableHash(value: string) {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ value.charCodeAt(i), 0x85ebca6b);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

const categories: readonly [RegExp, ApplicationTag[]][] = [
  [/^identity personality and self discovery$/, ["identity"]],
  [/^life purpose and direction$/, ["purpose"]],
  [/^emotions mental patterns and inner struggles$/, ["emotions"]],
  [/^hidden desires forbidden wants and internal conflicts$/, ["desire"]],
  [/^childhood upbringing and past patterns$/, ["childhood"]],
  [/^love and dating$/, ["love"]],
  [/^current romantic relationships$/, ["relationship"]],
  [/^what someone else thinks feels and wants$/, ["relationship"]],
  [/^compatibility and relationship dynamics$/, ["compatibility"]],
  [/^exes breakups and unresolved relationships$/, ["breakup"]],
  [/^marriage and long term commitment$/, ["marriage"]],
  [/^physical attraction intimacy and desire$/, ["intimacy"]],
  [/^friendships and social relationships$/, ["friendship"]],
  [/^parents siblings and family relationships$/, ["family"]],
  [/^children and parenting$/, ["parenting"]],
  [/^money wealth and financial behavior$/, ["money"]],
  [/^career and employment$/, ["career"]],
  [/^business entrepreneurship and business partnerships$/, ["business"]],
  [/^the future and timing$/, ["timing"]],
  [/^major decisions and crossroads$/, ["decisions"]],
  [/^moving relocation and environment$/, ["relocation"]],
  [/^reputation recognition and how the world sees you$/, ["reputation"]],
  [/^loss endings betrayal and difficult experiences$/, ["loss"]],
  [/^health vitality and personal wellbeing$/, ["wellbeing"]],
  [/^spirituality fulfillment and personal transformation$/, ["spirituality"]],
];

export function detectKnownQuestionCategory(category: string): ApplicationTag[] {
  const key = normalize(category.replace(/^\s*\d+[.)]\s*/, ""));
  return [...(categories.find(([pattern]) => pattern.test(key))?.[1] ?? [])];
}

/** Requirements remain private data. List numbering and formatting are not part of the question text. */
export function parseQuestionRequirements(requirements: RequirementInput): QuestionRequirement[] {
  const inputs = typeof requirements === "string" ? [requirements] : requirements;
  const entries: QuestionRequirement[] = [], occurrences = new Map<string, number>();
  let offset = 0;
  for (const input of inputs) {
    const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/);
    let category = "General", headingLine = -1;
    const add = (kind: QuestionRequirement["kind"], text: string, line: number) => {
      const identity = `${kind}|${normalize(category)}|${normalize(text)}`;
      const count = (occurrences.get(identity) ?? 0) + 1;
      occurrences.set(identity, count);
      entries.push({ id: `requirement-${stableHash(identity)}-${count}`, kind, text, category, applicationTags: kind === "question" ? detectKnownQuestionCategory(category) : [], line: offset + line + 1 });
    };
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw) continue;
      const line = raw.replace(/^#{1,6}\s+/, "").replace(/^\*\*(.+)\*\*$/, "$1");
      if (/^PART\s+[IVXLCDM]+\s*:/i.test(line)) continue;
      const numbered = /^(\d+)[.)]\s+(.+)$/.exec(line);
      if (numbered) {
        const text = numbered[2].trim();
        if (/\?\s*$/.test(text)) add("question", text, i);
        else {
          const next = lines.slice(i + 1).find(value => value.trim())?.trim() ?? "";
          category = text; headingLine = i;
          if (!detectKnownQuestionCategory(text).length && !/^\d+[.)]\s+.+\?\s*$/.test(next)) add("topic", text, i);
        }
        continue;
      }
      const bullet = /^[-*•]\s+(.+)$/.exec(line);
      if (bullet) { add("topic", bullet[1].trim(), i); continue; }
      // Chapter titles can precede a short descriptive paragraph and a topic list.
      const next = lines.slice(i + 1).filter(value => value.trim()).slice(0, 2);
      if (/^#{1,6}\s/.test(raw) || (line.length <= 120 && next.some(value => /^\s*[-*•]\s+/.test(value)))) {
        if (!/^\s*[-*•]\s+/.test(next[0] ?? "") && next.length < 2) continue;
        let previousLine = i - 1;
        while (previousLine >= 0 && !lines[previousLine].trim()) previousLine--;
        if (previousLine !== headingLine || /^#{1,6}\s/.test(raw) || i === 0) { category = line; headingLine = i; }
      }
    }
    offset += lines.length;
  }
  return entries;
}

const routingWords: readonly [RegExp, ApplicationTag][] = [
  [/\b(identity|personality)\b/, "identity"], [/\b(life purpose)\b/, "purpose"],
  [/\b(emotions|emotional patterns|overthink)\b/, "emotions"], [/\b(desires|repressed wants)\b/, "desire"],
  [/\b(childhood|upbringing)\b/, "childhood"], [/\b(dating|romance)\b/, "love"],
  [/\b(relationship|relationships|partner)\b/, "relationship"], [/\b(compatibility|compatible|synastry)\b/, "compatibility"],
  [/\b(breakup|breakups|ex partner)\b/, "breakup"], [/\b(marriage|spouse)\b/, "marriage"],
  [/\b(intimacy|physical attraction)\b/, "intimacy"], [/\b(friendship|friendships|friends)\b/, "friendship"],
  [/\b(family|siblings|parents)\b/, "family"], [/\b(parenting|child)\b/, "parenting"],
  [/\b(money|wealth|financial)\b/, "money"], [/\b(career|employment|job)\b/, "career"],
  [/\b(business|entrepreneurship)\b/, "business"], [/\b(timing|transits|progressions|returns|profections)\b/, "timing"],
  [/\b(decisions|crossroads)\b/, "decisions"], [/\b(relocation|astrocartography|moving)\b/, "relocation"],
  [/\b(reputation|recognition|public presence)\b/, "reputation"], [/\b(loss|betrayal)\b/, "loss"],
  [/\b(wellbeing|vitality|stress|healthy routines)\b/, "wellbeing"], [/\b(spirituality|fulfillment)\b/, "spirituality"],
];

/** Query routing hints only: tags never establish an answer, a diagnosis, or another person's thoughts. */
export function findQuestionTags(question: string, profileEntries: readonly QuestionRequirement[]): ApplicationTag[] {
  const key = normalize(question);
  const exact = profileEntries.filter(entry => entry.kind === "question" && normalize(entry.text) === key);
  if (exact.length) return [...new Set(exact.flatMap(entry => entry.applicationTags))];
  return routingWords.filter(([pattern]) => pattern.test(key)).map(([, tag]) => tag);
}

const ignoredWords = new Set("a an and are as at be by can could do does for from have how i in is it me my of on or our should that the their them these they this to us vs was we what when where which who why will with would you your".split(" "));
function terms(text: string) {
  return [...new Set(normalize(text).split(" ").filter(word => word.length > 1 && !ignoredWords.has(word)).map(word => word.length > 4 && word.endsWith("ies") ? word.slice(0, -3) + "y" : word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word))];
}
type IndexedName = { normalized: string; words: Set<string> };
function phraseScore(wanted: string[], normalized: string, names: IndexedName[]) {
  if (!wanted.length) return 0;
  let best = 0;
  for (const name of names) {
    const hits = wanted.filter(word => name.words.has(word)).length;
    const ratio = hits / wanted.length;
    if ((wanted.length === 1 && hits === 1) || (hits >= 2 && ratio >= 0.65)) best = Math.max(best, ratio * 8 + (name.normalized === normalized ? 4 : 0));
  }
  return best;
}
function exactEvidence(node: GraphNode, passages: Map<string, Passage>, sources: Map<string, Source>, brainId: string): QuestionCoverageEvidence[] {
  return (node.evidence ?? []).flatMap(item => {
    const passage = passages.get(item.passageId), source = sources.get(item.sourceId);
    if (!passage || !source || passage.sourceId !== item.sourceId || passage.page !== item.page || !node.sourceIds.includes(item.sourceId)) return [];
    const whitespace = (value: string) => value.trim().replace(/\s+/g, " ");
    if (item.imageId ? passage.image?.id !== item.imageId || (item.visualObservation?.trim().length ?? 0) < 20 : item.quote.trim().length < 12 || !whitespace(passage.text).includes(whitespace(item.quote))) return [];
    return [{ ...item, nodeId: node.id, sourceTitle: source.title, href: `/api/passage?id=${encodeURIComponent(item.passageId)}&brain=${encodeURIComponent(brainId)}` }];
  });
}

/** Candidate routing is deliberately weaker than semantic support or a completeness guarantee. */
export function questionCoverage(
  corpus: Corpus,
  requirements: RequirementInput | readonly QuestionRequirement[],
  options: { pending?: boolean; brainId?: string; warnings?: readonly string[] } = {},
): QuestionCoverageEntry[] {
  const entries: readonly QuestionRequirement[] = typeof requirements === "string" || typeof requirements[0] === "string"
    ? parseQuestionRequirements(requirements as RequirementInput) : requirements as readonly QuestionRequirement[];
  const passages = new Map(corpus.passages.map(passage => [passage.id, passage])), sources = new Map(corpus.sources.map(source => [source.id, source]));
  const available = corpus.nodes.filter(node => node.type === "teaching").map(node => ({
    node, evidence: exactEvidence(node, passages, sources, options.brainId ?? "main"),
    names: [node.label, ...(node.aliases ?? []), node.community].map(name => ({ normalized: normalize(name), words: new Set(terms(name)) })),
  })).filter(item => item.evidence.length);
  const words = new Map<string, Set<number>>(), applications = new Map<string, Set<number>>();
  const index = (map: Map<string, Set<number>>, key: string, value: number) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(value);
  };
  for (const [i, item] of available.entries()) {
    for (const name of item.names) for (const term of name.words) index(words, term, i);
    for (const tag of item.node.applicationTags ?? []) index(applications, tag, i);
  }
  return entries.map(entry => {
    const tags = entry.kind === "question" ? entry.applicationTags : [];
    const wanted = terms(entry.text), normalized = normalize(entry.text), candidates = new Set<number>();
    for (const term of wanted) for (const id of words.get(term) ?? []) candidates.add(id);
    for (const tag of tags) for (const id of applications.get(tag) ?? []) candidates.add(id);
    const matches = [...candidates].map(id => {
      const item = available[id];
      return { ...item, score: phraseScore(wanted, normalized, item.names) + (tags.some(tag => item.node.applicationTags?.includes(tag)) ? 3 : 0) };
    })
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id)).slice(0, 12);
    const evidence = matches.flatMap(item => item.evidence).slice(0, 36);
    const warnings = ["Candidate links are retrieval hints, not proof of a complete answer or complete knowledge coverage.", ...(options.warnings ?? [])];
    if (/what someone else thinks/i.test(entry.category)) warnings.push("Chart symbolism cannot verify another person's private thoughts or feelings.");
    if (tags.includes("wellbeing")) warnings.push("These are symbolic wellbeing themes, not medical diagnoses or explanations of symptoms.");
    return { ...entry, question: entry.text, status: matches.length ? "candidate" : options.pending ? "pending" : "not-found", nodeIds: matches.map(item => item.node.id), evidence, warnings: [...new Set(warnings)] };
  });
}
