import { describe, expect, it } from "vitest";
import { ChatCompletionChunk } from "openai/resources/index";
import { fromChatCompletionChunk } from "./openaiTypeConverters";

const usage = {
  prompt_tokens: 100,
  completion_tokens: 70,
  total_tokens: 170,
  prompt_tokens_details: { cached_tokens: 20 },
  completion_tokens_details: { reasoning_tokens: 50 },
};
const chunk = (choices: unknown[], measured = true) =>
  ({ choices, ...(measured ? { usage } : {}) }) as ChatCompletionChunk;

describe("streaming provider usage", () => {
  it("retains final usage-only chunks including reasoning and cache counts", () => {
    expect(fromChatCompletionChunk(chunk([]))).toMatchObject({
      role: "assistant",
      content: "",
      usage: {
        promptTokens: 100,
        completionTokens: 70,
        promptTokensDetails: { cachedTokens: 20 },
        completionTokensDetails: { reasoningTokens: 50 },
      },
    });
  });
  it("preserves content and tool calls when they share a usage chunk", () => {
    expect(
      fromChatCompletionChunk(chunk([{ delta: { content: "Done" } }])),
    ).toMatchObject({ content: "Done", usage: { completionTokens: 70 } });
    expect(
      fromChatCompletionChunk(
        chunk([
          {
            delta: {
              tool_calls: [
                {
                  id: "a",
                  type: "function",
                  function: { name: "read", arguments: "{}" },
                },
              ],
            },
          },
        ]),
      ),
    ).toMatchObject({ toolCalls: [{ id: "a" }], usage: { promptTokens: 100 } });
  });
  it("keeps reasoning chunks and ignores empty chunks without usage", () => {
    expect(
      fromChatCompletionChunk(
        chunk([{ delta: { reasoning_content: "Thinking" } }], false),
      ),
    ).toMatchObject({ role: "thinking", content: "Thinking" });
    expect(fromChatCompletionChunk(chunk([], false))).toBeUndefined();
  });
});
