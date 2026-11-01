// The flow diagram, drawn from the diagram-studio/1 file by name (served by GET /api/diagrams/:id, validated at server start).
// Boxes move; Reset puts them back (also when the page-level Reset raises resetSignal); Simulate walks the steps; the speed control
// sets the pause between steps. Buttons that cannot act right now are aria-disabled, not disabled, so keyboard focus is never lost.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BaseEdge, EdgeLabelRenderer, Handle, MarkerType, Position, getBezierPath, useNodesState, useEdgesState, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export const DIAGRAM_ID = 'progressive-trust-ladder';
const BASE_STEP_MS = 1500;
const SPEEDS = [{ label: '0.5x', factor: 0.5 }, { label: '1x', factor: 1 }, { label: '2x', factor: 2 }];
const COLORS = new Set(['dark', 'blue', 'green', 'grey', 'red', 'amber']);

const edgeClass = (dashed, hot) => [dashed ? 'edge--dashed' : '', hot ? 'edge--hot' : ''].filter(Boolean).join(' ') || undefined;

// A box with a handle on every side, so an arrow can leave toward the box it points at instead of looping out of the bottom.
const HANDLES = [['t', Position.Top], ['b', Position.Bottom], ['l', Position.Left], ['r', Position.Right]];
function Box({ data }) {
  return (
    <>
      {HANDLES.map(([k, pos]) => (
        <span key={k}>
          <Handle id={`s-${k}`} type="source" position={pos} className="box-handle" />
          <Handle id={`t-${k}`} type="target" position={pos} className="box-handle" />
        </span>
      ))}
      {data.label}
    </>
  );
}
const nodeTypes = { box: Box };

// The sides of the two boxes that face each other (from where the data file places them).
function sides(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ['r', 'l'] : ['l', 'r']) : (dy > 0 ? ['b', 't'] : ['t', 'b']);
}

