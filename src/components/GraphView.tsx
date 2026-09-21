import React, { useEffect, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCw,
  Search,
  FileText,
  X,
  Sparkles,
  MessageSquare,
  ArrowUpRight,
  Filter,
  Crosshair,
  Tag,
} from "lucide-react";
import { GraphData, GraphNode, NoteResponse } from "../types";
import { api } from "../api";

interface GraphViewProps {
  onOpenInChat?: (title: string, content: string) => void;
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  connections: number;
}

const TAG_PALETTE = [
  "#f59e0b", // Amber
  "#06b6d4", // Cyan
  "#10b981", // Emerald
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#3b82f6", // Blue
  "#f97316", // Orange
  "#14b8a6", // Teal
  "#a855f7", // Violet
];

function getTagColor(tags?: string[], fallbackVault?: string): string {
  // Notas somente-leitura (Obsidian Base): Cinza Neutro (#64748b)
  if (fallbackVault === "obsidian") {
    return "#64748b";
  }

  if (!tags || tags.length === 0) {
    return "#f59e0b";
  }

  // Mapeamento semântico padronizado da RFC Copernico v2.1
  for (const t of tags) {
    const norm = t.toLowerCase().replace(/^#/, "").trim();
    if (norm.includes("projeto") || norm.includes("project")) {
      return "#38bdf8"; // Azul Celeste
    }
    if (norm.includes("conceito") || norm.includes("concept") || norm.includes("idea")) {
      return "#f59e0b"; // Âmbar Solar
    }
    if (norm.includes("reuniao") || norm.includes("reunião") || norm.includes("diario") || norm.includes("diário") || norm.includes("meeting")) {
      return "#10b981"; // Verde Esmeralda
    }
    if (norm.includes("evolucao") || norm.includes("evolução")) {
      return "#eab308"; // Dourado
    }
  }

  const firstTag = tags[0].toLowerCase().replace(/^#/, "");
  let hash = 0;
  for (let i = 0; i < firstTag.length; i++) {
    hash = firstTag.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % TAG_PALETTE.length;
  return TAG_PALETTE[idx];
}

export const GraphView: React.FC<GraphViewProps> = ({ onOpenInChat }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [selectedNoteDetail, setSelectedNoteDetail] = useState<NoteResponse | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Filters & controls
  const [vaultFilter, setVaultFilter] = useState<"all" | "default" | "obsidian">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [colorBy, setColorBy] = useState<"vault" | "tag">("tag");
  const [egoFocus, setEgoFocus] = useState<boolean>(false);
  const [hideOrphans, setHideOrphans] = useState<boolean>(false);

  // Canvas transform
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const [zoomLevel, setZoomLevel] = useState(1);
  const isDraggingCanvas = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const draggedNode = useRef<SimNode | null>(null);

  // Simulation nodes ref for requestAnimationFrame
  const simNodesRef = useRef<SimNode[]>([]);
  const animFrameId = useRef<number | null>(null);

  // Load Graph Data
  const loadGraph = async () => {
    setIsLoading(true);
    try {
      const data = await api.getNotesGraph();
      setGraphData(data);
    } catch (err) {
      console.error("Failed to load graph data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadGraph();
  }, []);

  // Initialize simulation nodes when graphData changes
  useEffect(() => {
    if (!graphData.nodes.length) {
      simNodesRef.current = [];
      return;
    }

    // Count degrees
    const degreeMap = new Map<string, number>();
    graphData.links.forEach((l) => {
      degreeMap.set(l.source, (degreeMap.get(l.source) || 0) + 1);
      degreeMap.set(l.target, (degreeMap.get(l.target) || 0) + 1);
    });

    const width = canvasRef.current?.width || 800;
    const height = canvasRef.current?.height || 600;
    const center = { x: width / 2, y: height / 2 };

    const nodes: SimNode[] = graphData.nodes.map((n, i) => {
      const angle = (i / graphData.nodes.length) * 2 * Math.PI;
      const dist = 80 + Math.random() * 180;
      const conns = degreeMap.get(n.id) || 0;
      return {
        ...n,
        x: center.x + Math.cos(angle) * dist,
        y: center.y + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        connections: conns,
        radius: Math.min(14, Math.max(5, 5 + conns * 1.5)),
      };
    });

    simNodesRef.current = nodes;
  }, [graphData]);

  // When selected node changes, load its note content
  useEffect(() => {
    if (!selectedNode) {
      setSelectedNoteDetail(null);
      return;
    }
    const fetchDetail = async () => {
      setIsLoadingDetail(true);
      try {
        const id = selectedNode.path || selectedNode.title || selectedNode.id;
        const note = await api.readNote(id);
        setSelectedNoteDetail(note);
      } catch (err) {
        console.error("Failed to read note detail:", err);
      } finally {
        setIsLoadingDetail(false);
      }
    };
    fetchDetail();
  }, [selectedNode]);

  // Force simulation loop & rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let isRunning = true;

    const render = () => {
      if (!isRunning) return;

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const nodes = simNodesRef.current;
      const links = graphData.links;
      const t = transformRef.current;

      // Physics step
      const kRepulsion = 1200;
      const kSpring = 0.008;
      const springLength = 70;
      const centerPull = 0.002;
      const cx = width / 2;
      const cy = height / 2;

      // Repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i];
          const n2 = nodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const distSq = dx * dx + dy * dy || 1;
          const dist = Math.sqrt(distSq);
          if (dist < 350) {
            const force = kRepulsion / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            n1.vx -= fx;
            n1.vy -= fy;
            n2.vx += fx;
            n2.vy += fy;
          }
        }
      }

      // Spring attraction along links
      const nodeById = new Map<string, SimNode>();
      nodes.forEach((n) => nodeById.set(n.id, n));

      for (const l of links) {
        const n1 = nodeById.get(l.source);
        const n2 = nodeById.get(l.target);
        if (n1 && n2) {
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const displacement = dist - springLength;
          const force = displacement * kSpring;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          n1.vx += fx;
          n1.vy += fy;
          n2.vx -= fx;
          n2.vy -= fy;
        }
      }

      // Update positions with damping and center gravity
      for (const n of nodes) {
        if (draggedNode.current?.id === n.id) continue;
        n.vx += (cx - n.x) * centerPull;
        n.vy += (cy - n.y) * centerPull;
        n.vx *= 0.88;
        n.vy *= 0.88;
        n.x += n.vx;
        n.y += n.vy;
      }

      // Draw with viewport transformation
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.scale, t.scale);

      // 1. Draw Links
      const connectedSet =
        egoFocus && selectedNode
          ? new Set<string>([
              selectedNode.id,
              ...links
                .filter((l) => l.source === selectedNode.id || l.target === selectedNode.id)
                .map((l) => (l.source === selectedNode.id ? l.target : l.source)),
            ])
          : null;

      for (const l of links) {
        const n1 = nodeById.get(l.source);
        const n2 = nodeById.get(l.target);
        if (!n1 || !n2) continue;

        // Skip if filtered out by vault
        if (vaultFilter !== "all" && n1.vault !== vaultFilter && n2.vault !== vaultFilter) {
          continue;
        }

        // If Ego Focus is active, skip links not connected to the ego network
        if (connectedSet && (!connectedSet.has(n1.id) || !connectedSet.has(n2.id))) {
          continue;
        }

        const isHighlighted =
          hoveredNode?.id === n1.id ||
          hoveredNode?.id === n2.id ||
          selectedNode?.id === n1.id ||
          selectedNode?.id === n2.id;

        const isLineage = Boolean(l.is_lineage);
        ctx.beginPath();
        ctx.moveTo(n1.x, n1.y);
        ctx.lineTo(n2.x, n2.y);

        if (isLineage) {
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = isHighlighted ? "#fbbf24" : "rgba(245, 158, 11, 0.85)";
          ctx.lineWidth = isHighlighted ? 2.5 : 1.8;
        } else {
          ctx.setLineDash([]);
          ctx.strokeStyle = isHighlighted ? "rgba(168, 85, 247, 0.7)" : "rgba(255, 255, 255, 0.08)";
          ctx.lineWidth = isHighlighted ? 2 : 1;
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 2. Draw Nodes
      const queryLower = searchQuery.trim().toLowerCase();

      for (const n of nodes) {
        // Vault filter
        if (vaultFilter !== "all" && n.vault !== vaultFilter) continue;

        // Hide orphan nodes (degree == 0) if toggle is active
        if (hideOrphans && n.connections === 0) continue;

        const isMatch = queryLower ? n.title.toLowerCase().includes(queryLower) : true;
        const isHovered = hoveredNode?.id === n.id;
        const isSelected = selectedNode?.id === n.id;
        const isEgoDimmed = connectedSet && !connectedSet.has(n.id);

        ctx.globalAlpha = isEgoDimmed ? 0.1 : 1.0;

        // Node color
        let color =
          colorBy === "tag"
            ? getTagColor(n.tags, n.vault)
            : n.vault === "obsidian"
            ? "#06b6d4"
            : "#f59e0b";
        if (!isMatch) {
          color = "#52525b"; // Muted if no match
        }

        // Outer glow if hovered or selected
        if (isHovered || isSelected) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius + 6, 0, 2 * Math.PI);
          ctx.fillStyle = isSelected ? "rgba(245, 158, 11, 0.35)" : "rgba(255, 255, 255, 0.15)";
          ctx.fill();
        }

        // Node body
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = isHovered || isSelected ? 12 : 4;
        ctx.fill();
        ctx.shadowBlur = 0; // reset

        // Label
        if (t.scale > 0.7 || isHovered || isSelected || (isMatch && queryLower)) {
          ctx.font = `${isHovered || isSelected ? "600 11px" : "400 10px"} system-ui, -apple-system, sans-serif`;
          ctx.fillStyle = isHovered || isSelected ? "#ffffff" : isMatch ? "#e4e4e7" : "#71717a";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(n.title, n.x, n.y + n.radius + 4);
        }

        ctx.globalAlpha = 1.0;
      }

      ctx.restore();

      animFrameId.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      isRunning = false;
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    };
  }, [graphData, vaultFilter, searchQuery, hoveredNode, selectedNode, colorBy, egoFocus]);

  // Resize canvas to parent container
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Helper: map screen mouse coordinates to graph coordinates
  const screenToGraph = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const t = transformRef.current;
    return {
      x: (sx - t.x) / t.scale,
      y: (sy - t.y) / t.scale,
    };
  };

  // Find node under mouse
  const getNodeAt = (clientX: number, clientY: number): SimNode | null => {
    const { x, y } = screenToGraph(clientX, clientY);
    for (const n of simNodesRef.current) {
      if (vaultFilter !== "all" && n.vault !== vaultFilter) continue;
      const dx = n.x - x;
      const dy = n.y - y;
      if (dx * dx + dy * dy <= (n.radius + 6) * (n.radius + 6)) {
        return n;
      }
    }
    return null;
  };

  // Canvas Mouse events
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const node = getNodeAt(e.clientX, e.clientY);
    if (node) {
      draggedNode.current = node;
      setSelectedNode(node);
    } else {
      isDraggingCanvas.current = true;
      dragStart.current = {
        x: e.clientX - transformRef.current.x,
        y: e.clientY - transformRef.current.y,
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggedNode.current) {
      const { x, y } = screenToGraph(e.clientX, e.clientY);
      draggedNode.current.x = x;
      draggedNode.current.y = y;
      draggedNode.current.vx = 0;
      draggedNode.current.vy = 0;
      return;
    }

    if (isDraggingCanvas.current) {
      transformRef.current.x = e.clientX - dragStart.current.x;
      transformRef.current.y = e.clientY - dragStart.current.y;
      return;
    }

    // Check hover
    const node = getNodeAt(e.clientX, e.clientY);
    setHoveredNode(node);
  };

  const handleMouseUp = () => {
    isDraggingCanvas.current = false;
    draggedNode.current = null;
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const node = getNodeAt(e.clientX, e.clientY);
    if (node) {
      setSelectedNode(node);
      setEgoFocus(true);
    } else {
      setEgoFocus(false);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
    const newScale = Math.min(3.5, Math.max(0.25, transformRef.current.scale * zoomFactor));

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    transformRef.current.x = mouseX - (mouseX - transformRef.current.x) * (newScale / transformRef.current.scale);
    transformRef.current.y = mouseY - (mouseY - transformRef.current.y) * (newScale / transformRef.current.scale);
    transformRef.current.scale = newScale;
    setZoomLevel(newScale);
  };

  const handleZoom = (delta: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const factor = delta > 0 ? 1.2 : 0.8;
    const newScale = Math.min(3.5, Math.max(0.25, transformRef.current.scale * factor));
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    transformRef.current.x = cx - (cx - transformRef.current.x) * (newScale / transformRef.current.scale);
    transformRef.current.y = cy - (cy - transformRef.current.y) * (newScale / transformRef.current.scale);
    transformRef.current.scale = newScale;
    setZoomLevel(newScale);
  };

  const handleResetView = () => {
    transformRef.current = { x: 0, y: 0, scale: 1 };
    setZoomLevel(1);
  };

  // Connected nodes of selectedNode
  const connectedLinks = useMemo(() => {
    if (!selectedNode) return [];
    return graphData.links.filter(
      (l) => l.source === selectedNode.id || l.target === selectedNode.id
    );
  }, [selectedNode, graphData.links]);

  return (
    <div className="relative w-full h-full flex overflow-hidden bg-[var(--bg-app)] select-none">
      {/* Top Floating Controls Panel: Two stacked lines to avoid collision */}
      <div className="absolute top-4 left-5 z-10 flex flex-col gap-2 pointer-events-none">
        {/* Line 1: Info & Vault Filter */}
        <div className="flex items-center gap-2.5 pointer-events-auto bg-[var(--bg-card)]/95 backdrop-blur-md px-3 py-1.5 rounded-xl border border-[var(--border-subtle)] shadow-xl w-fit">
          <div className="flex items-center gap-2 pr-2.5 border-r border-[var(--border-subtle)]">
            <span className="text-xs font-semibold text-[var(--text-primary)] tracking-wide">Grafo</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500 dark:text-amber-400 font-mono font-medium">
              {graphData.nodes.length} notas
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-500 dark:text-cyan-300 font-mono font-medium">
              {graphData.links.length} conexões
            </span>
          </div>

          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => setVaultFilter("all")}
              className={`px-2.5 py-1 rounded-lg transition-all text-xs ${
                vaultFilter === "all"
                  ? "bg-amber-500 text-white font-medium shadow-sm shadow-amber-500/30"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setVaultFilter("default")}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 text-xs ${
                vaultFilter === "default"
                  ? "bg-amber-500 text-white font-medium shadow-sm shadow-amber-500/30"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Default
            </button>
            <button
              onClick={() => setVaultFilter("obsidian")}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 text-xs ${
                vaultFilter === "obsidian"
                  ? "bg-cyan-600 text-white font-medium shadow-sm shadow-cyan-900/40"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              Obsidian
            </button>
          </div>
        </div>

        {/* Line 2: Search in Graph & Zoom Controls */}
        <div className="flex items-center gap-2 pointer-events-auto w-fit">
          {/* Graph search input */}
          <div className="flex items-center gap-2 bg-[var(--bg-card)]/95 backdrop-blur-md px-3 py-1.5 rounded-xl border border-[var(--border-subtle)] shadow-xl">
            <Search size={13} className="text-[var(--text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filtrar notas..."
              className="bg-transparent text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none w-36 focus:w-48 transition-all"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X size={12} />
              </button>
            )}
          </div>

          {/* Mode controls: Color by Tag vs Vault & Ego Focus */}
          <div className="flex items-center gap-1 bg-[var(--bg-card)]/95 backdrop-blur-md p-1 rounded-xl border border-[var(--border-subtle)] shadow-xl">
            <button
              onClick={() => setColorBy((prev) => (prev === "tag" ? "vault" : "tag"))}
              className={`px-2 py-1 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-medium ${
                colorBy === "tag"
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
              title={colorBy === "tag" ? "Colorindo por Tags do Frontmatter (clique para alternar para Cofre)" : "Colorindo por Cofre (clique para alternar para Tags)"}
            >
              <Tag size={12} className={colorBy === "tag" ? "text-amber-400" : ""} />
              <span className="text-[11px]">{colorBy === "tag" ? "Tags" : "Cofre"}</span>
            </button>

            <button
              onClick={() => setEgoFocus((prev) => !prev)}
              className={`px-2 py-1 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-medium ${
                egoFocus
                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
              title={egoFocus ? "Modo Foco Ativo: isolando nó selecionado e suas conexões diretas" : "Ativar Modo Foco (Ego-Network ao selecionar nó ou duplo clique)"}
            >
              <Crosshair size={12} className={egoFocus ? "text-purple-400" : ""} />
              <span className="text-[11px]">Modo Foco</span>
            </button>

            <button
              onClick={() => setHideOrphans((prev) => !prev)}
              className={`px-2 py-1 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-medium ${
                hideOrphans
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
              title={hideOrphans ? "Nós órfãos ocultos (clique para exibir todos)" : "Ocultar nós órfãos (degree == 0)"}
            >
              <Filter size={12} className={hideOrphans ? "text-amber-400" : ""} />
              <span className="text-[11px]">Sem Órfãos</span>
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-[var(--bg-card)]/95 backdrop-blur-md p-1 rounded-xl border border-[var(--border-subtle)] shadow-xl">
            <button
              onClick={() => handleZoom(1)}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors"
              title="Zoom +"
            >
              <ZoomIn size={14} />
            </button>
            <button
              onClick={() => handleZoom(-1)}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors"
              title="Zoom -"
            >
              <ZoomOut size={14} />
            </button>
            <button
              onClick={handleResetView}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors"
              title="Resetar Vista"
            >
              <Maximize2 size={14} />
            </button>
            <button
              onClick={loadGraph}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors"
              title="Recarregar Grafo"
            >
              <RotateCw size={14} className={isLoading ? "animate-spin text-amber-500 dark:text-amber-400" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Hover tooltip */}
      {hoveredNode && !draggedNode.current && (
        <div
          className="absolute pointer-events-none z-20 px-2.5 py-1.5 rounded-lg bg-[var(--bg-card)]/95 border border-[var(--border-subtle)] text-[var(--text-primary)] shadow-2xl text-xs flex flex-col gap-0.5"
          style={{
            left: hoveredNode.x * transformRef.current.scale + transformRef.current.x + 16,
            top: hoveredNode.y * transformRef.current.scale + transformRef.current.y - 12,
          }}
        >
          <span className="font-semibold">{hoveredNode.title}</span>
          <span className="text-[10px] text-[var(--text-muted)]">
            Cofre: <span className="text-amber-500 dark:text-amber-400">{hoveredNode.vault}</span> • {hoveredNode.connections} conexões
          </span>
        </div>
      )}

      {/* Slide-over Note Details Panel */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
            className="absolute top-0 right-0 w-80 h-full bg-[var(--bg-card)]/95 backdrop-blur-xl border-l border-[var(--border-subtle)] shadow-2xl z-30 flex flex-col"
          >
            {/* Header */}
            <div className="p-4 border-b border-[var(--border-subtle)] flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      selectedNode.vault === "obsidian"
                        ? "bg-cyan-950/70 text-cyan-300 border border-cyan-800/40"
                        : "bg-amber-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/30"
                    }`}
                  >
                    {selectedNode.vault}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">
                    {selectedNode.connections} links
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate" title={selectedNode.title}>
                  {selectedNode.title}
                </h3>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            {/* Actions */}
            {onOpenInChat && (
              <div className="p-3 border-b border-[var(--border-subtle)] bg-black/5 dark:bg-white/[0.02]">
                <button
                  onClick={() => {
                    const title = selectedNoteDetail?.title || selectedNode.title;
                    const content = selectedNoteDetail?.content || "";
                    onOpenInChat(title, content);
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium flex items-center justify-center gap-2 transition-colors shadow-lg shadow-amber-500/30"
                >
                  <MessageSquare size={13} />
                  <span>Conversar sobre esta nota</span>
                </button>
              </div>
            )}

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Wikilinks section */}
              {connectedLinks.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Conexões Wikilink
                  </h4>
                  <div className="space-y-1">
                    {connectedLinks.map((link, idx) => {
                      const otherId = link.source === selectedNode.id ? link.target : link.source;
                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            const target = simNodesRef.current.find((n) => n.id === otherId);
                            if (target) setSelectedNode(target);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/[0.03] hover:bg-amber-500/10 text-xs text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 cursor-pointer flex items-center justify-between transition-colors"
                        >
                          <span className="truncate">[[{otherId}]]</span>
                          <ArrowUpRight size={12} className="opacity-50 shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Note Content Preview */}
              <div>
                <h4 className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                  Conteúdo da Nota
                </h4>
                {isLoadingDetail ? (
                  <div className="py-8 flex items-center justify-center text-xs text-[var(--text-muted)] gap-2">
                    <Sparkles size={14} className="animate-spin text-amber-500 dark:text-amber-400" />
                    <span>Carregando...</span>
                  </div>
                ) : selectedNoteDetail ? (
                  <div className="text-xs text-[var(--text-primary)] font-mono whitespace-pre-wrap leading-relaxed bg-[var(--bg-input)] p-3 rounded-xl border border-[var(--border-subtle)] select-text">
                    {selectedNoteDetail.content || selectedNoteDetail.corpo || "(Nota vazia)"}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--text-muted)] italic">
                    Nenhum conteúdo disponível.
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
