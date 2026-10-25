import { allowWorkspaceFilesForChat } from "../../redux/thunks/allowWorkspaceFilesForChat";
import { Button } from "../../components/ui";
import { BuiltInToolNames } from "core/tools/builtIn";
import { selectActiveTools } from "../../redux/selectors/selectActiveTools";
import { selectAgentBusy } from "../../redux/selectors/selectAgentBusy";
import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { VeniceAccount } from "core/util/veniceAccount";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  newSession,
  setWorkspaceFileApproval,
  allowToolForSession,
  revokeToolForSession,
  resetSessionToolAllow,
} from "../../redux/slices/sessionSlice";
import { saveCurrentSession } from "../../redux/thunks/session";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { cancelStream } from "../../redux/thunks/cancelStream";

export function ChatControls() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const messenger = useContext(IdeMessengerContext);
  const session = useAppSelector((s) => s.session);
  const agentBusy = useAppSelector(selectAgentBusy);
  const activeTools = useAppSelector(selectActiveTools);
  const terminalName = BuiltInToolNames.RunTerminalCommand;
  const terminalAllowed = session.sessionToolAllow[terminalName] === true;
  const model = useAppSelector(selectSelectedChatModel);
  const [expanded, setExpanded] = useState(false);
  const [account, setAccount] = useState<VeniceAccount>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [grantingFiles, setGrantingFiles] = useState(false);
  const workspaceFilesAllowed = !!session.workspaceFileApprovalRoots?.length;
  const refresh = async () => {
    setBusy(true);
    try {
      const response = await messenger.request("venice/account", undefined);
      if (response.status === "success") setAccount(response.content);
      else
        setAccount({
          available: true,
          error: "Could not refresh the balance.",
        });
    } catch {
      setAccount({ available: true, error: "Could not refresh the balance." });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setAccount(undefined);
    void refresh();
  }, [model?.title]);
  useEffect(() => {
    if (expanded && !session.isStreaming) void refresh();
  }, [session.isStreaming, expanded]);
  const logs = session.history.flatMap((item) => item.promptLogs ?? []);
  const measured = logs.filter((log) => log.usage);
  const input = measured.reduce(
    (sum, log) => sum + (log.usage?.promptTokens ?? 0),
    0,
  );
  const output = measured.reduce(
    (sum, log) => sum + (log.usage?.completionTokens ?? 0),
    0,
  );
  const reasoning = measured.reduce(
    (sum, log) =>
      sum + (log.usage?.completionTokensDetails?.reasoningTokens ?? 0),
    0,
  );
  let cost = 0,
    priced = 0;
  for (const log of measured) {
    const rate =
      log.model && log.usageProvider === "venice"
        ? account?.prices?.[log.model]
        : undefined;
    if (rate && log.usage) {
      cost +=
        (log.usage.promptTokens * rate.input +
          log.usage.completionTokens * rate.output) /
        1000000;
      priced++;
    }
  }
  const partial =
    measured.length !== logs.length ||
    (session.history.length > 0 && logs.length === 0);
  const approximate = measured.some((log) => log.usageEstimated);
  const context = session.contextPercentage;
  const contextLimit = model?.contextLength;
  return (
    <div className="border-vsc-input-border border-0 border-b border-solid px-2 py-1 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <strong>Continue · Neil</strong>
        <Button
          variant="ghost"
          size="sm"
          disabled={agentBusy || saving}
          title={
            agentBusy
              ? "Stop the active run before opening a new chat"
              : "New chat (⌥⌘N)"
          }
          onClick={async () => {
            setSaving(true);
            try {
              await dispatch(
                saveCurrentSession({
                  openNewSession: false,
                  generateTitle: false,
                }),
              ).unwrap();
              dispatch(newSession());
              setNotice("");
            } catch {
              setNotice(
                "Could not save this chat. Retry before starting a new one.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          ＋ New chat
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={agentBusy}
          onClick={() => navigate("/history")}
        >
          History
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          Usage {expanded ? "▴" : "▾"}
        </Button>
        {activeTools.some((tool) => tool.function.name === terminalName) && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={terminalAllowed}
            title="Run terminal commands without confirmation for this open chat. Explicitly blocked commands stay blocked. Resets when you switch chats or reload."
            onClick={() =>
              dispatch(
                terminalAllowed
                  ? revokeToolForSession(terminalName)
                  : allowToolForSession(terminalName),
              )
            }
          >
            {terminalAllowed
              ? "Terminal: auto · this chat"
              : "Allow terminal this chat"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={workspaceFilesAllowed}
          disabled={grantingFiles}
          title="Allow reading, creating and editing files inside this local workspace, and automatically accept those file changes. Outside files still require approval. Resets when you switch chats or reload; changing workspace folders invalidates the grant."
          onClick={async () => {
            if (workspaceFilesAllowed) {
              dispatch(setWorkspaceFileApproval(undefined));
              return;
            }
            setGrantingFiles(true);
            try {
              await dispatch(allowWorkspaceFilesForChat()).unwrap();
              setNotice("");
            } catch {
              setNotice(
                "Could not enable workspace file access. Open a local folder and try again.",
              );
            } finally {
              setGrantingFiles(false);
            }
          }}
        >
          {workspaceFilesAllowed
            ? "Workspace files: auto · this chat"
            : "Allow workspace files this chat"}
        </Button>
        {agentBusy && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch(cancelStream())}
          >
            Stop
          </Button>
        )}
      </div>
      {notice && <div role="alert">{notice}</div>}
      {(Object.keys(session.sessionToolAllow).length > 0 ||
        workspaceFilesAllowed) && (
        <div className="mt-1">
          {Object.keys(session.sessionToolAllow).length} tool(s) allowed for
          this chat{workspaceFilesAllowed ? " · Workspace files allowed" : ""} ·{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch(resetSessionToolAllow())}
          >
            Reset permissions
          </Button>
        </div>
      )}
      {agentBusy && (
        <div className="mt-1 opacity-70">
          Add context below: press Enter twice, or use Send. Running tools
          finish before it is applied.
        </div>
      )}
      {session.pendingSteering.length > 0 && (
        <div role="status" className="mt-1">
          {session.pendingSteering.length} message(s) queued for the agent.
        </div>
      )}
      {expanded && (
        <div className="mt-2 grid gap-1" aria-label="Chat usage">
          <div>
            Chat tokens: {input.toLocaleString()} in · {output.toLocaleString()}{" "}
            out{" "}
            {reasoning > 0 &&
              `· ${reasoning.toLocaleString()} reasoning (included in out)`}
            {approximate ? " (estimated)" : ""}
          </div>
          {partial && (
            <div>Partial totals: older messages have no recorded usage.</div>
          )}
          <div>
            Estimated context at last request:{" "}
            {session.contextInputTokens === undefined
              ? "Not measured yet"
              : `${session.contextInputTokens.toLocaleString()} tokens`}
            {context === undefined
              ? ""
              : ` · ${(context * 100).toFixed(1)}% of available input capacity`}
            {contextLimit
              ? ` · ${contextLimit.toLocaleString()} total window`
              : ""}
          </div>
          <div>
            Estimated chat cost:{" "}
            {priced
              ? `$${cost.toFixed(4)} USD${priced < measured.length ? " (partial)" : ""}`
              : "Unavailable"}
          </div>
          <div className="opacity-70">
            Cost is an estimate at current Venice rates. It excludes auxiliary
            or interrupted requests, extras and cache discounts. Tokens update
            after each model response.
          </div>
          {account?.available ? (
            <div>
              Venice balance:{" "}
              {Object.entries(account.balances ?? {})
                .map(
                  ([unit, amount]) =>
                    `${amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${unit}`,
                )
                .join(" · ") || "Unavailable"}
              {account.error && (
                <div>
                  {account.error}
                  {account.updatedAt
                    ? " Showing the last successful balance."
                    : ""}
                </div>
              )}
            </div>
          ) : (
            <div>Venice balance requires a selected Venice API model.</div>
          )}
          {account?.updatedAt && (
            <div className="opacity-70">
              Balance checked {new Date(account.updatedAt).toLocaleTimeString()}
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {busy ? "Checking…" : "Refresh balance"}
          </Button>
        </div>
      )}
    </div>
  );
}
