import { RootState } from "../store";
import { describe, it, expect, vi } from "vitest";
import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import { streamResponseThunk } from "./streamResponse";
import {
  queueSteering,
  allowToolForSession,
  newSession,
  setModelStreaming,
} from "../slices/sessionSlice";
import { sessionToolPolicies } from "../util/sessionToolPolicies";
import { cancelStream } from "./cancelStream";
vi.mock("../util/getBaseSystemMessage", () => ({
  getBaseSystemMessage: () => "System",
}));
vi.mock(
  "../../components/mainInput/TipTapEditor/utils/resolveEditorContent",
  () => ({
    resolveEditorContent: async ({ editorState }: any) => ({
      selectedContextItems: [],
      selectedCode: [],
      content: editorState.content[0].content[0].text,
    }),
  }),
);
const input = (text: string) => ({
  editorState: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
  modifiers: { useCodebase: false, noContext: true },
});
function setup() {
  const state = getEmptyRootState();
  state.session.streamAborter = new AbortController();
  state.config.config.selectedModelByRole.chat = {
    title: "Test",
    model: "gpt-4o",
    provider: "openai",
    underlyingProviderName: "openai",
    capabilities: { tools: true },
  } as any;
  const store = createMockStore(state);
  store.mockIdeMessenger.responses["llm/compileChat"] = {
    compiledChatMessages: [],
    contextPercentage: 0.1,
    didPrune: false,
  };
  return store;
}
describe("steering and per-chat approval", () => {
  it.each([true, false])(
    "retains the original task when steering (partial answer: %s)",
    async (hasPartialAnswer) => {
      const store = setup();
      let calls = 0;
      store.mockIdeMessenger.llmStreamChat = vi.fn(
        async function* (_request, signal) {
          calls++;
          if (calls === 1) {
            if (hasPartialAnswer)
              yield [
                {
                  role: "assistant" as const,
                  content: "Started original task.",
                },
              ];
            store.dispatch(queueSteering(input("Also check the theme")));
            expect(signal?.aborted).toBe(true);
            throw new Error("Aborted");
          }
          yield [
            {
              role: "assistant" as const,
              content: "Continuing with both instructions.",
            },
          ];
          return {
            prompt: "test",
            completion: "done",
            modelTitle: "Test",
            modelProvider: "openai",
          };
        },
      );
      await store.dispatch(
        streamResponseThunk(input("Review the plugin")) as any,
      );
      expect(calls).toBe(2);
      const state = store.getState() as RootState;
      expect(
        state.session.history
          .filter((h) => h.message.role === "user")
          .map((h) => h.message.content),
      ).toEqual(["Review the plugin", "Also check the theme"]);
      expect(state.session.pendingSteering).toEqual([]);
      expect(state.session.isStreaming).toBe(false);
      expect(
        store.getActions().some((a) => a.type === "ui/setShowDialog"),
      ).toBe(false);
    },
  );
  it("queues during tool work without aborting the running command; Stop clears the queue", async () => {
    const store = setup();
    const signal = (store.getState() as RootState).session.streamAborter.signal;
    store.dispatch(setModelStreaming(false));
    store.dispatch(queueSteering(input("Keep going")));
    expect(signal.aborted).toBe(false);
    expect(
      (store.getState() as RootState).session.pendingSteering,
    ).toHaveLength(1);
    await store.dispatch(cancelStream() as any);
    expect((store.getState() as RootState).session.pendingSteering).toEqual([]);
  });
  it("new chats clear temporary permissions and queued context; exclusions stay authoritative", () => {
    const store = setup();
    store.dispatch(allowToolForSession("terminal"));
    expect(
      sessionToolPolicies(
        { terminal: "allowedWithPermission" },
        (store.getState() as RootState).session.sessionToolAllow,
      ).terminal,
    ).toBe("allowedWithoutPermission");
    expect(
      sessionToolPolicies(
        { terminal: "disabled" },
        (store.getState() as RootState).session.sessionToolAllow,
      ).terminal,
    ).toBe("disabled");
    store.dispatch(queueSteering(input("Old context")));
    store.dispatch(newSession());
    expect((store.getState() as RootState).session.sessionToolAllow).toEqual(
      {},
    );
    expect((store.getState() as RootState).session.pendingSteering).toEqual([]);
  });
});
