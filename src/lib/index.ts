import { spawn } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { promisify } from "util";
import { exec } from "child_process";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);

export interface A11yNode {
  id: string;
  role?: string;
  title?: string;
  description?: string;
  value?: string;
  roleDescription?: string;
  identifier?: string;
  position?: [number, number];
  size?: [number, number];
  enabled?: boolean;
  focused?: boolean;
  selected?: boolean;
  children?: A11yNode[];
}

export interface WindowDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface A11yResult {
  window: WindowDimensions;
  a11y: A11yNode;
  screenshot: string;
}

export interface FullScreenshotResult {
  display: WindowDimensions;
  screenshot: string;
}

export interface WindowInfo {
  app: string;
  title: string;
  id: string;
}

export interface WindowListResponse {
  availableWindows: WindowInfo[];
}

export interface ErrorWithWindows {
  error: string;
  availableWindows: WindowInfo[];
}

function getProjectRoot(): string {
  // Get the directory where this file is located
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // Go up two levels: src/lib -> src -> project root
  return join(currentDir, "../..");
}

export async function compileSwiftIfNeeded(): Promise<string> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const swiftFile = join(currentDir, "a11y-extractor.swift");
  const executableFile = join(currentDir, "a11y-extractor");

  // Check if Swift file exists
  if (!existsSync(swiftFile)) {
    throw new Error("Swift source file not found: " + swiftFile);
  }

  // Check if we need to compile (executable doesn't exist or Swift file is newer)
  const needsCompile =
    !existsSync(executableFile) ||
    (await import("fs")).statSync(swiftFile).mtime >
      (await import("fs")).statSync(executableFile).mtime;

  if (needsCompile) {
    console.log("Compiling Swift accessibility extractor...");
    try {
      const { stdout, stderr } = await execAsync(
        `swiftc -o "${executableFile}" "${swiftFile}" -framework ApplicationServices -framework Cocoa`
      );
      if (stderr) {
        console.warn("Compilation warnings:", stderr);
      }
      console.log("Compilation successful!");
    } catch (error: any) {
      throw new Error(`Failed to compile Swift file: ${error.message}`);
    }
  }

  return executableFile;
}

export async function waitForUserInput(message: string): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(message);
    process.stdin.once("data", () => {
      resolve();
    });
    process.stdin.resume();
  });
}

export async function listAvailableWindows(): Promise<WindowListResponse> {
  const executable = await compileSwiftIfNeeded();

  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--list"]);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(
        new Error(`Failed to execute accessibility extractor: ${error.message}`)
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`Process exited with code ${code}: ${stderr || stdout}`)
        );
        return;
      }

      try {
        const result = JSON.parse(stdout) as WindowListResponse;
        resolve(result);
      } catch (error) {
        reject(new Error(`Failed to parse JSON output: ${error}`));
      }
    });
  });
}

export async function getAccessibilityTree(
  windowIdentifier: string,
  autoRetry: boolean = true
): Promise<A11yResult> {
  const executable = await compileSwiftIfNeeded();

  // Check if the identifier looks like a window ID (contains hyphens and is alphanumeric)
  const isWindowId =
    /^[a-z0-9-]+$/.test(windowIdentifier) && windowIdentifier.includes("-");
  const args = isWindowId
    ? ["--window-id", windowIdentifier]
    : [windowIdentifier];

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(
        new Error(`Failed to execute accessibility extractor: ${error.message}`)
      );
    });

    child.on("close", async (code) => {
      if (code !== 0) {
        // Try to parse error from stdout (our Swift app outputs JSON errors)
        try {
          const errorObj = JSON.parse(stdout);
          if (errorObj.error) {
            // Check if it's a permission error and we should auto-retry
            if (errorObj.needsPermission && autoRetry) {
              console.log("\n🔓 Accessibility permissions needed!");
              console.log(
                "\n📋 System Settings has been opened to the Accessibility page."
              );
              console.log("\nPlease follow these steps:");
              console.log(
                "  1. Find your terminal app in the list (Terminal, iTerm2, VS Code, etc.)"
              );
              console.log("  2. Toggle the checkbox to enable accessibility");
              console.log("  3. You may need to restart your terminal app\n");

              await waitForUserInput("Press Enter when ready to retry...");

              // Retry the operation
              try {
                const tree = await getAccessibilityTree(
                  windowIdentifier,
                  false
                );
                resolve(tree);
                return;
              } catch (retryError: any) {
                reject(
                  new Error(
                    `Still unable to access accessibility API: ${retryError.message}`
                  )
                );
                return;
              }
            }

            // Check if this is a "window not found" error with available windows
            if (errorObj.availableWindows) {
              const windowsError = errorObj as ErrorWithWindows;
              const error = new Error(windowsError.error) as any;
              error.availableWindows = windowsError.availableWindows;
              reject(error);
              return;
            }

            reject(new Error(errorObj.error));
            return;
          }
        } catch {
          // Not JSON, use regular error
        }

        reject(
          new Error(`Process exited with code ${code}: ${stderr || stdout}`)
        );
        return;
      }

      try {
        const tree = JSON.parse(stdout);
        if (tree.error) {
          reject(new Error(tree.error));
        } else {
          // Assign hierarchical IDs to the accessibility tree
          if (tree.a11y) {
            tree.a11y = assignHierarchicalIds(tree.a11y);
          }
          resolve(tree);
        }
      } catch (error) {
        reject(new Error(`Failed to parse JSON output: ${error}`));
      }
    });
  });
}

