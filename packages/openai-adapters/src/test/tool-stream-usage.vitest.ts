import { describe, expect, it, vi } from "vitest";
import { OpenAIApi } from "../apis/OpenAI.js";
describe("tool headers accompanied by usage", () => {
  it("preserves all frames in their original order", async () => {
    const api = new OpenAIApi({
      provider: "openai",
      apiKey: "test",
      apiBase: "https://api.venice.ai/api/v1",
    });
    const frames = [
      {
        choices: [
          {
            delta: {
              content: "Checking",
              tool_calls: [
                {
                  index: 0,
                  id: "a",
                  function: { name: "readFile", arguments: "{" },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 1 },
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '"filepath":"a.txt"}' } },
              ],
            },
          },
        ],
      },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 10 } },
    ];
    vi.spyOn(api.openai.chat.completions, "create").mockResolvedValue(
      (async function* () {
        yield* frames;
      })() as any,
    );
    const output = [];
    for await (const frame of api.chatCompletionStream(
      { model: "test", stream: true, messages: [] },
      new AbortController().signal,
    ))
      output.push(frame);
    expect(output).toEqual(frames);
  });
});
