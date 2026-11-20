/**
 * Studio's icons (RULES.md D35): one set, Phosphor's, each named for what
 * it stands for; regular weight, duotone where it needs emphasis; the
 * actions people scan for in colours of their own, from the theme; 16
 * pixels in trees and menus, 18 in toolbars. An icon is drawn for the eye
 * alone: what names a control is its label, or its accessible name.
 */
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ColumnsIcon } from "@phosphor-icons/react/dist/csr/Columns";
import { CommandIcon } from "@phosphor-icons/react/dist/csr/Command";
import { CubeIcon } from "@phosphor-icons/react/dist/csr/Cube";
import { DatabaseIcon } from "@phosphor-icons/react/dist/csr/Database";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { FunctionIcon } from "@phosphor-icons/react/dist/csr/Function";
import { GearIcon } from "@phosphor-icons/react/dist/csr/Gear";
import { GraphIcon } from "@phosphor-icons/react/dist/csr/Graph";
import { HashIcon } from "@phosphor-icons/react/dist/csr/Hash";
import { IdentificationBadgeIcon } from "@phosphor-icons/react/dist/csr/IdentificationBadge";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { KeyIcon } from "@phosphor-icons/react/dist/csr/Key";
import { KeyboardIcon } from "@phosphor-icons/react/dist/csr/Keyboard";
import { LightningIcon } from "@phosphor-icons/react/dist/csr/Lightning";
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/csr/LinkSimple";
import { ListMagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/ListMagnifyingGlass";
import { ListNumbersIcon } from "@phosphor-icons/react/dist/csr/ListNumbers";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassMinus";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassPlus";
import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlugIcon } from "@phosphor-icons/react/dist/csr/Plug";
import { PlugsIcon } from "@phosphor-icons/react/dist/csr/Plugs";
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/csr/PlugsConnected";
import { PushPinIcon } from "@phosphor-icons/react/dist/csr/PushPin";
import { SealCheckIcon } from "@phosphor-icons/react/dist/csr/SealCheck";
import { ShapesIcon } from "@phosphor-icons/react/dist/csr/Shapes";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { StarIcon } from "@phosphor-icons/react/dist/csr/Star";
import { StopCircleIcon } from "@phosphor-icons/react/dist/csr/StopCircle";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
import { TableIcon } from "@phosphor-icons/react/dist/csr/Table";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { TreeStructureIcon } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

/** The colour an icon takes, by what it does: a theme token's, or the text's. */
export type Tone = "plain" | "run" | "stop" | "commit" | "rollback" | "connect" | "disconnect";

/** Each icon, by name: its picture, and its tone. */
const ICONS = {
  newConnection: [PlugIcon, "connect"],
  connect: [PlugIcon, "connect"],
  disconnect: [PlugsIcon, "disconnect"],
  reconnect: [ArrowsClockwiseIcon, "connect"],
  cancel: [StopCircleIcon, "stop"],
  commit: [CheckCircleIcon, "commit"],
  rollback: [ArrowCounterClockwiseIcon, "rollback"],
  palette: [CommandIcon, "plain"],
  settings: [GearIcon, "plain"],
  themeSystem: [DesktopIcon, "plain"],
  themeLight: [SunIcon, "plain"],
  themeDark: [MoonIcon, "plain"],
  zoomIn: [MagnifyingGlassPlusIcon, "plain"],
  zoomOut: [MagnifyingGlassMinusIcon, "plain"],
  zoomReset: [MagnifyingGlassIcon, "plain"],
  layout: [SquaresFourIcon, "plain"],
  about: [InfoIcon, "plain"],
  keys: [KeyboardIcon, "plain"],
  edit: [PencilSimpleIcon, "plain"],
  pin: [PushPinIcon, "plain"],
  remove: [TrashIcon, "stop"],
  close: [XIcon, "plain"],
  favourite: [StarIcon, "plain"],
  explorer: [TreeStructureIcon, "plain"],
  details: [InfoIcon, "plain"],
  start: [DatabaseIcon, "plain"],
  connection: [PlugsConnectedIcon, "plain"],
  folder: [FolderIcon, "plain"],
  schema: [DatabaseIcon, "plain"],
  table: [TableIcon, "plain"],
  view: [EyeIcon, "plain"],
  column: [ColumnsIcon, "plain"],
  key: [KeyIcon, "plain"],
  foreignKey: [LinkSimpleIcon, "plain"],
  check: [SealCheckIcon, "plain"],
  index: [ListMagnifyingGlassIcon, "plain"],
  sequence: [ListNumbersIcon, "plain"],
  routine: [FunctionIcon, "plain"],
  trigger: [LightningIcon, "plain"],
  domain: [ShapesIcon, "plain"],
  type: [CubeIcon, "plain"],
  user: [UserIcon, "plain"],
  role: [UsersThreeIcon, "plain"],
  users: [IdentificationBadgeIcon, "plain"],
  graph: [GraphIcon, "plain"],
  other: [HashIcon, "plain"],
} as const satisfies Record<string, readonly [PhosphorIcon, Tone]>;

/** An icon's name. */
export type IconName = keyof typeof ICONS;

/** The size of an icon in a tree, a list or a menu, in pixels. */
export const SMALL = 16;
/** The size of an icon in a toolbar, in pixels. */
export const LARGE = 18;

/** What an icon is given. */
export interface IconProps {
  readonly name: IconName;
  readonly size?: number;
  /** Duotone, for an icon that needs emphasis. */
  readonly emphasis?: boolean;
}

/** The tone of icon `name`. */
export function toneOf(name: IconName): Tone {
  return ICONS[name][1];
}

/** The icon `name`, drawn for the eye alone. */
export function Icon({ name, size = SMALL, emphasis = false }: IconProps) {
  const [Picture, tone] = ICONS[name];
  return (
    <Picture
      className={`icon icon-${tone}`}
      size={size}
      weight={emphasis ? "duotone" : "regular"}
      aria-hidden="true"
      focusable="false"
    />
  );
}

/** The icon of each constraint's kind, as TABLE_CONSTRAINTS names it. */
export function constraintIcon(kind: string): IconName {
  switch (kind) {
    case "PRIMARY KEY":
    case "UNIQUE":
      return "key";
    case "FOREIGN KEY":
      return "foreignKey";
    case "CHECK":
      return "check";
    default:
      return "other";
  }
}
