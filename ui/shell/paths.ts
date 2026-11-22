/**
 * Paths as the window shows them (R-UI-1): a path beneath the user's home
 * folder written from `~`, as a shell writes it, so a folder's place reads
 * short and says nothing of the account; the whole path in its tooltip.
 */
import { useStudio } from "../state/store";

/** `path` written from `~` where it is `home` or beneath it, of either separator; else as it is. */
export function shortPath(path: string, home: string | null): string {
  if (home === null || home === "") {
    return path;
  }
  const base = home.replace(/[\\/]+$/u, "");
  if (path === base) {
    return "~";
  }
  const next = path.charAt(base.length);
  return path.startsWith(base) && (next === "/" || next === "\\") ? `~${path.slice(base.length)}` : path;
}

/** `shortPath` of the home folder the window knows. */
export function useShortPath(): (path: string) => string {
  const home = useStudio((s) => s.home);
  return (path) => shortPath(path, home);
}
