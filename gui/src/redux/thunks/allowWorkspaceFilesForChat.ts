import { createAsyncThunk } from "@reduxjs/toolkit";
import { WORKSPACE_FILE_TOOLS } from "core/tools/workspaceFileTools";
import { selectActiveTools } from "../selectors/selectActiveTools";
import { selectPendingToolCalls } from "../selectors/selectToolCalls";
import { setWorkspaceFileApproval } from "../slices/sessionSlice";
import { AppThunkDispatch, ThunkApiType } from "../store";
import { callToolById } from "./callToolById";
import { evaluateToolPolicies } from "./evaluateToolPolicies";
import { handleApplyStateUpdate } from "./handleApplyStateUpdate";

export const allowWorkspaceFilesForChat = createAsyncThunk<
  void,
  void,
  ThunkApiType
>("session/allowWorkspaceFiles", async (_, { dispatch, getState, extra }) => {
  const initial = getState();
  const roots = await extra.ideMessenger.ide.getWorkspaceDirs();
  if (
    !roots.length ||
    roots.some((root) => !root.startsWith("file://")) ||
    (await extra.ideMessenger.ide.isWorkspaceRemote())
  ) {
    throw new Error("A local workspace is required");
  }
  if (getState().session.id !== initial.session.id) return;
  dispatch(setWorkspaceFileApproval(roots));
  const granted = getState();
  const grant = granted.session.workspaceFileApprovalRoots;
  const stillGranted = () =>
    getState().session.id === initial.session.id &&
    getState().session.workspaceFileApprovalRoots === grant;
  // If approval is requested mid-chat, apply it to pending file requests too.
  // Do not start tools while the original stream is still preparing them.
  if (!granted.session.isStreaming) {
    const policies = await evaluateToolPolicies(
      ((action: any) =>
        stillGranted() ? dispatch(action) : action) as AppThunkDispatch,
      extra.ideMessenger,
      selectActiveTools(granted),
      selectPendingToolCalls(granted).filter((call) =>
        WORKSPACE_FILE_TOOLS.includes(call.toolCall.function.name),
      ),
      granted.ui.toolSettings,
      false,
      roots,
    );
    for (const { policy, toolCallState } of policies) {
      if (!stillGranted()) return;
      if (
        policy === "allowedWithoutPermission" &&
        selectActiveTools(getState()).some(
          (tool) => tool.function.name === toolCallState.toolCall.function.name,
        )
      ) {
        // Do not hold the permission toggle busy for the model's next turn.
        void dispatch(
          callToolById({
            toolCallId: toolCallState.toolCallId,
            isAutoApproved: true,
          }),
        );
      }
    }
  }
  for (const apply of getState().session.codeBlockApplyStates.states) {
    if (!stillGranted()) return;
    if (apply.status === "done" && apply.toolCallId)
      await dispatch(handleApplyStateUpdate(apply));
  }
});
