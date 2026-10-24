import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  ContextSubmenuItem,
  LoadSubmenuItemsArgs,
} from "../../index.js";
import { walkDirs } from "../../indexing/walkDir.js";
import {
  getShortestUniqueRelativeUriPaths,
  getUriPathBasename,
} from "../../util/uri.js";
import { BaseContextProvider } from "../index.js";
import { retrieveContextItemsFromEmbeddings } from "../retrieval/retrieval.js";

class FolderContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "folder",
    displayTitle: "Folder",
    description: "Type to search",
    type: "submenu",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    let folderPath = query;
    try {
      if (query.startsWith("file:"))
        folderPath = decodeURIComponent(new URL(query).pathname);
    } catch {
      /* Keep original reference. */
    }
    const folder: ContextItem = {
      name: "Selected folder",
      description: folderPath,
      content: `The user attached this local directory: ${JSON.stringify(folderPath)}. Use filesystem tools to inspect it. Indexed snippets below are only a partial selection, not the complete folder.`,
    };
    try {
      return [
        folder,
        ...(await retrieveContextItemsFromEmbeddings(
          extras,
          this.options,
          query,
        )),
      ];
    } catch {
      folder.content +=
        " Indexed retrieval is unavailable; the directory reference remains valid.";
      return [folder];
    }
  }
  async loadSubmenuItems(
    args: LoadSubmenuItemsArgs,
  ): Promise<ContextSubmenuItem[]> {
    const workspaceDirs = await args.ide.getWorkspaceDirs();
    const folders = await walkDirs(
      args.ide,
      {
        include: "dirs",
        source: "load submenu items - folder",
      },
      workspaceDirs,
    );
    const withUniquePaths = getShortestUniqueRelativeUriPaths(
      folders,
      workspaceDirs,
    );

    return withUniquePaths.map((folder) => {
      return {
        id: folder.uri,
        title: getUriPathBasename(folder.uri),
        description: folder.uniquePath,
      };
    });
  }
}

export default FolderContextProvider;
