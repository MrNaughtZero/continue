import { Tool } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";

const webTools: string[] = [
  BuiltInToolNames.SearchWeb,
  BuiltInToolNames.FetchUrlContent,
];

function isConfiguredPlaywrightTool(tool: Tool): boolean {
  if (tool.group !== "Chrome (Playwright)" || !tool.uri) return false;
  try {
    const uri = new URL(tool.uri);
    return (
      uri.protocol === "mcp:" &&
      decodeURIComponent(uri.host) === "Chrome (Playwright)"
    );
  } catch {
    return false;
  }
}

/** Resolve against enabled configuration, never model-provided names or labels. */
export function chatApprovalScope(name: string, activeTools: Tool[]) {
  const tool = activeTools.find(
    (candidate) => candidate.function.name === name,
  );
  if (!tool) return undefined;
  if (webTools.includes(name) && !tool.uri?.startsWith("mcp:")) {
    return {
      label: "Allow web for chat",
      description:
        "Allow web searches and reading URLs for this open chat. Resets when you switch chats or reload. Use Reset permissions to revoke.",
      toolNames: activeTools
        .filter(
          (candidate) =>
            webTools.includes(candidate.function.name) &&
            !candidate.uri?.startsWith("mcp:"),
        )
        .map((candidate) => candidate.function.name),
    };
  }
  if (isConfiguredPlaywrightTool(tool)) {
    return {
      label: "Allow Playwright for chat",
      description:
        "Allow all enabled tools from Chrome (Playwright), including browser actions, for this open chat. Resets when you switch chats or reload. Use Reset permissions to revoke.",
      toolNames: activeTools
        .filter(isConfiguredPlaywrightTool)
        .map((candidate) => candidate.function.name),
    };
  }
  return undefined;
}
