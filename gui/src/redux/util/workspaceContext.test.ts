import { describe, it, expect } from "vitest";
import {
  withWorkspaceContext,
  requireVisibleReply,
} from "core/llm/workspaceContext";
import { ChatMessage, IDE, PromptLog } from "core";
const log: PromptLog = {
  modelTitle: "test",
  modelProvider: "test",
  prompt: "",
  completion: "",
};
async function* chunks(
  messages: ChatMessage[],
): AsyncGenerator<ChatMessage, PromptLog> {
  yield* messages;
  return log;
}
async function drain(generator: AsyncGenerator) {
  const result = [];
  for await (const item of generator) result.push(item);
  return result;
}
describe("workspace and response protection", () => {
  it("uses live roots without mutating saved history", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "Original" },
      { role: "user", content: "Old project /old" },
    ];
    const result = await withWorkspaceContext(messages, {
      getWorkspaceDirs: async () => ["file:///new%20project"],
    } as IDE);
    expect(result[0].content).toContain("/new project");
    expect(messages[0].content).toBe("Original");
  });
  it("rejects thinking-only completion, accepts tools, and allows intentional cancellation", async () => {
    const controller = new AbortController();
    await expect(
      drain(
        requireVisibleReply(
          chunks([{ role: "thinking", content: "thinking" }]),
          controller.signal,
        ),
      ),
    ).rejects.toThrow("without an answer");
    await expect(
      drain(
        requireVisibleReply(
          chunks([
            {
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "1",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          ]),
          controller.signal,
        ),
      ),
    ).resolves.toHaveLength(1);
    controller.abort();
    await expect(
      drain(requireVisibleReply(chunks([]), controller.signal)),
    ).resolves.toEqual([]);
  });
});
