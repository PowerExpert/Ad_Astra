// graph.js — knowledge graph on an infinite pan/zoom canvas.
//
// Coordinate spaces:
//   Screen space  — canvas CSS pixels (what the mouse gives you)
//   World space   — where nodes/objects actually live (what's stored)
//
// Conversion:
//   screen → world:  wx = (sx - pan.x) / zoom
//   world → screen:  sx = wx * zoom + pan.x
//
// Drawing is done inside ctx.setTransform(zoom, 0, 0, zoom, pan.x, pan.y),
// so all drawing commands use world coordinates directly.
import {
  getNotes, getNote, getNoteLinks, createNote, updateNote, deleteNote,
  createManualLink, updateLink, deleteLink, getChildren, validParentTypesFor,
  getGraphObjects, createGraphObject, updateGraphObject, deleteGraphObject,
} from './storage.js';
import { el, $, clear, toast, openContextMenu, closeContextMenu, contextMenuItems } from './ui.js';
import { renderList } from './notes.js';

// ── Viewport state ────────────────────────────────────────────
let pan  = { x: 0, y: 0 };   // screen-space offset of the world origin
let zoom = 1;                 // scale factor (world units → screen pixels)
const ZOOM_MIN = 0.12, ZOOM_MAX = 5;

// ── Graph opts ────────────────────────────────────────────────
let opts = { labels: true, nodeSize: 8, linkStrength: 5 };

// ── Node positions (world space) ──────────────────────────────
let positions = {};   // { [noteId]: {x, y} }

// ── Drag / interaction state ──────────────────────────────────
let animFrame      = null;
let t              = 0;
let openNoteCallback = null;

// Pan drag (drag on empty canvas space)
let panDragging    = false;
let panDragStart   = null;   // { sx, sy, px, py }

// Node drag
let draggedNodeId  = null;
let nodeDragOffset = { x: 0, y: 0 };
let nodeClickInfo  = null;   // { wx, wy, id } — used to distinguish click from drag

// Title drag
let draggedTitleId = null;
let titleDragLive  = null;   // {x, y} in world space (committed on mouseup)
let titleDragOffset = { x: 0, y: 0 };

// Outline drag
let draggedOutlineId  = null;
let outlineDragStart  = null;  // world-space { x, y }
let outlineDragLive   = null;  // { dx, dy } world-space delta

// Outline two-click placement
let outlinePlacement  = null;  // null | {} | { x1, y1 }

// Connect mode
let connectSourceId   = null;

// Live world-space mouse position (updated on every mousemove)
let mouseWorld = { x: -9999, y: -9999 };

// ── Constants ─────────────────────────────────────────────────
const TYPE_RADIUS_MULT = { subject: 2.2, topic: 1.6, subtopic: 1.2, note: 0.85 };
const TITLE_FONT_SIZE  = 30;
const SWATCHES = ['#6F00FF','#A966FF','#4ADE80','#FBBF24','#38BDF8','#F472B6','#FB923C','#F87171','#FFFFFF'];

export function setOpenNoteCallback(fn) { openNoteCallback = fn; }
export function setOpts(patch) { opts = { ...opts, ...patch }; }

// ── Resize observer ───────────────────────────────────────────
let resizeObserver = null;

function syncCanvasSize(canvas, container) {
  const w = Math.max(1, container.offsetWidth);
  const h = Math.max(1, container.offsetHeight);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}
function bindResize(canvas, container) {
  if (resizeObserver) resizeObserver.disconnect();
  resizeObserver = new ResizeObserver(() => syncCanvasSize(canvas, container));
  resizeObserver.observe(container);
}

// ── Coordinate helpers ────────────────────────────────────────
function toWorld(sx, sy)  { return { x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom }; }
function toScreen(wx, wy) { return { x: wx * zoom + pan.x,   y: wy * zoom + pan.y   }; }

