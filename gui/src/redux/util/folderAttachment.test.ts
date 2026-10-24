import { describe, it, expect, vi } from "vitest";
import FolderContextProvider from "core/context/providers/FolderContextProvider";
import { retrieveContextItemsFromEmbeddings } from "core/context/retrieval/retrieval";
vi.mock("core/context/retrieval/retrieval", () => ({
  retrieveContextItemsFromEmbeddings: vi.fn(),
}));
describe("folder attachment without an index", () => {
  it.each([false, true])(
    "retains the real directory when retrieval is empty or unavailable (%s)",
    async (fail) => {
      const retrieval = vi.mocked(retrieveContextItemsFromEmbeddings);
      if (fail) retrieval.mockRejectedValueOnce(new Error("index unavailable"));
      else retrieval.mockResolvedValueOnce([]);
      const provider = new FolderContextProvider({});
      const items = await provider.getContextItems(
        "file:///workspace/themes/My%20Theme",
        {} as any,
      );
      expect(items[0].description).toBe("/workspace/themes/My Theme");
      expect(items[0].content).toContain("Use filesystem tools");
      expect(items).toHaveLength(1);
    },
  );
});
