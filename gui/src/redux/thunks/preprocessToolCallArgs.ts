import { ToolCallState } from "core";
import { ContinueErrorReason } from "core/util/errors";

import { IIdeMessenger } from "../../context/IdeMessenger";
import {
  errorToolCall,
  setProcessedToolCallArgs,
  updateToolCallOutput,
} from "../slices/sessionSlice";
import { AppThunkDispatch } from "../store";

export async function preprocessToolCalls(
  dispatch: AppThunkDispatch,
  ideMessenger: IIdeMessenger,
  generatedToolCalls: ToolCallState[],
): Promise<void> {
  // Tool call pre-processing
  await Promise.all(
    generatedToolCalls.map(async (tcState) => {
      let errorReason: ContinueErrorReason | undefined = undefined;
      let errorMessage: string | undefined = undefined;
      let preprocessedArgs: Record<string, unknown> | undefined = undefined;
      const incomplete =
        !tcState.toolCall.function.name?.trim() || !tcState.toolCall.id;
      const result = incomplete
        ? {
            status: "error" as const,
            error:
              "The model returned an incomplete tool call (missing tool name or call ID). No tool was executed. Retry with an available tool's exact name and a new call ID.",
          }
        : await ideMessenger.request("tools/preprocessArgs", {
            toolName: tcState.toolCall.function.name,
            args: tcState.parsedArgs,
          });
      if (result.status === "success") {
        preprocessedArgs = result.content.preprocessedArgs;
        errorMessage = result.content.errorMessage;
        errorReason = result.content.errorReason;
      } else {
        errorMessage = result.error;
        errorReason = ContinueErrorReason.Unknown;
      }
      if (errorReason) {
        dispatch(
          errorToolCall({
            toolCallId: tcState.toolCallId,
          }),
        );
        dispatch(
          updateToolCallOutput({
            toolCallId: tcState.toolCallId,
            contextItems: [
              {
                icon: "problems",
                name: "Invalid Tool Call",
                description: "",
                content: incomplete
                  ? errorMessage!
                  : `${tcState.toolCall.function.name} could not be prepared: ${errorMessage}\n\nPlease try something else or request further instructions.`,
                hidden: false,
              },
            ],
          }),
        );
      } else if (preprocessedArgs) {
        dispatch(
          setProcessedToolCallArgs({
            toolCallId: tcState.toolCallId,
            newArgs: preprocessedArgs,
          }),
        );
      }
    }),
  );
}
