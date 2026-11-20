/**
 * A connection's colour (RULES.md D32): the one it is given, else its
 * environment's, production's red by default, which tints the window's
 * frame, its status bar and its tab, each under white text.
 */
import type { Environment } from "../ipc/connections";

/** The colour of each environment where its connection names none; development has none. */
export const ENVIRONMENT_COLOURS: Readonly<Record<Environment, string | null>> = {
  development: null,
  test: "#7A4F00",
  production: "#B3261E",
};

/** Each environment's name, as the dialog and the status bar show it. */
export const ENVIRONMENT_NAMES: Readonly<Record<Environment, string>> = {
  development: "Development",
  test: "Test",
  production: "Production",
};

/** The colour a connection of `environment`, given `colour`, is tinted by, if any. */
export function tint(environment: Environment, colour: string | null): string | null {
  return colour ?? ENVIRONMENT_COLOURS[environment];
}
