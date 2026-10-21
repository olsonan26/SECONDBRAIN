"use client";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, Minus, Plus, RotateCcw, Search, X } from "lucide-react";
import type { GraphEdge, GraphNode } from "@/lib/types";
import { createGraphScene } from "@/lib/graph-scene";
const PALETTE = ["#68e7ed", "#ae92ff", "#fc91ab", "#eac67c", "#78b0fb", "#86d8b6"];
export function communityColor(community: string) { let n = 0; for (const c of community) n = (n * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[n % PALETTE.length]; }
function hash(value: string) { let h = 2166136261; for (const c of value) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
type Point = { x: number; y: number; z: number; node: GraphNode };
type Projected = Point & { px: number; py: number; depth: number };
type NodeSearchResult = { nodes: GraphNode[]; total: number };
interface BrainCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selected: string | null;
  onSelect: (node: GraphNode) => void;
  totalNodes?: number;
  onSearchNodes?: (query: string, offset: number) => Promise<NodeSearchResult>;
}
export default function BrainCanvas({ nodes, edges, selected, onSelect, totalNodes, onSearchNodes }: BrainCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null), rotation = useRef({ x: -.08, y: -.31 }), drag = useRef<{ x: number; y: number; moved: boolean } | null>(null), zoom = useRef(1), projected = useRef<Projected[]>([]);
  const [hovered, setHovered] = useState<GraphNode | null>(null), [paused, setPaused] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false), [nodeSearch, setNodeSearch] = useState(""), [nodeLimit, setNodeLimit] = useState(50);
  const [remotePage, setRemotePage] = useState<(NodeSearchResult & { query: string; nextOffset: number }) | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false), [remoteError, setRemoteError] = useState(""), [remoteRetry, setRemoteRetry] = useState(0);
  const remoteSearch = useRef(onSearchNodes), remoteVersion = useRef(0);
  const hasRemoteSearch = !!onSearchNodes;
  const fullNodeCount = Math.max(totalNodes ?? nodes.length, nodes.length);
  useEffect(() => { remoteSearch.current = onSearchNodes; }, [onSearchNodes]);
  const deferredSearch = useDeferredValue(nodeSearch.trim().toLocaleLowerCase());
  const scene = useMemo(() => createGraphScene(nodes, edges, selected), [nodes, edges, selected]);
  const browserNodes = useMemo(() => hasRemoteSearch || !browserOpen ? [] : nodes.filter(node => !deferredSearch || `${node.label} ${node.description} ${node.community} ${node.aliases?.join(" ") || ""}`.toLocaleLowerCase().includes(deferredSearch)).sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label)), [nodes, deferredSearch, hasRemoteSearch, browserOpen]);
  const remoteMatchesQuery = remotePage?.query === deferredSearch;
  const displayedNodes = hasRemoteSearch ? remoteMatchesQuery ? remotePage.nodes : [] : browserNodes.slice(0, nodeLimit);
  const matchingCount = hasRemoteSearch ? remoteMatchesQuery ? remotePage.total : 0 : browserNodes.length;
  const remainingCount = hasRemoteSearch ? remoteMatchesQuery ? Math.max(0, remotePage.total - remotePage.nextOffset) : 0 : Math.max(0, browserNodes.length - nodeLimit);

  useEffect(() => {
    if (!browserOpen || !hasRemoteSearch) return;
    const version = ++remoteVersion.current;
    setRemoteLoading(true);
    setRemoteError("");
    const timer = setTimeout(async () => {
      try {
        const result = await remoteSearch.current!(deferredSearch, 0);
        if (version === remoteVersion.current) setRemotePage({ ...result, query: deferredSearch, nextOffset: result.nodes.length });
      } catch (cause) {
        if (version === remoteVersion.current) setRemoteError(cause instanceof Error ? cause.message : "Could not search the complete graph.");
      } finally { if (version === remoteVersion.current) setRemoteLoading(false); }
    }, 220);
    return () => { clearTimeout(timer); remoteVersion.current++; };
  }, [browserOpen, deferredSearch, hasRemoteSearch, fullNodeCount, remoteRetry]);

  async function loadMoreNodes() {
    if (!hasRemoteSearch) { setNodeLimit(value => value + 50); return; }
    if (remoteLoading || !remoteMatchesQuery || !remoteSearch.current) return;
    const version = remoteVersion.current;
    setRemoteLoading(true);
    setRemoteError("");
    try {
      const result = await remoteSearch.current(deferredSearch, remotePage.nextOffset);
      if (version !== remoteVersion.current) return;
      setRemotePage(previous => {
        if (!previous || previous.query !== deferredSearch) return previous;
        const ids = new Set(previous.nodes.map(node => node.id));
        return { ...result, query: deferredSearch, nodes: [...previous.nodes, ...result.nodes.filter(node => !ids.has(node.id))], nextOffset: result.nodes.length ? previous.nextOffset + result.nodes.length : result.total };
      });
    } catch (cause) { if (version === remoteVersion.current) setRemoteError(cause instanceof Error ? cause.message : "Could not load more knowledge nodes."); }
    finally { if (version === remoteVersion.current) setRemoteLoading(false); }
  }
  const points = useMemo<Point[]>(() => scene.nodes.map(node => { const h = hash(`${node.id}h`) > .5 ? 1 : -1, a = Math.acos(1 - 2 * hash(`${node.id}a`)), b = hash(`${node.id}b`) * Math.PI * 2, r = .77 + hash(`${node.id}r`) * .23; return { node, x: h * (.14 + Math.abs(Math.sin(a) * Math.cos(b)) * .81 * r * (1 + .045 * Math.sin(a * 13 + b * 5))), y: Math.cos(a) * .89 * r, z: Math.sin(a) * Math.sin(b) * .64 * r }; }), [scene]);
  const linked = useMemo(() => { const ids = new Set<string>(); if (selected) { ids.add(selected); for (const e of edges) { if (e.source === selected) ids.add(e.target); if (e.target === selected) ids.add(e.source); } } return ids; }, [edges, selected]);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext("2d"); if (!ctx) return;
    let frame = 0, last = 0, width = 800, height = 650;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)"), observer = new ResizeObserver(([entry]) => { width = entry.contentRect.width; height = entry.contentRect.height; const dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }); observer.observe(canvas);
    const project = (x: number, y: number, z: number) => { const cy = Math.cos(rotation.current.y), sy = Math.sin(rotation.current.y), cx = Math.cos(rotation.current.x), sx = Math.sin(rotation.current.x), xx = x * cy + z * sy, zz = z * cy - x * sy, yy = y * cx - zz * sx, depth = y * sx + zz * cx, scale = Math.min(width * .405, height * .385) * zoom.current * (3.3 / (3.3 - depth)); return { px: width / 2 + xx * scale, py: height / 2 + yy * scale - 4, depth }; };
    const draw = (time: number) => {
      if (time - last < 26) { frame = requestAnimationFrame(draw); return; } last = time;
      if (!drag.current && !paused && !reduced.matches && !selected) rotation.current.y += .0007;
      ctx.clearRect(0, 0, width, height);
      const glow = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * .49); glow.addColorStop(0, "#5f4dac10"); glow.addColorStop(.7, "#426c8e04"); glow.addColorStop(1, "#00000000"); ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
      // Cortical contours give the brain its silhouette. Corpus edges alone encode relationships.
      for (const h of [-1, 1]) for (let row = 0; row < 15; row++) { const lat = .13 + row * (Math.PI - .26) / 14; ctx.beginPath(); for (let k = 0; k <= 100; k++) { const lon = k / 100 * Math.PI * 2, ripple = 1 + .025 * Math.sin(lon * 9 + row * 1.6), p = project(h * (.14 + Math.abs(Math.sin(lat) * Math.cos(lon)) * .81 * ripple), Math.cos(lat) * .89, Math.sin(lat) * Math.sin(lon) * .64); if (k === 0) ctx.moveTo(p.px, p.py); else ctx.lineTo(p.px, p.py); } ctx.strokeStyle = h === -1 ? "#64d9e516" : "#ae92ff16"; ctx.lineWidth = .65; ctx.stroke(); }
      const next = points.map(p => ({ ...p, ...project(p.x, p.y, p.z) })); projected.current = next; const map = new Map(next.map(p => [p.node.id, p]));
      for (const e of scene.edges) { const a = map.get(e.source), b = map.get(e.target); if (!a || !b) continue; const active = selected && (e.source === selected || e.target === selected); ctx.globalAlpha = selected ? active ? .57 : .018 : .1 + ((a.depth + b.depth + 1.5) / 3) * .06; ctx.strokeStyle = communityColor(a.node.community); ctx.lineWidth = active ? 1.25 : .5; ctx.setLineDash(e.confidence === "AMBIGUOUS" ? [2, 4] : e.confidence === "INFERRED" ? [4, 3] : []); ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.quadraticCurveTo((a.px + b.px) / 2 + (a.py - b.py) * .06, (a.py + b.py) / 2, b.px, b.py); ctx.stroke(); }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      next.sort((a, b) => a.depth - b.depth).forEach(p => { const active = p.node.id === selected, relevant = !selected || linked.has(p.node.id), radius = active ? 4.7 : .9 + Math.min(p.node.degree, 30) * .045 + (p.depth + 1) * .7; ctx.globalAlpha = relevant ? .55 + (p.depth + 1) * .18 : .1; ctx.fillStyle = active ? "#ffffff" : communityColor(p.node.community); ctx.shadowBlur = relevant ? active ? 22 : 7 : 0; ctx.shadowColor = communityColor(p.node.community); ctx.beginPath(); ctx.arc(p.px, p.py, radius, 0, Math.PI * 2); ctx.fill(); if (active) { ctx.shadowBlur = 0; ctx.strokeStyle = "#ffffff70"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.px, p.py, 10, 0, Math.PI * 2); ctx.stroke(); } }); ctx.shadowBlur = 0; ctx.globalAlpha = 1; canvas.dataset.rendered = "true"; frame = requestAnimationFrame(draw);
    }; frame = requestAnimationFrame(draw); return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [points, scene.edges, selected, linked, paused]);
  const hit = (x: number, y: number) => { let best: Projected | null = null, distance = 18; for (const p of projected.current) { const d = Math.hypot(p.px - x, p.py - y); if (d < distance) { distance = d; best = p; } } return best?.node ?? null; };
  return <div className="brain-stage"><canvas ref={canvasRef} aria-label={`Interactive brain ${scene.focused ? "neighborhood" : "overview"} showing ${scene.nodes.length.toLocaleString()} of ${fullNodeCount.toLocaleString()} knowledge nodes. Browse all nodes for keyboard navigation or to focus any teaching. Drag to rotate.`} onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (drag.current) { const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y; if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true; rotation.current.y += dx * .006; rotation.current.x = Math.max(-1.2, Math.min(1.2, rotation.current.x + dy * .006)); drag.current.x = e.clientX; drag.current.y = e.clientY; } else { const r = e.currentTarget.getBoundingClientRect(); setHovered(hit(e.clientX - r.left, e.clientY - r.top)); } }} onPointerUp={e => { if (drag.current && !drag.current.moved) { const r = e.currentTarget.getBoundingClientRect(), n = hit(e.clientX - r.left, e.clientY - r.top); if (n) onSelect(n); } drag.current = null; }} onPointerLeave={() => setHovered(null)} onPointerCancel={() => { drag.current = null; }} />
    <div className="graph-scene-summary"><span>{scene.focused ? "Focused neighborhood" : "Brain overview"}</span><small>{scene.nodes.length.toLocaleString()} of {fullNodeCount.toLocaleString()} nodes shown{scene.eligibleEdgeCount > scene.edges.length ? ` · ${scene.edges.length.toLocaleString()} connections drawn` : ""}</small></div>
    <button className="graph-browser-toggle" aria-expanded={browserOpen} onClick={() => setBrowserOpen(!browserOpen)}><Search size={12} />Browse all {fullNodeCount.toLocaleString()} nodes<ChevronDown size={12} /></button>
    {browserOpen ? <section className="graph-node-browser" aria-label="Browse every knowledge node"><div className="graph-node-browser-heading"><strong>Every knowledge node</strong><button className="icon-button" aria-label="Close node browser" onClick={() => setBrowserOpen(false)}><X size={14} /></button></div><label><Search size={13} /><input autoFocus value={nodeSearch} onChange={event => { setNodeSearch(event.target.value); setNodeLimit(50); }} aria-label="Search all knowledge nodes" placeholder="Find a teaching, definition, or technique…" /></label><p>{hasRemoteSearch && remoteLoading && !remoteMatchesQuery ? "Searching the complete graph…" : `${matchingCount.toLocaleString()} ${matchingCount === 1 ? "match" : "matches"}.`} Selecting any node brings it and its connections into focus.</p>{remoteError ? <p className="graph-node-search-error" role="alert">{remoteError} <button onClick={() => setRemoteRetry(value => value + 1)}>Retry search</button></p> : null}<div className="graph-node-browser-results">{displayedNodes.map(node => <button key={node.id} className={node.id === selected ? "selected" : ""} onClick={() => { onSelect(node); setBrowserOpen(false); }}><i style={{ background: communityColor(node.community) }} /><span><strong>{node.label}</strong><small>{node.knowledgeKind || node.type} · {node.community}{node.evidence?.[0]?.page ? ` · page ${node.evidence[0].page}` : ""}</small></span><em>{node.degree}</em></button>)}{!displayedNodes.length && !remoteLoading && !remoteError ? <p>No nodes match. Try another phrase or clear the graph’s collection filter.</p> : null}{remainingCount > 0 ? <button className="graph-node-more" disabled={remoteLoading} onClick={() => { void loadMoreNodes(); }}>{remoteLoading ? <><LoaderCircle size={12} className="spin" />Loading…</> : `Show 50 more (${remainingCount.toLocaleString()} remaining)`}</button> : hasRemoteSearch && remoteLoading ? <p role="status">Loading knowledge nodes…</p> : null}</div></section> : null}
    {hovered && <div className="graph-hover"><span className="color-dot" style={{ background: communityColor(hovered.community) }} /><strong>{hovered.label}</strong><span>{hovered.degree} connections</span></div>}
    <div className="graph-controls"><button className="icon-button" aria-label="Zoom out" onClick={() => { zoom.current = Math.max(.55, zoom.current - .15); }}><Minus size={16} /></button><button className="icon-button" aria-label="Zoom in" onClick={() => { zoom.current = Math.min(1.9, zoom.current + .15); }}><Plus size={16} /></button><span /><button className="icon-button" aria-label="Reset graph view" onClick={() => { zoom.current = 1; rotation.current = { x: -.08, y: -.31 }; }}><RotateCcw size={15} /></button><button className={`motion-toggle ${paused ? "active" : ""}`} onClick={() => setPaused(!paused)}>{paused ? "Rotate" : "Pause"}</button></div><div className="graph-instruction"><span className="orbit-mark" />Drag to explore · Select a concept</div>{!nodes.length && <div className="graph-empty">No concepts match these filters.</div>}</div>;
}
