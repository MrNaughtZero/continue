import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDE } from "../..";
import { BuiltInToolNames as T } from "../builtIn";
import {
  isWorkspaceFileApproved,
  resolveCreateFileUri,
} from "./workspaceFiles";

let temp: string, root: string, roots: string[], ide: IDE;
const uri = (p: string) => pathToFileURL(p).href;
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "continue-workspace-"));
  root = path.join(temp, "project");
  await fs.mkdir(root);
  await fs.mkdir(path.join(temp, "project-other"));
  await fs.writeFile(path.join(root, "file.txt"), "hello");
  roots = [uri(root)];
  ide = {
    isWorkspaceRemote: vi.fn().mockResolvedValue(false),
    getWorkspaceDirs: vi.fn().mockResolvedValue(roots),
    getCurrentFile: vi.fn().mockResolvedValue({
      path: uri(path.join(root, "file.txt")),
      isUntitled: false,
    }),
    fileExists: async (u: string) =>
      fs.stat(fileURLToPath(u)).then(
        () => true,
        () => false,
      ),
  } as unknown as IDE;
});
afterEach(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});
const approve = (name: string, filepath: string, actual?: string) =>
  isWorkspaceFileApproved(ide, name, { filepath }, roots, actual);

describe("local workspace file grant", () => {
  it("allows repeated reads and edits of workspace files", async () => {
    for (const name of [
      T.ReadFile,
      T.ReadFileRange,
      T.EditExistingFile,
      T.SingleFindAndReplace,
      T.MultiEdit,
    ]) {
      expect(await approve(name, "file.txt")).toBe(true);
      expect(await approve(name, path.join(root, "file.txt"))).toBe(true);
      expect(await approve(name, uri(path.join(root, "file.txt")))).toBe(true);
    }
    expect(await approve(T.ReadFile, path.join(root, "file.txt"))).toBe(true);
    expect(await approve(T.ReadFile, uri(path.join(root, "file.txt")))).toBe(
      true,
    );
    expect(await approve(T.ReadCurrentlyOpenFile, "")).toBe(true);
  });
  it("automatically grants the current workspace without a session snapshot, including directory listings", async () => {
    for (const dirPath of [undefined, ".", root, uri(root)]) {
      expect(await isWorkspaceFileApproved(ide, T.LSTool, { dirPath })).toBe(
        true,
      );
    }
    expect(
      await isWorkspaceFileApproved(ide, T.LSTool, { dirPath: temp }),
    ).toBe(false);
    expect(
      await isWorkspaceFileApproved(ide, T.ReadFile, { filepath: "file.txt" }),
    ).toBe(true);
    const secondRoot = path.join(temp, "project-other");
    await fs.writeFile(path.join(secondRoot, "second.txt"), "second workspace");
    vi.mocked(ide.getWorkspaceDirs).mockResolvedValue([uri(secondRoot)]);
    expect(
      await isWorkspaceFileApproved(ide, T.ReadFile, {
        filepath: "second.txt",
      }),
    ).toBe(true);
    expect(
      await isWorkspaceFileApproved(ide, T.ReadFile, {
        filepath: path.join(root, "file.txt"),
      }),
    ).toBe(false);
  });
  it("allows new nested files and preserves absolute create paths", async () => {
    const target = path.join(root, "new", "nested", "file.txt");
    expect(await resolveCreateFileUri(ide, target)).toBe(uri(target));
    expect(await resolveCreateFileUri(ide, uri(target))).toBe(uri(target));
    expect(await approve(T.CreateNewFile, target)).toBe(true);
    expect(await approve(T.CreateNewFile, "new/nested/file.txt")).toBe(true);
  });
  it("rejects traversal and similar-prefix siblings", async () => {
    expect(await approve(T.CreateNewFile, "../outside.txt")).toBe(false);
    expect(
      await approve(T.CreateNewFile, path.join(temp, "project-other/new.txt")),
    ).toBe(false);
    expect(await approve(T.ReadFile, path.join(temp, "outside.txt"))).toBe(
      false,
    );
  });
  it("checks real destinations for existing and new files under symlinks", async () => {
    const outside = path.join(temp, "project-other");
    await fs.writeFile(path.join(outside, "file.txt"), "outside");
    await fs.symlink(outside, path.join(root, "escape"));
    await fs.symlink(path.join(root, "file.txt"), path.join(root, "inside"));
    await fs.symlink(path.join(outside, "missing"), path.join(root, "broken"));
    expect(await approve(T.ReadFile, "escape/file.txt")).toBe(false);
    expect(await approve(T.CreateNewFile, "escape/new/file.txt")).toBe(false);
    expect(await approve(T.CreateNewFile, "broken/new.txt")).toBe(false);
    expect(await approve(T.ReadFile, "inside")).toBe(true);
  });
  it("rechecks the completed diff's actual destination", async () => {
    expect(
      await approve(
        T.EditExistingFile,
        "file.txt",
        uri(path.join(root, "file.txt")),
      ),
    ).toBe(true);
    expect(
      await approve(
        T.EditExistingFile,
        "file.txt",
        uri(path.join(temp, "outside.txt")),
      ),
    ).toBe(false);
  });
  it("invalidates grants when roots change or the workspace is remote", async () => {
    vi.mocked(ide.getWorkspaceDirs).mockResolvedValue([uri(temp)]);
    expect(await approve(T.ReadFile, "file.txt")).toBe(false);
    vi.mocked(ide.getWorkspaceDirs).mockResolvedValue(roots);
    vi.mocked(ide.isWorkspaceRemote).mockResolvedValue(true);
    expect(await approve(T.ReadFile, "file.txt")).toBe(false);
  });
  it("does not grant unrelated tools, untitled files or empty grants", async () => {
    expect(await approve(T.RunTerminalCommand, "file.txt")).toBe(false);
    expect(await approve("mcp_read_file", "file.txt")).toBe(false);
    expect(
      await isWorkspaceFileApproved(
        ide,
        T.ReadFile,
        { filepath: "file.txt" },
        [],
      ),
    ).toBe(false);
    vi.mocked(ide.getCurrentFile).mockResolvedValue({
      path: "untitled:test",
      contents: "",
      isUntitled: true,
    });
    expect(await approve(T.ReadCurrentlyOpenFile, "")).toBe(false);
  });
});
