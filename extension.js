const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/**
 * Reads and parses a Git object file
 * @param {string} objectPath - Full path to .git/objects/xx/yyyy... file
 * @returns {Promise<{type: string, size: number, content: Buffer}>}
 */
function parseGitObject(objectPath) {
  return new Promise((resolve, reject) => {
    fs.readFile(objectPath, (err, compressedData) => {
      if (err) return reject(err);

      zlib.inflate(compressedData, (err, decompressedData) => {
        if (err) return reject(err);

        const nullByteIndex = decompressedData.indexOf(0);
        if (nullByteIndex === -1) {
          return reject(new Error("Invalid Git object format"));
        }

        const header = decompressedData.slice(0, nullByteIndex).toString();
        const content = decompressedData.slice(nullByteIndex + 1);

        const [type, sizeStr] = header.split(" ");
        const size = parseInt(sizeStr, 10);

        if (size !== content.length) {
          return reject(new Error("Size mismatch"));
        }

        resolve({ type, size, content });
      });
    });
  });
}

/**
 * Parses tree object content into human-readable format
 * @param {Buffer} content - Content part of tree object
 * @returns {string} - Parsed tree content
 */
function parseTreeObject(content) {
  const entries = [];
  let offset = 0;

  while (offset < content.length) {
    // Read mode (until space)
    const spaceIndex = content.indexOf(0x20, offset); // Find space
    if (spaceIndex === -1) break;

    const mode = content.slice(offset, spaceIndex).toString();
    offset = spaceIndex + 1;

    // Read name (until null byte)
    const nullIndex = content.indexOf(0x00, offset);
    if (nullIndex === -1) break;

    const name = content.slice(offset, nullIndex).toString();
    offset = nullIndex + 1;

    // Read hash (20 bytes)
    if (offset + 20 > content.length) break;

    const hash = content.slice(offset, offset + 20).toString("hex");
    offset += 20;

    // Convert mode to human-readable type
    let typeStr = "";
    if (mode === "40000") {
      typeStr = "tree";
    } else if (mode === "100644") {
      typeStr = "blob";
    } else if (mode === "100755") {
      typeStr = "blob (executable)";
    } else if (mode === "120000") {
      typeStr = "symlink";
    } else if (mode === "160000") {
      typeStr = "commit (submodule)";
    } else {
      typeStr = "unknown";
    }

    entries.push(`${mode.padEnd(6)} ${typeStr.padEnd(20)} ${hash}    ${name}`);
  }

  return entries.join("\n");
}

/**
 * Provides decompressed content of Git objects
 */
class GitObjectContentProvider {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.gitObjectsPath = path.join(this.workspaceRoot, ".git", "objects");
  }

  /**
   * Called when VS Code requests the content of a custom URI
   * @param {vscode.Uri} uri
   */
  async provideTextDocumentContent(uri) {
    console.log("provideTextDocumentContent called with URI:", uri.toString());
    console.log("URI scheme:", uri.scheme);
    console.log("URI path:", uri.path);

    try {
      let objectPath;
      let hash;

      if (uri.scheme === "git-object-file") {
        // Opened directly from file path
        objectPath = uri.path;
        // Extract hash from file path: .git/objects/ab/cdef... -> abcdef...
        const parts = objectPath.split(path.sep);
        const objectsIndex = parts.findIndex((p) => p === "objects");
        if (objectsIndex >= 0 && parts.length > objectsIndex + 2) {
          const dir = parts[objectsIndex + 1];
          const file = parts[objectsIndex + 2];
          hash = dir + file;
        } else {
          hash = "unknown";
        }
      } else {
        // Opened with git-object: scheme (from tree view)
        hash = uri.path.startsWith("/") ? uri.path.substring(1) : uri.path;
        const dir = hash.substring(0, 2);
        const file = hash.substring(2);
        objectPath = path.join(this.gitObjectsPath, dir, file);
      }

      console.log("Object path:", objectPath);
      console.log("Hash:", hash);

      if (!fs.existsSync(objectPath)) {
        return `Object file not found for hash: ${hash}\nPath: ${objectPath}`;
      }

      // Parse the Git object
      const { type, size, content } = await parseGitObject(objectPath);

      // Display differently based on type
      let contentStr;
      if (type === "tree") {
        contentStr = parseTreeObject(content);
      } else {
        contentStr = content.toString();
      }

      // This string will be displayed in the editor tab
      return `Object Type: ${type}\nSize: ${size} bytes\nHash: ${hash}\n\n${contentStr}`;
    } catch (error) {
      console.error("Error providing text document content:", error);
      return `Error reading object: ${error.message}\n\nStack: ${error.stack}`;
    }
  }
}

/**
 * Provides the Tree View for Git objects
 */
