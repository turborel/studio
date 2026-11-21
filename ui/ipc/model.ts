/**
 * The model's commands (RULES.md D46): a model's file opened by the
 * platform's dialog, and an image saved where the dialog chooses.
 */
import { invoke } from "@tauri-apps/api/core";
import type { OpenedFile } from "./worksheet";

/** Asks which model to open, and reads it: null if the user cancelled. */
export function openModelFile(): Promise<OpenedFile | null> {
  return invoke<OpenedFile | null>("open_model_file");
}

/** Asks where to save `octets`, Base64, suggesting `name`: the path written, or null if the user cancelled. */
export function saveBinaryFile(name: string, octets: string): Promise<string | null> {
  return invoke<string | null>("save_binary_file", { name, octets });
}
