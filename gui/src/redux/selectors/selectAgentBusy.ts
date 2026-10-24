import { RootState } from "../store";
export const selectAgentBusy = (state: RootState) =>
  state.session.isStreaming ||
  state.session.history.some((item) =>
    item.toolCallStates?.some((tool) => tool.status === "calling"),
  );
