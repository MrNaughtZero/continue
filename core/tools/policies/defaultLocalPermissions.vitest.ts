import { describe, expect, it, vi } from "vitest";
import { IDE, Tool } from "../..";
import { BuiltInToolNames as T } from "../builtIn";
import { defaultLocalPermissions } from "./defaultLocalPermissions";
import { isWorkspaceFileApproved } from "./workspaceFiles";
vi.mock("./workspaceFiles", () => ({ isWorkspaceFileApproved: vi.fn() }));
const ide = {} as IDE;
const file = { function: { name: T.ReadFile } } as Tool;
const terminal = {
  function: { name: T.RunTerminalCommand },
  evaluateToolCallPolicy: () => "allowedWithPermission",
} as Tool;
describe("automatic local permissions independent of chat and model", () => {
  it("approves repeated workspace reads even when the base setting asks", async () => {
    vi.mocked(isWorkspaceFileApproved).mockResolvedValue(true);
    for (let i = 0; i < 3; i++) {
      expect(
        await defaultLocalPermissions(ide, file, "allowedWithPermission", {
          filepath: "file.txt",
        }),
      ).toEqual({
        policy: "allowedWithoutPermission",
        workspaceFileApproved: true,
      });
    }
  });
  it("requires permission outside the workspace even when globally allowed", async () => {
    vi.mocked(isWorkspaceFileApproved).mockResolvedValue(false);
    expect(
      await defaultLocalPermissions(ide, file, "allowedWithoutPermission", {
        filepath: "/outside/file",
      }),
    ).toEqual({
      policy: "allowedWithPermission",
      workspaceFileApproved: false,
    });
  });
  it("approves terminal commands without a session flag", async () => {
    expect(
      await defaultLocalPermissions(ide, terminal, "allowedWithPermission", {
        command: "npm run build",
      }),
    ).toEqual({ policy: "allowedWithoutPermission", terminalApproved: true });
  });
  it("preserves explicitly disabled tools and terminal command exclusions", async () => {
    expect(
      (await defaultLocalPermissions(ide, file, "disabled", {}))?.policy,
    ).toBe("disabled");
    expect(
      (await defaultLocalPermissions(ide, terminal, "disabled", {}))?.policy,
    ).toBe("disabled");
    const excluded = {
      ...terminal,
      evaluateToolCallPolicy: () => "disabled" as const,
    };
    expect(
      (
        await defaultLocalPermissions(
          ide,
          excluded,
          "allowedWithoutPermission",
          {},
        )
      )?.policy,
    ).toBe("disabled");
  });
  it("does not extend automatic access to custom tools or browser tools", async () => {
    expect(
      await defaultLocalPermissions(
        ide,
        { ...file, uri: "mcp://server/read_file" },
        "allowedWithPermission",
        {},
      ),
    ).toBeUndefined();
    expect(
      await defaultLocalPermissions(
        ide,
        { function: { name: T.SearchWeb } } as Tool,
        "allowedWithPermission",
        {},
      ),
    ).toBeUndefined();
  });
});
