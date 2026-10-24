import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { ContextItem, McpUiState } from "core";
import { CLIENT_TOOLS_IMPLS } from "core/tools/builtIn";
import { ContinueError, ContinueErrorReason } from "core/util/errors";

import { callClientTool } from "../../util/clientTools/callClientTool";
import { selectSelectedChatModel } from "../slices/configSlice";
import {
  acceptToolCall,
  allowToolForSession,
  errorToolCall,
  setInactive,
  setToolCallCalling,
  updateToolCallOutput,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { findToolCallById, logToolUsage } from "../util";
import { selectActiveTools } from "../selectors/selectActiveTools";
import { selectPendingToolCalls } from "../selectors/selectToolCalls";
import { chatApprovalScope } from "../util/chatApprovalScope";
import { sessionToolPolicies } from "../util/sessionToolPolicies";
import { evaluateToolPolicies } from "./evaluateToolPolicies";
import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";

export const callToolById = createAsyncThunk<
  void,
  {
    toolCallId: string;
    isAutoApproved?: boolean;
    acceptOnce?: boolean;
    depth?: number;
  },
  ThunkApiType
>("chat/callTool", async (inputs, { dispatch, extra, getState }) => {
  const { toolCallId, isAutoApproved, depth = 0 } = inputs;

  const state = getState();
  const toolCallState = findToolCallById(state.session.history, toolCallId);
  if (!toolCallState) {
    console.warn(`Tool call with ID ${toolCallId} not found`);
    return;
  }

  if (toolCallState.status !== "generated") {
    return;
  }

  const selectedChatModel = selectSelectedChatModel(state);

  if (!selectedChatModel) {
    throw new Error("No model selected");
  }

  // Both the toolbar and keyboard use this path. Automatic execution and
  // "Accept once" must never create a broader grant.
  const scope =
    !isAutoApproved && !inputs.acceptOnce
      ? chatApprovalScope(
          toolCallState.toolCall.function.name,
          selectActiveTools(state),
        )
      : undefined;
  if (scope) {
    for (const name of scope.toolNames) dispatch(allowToolForSession(name));
    const approvedState = getState();
    const wasAborted = state.session.streamAborter.signal.aborted;
    const policies = await evaluateToolPolicies(
      (action: any) =>
        getState().session.id === state.session.id ? dispatch(action) : action,
      extra.ideMessenger,
      selectActiveTools(approvedState),
      selectPendingToolCalls(approvedState).filter((call) =>
        scope.toolNames.includes(call.toolCall.function.name),
      ),
      sessionToolPolicies(
        approvedState.ui.toolSettings,
        approvedState.session.sessionToolAllow,
      ),
    );
    for (const { policy, toolCallState: pending } of policies) {
      const current = getState();
      if (
        current.session.id !== state.session.id ||
        (!wasAborted && state.session.streamAborter.signal.aborted)
      )
        return;
      const name = pending.toolCall.function.name;
      // Recheck revocation/exclusion after awaiting the policy or another tool.
      if (
        !current.session.sessionToolAllow[name] ||
        !selectActiveTools(current).some((tool) => tool.function.name === name)
      )
        continue;
      if (
        policy === "allowedWithoutPermission" ||
        (pending.toolCallId === toolCallId &&
          policy === "allowedWithPermission")
      ) {
        unwrapResult(
          await dispatch(
            callToolById({
              toolCallId: pending.toolCallId,
              isAutoApproved: true,
              depth,
            }),
          ),
        );
      }
    }
    return;
  }

  dispatch(
    setToolCallCalling({
      toolCallId,
    }),
  );

  let output: ContextItem[] | undefined = undefined;
  let mcpUiState: McpUiState | undefined = undefined;
  let error: ContinueError | undefined = undefined;
  let streamResponse: boolean;

  // IMPORTANT:
  // Errors that occur while calling tool call implementations
  // Are caught and passed in output as context items
  // Errors that occur outside specifically calling the tool
  // Should not be caught here - should be handled as normal stream errors
  if (
    CLIENT_TOOLS_IMPLS.find(
      (toolName) => toolName === toolCallState.toolCall.function.name,
    )
  ) {
    // Tool is called on client side
    const {
      output: clientToolOutput,
      respondImmediately,
      error: clientToolError,
    } = await callClientTool(toolCallState, {
      dispatch,
      ideMessenger: extra.ideMessenger,
      getState,
    });
    output = clientToolOutput;
    error = clientToolError;
    streamResponse = respondImmediately;
  } else {
    // Tool is called on core side
    const result = await extra.ideMessenger.request("tools/call", {
      toolCall: toolCallState.toolCall,
    });
    if (result.status === "error") {
      throw new Error(result.error);
    } else {
      output = result.content.contextItems;
      mcpUiState = result.content.mcpUiState;
      error = result.content.errorMessage
        ? new ContinueError(
            result.content.errorReason || ContinueErrorReason.Unspecified,
            result.content.errorMessage,
          )
        : undefined;
    }
    streamResponse = true;
  }

  if (getState().session.id !== state.session.id) return;

  if (error) {
    dispatch(
      updateToolCallOutput({
        toolCallId,
        contextItems: [
          {
            icon: "problems",
            name: "Tool Call Error",
            description: "Tool Call Failed",
            content: `${toolCallState.toolCall.function.name} failed with the message: ${error.message}\n\nPlease try something else or request further instructions.`,
            hidden: false,
          },
        ],
      }),
    );
  } else if (output?.length) {
    dispatch(
      updateToolCallOutput({
        toolCallId,
        contextItems: output,
        mcpUiState,
      }),
    );
  }

  if (streamResponse) {
    if (error) {
      logToolUsage(toolCallState, false, false, extra.ideMessenger, output);
      dispatch(
        errorToolCall({
          toolCallId,
        }),
      );
    } else {
      logToolUsage(toolCallState, true, true, extra.ideMessenger, output);
      dispatch(
        acceptToolCall({
          toolCallId,
        }),
      );
    }

    // Send to the LLM to continue the conversation
    const wrapped = await dispatch(
      streamResponseAfterToolCall({
        toolCallId,
        depth: depth + 1,
        ...(state.session.streamAborter.signal.aborted
          ? { continueResponse: false }
          : {}),
      }),
    );
    unwrapResult(wrapped);
  } else {
    dispatch(setInactive());
  }
});
