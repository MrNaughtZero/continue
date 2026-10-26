import { ToolPolicy } from "@continuedev/terminal-security";
import { IDE, Tool } from "../..";
import { BuiltInToolNames } from "../builtIn";
import { WORKSPACE_FILE_TOOLS } from "../workspaceFileTools";
import { isWorkspaceFileApproved } from "./workspaceFiles";

export async function defaultLocalPermissions(
  ide: IDE,
  tool: Tool,
  basePolicy: ToolPolicy,
  args: Record<string, unknown>,
  processedArgs?: Record<string, unknown>,
  actualFileUri?: string,
): Promise<
  | {
      policy: ToolPolicy;
      workspaceFileApproved?: boolean;
      terminalApproved?: boolean;
    }
  | undefined
> {
  // Custom/MCP tools do not inherit the built-in tools' permissions.
  if (tool.uri) return undefined;
  const name = tool.function.name;
  if (WORKSPACE_FILE_TOOLS.includes(name)) {
    const approved =
      basePolicy !== "disabled" &&
      (await isWorkspaceFileApproved(
        ide,
        name,
        args,
        undefined,
        actualFileUri,
      ));
    return {
      policy:
        basePolicy === "disabled"
          ? "disabled"
          : approved
            ? "allowedWithoutPermission"
            : "allowedWithPermission",
      workspaceFileApproved: approved,
    };
  }
  if (name === BuiltInToolNames.RunTerminalCommand) {
    const evaluated =
      tool.evaluateToolCallPolicy?.(basePolicy, args, processedArgs) ??
      basePolicy;
    const approved = basePolicy !== "disabled" && evaluated !== "disabled";
    return {
      policy: approved ? "allowedWithoutPermission" : "disabled",
      terminalApproved: approved,
    };
  }
  return undefined;
}
