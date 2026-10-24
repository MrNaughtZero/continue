import { fetchwithRequestOptions } from "@continuedev/fetch";
import { ILLM } from "..";

export interface VeniceAccount {
  available: boolean;
  balances?: Record<string, number>;
  prices?: Record<string, { input: number; output: number }>;
  updatedAt?: number;
  error?: string;
}
const cache = new WeakMap<ILLM, { at: number; value: VeniceAccount }>();
export async function getVeniceAccount(
  model?: ILLM | null,
): Promise<VeniceAccount> {
  if (!model?.apiKey || !model.apiBase) return { available: false };
  try {
    if (new URL(model.apiBase).hostname !== "api.venice.ai")
      return { available: false };
  } catch {
    return { available: false };
  }
  const previous = cache.get(model);
  if (previous && Date.now() - previous.at < 30000) return previous.value;
  try {
    const [limits, models] = await Promise.all(
      ["api_keys/rate_limits", "models"].map(async (path) => {
        const response = await fetchwithRequestOptions(
          `https://api.venice.ai/api/v1/${path}`,
          {
            headers: { Authorization: `Bearer ${model.apiKey}` },
            signal: AbortSignal.timeout(15000),
          },
          model.requestOptions,
        );
        if (!response.ok)
          throw new Error(`Venice account request failed (${response.status})`);
        return response.json() as Promise<{ data?: any }>;
      }),
    );
    const balances: Record<string, number> = {};
    for (const [unit, amount] of Object.entries(limits.data?.balances ?? {})) {
      if (typeof amount === "number" && Number.isFinite(amount))
        balances[unit] = amount;
    }
    const prices: NonNullable<VeniceAccount["prices"]> = {};
    for (const entry of models.data ?? []) {
      const pricing = entry.model_spec?.pricing;
      if (
        typeof pricing?.input?.usd === "number" &&
        typeof pricing?.output?.usd === "number"
      )
        prices[entry.id] = {
          input: pricing.input.usd,
          output: pricing.output.usd,
        };
    }
    const value = { available: true, balances, prices, updatedAt: Date.now() };
    cache.set(model, { at: Date.now(), value });
    return value;
  } catch (error) {
    const status =
      error instanceof Error
        ? error.message.match(/^Venice account request failed \(\d+\)$/)?.[0]
        : undefined;
    return {
      ...(previous?.value ?? {}),
      available: true,
      error:
        status ??
        "Venice balance is temporarily unavailable. Retry using Refresh.",
    };
  }
}
