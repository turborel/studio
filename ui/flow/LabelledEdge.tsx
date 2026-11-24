/**
 * An edge of a drawing (RULES.md D74): a curve between its ends, bent as
 * its data says so parallel edges spread apart, drawn in the theme's
 * colour; its label on a plate at the place `labels.ts` chose, or, with
 * none, shown on hover of the edge, as the drawing's toggle may show it.
 */
import { EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { along, control } from "./labels";

/** What a labelled edge is drawn of. */
export interface LabelledData extends Record<string, unknown> {
  readonly label: string;
  readonly bend: number;
  /** Where along it its label sits, from 0 to 1; null to show it on hover alone. */
  readonly at: number | null;
  /** Whether its label is shown even where no place was found for it. */
  readonly always?: boolean;
  readonly dashed?: boolean;
}

/** An edge, curved, its label on a plate. */
export function LabelledEdge(props: EdgeProps) {
  const data = props.data as LabelledData | undefined;
  const from = { x: props.sourceX, y: props.sourceY };
  const to = { x: props.targetX, y: props.targetY };
  const by = control(from, to, data?.bend ?? 0);
  const path = `M ${String(from.x)} ${String(from.y)} Q ${String(by.x)} ${String(by.y)} ${String(to.x)} ${String(to.y)}`;
  const t = data?.at ?? (data?.always === true ? 0.5 : null);
  const at = t === null ? null : along(from, by, to, t);
  const label = data?.label ?? "";
  return (
    <>
      <path
        id={props.id}
        className={`react-flow__edge-path flow-edge${data?.dashed === true ? " flow-edge-dashed" : ""}`}
        d={path}
        fill="none"
        markerEnd={props.markerEnd}
      />
      <path className="flow-edge-hover" d={path} fill="none">
        <title>{label}</title>
      </path>
      {at !== null && label !== "" && (
        <EdgeLabelRenderer>
          <div
            className="flow-label"
            style={{ transform: `translate(-50%, -50%) translate(${String(at.x)}px, ${String(at.y)}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** The edges a drawing draws. */
export const EDGE_TYPES = { labelled: LabelledEdge };
