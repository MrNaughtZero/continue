import { describe, expect, it, vi } from "vitest";
import { ChatHistoryItem, ToolCallState } from "core";
import { fromChatCompletionChunk } from "core/llm/openaiTypeConverters";
import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import { streamUpdate } from "../slices/sessionSlice";
import { RootState } from "../store";
import { preprocessToolCalls } from "./preprocessToolCallArgs";
import { constructMessages } from "../util/constructMessages";

const delta = (content: string, calls: unknown[]) =>
  fromChatCompletionChunk({
    choices: [{ delta: { content, tool_calls: calls } }],
  } as any)!;
const tool = (index: number, id?: string, name?: string, args = "") => ({
  index,
  id,
  type: "function",
  function: { name, arguments: args },
});
const calls = (store: ReturnType<typeof createMockStore>) =>
  (store.getState() as RootState).session.history.at(-1)!.toolCallStates!;

function setup() {
  const state = getEmptyRootState();
  state.session.history = [
    {
      message: { role: "user", content: "Check files", id: "user-1" },
      contextItems: [],
    },
  ];
  return createMockStore(state);
}

describe("streamed tool identity", () => {
  it("retains text plus the tool header and merges later arguments", () => {
    const store = setup();
    store.dispatch(
      streamUpdate([
        delta("Checking a file.", [
          tool(0, "call-a", "readFile", '{"filepath":'),
        ]),
      ]),
    );
    store.dispatch(
      streamUpdate([delta("", [tool(0, undefined, undefined, '"test.txt"}')])]),
    );
    expect(calls(store)).toHaveLength(1);
    expect(calls(store)[0].toolCall).toMatchObject({
      id: "call-a",
      function: { name: "readFile", arguments: '{"filepath":"test.txt"}' },
    });
    expect(
      (store.getState() as RootState).session.history.at(-1)!.message.content,
    ).toBe("Checking a file.");
  });
  it("routes interleaved argument fragments by index rather than the last tool", () => {
    const store = setup();
    store.dispatch(
      streamUpdate([
        delta("", [
          tool(0, "a", "readFile", '{"filepath":"'),
          tool(1, "b", "ls", '{"dirPath":"'),
        ]),
      ]),
    );
    store.dispatch(
      streamUpdate([delta("", [tool(0, undefined, undefined, 'a.txt"}')])]),
    );
    store.dispatch(
      streamUpdate([delta("", [tool(1, undefined, undefined, 'src"}')])]),
    );
    expect(calls(store).map((c) => [c.toolCallId, c.parsedArgs])).toEqual([
      ["a", { filepath: "a.txt" }],
      ["b", { dirPath: "src" }],
    ]);
  });
  it("joins a later ID/name to its earlier indexed argument fragment", () => {
    const store = setup();
    store.dispatch(
      streamUpdate([delta("", [tool(0, undefined, undefined, "{")])]),
    );
    store.dispatch(
      streamUpdate([
        delta("", [tool(0, "a", "readFile", '"filepath":"a.txt"}')]),
      ]),
    );
    expect(calls(store)).toHaveLength(1);
    expect(calls(store)[0].toolCall).toMatchObject({
      id: "a",
      function: { name: "readFile", arguments: '{"filepath":"a.txt"}' },
    });
  });
  it("does not send incomplete calls to the backend", async () => {
    const store = setup();
    store.dispatch(
      streamUpdate([delta("", [tool(0, undefined, undefined, "{}")])]),
    );
    const request = vi.spyOn(store.mockIdeMessenger, "request");
    await preprocessToolCalls(
      store.dispatch as any,
      store.mockIdeMessenger,
      calls(store),
    );
    expect(request).not.toHaveBeenCalled();
    expect(calls(store)[0].status).toBe("errored");
    expect(calls(store)[0].output?.[0].content).toContain(
      "missing tool name or call ID",
    );
  });
  it("omits malformed native pairs from old history while preserving valid calls and the saved history", () => {
    const bad = {
      id: "",
      type: "function" as const,
      function: { name: "", arguments: "{}" },
    };
    const good = {
      id: "a",
      type: "function" as const,
      function: { name: "readFile", arguments: '{"filepath":"a.txt"}' },
    };
    const state = (toolCall: typeof bad): ToolCallState => ({
      toolCall,
      toolCallId: toolCall.id,
      status: "errored",
      parsedArgs: {},
    });
    const history: ChatHistoryItem[] = [
      { message: { role: "user", content: "Check files" }, contextItems: [] },
      {
        message: {
          role: "assistant",
          content: "Checking",
          toolCalls: [bad, good],
        },
        contextItems: [],
        toolCallStates: [state(bad), state(good)],
      },
    ];
    const original = JSON.stringify(history);
    const { messages } = constructMessages(history, "", [], {});
    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant?.role === "assistant" && assistant.toolCalls).toEqual([
      good,
    ]);
    expect(
      messages.filter((m) => m.role === "tool").map((m) => m.toolCallId),
    ).toEqual(["a"]);
    expect(messages.at(-1)?.content).toContain("missing tool name or call ID");
    expect(JSON.stringify(history)).toBe(original);
  });
});