export async function getAccessibilityTreeById(
  windowId: string,
  autoRetry: boolean = true
): Promise<A11yResult> {
  const executable = await compileSwiftIfNeeded();

  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--window-id", windowId]);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(
        new Error(`Failed to execute accessibility extractor: ${error.message}`)
      );
    });

    child.on("close", async (code) => {
      if (code !== 0) {
        // Try to parse error from stdout (our Swift app outputs JSON errors)
        try {
          const errorObj = JSON.parse(stdout);
          if (errorObj.error) {
            // Check if this is a "window not found" error with available windows
            if (errorObj.availableWindows) {
              const windowsError = errorObj as ErrorWithWindows;
              const error = new Error(windowsError.error) as any;
              error.availableWindows = windowsError.availableWindows;
              reject(error);
              return;
            }

            reject(new Error(errorObj.error));
            return;
          }
        } catch {
          // Not JSON, use regular error
        }

        reject(
          new Error(`Process exited with code ${code}: ${stderr || stdout}`)
        );
        return;
      }

      try {
        const tree = JSON.parse(stdout);
        if (tree.error) {
          reject(new Error(tree.error));
        } else {
          // Assign hierarchical IDs to the accessibility tree
          if (tree.a11y) {
            tree.a11y = assignHierarchicalIds(tree.a11y);
          }
          resolve(tree);
        }
      } catch (error) {
        reject(new Error(`Failed to parse JSON output: ${error}`));
      }
    });
  });
}

export async function getFullDisplayScreenshot(): Promise<FullScreenshotResult> {
  const executable = await compileSwiftIfNeeded();

  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--full-screenshot"]);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(
        new Error(`Failed to execute accessibility extractor: ${error.message}`)
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`Process exited with code ${code}: ${stderr || stdout}`)
        );
        return;
      }
      try {
        const result = JSON.parse(stdout) as FullScreenshotResult;
        if ((result as any).error) {
          reject(new Error((result as any).error));
        } else {
          resolve(result);
        }
      } catch (error) {
        reject(new Error(`Failed to parse JSON output: ${error}`));
      }
    });
  });
}

export async function getDisplayScreenshotForRect(
  rect: WindowDimensions
): Promise<FullScreenshotResult> {
  const executable = await compileSwiftIfNeeded();
  const args = [
    "--full-screenshot-for-rect",
    String(rect.x),
    String(rect.y),
    String(rect.width),
    String(rect.height),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      reject(
        new Error(`Failed to execute accessibility extractor: ${error.message}`)
      );
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`Process exited with code ${code}: ${stderr || stdout}`)
        );
        return;
      }
      try {
        const result = JSON.parse(stdout) as FullScreenshotResult;
        if ((result as any).error) {
          reject(new Error((result as any).error));
        } else {
          resolve(result);
        }
      } catch (error) {
        reject(new Error(`Failed to parse JSON output: ${error}`));
      }
    });
  });
}

