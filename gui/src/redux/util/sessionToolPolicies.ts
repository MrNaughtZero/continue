import { ToolPolicies } from "../slices/uiSlice";
export function sessionToolPolicies(
  global: ToolPolicies,
  session: Record<string, boolean>,
): ToolPolicies {
  const result = { ...global };
  for (const [name, allowed] of Object.entries(session)) {
    if (allowed && global[name] !== "disabled")
      result[name] = "allowedWithoutPermission";
  }
  return result;
}
