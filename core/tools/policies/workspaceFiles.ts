import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import untildify from "untildify";
import { IDE } from "../..";
import {
  inferResolvedUriFromRelativePath,
  resolveRelativePathInDir,
} from "../../util/ideUtils";
import { resolveInputPath } from "../../util/pathResolver";
import { BuiltInToolNames } from "../builtIn";
import { WORKSPACE_FILE_TOOLS } from "../workspaceFileTools";

/** Resolve creation exactly once, preserving absolute paths rather than joining them to the workspace again. */
export async function resolveCreateFileUri(
  ide: IDE,
  input: string,
): Promise<string> {
  const value = untildify(input.trim());
  if (value.startsWith("file://"))
    return pathToFileURL(fileURLToPath(value)).href;
  if (path.isAbsolute(value)) return pathToFileURL(value).href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value))
    throw new Error("Unsupported file path");
  return inferResolvedUriFromRelativePath(value, ide);
}

async function canonicalPath(filename: string): Promise<string> {
  let ancestor = filename;
  const suffix: string[] = [];
  while (true) {
    try {
      // lstat distinguishes a missing file from a dangling symlink. Do not grant
      // permission through a symlink whose real destination cannot be resolved.
      await fs.lstat(ancestor);
      return path.join(await fs.realpath(ancestor), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        await fs.lstat(ancestor);
        throw new Error("Unresolved symlink");
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT")
          throw statError;
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

/** Validate against the current local workspace; optional roots pin a caller to a snapshot. */
export async function isWorkspaceFileApproved(
  ide: IDE,
  toolName: string,
  args: Record<string, unknown>,
  approvedRoots?: string[],
  actualFileUri?: string,
): Promise<boolean> {
  try {
    if (
      !WORKSPACE_FILE_TOOLS.includes(toolName) ||
      (await ide.isWorkspaceRemote())
    )
      return false;
    const roots = await ide.getWorkspaceDirs();
    if (
      !roots.length ||
      (approvedRoots &&
        (roots.length !== approvedRoots.length ||
          roots.some((root) => !approvedRoots.includes(root))))
    )
      return false;
    if (roots.some((root) => !root.startsWith("file://"))) return false;
    let uri = actualFileUri;
    if (!uri) {
      if (toolName === BuiltInToolNames.ReadCurrentlyOpenFile) {
        const current = await ide.getCurrentFile();
        if (!current || current.isUntitled) return false;
        uri = current.path.startsWith("file://")
          ? current.path
          : pathToFileURL(current.path).href;
      } else if (toolName === BuiltInToolNames.LSTool) {
        const input = args.dirPath ?? ".";
        if (typeof input !== "string") return false;
        uri = (await resolveInputPath(ide, input || "."))?.uri;
      } else {
        if (typeof args.filepath !== "string" || !args.filepath.trim())
          return false;
        if (toolName === BuiltInToolNames.CreateNewFile) {
          uri = await resolveCreateFileUri(ide, args.filepath);
        } else if (
          [
            BuiltInToolNames.EditExistingFile,
            BuiltInToolNames.SingleFindAndReplace,
            BuiltInToolNames.MultiEdit,
          ].includes(toolName as BuiltInToolNames)
        ) {
          // Match the client edit tools' resolver. The completed diff is checked
          // again against its actual URI before accepting it.
          uri = await resolveRelativePathInDir(args.filepath, ide);
        } else {
          uri = (await resolveInputPath(ide, args.filepath))?.uri;
        }
      }
    }
    if (!uri?.startsWith("file://")) return false;
    const target = await canonicalPath(fileURLToPath(uri));
    for (const root of roots) {
      const realRoot = await fs.realpath(fileURLToPath(root));
      const relative = path.relative(realRoot, target);
      if (
        relative === "" ||
        (!path.isAbsolute(relative) &&
          relative !== ".." &&
          !relative.startsWith(`..${path.sep}`))
      )
        return true;
    }
    return false;
  } catch {
    return false;
  }
}
