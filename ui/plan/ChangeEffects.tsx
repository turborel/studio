/**
 * What a data change would do beside its rows, of plain EXPLAIN of an
 * INSERT, UPDATE, DELETE or MERGE, which runs nothing (RULES.md D70;
 * Turborel's `sql/statements/explain.md`, its D980, D983, D984): the
 * indexes whose entries it would write, the referential actions that
 * would cascade from it, the triggers that would fire, and how a point
 * path would run it when prepared or in a procedure.
 */
import type { ChangeEffects } from "./plan";

/** A list of what the change would do, or none. */
function Listed({ items }: { readonly items: readonly string[] }) {
  return items.length === 0 ? (
    <dd>none</dd>
  ) : (
    <dd>
      <ul>
        {items.map((item, at) => (
          <li key={`${String(at)}.${item}`}>{item}</li>
        ))}
      </ul>
    </dd>
  );
}

/** The section of what a data change would do, of its plan's `effects`. */
export function ChangeEffectsView({ effects }: { readonly effects: ChangeEffects }) {
  return (
    <section className="plan-effects" aria-label="What the change would do">
      <p>Not run: what the change would do beside the rows its plan reads.</p>
      <dl>
        <dt>Indexes maintained</dt>
        <Listed items={effects.maintains} />
        <dt>Cascades</dt>
        <Listed items={effects.cascades} />
        <dt>Triggers</dt>
        <Listed items={effects.triggers} />
        <dt>Point path</dt>
        <dd>{effects.pointPath ?? "none"}</dd>
      </dl>
    </section>
  );
}
