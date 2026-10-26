import { setToolPolicy } from "../slices/uiSlice";
import { describe, expect, it, vi } from "vitest";
import { Tool, ToolCallState } from "core";
import { BuiltInToolNames as T } from "core/tools/builtIn";
import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import { IIdeMessenger } from "../../context/IdeMessenger";
import { newSession, resetSessionToolAllow } from "../slices/sessionSlice";
import { evaluateToolPolicies } from "./evaluateToolPolicies";
import { handleApplyStateUpdate } from "./handleApplyStateUpdate";

const name = T.EditExistingFile;
const tool = {
  type: "function",
  function: { name, description: "edit", parameters: {} },
  group: "Built-In",
  defaultToolPolicy: "allowedWithPermission",
} as Tool;
const call = {
  toolCallId: "edit1",
  status: "calling",
  tool,
  parsedArgs: { filepath: "file.txt" },
  toolCall: {
    id: "edit1",
    type: "function",
    function: { name, arguments: '{"filepath":"file.txt"}' },
  },
} as ToolCallState;
const apply = {
  streamId: "diff1",
  toolCallId: "edit1",
  status: "done" as const,
  filepath: "file:///workspace/file.txt",
};
function setup() {
  const state = getEmptyRootState();
  state.session.mode = "agent";
  state.session.streamAborter.abort = vi.fn();
  state.config.config.tools = [tool];
  state.session.history = [
    {
      message: {
        id: "message1",
        role: "assistant",
        content: "",
        toolCalls: [call.toolCall],
      },
      contextItems: [],
      toolCallStates: [call],
    },
  ];
  const store = createMockStore(state);
  const post = vi.spyOn(store.mockIdeMessenger, "post");
  delete store.mockIdeMessenger.responseHandlers["tools/evaluatePolicy"];
  store.mockIdeMessenger.responses["tools/evaluatePolicy"] = {
    policy: "allowedWithoutPermission",
    workspaceFileApproved: true,
  };
  return { store, post };
}

describe("workspace file approval and automatic acceptance", () => {
  it("allows tools only with a successful scoped path check", async () => {
    for (const approved of [true, false, undefined]) {
      const request = vi.fn().mockResolvedValue({
        status: "success",
        content: {
          policy: "allowedWithoutPermission",
          workspaceFileApproved: approved,
        },
      });
      const result = await evaluateToolPolicies(
        vi.fn(),
        { request } as unknown as IIdeMessenger,
        [tool],
        [call],
        {},
        false,
      );
      expect(result[0].policy).toBe(
        approved ? "allowedWithoutPermission" : "allowedWithPermission",
      );
    }
  });
  it("keeps disabled file tools disabled", async () => {
    const request = vi.fn().mockResolvedValue({
      status: "success",
      content: {
        policy: "allowedWithoutPermission",
        workspaceFileApproved: true,
      },
    });
    const result = await evaluateToolPolicies(
      vi.fn(),
      { request } as unknown as IIdeMessenger,
      [tool],
      [call],
      { [name]: "disabled" },
      false,
    );
    expect(result[0].policy).toBe("disabled");
  });
  it("accepts a completed workspace edit without a second prompt", async () => {
    const { store, post } = setup();
    const request = vi.spyOn(store.mockIdeMessenger, "request");
    await store.dispatch(handleApplyStateUpdate(apply) as any);
    expect(request).toHaveBeenCalledWith(
      "tools/evaluatePolicy",
      expect.objectContaining({
        workspaceFileUri: apply.filepath,
      }),
    );
    expect(post).toHaveBeenCalledWith("acceptDiff", {
      streamId: apply.streamId,
      filepath: apply.filepath,
    });
  });
  it("leaves edits outside the workspace pending even with a global auto setting", async () => {
    const { store, post } = setup();
    store.dispatch(
      setToolPolicy({ toolName: name, policy: "allowedWithoutPermission" }),
    );
    store.mockIdeMessenger.responses["tools/evaluatePolicy"] = {
      policy: "allowedWithPermission",
      workspaceFileApproved: false,
    };
    await store.dispatch(handleApplyStateUpdate(apply) as any);
    expect(post).not.toHaveBeenCalledWith("acceptDiff", expect.anything());
  });
  it("does not accept if the tool is disabled or the chat changes during the check", async () => {
    for (const action of [
      setToolPolicy({ toolName: name, policy: "disabled" }),
      newSession(),
    ]) {
      const { store, post } = setup();
      store.mockIdeMessenger.responseHandlers["tools/evaluatePolicy"] =
        async () => {
          store.dispatch(action);
          return {
            policy: "allowedWithoutPermission",
            workspaceFileApproved: true,
          };
        };
      await store.dispatch(handleApplyStateUpdate(apply) as any);
      expect(post).not.toHaveBeenCalledWith("acceptDiff", expect.anything());
    }
  });
  it("uses automatic file permission after new chats and permission resets with no session toggle", async () => {
    const { store } = setup();
    for (const action of [newSession(), resetSessionToolAllow()]) {
      store.dispatch(action);
      const results = await evaluateToolPolicies(
        store.dispatch as any,
        store.mockIdeMessenger,
        [tool],
        [call],
        {},
      );
      expect(results[0].policy).toBe("allowedWithoutPermission");
    }
  });
  it("automatically approves terminal commands without a session grant", async () => {
    const { store } = setup();
    store.mockIdeMessenger.responses["tools/evaluatePolicy"] = {
      policy: "allowedWithoutPermission",
      terminalApproved: true,
    };
    const terminalCall = {
      ...call,
      toolCall: {
        ...call.toolCall,
        function: { name: T.RunTerminalCommand, arguments: "{}" },
      },
    };
    const results = await evaluateToolPolicies(
      store.dispatch as any,
      store.mockIdeMessenger,
      [],
      [terminalCall],
      { [T.RunTerminalCommand]: "allowedWithPermission" },
    );
    expect(results[0].policy).toBe("allowedWithoutPermission");
  });
});
