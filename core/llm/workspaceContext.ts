import { ChatMessage, IDE, PromptLog } from "..";

export async function withWorkspaceContext(
  messages: ChatMessage[],
  ide: IDE,
): Promise<ChatMessage[]> {
  const roots = (await ide.getWorkspaceDirs()).map((root) => {
    try {
      return root.startsWith("file:")
        ? decodeURIComponent(new URL(root).pathname)
        : root;
    } catch {
      return root;
    }
  });
  const context = `<current_ide_workspace>
Open workspace folders freshly read from the IDE: ${JSON.stringify(roots)}
These are project roots, not a terminal's current directory. Older chat paths may belong to another project. Verify paths and file contents with filesystem tools; do not invent listings. If tools are unavailable, say so.
</current_ide_workspace>`;
  const copy = messages.map((message) => ({ ...message }));
  const system = copy.find((message) => message.role === "system");
  if (system && typeof system.content === "string")
    system.content += "\n\n" + context;
  else copy.unshift({ role: "system", content: context });
  return copy;
}

export async function* requireVisibleReply(
  generator: AsyncGenerator<ChatMessage, PromptLog>,
  signal: AbortSignal,
): AsyncGenerator<ChatMessage, PromptLog> {
  let visible = false;
  let finished = false;
  try {
    while (true) {
      const next = await generator.next();
      if (next.done) {
        finished = true;
        if (!signal.aborted && !visible)
          throw new Error(
            "Large V2 finished thinking without an answer or tool call. Retry the message; if it repeats, reduce reasoning effort or shorten the request.",
          );
        return next.value;
      }
      const chunk = next.value;
      if (
        chunk.role === "assistant" &&
        (chunk.toolCalls?.length ||
          (typeof chunk.content === "string"
            ? chunk.content.trim()
            : chunk.content.some(
                (part) => part.type === "text" && part.text.trim(),
              )))
      )
        visible = true;
      yield chunk;
    }
  } finally {
    if (!finished)
      await generator.return({
        modelTitle: "",
        modelProvider: "",
        prompt: "",
        completion: "",
      });
  }
}
