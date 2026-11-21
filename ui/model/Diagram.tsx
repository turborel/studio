/**
 * A model's diagram (RULES.md D15, D46): React Flow draws its tables and
 * their foreign keys, a table dragged keeping its new place in the
 * model, a click selecting it; a search centres the diagram on the first
 * table it finds.
 */
import {
  Background,
  Controls,
  type Node,
  type NodeProps,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect } from "react";
import { BOX_WIDTH, boxHeight } from "./layout";
import { columnMarks } from "./svg";
import { type ModelDoc } from "./models";
import { tableKey } from "./model";
import { edgesOf, nodesOf, type TableData } from "./flowParts";

/** A table's node: its name, then each column, its type and marks. */
export function TableNode({ data }: NodeProps) {
  const { table, selected } = data as TableData;
  return (
    <div
      className={selected ? "model-table model-selected" : "model-table"}
      style={{ width: BOX_WIDTH, height: boxHeight(table) }}
    >
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

/** The diagram of `doc`, a table moved told by `onMove`, one clicked by `onSelect`. */
export function Diagram(props: {
  readonly doc: ModelDoc;
  readonly search: string;
  readonly onMove: (key: string, at: { x: number; y: number }) => void;
  readonly onSelect: (key: string | null) => void;
}) {
  const { doc } = props;
  const nodes = nodesOf(doc.model, doc);
  const edges = edgesOf(doc.model, doc.filter);
  return (
    <div
      className="model-diagram"
      role="figure"
      aria-label={`Diagram of ${doc.model.name}: ${String(doc.model.tables.length)} tables`}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
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
          onPaneClick={() => {
            props.onSelect(null);
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