export function displayAvailableWindows(windows: WindowInfo[]) {
  console.log("\n📱 Available windows:");

  // Group windows by app
  const windowsByApp = windows.reduce((acc, window) => {
    if (!acc[window.app]) {
      acc[window.app] = [];
    }
    acc[window.app].push({ title: window.title, id: window.id });
    return acc;
  }, {} as Record<string, Array<{ title: string; id: string }>>);

  for (const [appName, windowInfos] of Object.entries(windowsByApp)) {
    console.log(`\n  📦 ${appName}:`);
    for (const info of windowInfos) {
      console.log(`    • "${info.title}" (ID: ${info.id})`);
    }
  }

  console.log(
    "\n💡 You can search by app name + window title, or use window ID."
  );
  console.log("   Examples:");
  console.log(
    "     bun run src/index.ts 'edge commander'  # Search by app+title"
  );
  console.log("     bun run src/index.ts safari-main       # Use window ID");
}

function calculateMatchScore(
  node: A11yNode,
  searchCriteria: Partial<A11yNode>
): number {
  let score = 0;
  let totalCriteria = 0;

  for (const [key, value] of Object.entries(searchCriteria)) {
    if (value === undefined || value === null) continue;

    totalCriteria++;
    const nodeValue = (node as any)[key];

    if (key === "position" || key === "size") {
      if (
        Array.isArray(nodeValue) &&
        Array.isArray(value) &&
        nodeValue.length === 2 &&
        value.length === 2
      ) {
        if (nodeValue[0] === value[0] && nodeValue[1] === value[1]) {
          score += 10;
        }
      }
    } else if (typeof value === "string" && typeof nodeValue === "string") {
      if (nodeValue.toLowerCase().includes(value.toLowerCase())) {
        score += 5;
      } else if (nodeValue.toLowerCase() === value.toLowerCase()) {
        score += 10;
      }
    } else if (nodeValue === value) {
      score += 10;
    }
  }

  return totalCriteria === 0 ? 0 : score / totalCriteria;
}

function searchTree(
  node: A11yNode,
  searchCriteria: Partial<A11yNode>
): A11yNode[] {
  const results: A11yNode[] = [];

  const score = calculateMatchScore(node, searchCriteria);
  if (score > 0) {
    results.push(node);
  }

  if (node.children) {
    for (const child of node.children) {
      results.push(...searchTree(child, searchCriteria));
    }
  }

  return results;
}

function generateWindowId(appName: string, windowTitle: string): string {
  const cleanApp = appName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);

  const cleanTitle = windowTitle
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 15);

  return `${cleanApp}-${cleanTitle}`;
}

function calculateWindowSimilarity(query: string, window: WindowInfo): number {
  const queryLower = query.toLowerCase();
  const appLower = window.app.toLowerCase();
  const titleLower = window.title.toLowerCase();
  const combinedLower = `${appLower} ${titleLower}`;

  // Direct ID match gets highest score
  if (window.id === queryLower) {
    return 1000;
  }

  let score = 0;

  // Exact matches
  if (appLower === queryLower || titleLower === queryLower) {
    score += 100;
  }

  // Combined app + title contains query
  if (combinedLower.includes(queryLower)) {
    score += 50;
  }

  // App or title contains query
  if (appLower.includes(queryLower)) {
    score += 30;
  }
  if (titleLower.includes(queryLower)) {
    score += 30;
  }

  // Fuzzy matching - check for partial word matches
  const queryWords = queryLower.split(/\s+/);
  const combinedWords = combinedLower.split(/\s+/);

  for (const queryWord of queryWords) {
    if (queryWord.length < 2) continue;

    for (const combinedWord of combinedWords) {
      if (combinedWord.includes(queryWord)) {
        score += 10;
      }
      // Partial substring match
      if (queryWord.length >= 3) {
        for (let i = 0; i <= queryWord.length - 3; i++) {
          const substring = queryWord.substring(i, i + 3);
          if (combinedWord.includes(substring)) {
            score += 2;
          }
        }
      }
    }
  }

  return score;
}

export function searchWindows(
  query: string,
  windows: WindowInfo[]
): WindowInfo[] {
  const windowsWithIds = windows.map((w) => ({
    ...w,
    id: w.id || generateWindowId(w.app, w.title),
  }));

  const scored = windowsWithIds.map((window) => ({
    window,
    score: calculateWindowSimilarity(query, window),
  }));

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.window);
}

