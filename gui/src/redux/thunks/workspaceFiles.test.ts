import { describe, expect, it, vi } from "vitest";
import { Tool, ToolCallState } from "core";
import { BuiltInToolNames as T } from "core/tools/builtIn";
import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import { IIdeMessenger } from "../../context/IdeMessenger";
import {
  newSession,
  resetSessionToolAllow,
  setWorkspaceFileApproval,
} from "../slices/sessionSlice";
import { evaluateToolPolicies } from "./evaluateToolPolicies";
import { handleApplyStateUpdate } from "./handleApplyStateUpdate";
import { allowWorkspaceFilesForChat } from "./allowWorkspaceFilesForChat";

const roots = ["file:///workspace"];
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
function setup(granted = true) {
  const state = getEmptyRootState();
  state.session.mode = "agent";
  state.config.config.tools = [tool];
  state.session.workspaceFileApprovalRoots = granted ? roots : undefined;
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
        roots,
      );
      expect(result[0].policy).toBe(
        approved ? "allowedWithoutPermission" : "allowedWithPermission",
      );
      expect(request.mock.calls[0][1].workspaceFileApprovalRoots).toEqual(
        roots,
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
      roots,
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
        workspaceFileApprovalRoots: roots,
      }),
    );
    expect(post).toHaveBeenCalledWith("acceptDiff", {
      streamId: apply.streamId,
      filepath: apply.filepath,
    });
  });
  it("leaves edits pending without a grant or outside the approved roots", async () => {
    for (const granted of [true, false]) {
      const { store, post } = setup(granted);
      store.mockIdeMessenger.responses["tools/evaluatePolicy"] = {
        policy: "allowedWithPermission",
        workspaceFileApproved: false,
      };
      await store.dispatch(handleApplyStateUpdate(apply) as any);
      expect(post).not.toHaveBeenCalledWith("acceptDiff", expect.anything());
    }
  });
  it("does not accept if the grant is revoked or the chat changes during the check", async () => {
    for (const action of [setWorkspaceFileApproval(undefined), newSession()]) {
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
  it("grants local roots and accepts an already pending edit", async () => {
    const { store, post } = setup(false);
    await store.dispatch(handleApplyStateUpdate(apply) as any);
    store.mockIdeMessenger.responses.getWorkspaceDirs = roots;
    store.mockIdeMessenger.responses.isWorkspaceRemote = false;
    await store.dispatch(allowWorkspaceFilesForChat() as any);
    expect(
      (store.getState() as any).session.workspaceFileApprovalRoots,
    ).toEqual(roots);
    expect(post).toHaveBeenCalledWith("acceptDiff", {
      streamId: apply.streamId,
      filepath: apply.filepath,
    });
  });
  it("clears on reset or a new chat", () => {
    const { store } = setup();
    store.dispatch(resetSessionToolAllow());
    expect(
      (store.getState() as any).session.workspaceFileApprovalRoots,
    ).toBeUndefined();
    store.dispatch(setWorkspaceFileApproval(roots));
    store.dispatch(newSession());
    expect(
      (store.getState() as any).session.workspaceFileApprovalRoots,
    ).toBeUndefined();
  });
});
