import { chatApprovalScope } from "../../../../redux/util/chatApprovalScope";
import { selectActiveTools } from "../../../../redux/selectors/selectActiveTools";
import { allowToolForSession } from "../../../../redux/slices/sessionSlice";
import { BuiltInToolNames } from "core/tools/builtIn";
import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import { selectPendingToolCalls } from "../../../../redux/selectors/selectToolCalls";
import { callToolById } from "../../../../redux/thunks/callToolById";
import { cancelToolCallThunk } from "../../../../redux/thunks/cancelToolCall";
import { getAltKeyLabel, getMetaKeyLabel, isJetBrains } from "../../../../util";
import { Button } from "../../../ui";
import { useMainEditor } from "../../TipTapEditor";

export const generateToolCallButtonTestId = (
  action: "accept" | "reject",
  toolCallId: string,
) => {
  return `${action}-tool-call-button-${toolCallId}`;
};

export function PendingToolCallToolbar() {
  const dispatch = useAppDispatch();
  const jetbrains = isJetBrains();
  const pendingToolCalls = useAppSelector(selectPendingToolCalls);
  const editor = useMainEditor();
  const activeTools = useAppSelector(selectActiveTools);

  if (pendingToolCalls.length === 0) {
    return null;
  }

  const handleAccept = (toolCallId: string, acceptOnce = false) => {
    void dispatch(callToolById({ toolCallId, acceptOnce }));
  };

  const handleReject = (toolCallId: string) => {
    // put cursor in editor after last rejection
    if (pendingToolCalls.length === 1) {
      editor.mainEditor?.commands.focus();
    }
    void dispatch(cancelToolCallThunk({ toolCallId }));
  };

  return (
    <div className="flex w-full flex-col pb-0.5">
      {pendingToolCalls.map((toolCall, index) => {
        const scope = chatApprovalScope(
          toolCall.toolCall.function.name,
          activeTools,
        );
        return (
          <div
            key={toolCall.toolCallId}
            className="border-input bg-input flex flex-wrap items-center gap-2 rounded border"
          >
            <span className="text-description flex-1 truncate text-xs italic">
              {toolCall.tool?.displayTitle ?? toolCall.toolCall.function.name}
            </span>

            <div className="flex flex-wrap items-center gap-1">
              {scope ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAccept(toolCall.toolCallId, true)}
                >
                  Accept once
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  title={
                    toolCall.toolCall.function.name ===
                    BuiltInToolNames.RunTerminalCommand
                      ? "Run terminal commands without confirmation for this open chat. Explicitly blocked commands stay blocked."
                      : "Automatically approve this tool until you leave this chat. Excluded tools and command rules still apply."
                  }
                  onClick={() => {
                    dispatch(
                      allowToolForSession(toolCall.toolCall.function.name),
                    );
                    handleAccept(toolCall.toolCallId);
                  }}
                >
                  Allow this chat
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-description-muted my-1 font-medium"
                onClick={() => handleReject(toolCall.toolCallId)}
                data-testid={generateToolCallButtonTestId(
                  "reject",
                  toolCall.toolCallId,
                )}
              >
                {/* JetBrains overrides cmd+backspace, so we have to use another shortcut */}
                {index === 0 && (
                  <span className="text-2xs mr-1">
                    {jetbrains ? getAltKeyLabel() : getMetaKeyLabel()}⌫
                  </span>
                )}
                <span>Reject</span>
              </Button>

              <Button
                variant="primary"
                title={scope?.description}
                size="sm"
                className="my-1 font-medium"
                onClick={() => handleAccept(toolCall.toolCallId)}
                data-testid={generateToolCallButtonTestId(
                  "accept",
                  toolCall.toolCallId,
                )}
              >
                {index === 0 && (
                  <span className="text-2xs mr-1">{getMetaKeyLabel()}⏎</span>
                )}
                <span>{scope?.label ?? "Accept"}</span>
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