// ── Main entry points ─────────────────────────────────────────
export function startGraph() {
  const canvas    = $('#graph-canvas');
  const container = $('#graph-view');
  if (!canvas || !container) return;
  loadPanZoom();
  syncCanvasSize(canvas, container);
  rebuildPositions(canvas.width, canvas.height);
  bindInteraction(canvas);
  ensureHint(container);
  bindResize(canvas, container);
  if (animFrame) cancelAnimationFrame(animFrame);
  t = 0;
  const ctx = canvas.getContext('2d');

  function frame() {
    const W = canvas.width, H = canvas.height;
    t += 0.008;

    // ── 1. Background (screen space, before transform) ──────────
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset to identity
    ctx.fillStyle = '#08080E';
    ctx.fillRect(0, 0, W, H);

    // ── 2. Enter world space ─────────────────────────────────────
    ctx.setTransform(zoom, 0, 0, zoom, pan.x, pan.y);

    // Infinite dot grid. Dots live at world-space multiples of `spacing`,
    // only the ones currently inside the viewport are drawn.
    // When you zoom out you see more dots (grid contracts visually);
    // when you zoom in you see fewer, spread farther apart.
    // The dot radius is kept visually constant (1.5 screen px) regardless
    // of zoom so they never disappear or overwhelm the view.
    const spacing = 32;
    // dotR uses sqrt(zoom) so dots shrink when zoomed out but not as
    // aggressively as full world-space scaling. Screen size = 1.5*sqrt(zoom):
    //   zoom 0.12 → ~0.5px   zoom 0.5 → ~1.1px   zoom 1 → 1.5px   zoom 4 → 3px
    const dotR     = 1.5 / Math.sqrt(zoom);
    // Alpha also fades as zoom decreases so dots can't crowd the screen even
    // if a few pixels wide. Clamped so they never fully disappear.
    const dotAlpha = (0x79 / 255) * Math.min(1, Math.max(0.08, zoom));
    const wx0 = -pan.x / zoom,       wy0 = -pan.y / zoom;
    const wx1 = (W - pan.x) / zoom,  wy1 = (H - pan.y) / zoom;
    const gx0 = Math.floor(wx0 / spacing) * spacing;
    const gy0 = Math.floor(wy0 / spacing) * spacing;
    ctx.fillStyle = `rgba(63,63,63,${dotAlpha.toFixed(3)})`;
    for (let gx = gx0; gx <= wx1 + spacing; gx += spacing) {
      for (let gy = gy0; gy <= wy1 + spacing; gy += spacing) {
        ctx.beginPath();
        ctx.arc(gx, gy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── 3. Outlines (drawn behind everything) ───────────────────
    const outlines = currentOutlines();
    for (const o of outlines) {
      const live = (draggedOutlineId === o.id && outlineDragLive) ? outlineDragLive : { dx: 0, dy: 0 };
      const x1 = Math.min(o.x1, o.x2) + live.dx, x2 = Math.max(o.x1, o.x2) + live.dx;
      const y1 = Math.min(o.y1, o.y2) + live.dy, y2 = Math.max(o.y1, o.y2) + live.dy;
      ctx.strokeStyle = (o.color || '#6F00FF') + 'CC';
      ctx.lineWidth   = 2 / zoom;
      ctx.setLineDash([7 / zoom, 5 / zoom]);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.setLineDash([]);
    }

    // ── 4. Links ─────────────────────────────────────────────────
    const nodes = currentNodes();
    const links = currentLinks();
    for (const link of links) {
      const na = nodes.find(n => n.id === link.a), nb = nodes.find(n => n.id === link.b);
      if (!na || !nb) continue;
      if (link.kind === 'hierarchy') {
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth   = 1.6 / zoom;
        ctx.stroke();
        continue;
      }
      let strokeStyle;
      if (link.color) {
        const pulse = 0.55 + Math.sin(t * 2 + link.a.charCodeAt(0) * 0.01) * 0.25;
        strokeStyle  = link.color + Math.round(pulse * 255).toString(16).padStart(2, '0');
      } else {
        const pulse = 0.30 + Math.sin(t * 2 + link.a.charCodeAt(0) * 0.01) * 0.15;
        const alpha = Math.round(pulse * 255).toString(16).padStart(2, '0');
        const grad  = ctx.createLinearGradient(na.x, na.y, nb.x, nb.y);
        grad.addColorStop(0, na.color + alpha);
        grad.addColorStop(1, nb.color + alpha);
        strokeStyle = grad;
      }
      ctx.beginPath();
      ctx.moveTo(na.x, na.y);
      ctx.lineTo(nb.x, nb.y);
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth   = (1.8 + opts.linkStrength * 0.25) / zoom;
      if (link.kind === 'manual') ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
      const prog = ((t * 0.4 + link.a.charCodeAt(0) * 0.01) % 1 + 1) % 1;
      const px   = na.x + (nb.x - na.x) * prog, py = na.y + (nb.y - na.y) * prog;
      ctx.beginPath();
      ctx.arc(px, py, 2 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = link.color || na.color;
      ctx.fill();
    }

    // ── 5. Nodes ─────────────────────────────────────────────────
    for (const n of nodes) {
      const r = nodeRadius(n);
      ctx.beginPath();
      drawNodeShape(ctx, n, r + 2 / zoom);
      ctx.strokeStyle = n.id === connectSourceId ? 'rgba(139,127,238,0.9)' : 'rgba(255,255,255,0.18)';
      ctx.lineWidth   = (n.id === connectSourceId ? 2 : 1) / zoom;
      ctx.stroke();
      ctx.beginPath();
      drawNodeShape(ctx, n, r);
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fill();
      if (opts.labels) {
        const weight = n.type === 'subject' ? 700 : n.type === 'topic' ? 600 : 500;
        const size   = (n.type === 'subject' ? 13 : n.type === 'topic' ? 11.5 : n.type === 'subtopic' ? 10.5 : 10) / zoom;
        ctx.font      = `${weight} ${size}px 'Inter', sans-serif`;
        ctx.fillStyle = n.type === 'subject' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.65)';
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y + r + 13 / zoom);
      }
    }

    // ── 6. Titles (drawn on top) ──────────────────────────────────
    const titles = currentTitles();
    for (const ti of titles) {
      const live = (draggedTitleId === ti.id && titleDragLive) ? titleDragLive : ti;
      const size = TITLE_FONT_SIZE / zoom;
      ctx.font      = `700 ${size}px 'Space Grotesk', sans-serif`;
      ctx.fillStyle = ti.color || 'rgba(255,255,255,0.92)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ti.text || 'Untitled', live.x, live.y);
    }
    ctx.textBaseline = 'alphabetic';

    // ── 7. Rubber-band overlays ───────────────────────────────────
    if (connectSourceId) {
      const src = nodes.find(n => n.id === connectSourceId);
      if (src) {
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(mouseWorld.x, mouseWorld.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth   = 1.5 / zoom;
        ctx.setLineDash([5 / zoom, 4 / zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        connectSourceId = null;
      }
    }
    if (outlinePlacement && outlinePlacement.x1 !== undefined) {
      const ox1 = Math.min(outlinePlacement.x1, mouseWorld.x), ox2 = Math.max(outlinePlacement.x1, mouseWorld.x);
      const oy1 = Math.min(outlinePlacement.y1, mouseWorld.y), oy2 = Math.max(outlinePlacement.y1, mouseWorld.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth   = 1.5 / zoom;
      ctx.setLineDash([5 / zoom, 4 / zoom]);
      ctx.strokeRect(ox1, oy1, ox2 - ox1, oy2 - oy1);
      ctx.setLineDash([]);
    }

    // Update cursor to give clear feedback about current interaction mode
    const canvas2 = $('#graph-canvas');
    if (canvas2) {
      if (panDragging) canvas2.style.cursor = 'grabbing';
      else if (connectSourceId || outlinePlacement) canvas2.style.cursor = 'crosshair';
      else canvas2.style.cursor = 'default';
    }

    animFrame = requestAnimationFrame(frame);
  }
  frame();
}

export function stopGraph() {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
  cancelConnectMode();
  cancelOutlinePlacement();
}

// ── Node geometry ─────────────────────────────────────────────
function nodeRadius(n) { return opts.nodeSize * 0.8 * (TYPE_RADIUS_MULT[n.type] || 1); }
function hitRadius(n)  { return nodeRadius(n) + 6; }  // slightly larger hit area for comfort

function drawNodeShape(ctx, n, r) {
  if (n.type === 'subject') { drawPolygon(ctx, n.x, n.y, r, 6, Math.PI / 6); return; }
  if (n.type === 'topic')   { drawPolygon(ctx, n.x, n.y, r, 4, Math.PI / 4); return; }
  ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
}
function drawPolygon(ctx, cx, cy, r, sides, rotation = 0) {
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else         ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

// ── Data accessors ────────────────────────────────────────────
function currentNodes() {
  return getNotes().map(n => {
    const pos = positions[n.id] || {};
    return { id: n.id, type: n.type || 'note', label: n.title || 'Untitled', color: n.color || '#6F00FF', x: pos.x || 0, y: pos.y || 0 };
  });
}
function currentLinks() {
  const hierarchy = getNotes().filter(n => n.parent_id).map(n => ({ a: n.parent_id, b: n.id, kind: 'hierarchy', color: null }));
  const refs      = getNoteLinks().map(l => ({ a: l.source, b: l.target, kind: l.kind || 'wikilink', color: l.color || null, id: l.id }));
  return [...hierarchy, ...refs];
}
function currentTitles()   { return getGraphObjects().filter(o => o.type === 'title'); }
function currentOutlines() { return getGraphObjects().filter(o => o.type === 'outline'); }

// ── Initial layout ────────────────────────────────────────────
function rebuildPositions(W, H) {
  const notes   = getNotes();
  const cx = W / 2, cy = H / 2;
  const baseR   = Math.min(W, H) * 0.32;
  const subjects = notes.filter(n => (n.type || 'note') === 'subject');
  const jitter   = () => (Math.random() - 0.5) * 40;

  const placeIfNew = (id, x, y) => { if (!positions[id]) positions[id] = { x, y }; };
  const layoutKids = (parentId, px, py, radius, depth) => {
    getChildren(parentId).forEach((k, i, arr) => {
      const a = (i / Math.max(1, arr.length)) * Math.PI * 2 + depth * 0.6;
      const x = px + Math.cos(a) * radius + jitter(), y = py + Math.sin(a) * radius + jitter();
      placeIfNew(k.id, x, y);
      layoutKids(k.id, x, y, radius * 0.55, depth + 1);
    });
  };

  subjects.forEach((s, i, arr) => {
    const a = (i / Math.max(1, arr.length)) * Math.PI * 2;
    const x = cx + Math.cos(a) * baseR, y = cy + Math.sin(a) * baseR;
    placeIfNew(s.id, x, y);
    layoutKids(s.id, x, y, baseR * 0.55, 1);
  });

  const orphans = notes.filter(n => !n.parent_id && (n.type || 'note') !== 'subject');
  if (orphans.length) {
    const groups = {};
    for (const n of orphans) { const s = n.subject || 'General'; (groups[s] = groups[s] || []).push(n); }
    Object.keys(groups).forEach((s, i, arr) => {
      const a = (i / Math.max(1, arr.length)) * Math.PI * 2 + 0.7;
      const gx = cx + Math.cos(a) * baseR, gy = cy + Math.sin(a) * baseR;
      groups[s].forEach((n, j, g) => {
        const aa = (j / Math.max(1, g.length)) * Math.PI * 2;
        placeIfNew(n.id, gx + Math.cos(aa) * 60 + jitter(), gy + Math.sin(aa) * 60 + jitter());
      });
    });
  }
  for (const id of Object.keys(positions)) { if (!notes.find(n => n.id === id)) delete positions[id]; }
  savePositions();
}

// ── Geometry helpers ──────────────────────────────────────────
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, lenSq = dx * dx + dy * dy;
  const tt = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + tt * dx), py - (y1 + tt * dy));
}
function pointInRect(px, py, r) { return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }

function titleBounds(ti) {
  // Approximate text width without a canvas context (good enough for hit-testing)
  const charW = TITLE_FONT_SIZE * 0.55, pad = 12;
  const w = (ti.text || '').length * charW + pad * 2;
  return { x: ti.x - w / 2 - pad, y: ti.y - TITLE_FONT_SIZE / 2 - pad, w: w + pad * 2, h: TITLE_FONT_SIZE + pad * 2 };
}
function outlineEdgeHit(wx, wy, o) {
  // Threshold in world units, inversely scaled so it stays ~8 screen px at any zoom
  const threshold = 8 / zoom;
  const x1 = Math.min(o.x1, o.x2), x2 = Math.max(o.x1, o.x2);
  const y1 = Math.min(o.y1, o.y2), y2 = Math.max(o.y1, o.y2);
  return [[x1,y1,x2,y1],[x1,y2,x2,y2],[x1,y1,x1,y2],[x2,y1,x2,y2]]
    .some(([ex1,ey1,ex2,ey2]) => distToSegment(wx, wy, ex1, ey1, ex2, ey2) < threshold);
}
function linkHitTest(wx, wy, nodes) {
  const threshold = 7 / zoom;
  for (const l of getNoteLinks()) {
    if (l.kind !== 'manual') continue;
    const na = nodes.find(n => n.id === l.source), nb = nodes.find(n => n.id === l.target);
    if (!na || !nb) continue;
    if (distToSegment(wx, wy, na.x, na.y, nb.x, nb.y) < threshold) return l;
  }
  return null;
}

// ── Interaction binding ───────────────────────────────────────
function bindInteraction(canvas) {
  if (canvas.__bound) return;
  canvas.__bound = true;

  // Zoom: scroll wheel, centered on cursor
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect   = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    // Keep the world point under the cursor fixed
    const wx = (sx - pan.x) / zoom, wy = (sy - pan.y) / zoom;
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    pan.x = sx - wx * zoom;
    pan.y = sy - wy * zoom;
    savePanZoom();
  }, { passive: false });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const { x: wx, y: wy } = toWorld(sx, sy);
    const nodes = currentNodes();

    // ── Outline placement (two-click flow) ──────────────────
    if (outlinePlacement) {
      if (outlinePlacement.x1 === undefined) {
        outlinePlacement = { x1: wx, y1: wy };
        toast('Click the second corner — Esc to cancel');
      } else {
        const x1 = Math.min(outlinePlacement.x1, wx), x2 = Math.max(outlinePlacement.x1, wx);
        const y1 = Math.min(outlinePlacement.y1, wy), y2 = Math.max(outlinePlacement.y1, wy);
        createGraphObject({ type: 'outline', x1, y1, x2, y2, color: SWATCHES[0] });
        cancelOutlinePlacement();
        toast('Outline added');
      }
      return;
    }

    // ── Connect mode ─────────────────────────────────────────
    if (connectSourceId) {
      const hit = nodes.find(n => Math.hypot(n.x - wx, n.y - wy) < hitRadius(n));
      if (hit && hit.id !== connectSourceId) { createManualLink(connectSourceId, hit.id); toast('Connected'); }
      cancelConnectMode();
      return;
    }

    // ── Node drag ────────────────────────────────────────────
    const nodeHit = nodes.find(n => Math.hypot(n.x - wx, n.y - wy) < hitRadius(n));
    if (nodeHit) {
      draggedNodeId    = nodeHit.id;
      nodeDragOffset   = { x: wx - nodeHit.x, y: wy - nodeHit.y };
      nodeClickInfo    = { wx, wy, id: nodeHit.id };
      return;
    }

    // ── Title drag ───────────────────────────────────────────
    const titleHit = currentTitles().find(ti => pointInRect(wx, wy, titleBounds(ti)));
    if (titleHit) {
      draggedTitleId   = titleHit.id;
      titleDragLive    = { x: titleHit.x, y: titleHit.y };
      titleDragOffset  = { x: wx - titleHit.x, y: wy - titleHit.y };
      return;
    }

    // ── Outline drag (edge only) ─────────────────────────────
    const outlineHit = currentOutlines().find(o => outlineEdgeHit(wx, wy, o));
    if (outlineHit) {
      draggedOutlineId  = outlineHit.id;
      outlineDragStart  = { x: wx, y: wy };
      outlineDragLive   = { dx: 0, dy: 0 };
      return;
    }

    // ── Pan drag (empty space) ───────────────────────────────
    panDragging  = true;
    panDragStart = { sx, sy, px: pan.x, py: pan.y };
  });

  window.addEventListener('mousemove', (e) => {
    const canvas2 = $('#graph-canvas');
    if (!canvas2) return;
    const rect = canvas2.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const w  = toWorld(sx, sy);
    mouseWorld.x = w.x;
    mouseWorld.y = w.y;

    if (panDragging && panDragStart) {
      pan.x = panDragStart.px + (sx - panDragStart.sx);
      pan.y = panDragStart.py + (sy - panDragStart.sy);
    }
    if (draggedNodeId) {
      const p = positions[draggedNodeId];
      if (p) { p.x = w.x - nodeDragOffset.x; p.y = w.y - nodeDragOffset.y; }
    }
    if (draggedTitleId && titleDragLive) {
      titleDragLive.x = w.x - titleDragOffset.x;
      titleDragLive.y = w.y - titleDragOffset.y;
    }
    if (draggedOutlineId && outlineDragStart && outlineDragLive) {
      outlineDragLive.dx = w.x - outlineDragStart.x;
      outlineDragLive.dy = w.y - outlineDragStart.y;
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (panDragging) {
      panDragging = false;
      savePanZoom();
    }
    if (draggedNodeId) {
      const canvas2 = $('#graph-canvas');
      if (canvas2) {
        const rect = canvas2.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const w  = toWorld(sx, sy);
        if (nodeClickInfo && Math.hypot(w.x - nodeClickInfo.wx, w.y - nodeClickInfo.wy) < 6 / zoom) {
          openNoteCallback?.(nodeClickInfo.id);
        }
      }
      draggedNodeId = null;
      nodeClickInfo = null;
      savePositions();
    }
    if (draggedTitleId && titleDragLive) {
      updateGraphObject(draggedTitleId, { x: titleDragLive.x, y: titleDragLive.y });
      draggedTitleId = null;
      titleDragLive  = null;
    }
    if (draggedOutlineId && outlineDragLive) {
      const o = currentOutlines().find(x => x.id === draggedOutlineId);
      if (o) updateGraphObject(draggedOutlineId, { x1: o.x1 + outlineDragLive.dx, y1: o.y1 + outlineDragLive.dy, x2: o.x2 + outlineDragLive.dx, y2: o.y2 + outlineDragLive.dy });
      draggedOutlineId = null;
      outlineDragLive  = null;
      outlineDragStart = null;
    }
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const rect  = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const { x: wx, y: wy } = toWorld(sx, sy);
    const nodes = currentNodes();

    const nodeHit    = nodes.find(n => Math.hypot(n.x - wx, n.y - wy) < hitRadius(n));
    if (nodeHit)    { showNodeContextMenu(nodeHit, e.clientX, e.clientY); return; }
    const titleHit   = currentTitles().find(ti => pointInRect(wx, wy, titleBounds(ti)));
    if (titleHit)   { showTitleContextMenu(titleHit, e.clientX, e.clientY); return; }
    const outlineHit = currentOutlines().find(o => outlineEdgeHit(wx, wy, o));
    if (outlineHit) { showOutlineContextMenu(outlineHit, e.clientX, e.clientY); return; }
    const linkHit    = linkHitTest(wx, wy, nodes);
    if (linkHit)    { showLinkContextMenu(linkHit, e.clientX, e.clientY); return; }
    showCanvasContextMenu(wx, wy, e.clientX, e.clientY);
  });
}

function ensureHint(container) {
  const old = container.querySelector('.graph-hint');
  if (old) old.remove();
  container.appendChild(el('div', { class: 'graph-hint' },
    'Scroll to zoom · drag empty space to pan · right-click to add nodes, titles, or outlines'));
}

// ── Connect mode ──────────────────────────────────────────────
function armConnectMode(id) {
  cancelOutlinePlacement();
  connectSourceId = id;
  toast('Click another node to connect it — Esc to cancel');
  window.addEventListener('keydown', onConnectKey);
}
function onConnectKey(e) { if (e.key === 'Escape') cancelConnectMode(); }
function cancelConnectMode() {
  if (!connectSourceId) return;
  connectSourceId = null;
  window.removeEventListener('keydown', onConnectKey);
}

// ── Outline two-click placement ───────────────────────────────
function armOutlinePlacement() {
  cancelConnectMode();
  outlinePlacement = {};
  toast('Click the first corner — Esc to cancel');
  window.addEventListener('keydown', onOutlineKey);
}
function onOutlineKey(e) { if (e.key === 'Escape') cancelOutlinePlacement(); }
function cancelOutlinePlacement() {
  if (outlinePlacement === null) return;
  outlinePlacement = null;
  window.removeEventListener('keydown', onOutlineKey);
}

// ── Context menus ─────────────────────────────────────────────
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function showCanvasContextMenu(wx, wy, clientX, clientY) {
  const menu = el('div', { class: 'ctx-menu' }, [
    el('div', { class: 'ctx-menu-title' }, 'Add to graph'),
    ...['subject','topic','subtopic','note'].map(ty => el('div', {
      class: 'ctx-menu-item',
      onclick: () => { closeContextMenu(); openCreateNodeModal(ty, wx, wy); },
    }, '+ ' + capitalize(ty))),
    el('div', { class: 'ctx-menu-item', onclick: () => { closeContextMenu(); openCreateTitleModal(wx, wy); } }, '+ Title'),
    el('div', { class: 'ctx-menu-item', onclick: () => { closeContextMenu(); armOutlinePlacement(); } }, '+ Outline'),
  ]);
  openContextMenu(menu, clientX, clientY);
}

function showNodeContextMenu(node, clientX, clientY) {
  openContextMenu(contextMenuItems(`${node.label} · ${node.type}`, [
    { label: 'Open',       onClick: () => openNoteCallback?.(node.id) },
    { label: 'Connect to…',onClick: () => armConnectMode(node.id) },
    { label: 'Rename',     onClick: () => {
      const v = prompt('Rename node', node.label);
      if (v && v.trim() && v.trim() !== node.label) { updateNote(node.id, { title: v.trim() }); renderList(); }
    } },
    { label: 'Delete', danger: true, onClick: () => {
      if (confirm(`Delete "${node.label}"? Child nodes will be unlinked.`)) {
        deleteNote(node.id); delete positions[node.id]; savePositions(); renderList();
      }
    } },
  ]), clientX, clientY);
}

function showTitleContextMenu(ti, clientX, clientY) {
  openContextMenu(contextMenuItems(ti.text || 'Title', [
    { label: 'Edit text', onClick: () => {
      const v = prompt('Title text', ti.text || '');
      if (v != null && v.trim()) updateGraphObject(ti.id, { text: v.trim() });
    } },
    { label: 'Delete', danger: true, onClick: () => deleteGraphObject(ti.id) },
  ]), clientX, clientY);
}

function showColorAndDeleteMenu(title, currentColor, onColor, onDelete, clientX, clientY) {
  const cur = (currentColor || '').toLowerCase();
  const swatchRow = el('div', { class: 'ctx-swatch-row' },
    SWATCHES.map(c => el('div', {
      class: 'ctx-swatch' + (cur === c.toLowerCase() ? ' selected' : ''),
      style: { background: c },
      onclick: () => { closeContextMenu(); onColor(c); },
    }))
  );
  openContextMenu(el('div', { class: 'ctx-menu' }, [
    el('div', { class: 'ctx-menu-title' }, title),
    swatchRow,
    el('div', { class: 'ctx-menu-item ctx-menu-danger', onclick: () => { closeContextMenu(); onDelete(); } }, 'Delete'),
  ]), clientX, clientY);
}

function showOutlineContextMenu(o, clientX, clientY) {
  showColorAndDeleteMenu('Outline', o.color, c => updateGraphObject(o.id, { color: c }), () => deleteGraphObject(o.id), clientX, clientY);
}
function showLinkContextMenu(link, clientX, clientY) {
  showColorAndDeleteMenu('Connection', link.color, c => updateLink(link.id, { color: c }), () => deleteLink(link.id), clientX, clientY);
}

// ── Create modals ─────────────────────────────────────────────
function getValidParents(type) {
  const wanted = validParentTypesFor(type);
  return !wanted.length ? [] : getNotes().filter(n => wanted.includes(n.type || 'note'));
}

function openCreateNodeModal(defaultType, wx, wy) {
  const host = el('div', { class: 'modal-backdrop' });
  const titleInput = el('input', { class: 'input', placeholder: 'Title' });
  const typeSel = el('select', { class: 'select' },
    ['subject','topic','subtopic','note'].map(ty =>
      el('option', { value: ty, ...(ty === defaultType ? { selected: 'selected' } : {}) }, capitalize(ty))));
  const parentWrap = el('div');
  const err = el('div', { class: 'modal-sub' }, '');

  const renderParentField = () => {
    clear(parentWrap);
    const ty = typeSel.value;
    if (ty === 'subject') return;
    const candidates = getValidParents(ty);
    parentWrap.appendChild(el('div', { class: 'modal-sub' }, 'Parent'));
    parentWrap.appendChild(el('select', { class: 'select', id: 'create-node-parent' }, [
      el('option', { value: '' }, candidates.length ? '— choose parent —' : `No ${validParentTypesFor(ty).join('/')} yet — create one first`),
      ...candidates.map(p => el('option', { value: p.id }, `[${p.type}] ${p.title}`)),
    ]));
  };
  typeSel.addEventListener('change', renderParentField);
  renderParentField();

  const createBtn = el('button', { class: 'btn-primary' }, 'Create');
  const cancelBtn = el('button', { class: 'btn-ghost' }, 'Cancel');
  createBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) { err.textContent = 'Title required'; return; }
    const ty = typeSel.value;
    let parentId = null, subjectStr = title;
    if (ty !== 'subject') {
      const parentSel = $('#create-node-parent', host);
      parentId = parentSel?.value || null;
      if (!parentId) { err.textContent = 'Choose a parent node'; return; }
      const pNote = getNote(parentId);
      subjectStr = pNote.type === 'subject' ? pNote.title : (pNote.subject || 'General');
    }
    const note = await createNote({ type: ty, parent_id: parentId, title, subject: subjectStr, body: '' });
    const canvas = $('#graph-canvas');
    const margin = 30 / zoom;
    const cxMin = (-pan.x / zoom) + margin, cxMax = ((canvas?.width || 800) - pan.x) / zoom - margin;
    const cyMin = (-pan.y / zoom) + margin, cyMax = ((canvas?.height || 600) - pan.y) / zoom - margin;
    positions[note.id] = {
      x: Math.min(Math.max(wx, cxMin), cxMax),
      y: Math.min(Math.max(wy, cyMin), cyMax),
    };
    savePositions();
    document.body.removeChild(host);
    renderList();
    toast(`Created ${ty}: ${title}`);
  });
  cancelBtn.addEventListener('click', () => document.body.removeChild(host));

  host.appendChild(el('div', { class: 'modal' }, [
    el('div', { class: 'modal-title' }, 'Create node'),
    el('div', { class: 'modal-sub' }, 'Type'), typeSel,
    parentWrap,
    el('div', { class: 'modal-sub' }, 'Title'), titleInput,
    err,
    el('div', { style: { display: 'flex', gap: '8px', marginTop: '4px' } }, [createBtn, cancelBtn]),
  ]));
  document.body.appendChild(host);
  titleInput.focus();
}