class GitObjectTreeDataProvider {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.gitObjectsPath = this.workspaceRoot
      ? path.join(this.workspaceRoot, ".git", "objects")
      : undefined;
  }

  getTreeItem(element) {
    return element;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  async getChildren(element) {
    if (!this.gitObjectsPath || !fs.existsSync(this.gitObjectsPath)) {
      // .git/objects path doesn't exist
      return [];
    }

    if (!element) {
      // Root level (e.g., '0a', 'ff')
      const entries = fs.readdirSync(this.gitObjectsPath, {
        withFileTypes: true,
      });
      return entries
        .filter((entry) => entry.isDirectory() && entry.name.length === 2)
        .map((entry) => {
          return new vscode.TreeItem(
            entry.name,
            vscode.TreeItemCollapsibleState.Collapsed
          );
        });
    }

    if (element.label && element.label.length === 2) {
      // Second level (e.g., 'b1c2d3...')
      const subDir = path.join(this.gitObjectsPath, element.label);
      const files = fs.readdirSync(subDir);

      return Promise.all(
        files.map(async (file) => {
          const hash = element.label + file;
          const objectPath = path.join(subDir, file);

          try {
            const { type, size } = await parseGitObject(objectPath);
            const label = `${file.substring(0, 10)}... (${type}, ${size}b)`;

            const item = new vscode.TreeItem(
              label,
              vscode.TreeItemCollapsibleState.None
            );
            item.description = hash;
            item.tooltip = `Type: ${type}\nSize: ${size} bytes\nHash: ${hash}`;

            // Don't set resourceUri to prevent VS Code from trying to open the actual file
            // If item.resourceUri is not set, VS Code won't attempt to open the physical file

            // Set command to show object content
            // Pass hash instead of objectPath
            item.command = {
              command: "git-object-viewer.showObjectContent",
              title: "Show Content",
              arguments: [hash], // Pass hash instead of path
            };
            return item;
          } catch (error) {
            console.error(`Error parsing ${hash}:`, error);
            return new vscode.TreeItem(
              `${file} (Error)`,
              vscode.TreeItemCollapsibleState.None
            );
          }
        })
      );
    }

    return [];
  }
}

/**
 * Extension activation function
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log('Congratulations, "git-object-viewer" is now active!');

  const workspaceRoot = vscode.workspace.workspaceFolders
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : undefined;

  if (!workspaceRoot) {
    vscode.window.showErrorMessage(
      "Please open a folder (repository) to use Git Object Viewer."
    );
    return;
  }

  // Register TreeDataProvider
  const gitObjectProvider = new GitObjectTreeDataProvider(workspaceRoot);
  vscode.window.registerTreeDataProvider("git-objects-view", gitObjectProvider);

  // Register TextDocumentContentProvider
  // This provider handles the 'git-object' custom scheme
  const objectContentProvider = new GitObjectContentProvider(workspaceRoot);

  // Register git-object: scheme (used by tree view)
  const gitObjectProviderDisposable =
    vscode.workspace.registerTextDocumentContentProvider(
      "git-object",
      objectContentProvider
    );
  context.subscriptions.push(gitObjectProviderDisposable);
  console.log("Git Object Content Provider registered for scheme: git-object");

  // Register git-object-file: scheme (used when opening actual files)
  const fileProviderDisposable =
    vscode.workspace.registerTextDocumentContentProvider(
      "git-object-file",
      objectContentProvider
    );
  context.subscriptions.push(fileProviderDisposable);
  console.log(
    "Git Object Content Provider registered for scheme: git-object-file"
  );

  // Register command to show object content
  // This command receives a hash as an argument
  let disposable = vscode.commands.registerCommand(
    "git-object-viewer.showObjectContent",
    async (hash) => {
      try {
        // Create URI with git-object: scheme and hash value
        // Use Uri.from for clearer URI creation instead of Uri.parse
        const uri = vscode.Uri.from({
          scheme: "git-object",
          path: hash,
        });

        // Open document with this URI (VS Code will call ContentProvider)
        const doc = await vscode.workspace.openTextDocument(uri);

        // Show document in editor (preview: false to open in new tab)
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (error) {
        console.error("Error in showObjectContent:", error);
        vscode.window.showErrorMessage(
          "Failed to show Git object: " + error.message
        );
      }
    }
  );

  context.subscriptions.push(disposable);

  // Register command to open actual Git object files directly
  let openGitObjectDisposable = vscode.commands.registerCommand(
    "git-object-viewer.openGitObject",
    async (fileUri) => {
      try {
        if (!fileUri) {
          vscode.window.showErrorMessage("No file selected");
          return;
        }

        console.log("Opening git object file:", fileUri.fsPath);

        // Convert actual file path to git-object-file: scheme
        const virtualUri = vscode.Uri.from({
          scheme: "git-object-file",
          path: fileUri.fsPath,
        });

        const doc = await vscode.workspace.openTextDocument(virtualUri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (error) {
        console.error("Error opening git object file:", error);
        vscode.window.showErrorMessage(
          "Failed to open Git object: " + error.message
        );
      }
    }
  );

  context.subscriptions.push(openGitObjectDisposable);
}

module.exports = {
  activate,
};
