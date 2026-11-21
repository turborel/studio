/**
 * The dialogs of users, roles and privileges (RULES.md D57): a user made,
 * a password changed, a role made, a role granted or revoked, and a
 * table's privileges granted or revoked. Each act's statement is written
 * by the backend and run through the connection's guards; a password is
 * sent once and kept nowhere.
 */
import { useState } from "react";
import type { Act, Privilege } from "../ipc/admin";
import { show } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import { Modal } from "../shell/Modal";
import { runAct } from "./admin";

/** What a dialog of security is of. */
export type SecurityForm =
  | { readonly kind: "createUser" }
  | { readonly kind: "password"; readonly user: string }
  | { readonly kind: "createRole" }
  | { readonly kind: "grantRole"; readonly role: string; readonly grantee: string }
  | { readonly kind: "privileges"; readonly table: string; readonly title: string };

/** The privileges of a table, each with its name. */
const PRIVILEGES: readonly (readonly [Privilege, string])[] = [
  ["select", "SELECT"],
  ["insert", "INSERT"],
  ["update", "UPDATE"],
  ["delete", "DELETE"],
  ["references", "REFERENCES"],
  ["trigger", "TRIGGER"],
];

/** A field of text, or of a password. */
function Field(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly secret?: boolean;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type={props.secret === true ? "password" : "text"}
        autoComplete="off"
        value={props.value}
        onChange={(e) => {
          props.onChange(e.target.value);
        }}
      />
    </label>
  );
}

/** A box ticked or not. */
function Tick(props: { readonly label: string; readonly checked: boolean; readonly onChange: (on: boolean) => void }) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => {
          props.onChange(e.target.checked);
        }}
      />
      <span>{props.label}</span>
    </label>
  );
}

/** The dialog's buttons, each an act, and what the last told. */
function Acts(props: { readonly connection: number; readonly acts: readonly (readonly [string, Act | null])[] }) {
  const store = useStore();
  const [told, setTold] = useState("");
  const close = () => {
    show(store, null);
  };
  const act = async (a: Act) => {
    const outcome = await runAct(store, props.connection, a);
    if (outcome.kind === "done") {
      close();
    } else if (outcome.kind === "failed") {
      setTold(outcome.why);
    }
  };
  return (
    <>
      {told !== "" && <p role="status">{told}</p>}
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Cancel
        </button>
        {props.acts.map(([name, a]) => (
          <button key={name} type="button" disabled={a === null} onClick={() => a !== null && void act(a)}>
            {name}
          </button>
        ))}
      </div>
    </>
  );
}

/** A user made, or a user's password changed. */
function UserForm({ connection, user }: { readonly connection: number; readonly user: string | null }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const ready = password !== "" && password === again && (user !== null || name.trim() !== "");
  const act: Act | null = !ready
    ? null
    : user === null
      ? { kind: "createUser", name: name.trim(), password }
      : { kind: "changePassword", name: user, password };
  return (
    <>
      {user === null ? <Field label="Name" value={name} onChange={setName} /> : <p>User {user}</p>}
      <Field label="Password" secret value={password} onChange={setPassword} />
      <Field label="Password again" secret value={again} onChange={setAgain} />
      {again !== "" && again !== password && <p className="hint">The passwords differ.</p>}
      <Acts connection={connection} acts={[[user === null ? "Create User" : "Change Password", act]]} />
    </>
  );
}

/** A role made. */
function RoleForm({ connection }: { readonly connection: number }) {
  const [name, setName] = useState("");
  return (
    <>
      <Field label="Name" value={name} onChange={setName} />
      <Acts
        connection={connection}
        acts={[["Create Role", name.trim() === "" ? null : { kind: "createRole", name: name.trim() }]]}
      />
    </>
  );
}

/** A role granted to, or revoked from, a user, a role or PUBLIC. */
function GrantRoleForm(props: { readonly connection: number; readonly role: string; readonly grantee: string }) {
  const [role, setRole] = useState(props.role);
  const [grantee, setGrantee] = useState(props.grantee);
  const [admin, setAdmin] = useState(false);
  const [cascade, setCascade] = useState(false);
  const ready = role.trim() !== "" && grantee.trim() !== "";
  return (
    <>
      <Field label="Role" value={role} onChange={setRole} />
      <Field label="To or from (a user, a role, or PUBLIC)" value={grantee} onChange={setGrantee} />
      <Tick label="With admin option" checked={admin} onChange={setAdmin} />
      <Tick label="Revoke with CASCADE" checked={cascade} onChange={setCascade} />
      <Acts
        connection={props.connection}
        acts={[
          ["Revoke", ready ? { kind: "revokeRole", role: role.trim(), grantee: grantee.trim(), cascade } : null],
          ["Grant", ready ? { kind: "grantRole", role: role.trim(), grantee: grantee.trim(), admin } : null],
        ]}
      />
    </>
  );
}

/** A table's privileges granted or revoked. */
function PrivilegesForm(props: { readonly connection: number; readonly table: string }) {
  const [chosen, setChosen] = useState<readonly Privilege[]>(["select"]);
  const [grantee, setGrantee] = useState("");
  const [option, setOption] = useState(false);
  const [cascade, setCascade] = useState(false);
  const ready = chosen.length > 0 && grantee.trim() !== "";
  const g = grantee.trim();
  return (
    <>
      <fieldset>
        <legend>Privileges</legend>
        {PRIVILEGES.map(([p, name]) => (
          <Tick
            key={p}
            label={name}
            checked={chosen.includes(p)}
            onChange={(on) => {
              setChosen(on ? [...chosen, p] : chosen.filter((c) => c !== p));
            }}
          />
        ))}
      </fieldset>
      <Field label="To or from (a user, a role, or PUBLIC)" value={grantee} onChange={setGrantee} />
      <Tick label="With grant option" checked={option} onChange={setOption} />
      <Tick label="Revoke with CASCADE" checked={cascade} onChange={setCascade} />
      <Acts
        connection={props.connection}
        acts={[
          [
            "Revoke",
            ready ? { kind: "revokePrivileges", privileges: chosen, table: props.table, grantee: g, cascade } : null,
          ],
          [
            "Grant",
            ready
              ? { kind: "grantPrivileges", privileges: chosen, table: props.table, grantee: g, grantOption: option }
              : null,
          ],
        ]}
      />
    </>
  );
}

/** The title of `form`'s dialog. */
function titleOf(form: SecurityForm): string {
  switch (form.kind) {
    case "createUser":
      return "New User";
    case "password":
      return "Change Password";
    case "createRole":
      return "New Role";
    case "grantRole":
      return "Grant or Revoke a Role";
    case "privileges":
      return `Privileges on ${form.title}`;
  }
}

/** The dialog of `form`, on `connection`. */
export function SecurityDialog({ connection, form }: { readonly connection: number; readonly form: SecurityForm }) {
  const store = useStore();
  const open = useStudio((s) => s.open.some((c) => c.id === connection));
  const body = () => {
    switch (form.kind) {
      case "createUser":
        return <UserForm connection={connection} user={null} />;
      case "password":
        return <UserForm connection={connection} user={form.user} />;
      case "createRole":
        return <RoleForm connection={connection} />;
      case "grantRole":
        return <GrantRoleForm connection={connection} role={form.role} grantee={form.grantee} />;
      case "privileges":
        return <PrivilegesForm connection={connection} table={form.table} />;
    }
  };
  return (
    <Modal
      title={titleOf(form)}
      onClose={() => {
        show(store, null);
      }}
    >
      {open ? body() : <p className="hint">The connection is closed.</p>}
    </Modal>
  );
}