function openCreateTitleModal(wx, wy) {
  const host = el('div', { class: 'modal-backdrop' });
  const textInput = el('input', { class: 'input', placeholder: 'e.g. "Midterm topics"' });
  const err = el('div', { class: 'modal-sub' }, '');
  const createBtn = el('button', { class: 'btn-primary' }, 'Create');
  const cancelBtn = el('button', { class: 'btn-ghost' }, 'Cancel');
  createBtn.addEventListener('click', async () => {
    const text = textInput.value.trim();
    if (!text) { err.textContent = 'Text required'; return; }
    await createGraphObject({ type: 'title', text, x: wx, y: wy, color: 'rgba(255,255,255,0.92)' });
    document.body.removeChild(host);
    toast('Title added');
  });
  cancelBtn.addEventListener('click', () => document.body.removeChild(host));
  host.appendChild(el('div', { class: 'modal' }, [
    el('div', { class: 'modal-title' }, 'Add a title'),
    el('div', { class: 'modal-sub' }, 'Big label to mark what a section of the graph is about'),
    textInput, err,
    el('div', { style: { display: 'flex', gap: '8px', marginTop: '4px' } }, [createBtn, cancelBtn]),
  ]));
  document.body.appendChild(host);
  textInput.focus();
}

// ── Persistence ───────────────────────────────────────────────
const POS_KEY   = 'nexuslearn.graphPositions';
const VIEW_KEY  = 'nexuslearn.graphView';

function savePositions() {
  try { localStorage.setItem(POS_KEY, JSON.stringify(positions)); } catch {}
}
function savePanZoom() {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ pan, zoom })); } catch {}
}
export function loadPositions() {
  try { const r = localStorage.getItem(POS_KEY); if (r) positions = JSON.parse(r); } catch {}
}
function loadPanZoom() {
  try {
    const r = localStorage.getItem(VIEW_KEY);
    if (r) { const v = JSON.parse(r); pan = v.pan || { x: 0, y: 0 }; zoom = v.zoom || 1; }
  } catch {}
}
loadPositions();
