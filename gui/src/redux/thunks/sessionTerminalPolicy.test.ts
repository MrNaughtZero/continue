import { describe, expect, it, vi } from "vitest";
import { ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { evaluateToolPolicies } from "./evaluateToolPolicies";
import { IIdeMessenger } from "../../context/IdeMessenger";
import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import {
  allowToolForSession,
  revokeToolForSession,
  newSession,
} from "../slices/sessionSlice";
import { RootState } from "../store";

const terminal = BuiltInToolNames.RunTerminalCommand;
async function evaluate({
  approved = false,
  dynamic = "allowedWithPermission",
  base = "allowedWithoutPermission",
  name = terminal,
  error = false,
} = {}) {
  const request = vi.fn().mockResolvedValue(
    error
      ? { status: "error", error: "Policy unavailable" }
      : {
          status: "success",
          content: { policy: dynamic, displayValue: "python3 script.py" },
        },
  );
  const call = {
    toolCallId: "test",
    toolCall: { function: { name, arguments: "{}" } },
    parsedArgs: { command: "python3 script.py" },
  } as ToolCallState;
  const results = await evaluateToolPolicies(
    vi.fn(),
    { request } as unknown as IIdeMessenger,
    [],
    [call],
    { [name]: base as any },
    approved,
  );
  expect(request).toHaveBeenCalled();
  return results[0].policy;
}

describe("terminal approval for this chat", () => {
  it("covers repeated command prompts only after explicit session approval", async () => {
    expect(await evaluate()).toBe("allowedWithPermission");
    expect(await evaluate({ approved: true })).toBe("allowedWithoutPermission");
    expect(await evaluate({ approved: true })).toBe("allowedWithoutPermission");
  });
  it("preserves explicit command and tool exclusions", async () => {
    expect(await evaluate({ approved: true, dynamic: "disabled" })).toBe(
      "disabled",
    );
    expect(await evaluate({ approved: true, base: "disabled" })).toBe(
      "disabled",
    );
  });
  it("does not bypass a failed policy evaluation", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await evaluate({ approved: true, error: true })).toBe("disabled");
    } finally {
      errorLog.mockRestore();
    }
  });
  it("does not grant other tools the terminal override", async () => {
    expect(
      await evaluate({ approved: true, name: BuiltInToolNames.ReadFile }),
    ).toBe("allowedWithPermission");
  });
  it("requires the effective tool setting to allow execution", async () => {
    expect(
      await evaluate({ approved: true, base: "allowedWithPermission" }),
    ).toBe("allowedWithPermission");
  });
  it("can be revoked without affecting other tools and clears on a new chat", () => {
    const store = createMockStore(getEmptyRootState());
    store.dispatch(allowToolForSession(terminal));
    store.dispatch(allowToolForSession("other"));
    store.dispatch(revokeToolForSession(terminal));
    expect((store.getState() as RootState).session.sessionToolAllow).toEqual({
      other: true,
    });
    store.dispatch(allowToolForSession(terminal));
    store.dispatch(newSession());
    expect((store.getState() as RootState).session.sessionToolAllow).toEqual(
      {},
    );
  });
});
