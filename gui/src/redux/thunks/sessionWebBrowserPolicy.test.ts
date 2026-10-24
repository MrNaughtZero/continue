import { describe, expect, it, vi } from "vitest";
import { Tool } from "core";
import { BuiltInToolNames, BUILT_IN_GROUP_NAME } from "core/tools/builtIn";
import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import { selectActiveTools } from "../selectors/selectActiveTools";
import { newSession, resetSessionToolAllow } from "../slices/sessionSlice";
import { RootState } from "../store";
import { chatApprovalScope } from "../util/chatApprovalScope";
import { sessionToolPolicies } from "../util/sessionToolPolicies";
import { callToolById } from "./callToolById";

vi.mock("./streamResponseAfterToolCall", () => ({
  streamResponseAfterToolCall: () => async () => ({ payload: undefined }),
}));

const search = BuiltInToolNames.SearchWeb;
const fetch = BuiltInToolNames.FetchUrlContent;
const terminal = BuiltInToolNames.RunTerminalCommand;
const navigate = "chrome_playwright_browser_navigate";
const click = "chrome_playwright_browser_click";
function makeTool(
  name: string,
  group = BUILT_IN_GROUP_NAME,
  uri?: string,
): Tool {
  return {
    type: "function",
    function: { name, description: name, parameters: {} },
    displayTitle: name,
    group,
    uri,
    readonly: false,
  };
}
const tools = [
  makeTool(search),
  makeTool(fetch),
  makeTool(terminal),
  makeTool(
    navigate,
    "Chrome (Playwright)",
    "mcp://Chrome%20(Playwright)/browser_navigate",
  ),
  makeTool(
    click,
    "Chrome (Playwright)",
    "mcp://Chrome%20(Playwright)/browser_click",
  ),
  makeTool(
    "another_server_browser_click",
    "Another server",
    "mcp://Another%20server/browser_click",
  ),
  makeTool(
    "misleading_browser_click",
    "Chrome (Playwright)",
    "mcp://Another%20server/browser_click",
  ),
];
function setup(names = [navigate]) {
  const state = getEmptyRootState();
  state.session.mode = "agent";
  state.session.id = "chat-one";
  state.config.config.tools = tools;
  state.config.config.selectedModelByRole.chat = {
    title: "Test",
    model: "gpt-4o",
    provider: "openai",
    underlyingProviderName: "openai",
  };
  state.ui.toolSettings = Object.fromEntries(
    tools.map((t) => [t.function.name, "allowedWithPermission"]),
  );
  state.session.history = [
    {
      message: {
        id: "assistant",
        role: "assistant",
        content: "",
        toolCalls: [],
      },
      contextItems: [],
      toolCallStates: names.map((name, index) => ({
        toolCallId: `call-${index}`,
        status: "generated",
        parsedArgs: {},
        toolCall: {
          id: `call-${index}`,
          type: "function",
          function: { name, arguments: "{}" },
        },
        tool: tools.find((t) => t.function.name === name),
      })),
    },
  ];
  const store = createMockStore(state);
  store.mockIdeMessenger.responseHandlers["tools/evaluatePolicy"] = async ({
    basePolicy,
  }) => ({ policy: basePolicy });
  return store;
}
const grants = (store: ReturnType<typeof setup>) =>
  (store.getState() as RootState).session.sessionToolAllow;
const accept = (store: ReturnType<typeof setup>, extra = {}) =>
  store.dispatch(callToolById({ toolCallId: "call-0", ...extra }) as any);

describe("web and Playwright approval for this chat", () => {
  it("remembers normal acceptance (also used by the keyboard) across the same Playwright server", async () => {
    const store = setup();
    await accept(store);
    expect(grants(store)).toEqual({ [navigate]: true, [click]: true });
    const policies = sessionToolPolicies(
      (store.getState() as RootState).ui.toolSettings,
      grants(store),
    );
    expect(policies[click]).toBe("allowedWithoutPermission");
    expect(policies[terminal]).toBe("allowedWithPermission");
  });
  it.each([search, fetch])(
    "remembers %s for both web search and URL reading",
    async (name) => {
      const store = setup([name]);
      await accept(store);
      expect(grants(store)).toEqual({ [search]: true, [fetch]: true });
    },
  );
  it.each([{ acceptOnce: true }, { isAutoApproved: true }])(
    "does not expand permission for %j",
    async (extra) => {
      const store = setup();
      await accept(store, extra);
      expect(grants(store)).toEqual({});
    },
  );
  it("executes already-pending browser calls after one acceptance, leaving unrelated tools pending", async () => {
    const store = setup([navigate, click, terminal]);
    const request = vi.spyOn(store.mockIdeMessenger, "request");
    await accept(store);
    const executed = request.mock.calls
      .filter(([kind]) => kind === "tools/call")
      .map(([, data]) => (data as any).toolCall.function.name);
    expect(executed).toEqual([navigate, click]);
    expect(
      (store.getState() as RootState).session.history[0].toolCallStates?.[2]
        .status,
    ).toBe("generated");
  });
  it("preserves disabled tools, excluded groups, and server identity", () => {
    const store = setup();
    const state = store.getState() as RootState;
    const blocked = {
      ...state,
      ui: {
        ...state.ui,
        toolSettings: {
          ...state.ui.toolSettings,
          [click]: "disabled" as const,
        },
      },
    };
    expect(
      chatApprovalScope(navigate, selectActiveTools(blocked))?.toolNames,
    ).toEqual([navigate]);
    const excluded = {
      ...state,
      ui: {
        ...state.ui,
        toolGroupSettings: { "Chrome (Playwright)": "exclude" as const },
      },
    };
    expect(
      chatApprovalScope(navigate, selectActiveTools(excluded)),
    ).toBeUndefined();
    expect(
      chatApprovalScope("misleading_browser_click", tools),
    ).toBeUndefined();
    expect(
      chatApprovalScope("another_server_browser_click", tools),
    ).toBeUndefined();
    expect(
      sessionToolPolicies({ [click]: "disabled" }, { [click]: true })[click],
    ).toBe("disabled");
  });
  it("still enforces dynamic denial when accepting a group", async () => {
    const store = setup([navigate, click]);
    store.mockIdeMessenger.responseHandlers["tools/evaluatePolicy"] = async ({
      toolName,
      basePolicy,
    }) => ({ policy: toolName === click ? "disabled" : basePolicy });
    const request = vi.spyOn(store.mockIdeMessenger, "request");
    await accept(store);
    expect(
      request.mock.calls.filter(([kind]) => kind === "tools/call"),
    ).toHaveLength(1);
    expect(
      (store.getState() as RootState).session.history[0].toolCallStates?.[1]
        .status,
    ).toBe("errored");
  });
  it("can reset approvals and clears them when leaving the chat", async () => {
    const store = setup();
    await accept(store);
    store.dispatch(resetSessionToolAllow());
    expect(grants(store)).toEqual({});
    const other = setup();
    await accept(other);
    other.dispatch(newSession());
    expect(grants(other)).toEqual({});
  });
  it("does not execute calls after switching chats during policy evaluation", async () => {
    const store = setup();
    store.mockIdeMessenger.responseHandlers["tools/evaluatePolicy"] = async ({
      basePolicy,
    }) => {
      store.dispatch(newSession());
      return { policy: basePolicy };
    };
    const request = vi.spyOn(store.mockIdeMessenger, "request");
    await accept(store);
    expect(
      request.mock.calls.filter(([kind]) => kind === "tools/call"),
    ).toHaveLength(0);
    expect(grants(store)).toEqual({});
  });
});
