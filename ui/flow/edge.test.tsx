import { render } from "@testing-library/react";
import { type EdgeProps, Position, ReactFlowProvider } from "@xyflow/react";
import { type LabelledData, LabelledEdge } from "./LabelledEdge";

/** An edge's props, of `data`. */
function props(data: LabelledData | undefined): EdgeProps {
  return {
    id: "e",
    source: "a",
    target: "b",
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data,
    markerEnd: "url(#arrow)",
  } as EdgeProps;
}

/** The edge of `data` drawn: its paths' classes, its hover title, and its path. */
function drawn(data: LabelledData | undefined) {
  const { container, unmount } = render(
    <ReactFlowProvider>
      <svg>
        <LabelledEdge {...props(data)} />
      </svg>
    </ReactFlowProvider>,
  );
  const paths = [...container.querySelectorAll("path")];
  const shown = {
    classes: paths.map((p) => p.getAttribute("class")),
    title: container.querySelector("title")?.textContent,
    d: paths[0]?.getAttribute("d"),
  };
  unmount();
  return shown;
}

describe("a drawing's edge", () => {
  it("is a curve bent as its data says, dashed if asked, its label its hover's title [DESIGN] D74", () => {
    const plain = drawn({ label: "ORDER_LINES 1, 3", bend: 10, at: 0.5 });
    expect(plain.classes).toEqual(["react-flow__edge-path flow-edge", "flow-edge-hover"]);
    expect(plain.title).toBe("ORDER_LINES 1, 3");
    expect(plain.d).toBe("M 0 0 Q 50 20 100 0");
    expect(drawn({ label: "BANK SOURCE", bend: 0, at: null, dashed: true }).classes[0]).toContain("flow-edge-dashed");
    expect(drawn({ label: "E", bend: 0, at: null, always: true }).title).toBe("E");
    expect(drawn(undefined).d).toBe("M 0 0 Q 50 0 100 0");
  });
});
