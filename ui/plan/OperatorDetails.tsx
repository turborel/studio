/**
 * The details of an operator of its kind (RULES.md D54), beside the plan:
 * a range join's search, an aggregate's grouping, a semi join's, an
 * antijoin's and a mark join's way, and what EXPLAIN ANALYZE told it did
 * beyond its rows: the rows a data change changed, its batches, its spill
 * and its reads of an index.
 */
import { Fragment } from "react";
import { groupingOf, markOf, rangeOf, semiOf, transferOf } from "./kinds";
import type { PlanNode } from "./plan";

/** What a range join searches by, of `node` if it is one. */
function RangeDetails({ node }: { readonly node: PlanNode }) {
  const range = rangeOf(node);
  if (range === null) {
    return null;
  }
  return (
    <>
      <dt>Sorted on</dt>
      <dd>{range.sorted}</dd>
      {range.within.length > 0 && (
        <>
          <dt>Grouped by</dt>
          <dd>{range.within.join(", ")}</dd>
        </>
      )}
      {range.pruned !== null && (
        <>
          <dt>Pruned by</dt>
          <dd>{range.pruned}</dd>
        </>
      )}
    </>
  );
}

/** What `node` did beyond its rows: the rows it changed, its batches, its spill and its reads of an index. */
function DoneDetails({ node }: { readonly node: PlanNode }) {
  const told: (readonly [string, string])[] = [];
  if (node.changed !== null) {
    told.push(["Rows changed", String(node.changed)]);
  }
  if (node.batches !== null) {
    told.push(["Batches", `${String(node.batches.count)}, of ${String(node.batches.meanRows)} rows on average`]);
  }
  if (node.spilled !== null) {
    const { bytes, partitions, passes } = node.spilled;
    told.push([
      "Spilled",
      `${String(bytes)} bytes, to ${String(partitions)} partitions, read back in ${String(passes)} passes`,
    ]);
  }
  const reads = node.reads;
  if (reads !== null) {
    const parts: (readonly [string, number | null])[] = [
      ["entries", reads.entries],
      ["fetched", reads.fetched],
      ["rechecked", reads.rechecked],
      ["leaf pages", reads.leafPages],
    ];
    told.push(["Read", parts.flatMap(([name, n]) => (n === null ? [] : [`${name} ${String(n)}`])).join(", ")]);
  }
  return (
    <>
      {told.map(([name, value]) => (
        <Fragment key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </>
  );
}

/** How mark join `node` marks each row of its left, and how it searches its right. */
function MarkDetails({ node }: { readonly node: PlanNode }) {
  const mark = markOf(node);
  if (mark === null) {
    return null;
  }
  return (
    <>
      <dt>Join</dt>
      <dd>
        Mark join: each row of its left once, marked true, false or unknown by whether its right has a matching row, the
        mark read by the condition above
      </dd>
      {mark.marking !== null && (
        <>
          <dt>Marking</dt>
          <dd>{mark.marking}</dd>
        </>
      )}
      {mark.method !== null && (
        <>
          <dt>By</dt>
          <dd>{mark.method}</dd>
        </>
      )}
    </>
  );
}

/** How semi join or antijoin `node` joins: what of its left it keeps, and how it searches its right. */
function SemiDetails({ node }: { readonly node: PlanNode }) {
  const semi = semiOf(node);
  if (semi === null) {
    return null;
  }
  return (
    <>
      <dt>Join</dt>
      <dd>
        {semi.anti
          ? "Antijoin: each row of its left that no row of its right matches"
          : "Semi join: each row of its left at its first match on its right, once"}
      </dd>
      {semi.method !== null && (
        <>
          <dt>By</dt>
          <dd>{semi.method}</dd>
        </>
      )}
    </>
  );
}

/** How aggregate `node` groups: streamed or not, by which keys, computing what. */
function GroupingDetails({ node }: { readonly node: PlanNode }) {
  const grouping = groupingOf(node);
  if (grouping === null) {
    return null;
  }
  return (
    <>
      <dt>Grouping</dt>
      <dd>
        {grouping.streamed
          ? "Streamed: a group made at a time, over its input in the order of its keys"
          : "Of its input in any order"}
      </dd>
      {grouping.keys.length > 0 && (
        <>
          <dt>Grouped by</dt>
          <dd>{grouping.keys.join(", ")}</dd>
        </>
      )}
      {grouping.computing.length > 0 && (
        <>
          <dt>Computing</dt>
          <dd>{grouping.computing.join(", ")}</dd>
        </>
      )}
    </>
  );
}

/** What phase of predicate transfer `node` does: the chain's tables read first, each filtered by those before it. */
function TransferDetails({ node }: { readonly node: PlanNode }) {
  const transfer = transferOf(node);
  if (transfer === null) {
    return null;
  }
  const tables = transfer.leaves === null ? "the tables" : `the ${String(transfer.leaves)} tables`;
  const steps = transfer.steps === null ? "" : `, in ${String(transfer.steps)} steps`;
  return (
    <>
      <dt>Predicate transfer</dt>
      <dd>
        Reads {tables} of the chain of joins below it first{steps}, each read filtered by Bloom filters of the join keys
        of the tables read before it, so each join is given only the rows that can match
      </dd>
    </>
  );
}

/** Every detail of operator `node` of its kind, and of what it did. */
export function KindDetails({ node }: { readonly node: PlanNode }) {
  return (
    <>
      <TransferDetails node={node} />
      <RangeDetails node={node} />
      <GroupingDetails node={node} />
      <SemiDetails node={node} />
      <MarkDetails node={node} />
      <DoneDetails node={node} />
    </>
  );
}
