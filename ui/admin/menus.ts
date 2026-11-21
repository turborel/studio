/**
 * The context menus of users and roles (RULES.md D53, D57): of the
 * explorer's Users and Roles, a user made and a role made; of a user, its
 * password changed, its leave to create roles, a role granted, and the
 * user dropped; of a role, granted or revoked, and dropped. Each drop is
 * marked as one that destroys, and asks first as the guards do.
 */
import { namer } from "../data/ddl";
import type { MenuItem } from "../shell/ContextMenu";
import { show } from "../state/actions";
import type { Store } from "../state/store";
import { runAct } from "./admin";
import type { SecurityForm } from "./SecurityDialog";

/** Opens the dialog of `form` on `connection`. */
export function openSecurity(store: Store, connection: number, form: SecurityForm): () => void {
  return () => {
    show(store, { kind: "security", connection, form });
  };
}

/** `name` as SQL writes it. */
function sqlName(store: Store, name: string): string {
  return namer(store.current().reservedWords)(name);
}

/** The menu of the explorer's Users and Roles. */
export function securityMenu(store: Store, connection: number): MenuItem[] {
  return [
    { label: "New User…", icon: "newUser", run: openSecurity(store, connection, { kind: "createUser" }) },
    { label: "New Role…", icon: "role", run: openSecurity(store, connection, { kind: "createRole" }) },
  ];
}

/** The menu of user `name`. */
export function userMenu(store: Store, connection: number, name: string): MenuItem[] {
  const user = sqlName(store, name);
  const security = store.current().catalogs[connection]?.security;
  const mayCreate = security?.users.find((u) => u.name === name)?.createRole === true;
  return [
    { label: "Change Password…", icon: "key", run: openSecurity(store, connection, { kind: "password", user }) },
    {
      label: mayCreate ? "Forbid Creating Roles" : "Let Create Roles",
      icon: "role",
      run: () => void runAct(store, connection, { kind: "allowCreateRole", name: user, allowed: !mayCreate }),
    },
    {
      label: "Grant a Role…",
      icon: "role",
      run: openSecurity(store, connection, { kind: "grantRole", role: "", grantee: user }),
    },
    "separator",
    {
      label: "Drop User",
      icon: "remove",
      destructive: true,
      run: () => void runAct(store, connection, { kind: "dropUser", name: user }),
    },
  ];
}

/** The menu of role `name`. */
export function roleMenu(store: Store, connection: number, name: string): MenuItem[] {
  const role = sqlName(store, name);
  return [
    {
      label: "Grant or Revoke…",
      icon: "role",
      run: openSecurity(store, connection, { kind: "grantRole", role, grantee: "" }),
    },
    "separator",
    {
      label: "Drop Role",
      icon: "remove",
      destructive: true,
      run: () => void runAct(store, connection, { kind: "dropRole", name: role, cascade: false }),
    },
  ];
}

/** The menu of user or role `of`. */
export function accountMenu(
  store: Store,
  connection: number,
  of: { readonly kind: "user" | "role"; readonly name: string },
): MenuItem[] {
  return of.kind === "user" ? userMenu(store, connection, of.name) : roleMenu(store, connection, of.name);
}
