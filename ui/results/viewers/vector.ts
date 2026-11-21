/**
 * Vectors for their viewer (RULES.md D39): a vector's text, as Turborel
 * writes one, dense as a list of its elements in brackets, sparse as its
 * dimension count, its positions and its elements, or as a JSON object
 * of those, read into its elements.
 */

/** A vector read: its dimension count, and its elements not zero by position. */
export interface VectorRead {
  readonly dims: number;
  readonly elements: readonly (readonly [number, number])[];
  readonly sparse: boolean;
}

/** Whether `value` is a list of numbers. */
function numbers(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => typeof v === "number");
}

/** A sparse vector of `dims`, `indices` and `values`, if they are one. */
function sparse(dims: unknown, indices: unknown, values: unknown): VectorRead | null {
  if (typeof dims !== "number" || !numbers(indices) || !numbers(values) || indices.length !== values.length) {
    return null;
  }
  return { dims, elements: indices.map((at, i) => [at, values[i] ?? 0] as const), sparse: true };
}

/** `text` read as a vector: null if it is none. */
export function parseVector(text: string): VectorRead | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (numbers(value)) {
    return { dims: value.length, elements: value.map((v, i) => [i, v] as const), sparse: false };
  }
  if (Array.isArray(value) && value.length === 3) {
    return sparse(value[0], value[1], value[2]);
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    return sparse(o["dims"], o["indices"], o["values"]);
  }
  return null;
}

/** A vector's figures: its Euclidean norm, and its least and greatest elements. */
export function figures(v: VectorRead): { norm: number; min: number; max: number } {
  const values = v.elements.map(([, e]) => e);
  const zero = v.sparse && v.elements.length < v.dims ? [0] : [];
  return {
    norm: Math.sqrt(values.reduce((total, e) => total + e * e, 0)),
    min: Math.min(...values, ...zero),
    max: Math.max(...values, ...zero),
  };
}