export function findBestWindow(
  query: string,
  windows: WindowInfo[]
): WindowInfo | null {
  const matches = searchWindows(query, windows);
  return matches.length > 0 ? matches[0] : null;
}

export async function searchWindow(
  windowQuery: string
): Promise<string | null> {
  try {
    const windowList = await listAvailableWindows();
    const bestMatch = findBestWindow(windowQuery, windowList.availableWindows);

    if (bestMatch) {
      console.log(
        `Found window: "${bestMatch.title}" in ${bestMatch.app} (ID: ${bestMatch.id})`
      );
      return bestMatch.id;
    }
  } catch (error) {
    console.warn("Failed to search windows:", error);
  }

  return null;
}

export async function focusWindow(windowId: string): Promise<boolean> {
  return focusWindowById(windowId);
}

export async function focusWindowById(windowId: string): Promise<boolean> {
  const executable = await compileSwiftIfNeeded();

  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--focus-id", windowId]);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(
        new Error(`Failed to execute accessibility extractor: ${error.message}`)
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve(false);
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result.success === true);
      } catch (error) {
        resolve(false);
      }
    });
  });
}

export async function focusWindowByTitle(
  windowTitle: string
): Promise<boolean> {
  const executable = await compileSwiftIfNeeded();

  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--focus", windowTitle]);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(
        new Error(`Failed to execute accessibility extractor: ${error.message}`)
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve(false);
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result.success === true);
      } catch (error) {
        resolve(false);
      }
    });
  });
}

export async function clickElement(
  node: A11yNode,
  windowInfo?: WindowDimensions
): Promise<void> {
  if (!node.position || !node.size) {
    throw new Error("Element must have position and size to be clickable");
  }

  // Calculate the center point in global screen coordinates
  const centerX = node.position[0] + node.size[0] / 2;
  const centerY = node.position[1] + node.size[1] / 2;

  // If we have window info, we need to get the display that contains this window
  // and apply the same coordinate transformation used for full display screenshots
  let clickX = centerX;
  let clickY = centerY;

  if (windowInfo) {
    // First get the display info for this window
    try {
      const displayInfo = await getDisplayScreenshotForRect(windowInfo);
      if (displayInfo.display) {
        // The coordinates are already in global screen space, which is what we need
        // The Swift code will handle finding the right display and coordinate transformation
        console.log(
          `Display info: position=[${displayInfo.display.x}, ${displayInfo.display.y}], size=[${displayInfo.display.width}, ${displayInfo.display.height}]`
        );
      }
    } catch (e) {
      console.warn("Could not get display info, using coordinates as-is:", e);
    }

    console.log(
      `Original element position: [${node.position[0]}, ${node.position[1]}]`
    );
    console.log(
      `Window info: position=[${windowInfo.x}, ${windowInfo.y}], size=[${windowInfo.width}, ${windowInfo.height}]`
    );
  }

  console.log(`Clicking at global screen coordinates: [${clickX}, ${clickY}]`);

  const executable = await compileSwiftIfNeeded();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [
      "--click-absolute",
      String(clickX),
      String(clickY),
    ]);
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      reject(new Error(`Failed to execute click: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Click command failed with code ${code}: ${stderr}`));
      } else {
        resolve();
      }
    });
  });
}

export function assignHierarchicalIds(
  tree: A11yNode,
  parentId: string = ""
): A11yNode {
  const assignIds = (node: A11yNode, currentId: string): A11yNode => {
    const hasChildren = node.children && node.children.length > 0;
    const nodeId = hasChildren ? `${currentId}.` : currentId;
    const nodeWithId = { ...node, id: nodeId };

    if (hasChildren) {
      nodeWithId.children = node.children!.map((child, index) => {
        const childId = currentId
          ? `${currentId}.${index + 1}`
          : `${index + 1}`;
        return assignIds(child, childId);
      });
    }

    return nodeWithId;
  };

  const rootId = parentId || "1";
  return assignIds(tree, rootId);
}

export {
  drawBoundingBox,
  drawMultipleBoundingBoxes,
  getImageDimensions,
  normalizeCoordinatesToScreenshot,
  normalizeSizeToScreenshot,
  normalizeScreenCoordinatesToFullScreenshot,
  drawCircleAtScreenCoordinatesOnFullScreenshot,
  type BoundingBoxOptions,
  type CircleOptions,
} from "./utils.js";