// An edge that draws its own label, so a reply along the same pair of boxes can sit above or below its partner instead of on top of it.
// The label's position is a run-time value, so it is the one place a style attribute is written.
function LabelEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div className="edge-label" data-testid="edge-label" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly + data.dy}px)` }}>{data.text}</div>
      </EdgeLabelRenderer>
    </>
  );
}
const edgeTypes = { label: LabelEdge };

// Edges that run along the same pair of boxes in opposite directions get opposite nudges (-12 and +12 px), so their labels never share a spot.
export function labelOffsets(edges) {
  return edges.map((e, i) => {
    if (edges.slice(0, i).some((o) => o.source === e.target && o.target === e.source)) return 12;
    return edges.slice(i + 1).some((o) => o.source === e.target && o.target === e.source) ? -12 : 0;
  });
}

function toFlow(d) {
  const nodes = d.nodes.map((n) => {
    const color = d.groups[n.group].color;
    return {
      id: n.id,
      type: 'box',
      position: { x: n.x, y: n.y },
      className: `node node--${COLORS.has(color) ? color : 'dark'}`,
      data: {
        label: (
          <div className="node-label">
            <strong>{n.label}</strong>
            {(n.sub || []).map((line, i) => <span key={i}>{line}</span>)}
          </div>
        ),
      },
    };
  });
  const offsets = labelOffsets(d.edges);
  const at = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
  const edges = d.edges.map((e, i) => {
    let [a, b] = sides(at[e.source], at[e.target]);
    // The reply along a pair already drawn leaves from another side, so the two lines do not lie on top of each other.
    if (d.edges.slice(0, i).some((o) => o.source === e.target && o.target === e.source)) [a, b] = a === 'l' || a === 'r' ? ['b', 'b'] : ['r', 'r'];
    return {
    id: `e${i}`,
    source: e.source,
    target: e.target,
    sourceHandle: `s-${a}`,
    targetHandle: `t-${b}`,
    type: 'label',
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: false,
    className: edgeClass(e.dashed, false),
    data: { dashed: Boolean(e.dashed), text: e.label || '', dy: offsets[i] },
    };
  });
  return { nodes, edges };
}

// The zoom buttons sit in a row above the canvas, not on top of it, so they can never cover a node box at any width.
export function DiagramPanel(props) {
  return <ReactFlowProvider><DiagramInner {...props} /></ReactFlowProvider>;
}

// A button that is not available answers aria-disabled and does nothing when pressed; focus stays where it was.
const Act = ({ off, onAct, children, ...rest }) => (
  <button type="button" aria-disabled={off ? 'true' : undefined} onClick={() => { if (!off) onAct(); }} {...rest}>{children}</button>
);

function DiagramInner({ api, resetSignal = 0 }) {
  const flow = useReactFlow();
  const [diagram, setDiagram] = useState(null);
  const [error, setError] = useState(null);
  const [speed, setSpeed] = useState(1);
  const [running, setRunning] = useState(false);
  const [caption, setCaption] = useState('');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const initial = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    api.diagram(DIAGRAM_ID).then((r) => {
      if (!alive) return;
      if (!r.data || !r.data.nodes) { setError('The diagram could not be loaded.'); return; }
      const f = toFlow(r.data);
      initial.current = f;
      setDiagram(r.data);
      setNodes(f.nodes);
      setEdges(f.edges);
    }).catch(() => alive && setError('The diagram could not be loaded.'));
    return () => { alive = false; };
  }, [api, setNodes, setEdges]);

  const stopSim = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    setRunning(false);
  }, []);
  useEffect(() => stopSim, [stopSim]);

  // Puts every box back where the data file placed it, clears the highlighted edges and the caption, and refits the view.
  const restoreLayout = useCallback(() => {
    stopSim();
    if (!initial.current) return;
    setNodes(initial.current.nodes.map((n) => ({ ...n, position: { ...n.position } })));
    setEdges(initial.current.edges.map((e) => ({ ...e, animated: false })));
    setCaption('');
    setTimeout(() => flow.fitView({ duration: 200, padding: 0.1 }), 0);
  }, [setNodes, setEdges, stopSim, flow]);

  // The page-level Reset raises resetSignal; the diagram goes back in place with it.
  const seen = useRef(resetSignal);
  useEffect(() => {
    if (seen.current === resetSignal) return;
    seen.current = resetSignal;
    restoreLayout();
  }, [resetSignal, restoreLayout]);

  const simulate = useCallback(() => {
    if (!diagram || !diagram.steps || !diagram.steps.length) return;
    stopSim();
    const pause = BASE_STEP_MS / SPEEDS[speed].factor;
    const steps = diagram.steps;
    setRunning(true);
    let i = 0;
    const show = () => {
      const step = steps[i];
      const hot = new Set(step.edges);
      setEdges(initial.current.edges.map((e, k) => ({ ...e, animated: hot.has(k), className: edgeClass(e.data.dashed, hot.has(k)) })));
      setCaption(`Step ${i + 1} of ${steps.length}: ${step.title}. ${step.what}`);
      i += 1;
      if (i < steps.length) timer.current = setTimeout(show, pause);
      else { timer.current = setTimeout(() => setRunning(false), pause); }
    };
    show();
  }, [diagram, speed, setEdges, stopSim]);

  // minZoom 0.5 keeps the labels readable; fitView then shows as much of the diagram as that zoom allows.
  const flowProps = useMemo(() => ({ fitView: true, minZoom: 0.5, nodesDraggable: true, nodesConnectable: false, elementsSelectable: true }), []);

  if (error) return <p role="alert" className="muted">{error}</p>;
  return (
    <div>
      <div className="row">
        <Act off={!diagram || running} onAct={simulate}>Simulate</Act>
        <Act off={!running} onAct={stopSim}>Stop</Act>
        <Act off={!diagram} onAct={restoreLayout}>Reset diagram</Act>
        <label htmlFor="speed" className="speed-label">Speed</label>
        <select id="speed" className="speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
        </select>
      </div>
      <p aria-live="polite" className="muted" data-testid="caption">{caption}</p>
      <div className="row" role="group" aria-label="Diagram view">
        <Act off={!diagram} onAct={() => flow.zoomIn({ duration: 200 })}>Zoom in</Act>
        <Act off={!diagram} onAct={() => flow.zoomOut({ duration: 200 })}>Zoom out</Act>
        <Act off={!diagram} onAct={() => flow.fitView({ duration: 200, padding: 0.1 })}>Fit view</Act>
      </div>
      <div className="diagram" role="region" aria-label="Flow diagram">
        {/* Mounted only once the nodes exist, so fitView runs on the real layout. */}
        {diagram ? (
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} {...flowProps}>
            <Background />
          </ReactFlow>
        ) : null}
      </div>
      <p className="muted">Boxes can be dragged. Reset diagram puts them back.</p>
    </div>
  );
}
