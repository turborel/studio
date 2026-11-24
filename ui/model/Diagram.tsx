/**
 * A model's diagram (RULES.md D15, D46): React Flow draws its tables and
 * their foreign keys, a table dragged keeping its new place in the
 * model, a click selecting it; a search centres the diagram on the first
 * table it finds.
 */
import {
  Background,
  Controls,
  Handle,
  type Node,
  type NodeProps,
  ReactFlow,
  Position,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect } from "react";
import { BOX_WIDTH, boxHeight } from "./layout";
import { columnMarks } from "./svg";
import { type ModelDoc } from "./models";
import { tableKey } from "./model";
import { edgesOf, handleId, nodesOf, rowMiddle, type TableData } from "./flowParts";
import { EDGE_TYPES } from "../flow/LabelledEdge";
import "../flow/flow.css";
import { menuKey } from "../shell/ContextMenu";

/** The ends an edge is drawn to of a column, or of the table for none, `top` down its box: each side's, of each way. */
function Handles({ column, top }: { readonly column: string | null; readonly top: number }) {
  const ends = [
    ["l", Position.Left],
    ["r", Position.Right],
  ] as const;
  return ends.flatMap(([side, position]) =>
    (["s", "t"] as const).map((kind) => (
      <Handle
        key={`${side}${kind}`}
        id={handleId(column, side, kind)}
        type={kind === "s" ? "source" : "target"}
        position={position}
        isConnectable={false}
        className="flow-handle"
        style={{ top }}
      />
    )),
  );
}

/** A table's node: its name, then each column, its type and marks. */
export function TableNode({ data }: NodeProps) {
  const { table, selected } = data as TableData;
  return (
    <div
      className={selected ? "model-table model-selected" : "model-table"}
      style={{ width: BOX_WIDTH, height: boxHeight(table) }}
    >
      <Handles column={null} top={rowMiddle(table, null)} />
      {table.columns.map((c) => (
        <Handles key={c.name} column={c.name} top={rowMiddle(table, c.name)} />
      ))}
      <div className="model-table-name">{tableKey(table)}</div>
      <ul>
        {table.columns.map((c) => (
          <li key={c.name}>
            <span>{c.name}</span>
            <span className="model-type">
              {c.type} {columnMarks(table, c.name)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A schema's box, behind its tables. */
export function SchemaNode({ data }: NodeProps) {
  return <div className="model-schema">{(data as { schema: string }).schema}</div>;
}

/** The kinds of node a diagram draws. */
const NODE_TYPES = { table: TableNode, schema: SchemaNode };

/** Centres the diagram on the first table `search` finds, as it changes. */
function SearchFocus({ doc, search }: { readonly doc: ModelDoc; readonly search: string }) {
  const flow = useReactFlow();
  useEffect(() => {
    const word = search.trim().toUpperCase();
    const found = word === "" ? undefined : doc.model.tables.find((t) => tableKey(t).toUpperCase().includes(word));
    if (found?.position !== undefined && found.position !== null) {
      void flow.setCenter(found.position.x + BOX_WIDTH / 2, found.position.y + boxHeight(found) / 2, { zoom: 1 });
    }
  }, [flow, doc.model.tables, search]);
  return null;
}

/** Opens the menu of the table selected, or of the diagram, by Shift+F10 or the context menu key. */
function keyedMenu(
  doc: ModelDoc,
  onMenu: ((key: string | null, at: { x: number; y: number }) => void) | undefined,
): (e: React.KeyboardEvent<HTMLDivElement>) => void {
  return (e) => {
    if (menuKey(e)) {
      e.preventDefault();
      const box = e.currentTarget.getBoundingClientRect();
      onMenu?.(doc.selected, { x: box.left + KEYED_INSET, y: box.top + KEYED_INSET });
    }
  };
}

/** What a click on the diagram's background does: no table selected. */
function selectsNone(onSelect: (key: string | null) => void): () => void {
  return () => {
    onSelect(null);
  };
}

/** The nodes and edges of `doc`'s tables not hidden. */
function drawn(doc: ModelDoc) {
  const model = { ...doc.model, tables: doc.model.tables.filter((t) => !doc.hidden.includes(tableKey(t))) };
  return { nodes: nodesOf(model, doc), edges: edgesOf(model, doc.filter) };
}

/** Opens the menu of `key`, or of the diagram, where the pointer is. */
function pointedMenu(
  event: { preventDefault: () => void; clientX: number; clientY: number },
  key: string | null,
  onMenu: ((key: string | null, at: { x: number; y: number }) => void) | undefined,
): void {
  event.preventDefault();
  onMenu?.(key, { x: event.clientX, y: event.clientY });
}

/** How far into the diagram a menu opened by the keys is placed, in pixels. */
const KEYED_INSET = 40;

/** The diagram of `doc`, a table moved told by `onMove`, one clicked by `onSelect`. */
export function Diagram(props: {
  readonly doc: ModelDoc;
  readonly search: string;
  readonly onMove: (key: string, at: { x: number; y: number }) => void;
  readonly onSelect: (key: string | null) => void;
  /** The menu of a table, or of the diagram where `key` is null, at a place in the window. */
  readonly onMenu?: (key: string | null, at: { x: number; y: number }) => void;
}) {
  const { doc } = props;
  const { nodes, edges } = drawn(doc);
  return (
    <div
      className="model-diagram"
      role="figure"
      aria-label={`Diagram of ${doc.model.name}: ${String(doc.model.tables.length)} tables`}
      tabIndex={0}
      onKeyDown={keyedMenu(doc, props.onMenu)}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView={true}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          colorMode={document.documentElement.dataset["theme"] === "dark" ? "dark" : "light"}
          onNodeDragStop={(_event, node: Node) => {
            props.onMove(node.id, node.position);
          }}
          onNodeClick={(_event, node: Node) => {
            props.onSelect(node.type === "table" ? node.id : null);
          }}
          onPaneClick={selectsNone(props.onSelect)}
          onNodeContextMenu={(event, node: Node) => {
            pointedMenu(event, node.type === "table" ? node.id : null, props.onMenu);
          }}
          onPaneContextMenu={(event) => {
            pointedMenu(event, null, props.onMenu);
          }}
        >
          <Background />
          <Controls showInteractive={false} />
          <SearchFocus doc={doc} search={props.search} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
