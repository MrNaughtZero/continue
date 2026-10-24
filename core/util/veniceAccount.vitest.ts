import { describe, it, expect, vi } from "vitest";
import { getVeniceAccount } from "./veniceAccount";
import { fetchwithRequestOptions } from "@continuedev/fetch";
import { ILLM } from "..";
vi.mock("@continuedev/fetch", () => ({ fetchwithRequestOptions: vi.fn() }));
const fetchMock = vi.mocked(fetchwithRequestOptions);
describe("Venice account display", () => {
  it("never sends another provider's credential to Venice", async () => {
    fetchMock.mockClear();
    expect(
      await getVeniceAccount({
        apiBase: "https://other.example/v1",
        apiKey: "test",
      } as ILLM),
    ).toEqual({ available: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("returns only balances and prices, caches responses, and excludes credentials", async () => {
    fetchMock.mockClear();
    fetchMock.mockImplementation(
      async (url) =>
        ({
          ok: true,
          json: async () =>
            String(url).endsWith("models")
              ? {
                  data: [
                    {
                      id: "model",
                      model_spec: {
                        pricing: { input: { usd: 3 }, output: { usd: 5 } },
                      },
                    },
                  ],
                }
              : {
                  data: {
                    balances: { USD: 12.5, DIEM: 0 },
                    apiTier: "private-tier",
                  },
                },
        }) as any,
    );
    const model = {
      apiBase: "https://api.venice.ai/api/v1",
      apiKey: "test-private-key",
    } as ILLM;
    const result = await getVeniceAccount(model);
    expect(result.balances).toEqual({ USD: 12.5, DIEM: 0 });
    expect(result.prices).toEqual({ model: { input: 3, output: 5 } });
    expect(JSON.stringify(result)).not.toContain("private");
    await getVeniceAccount(model);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
