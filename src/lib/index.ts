import { spawn } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { promisify } from "util";
import { exec } from "child_process";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);

export interface A11yNode {
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
  const needsCompile = !existsSync(executableFile) || 
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
    process.stdin.once('data', () => {
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
      reject(new Error(`Failed to execute accessibility extractor: ${error.message}`));
    });
    
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}: ${stderr || stdout}`));
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

export async function getAccessibilityTree(windowTitle: string, autoRetry: boolean = true): Promise<A11yResult> {
  const executable = await compileSwiftIfNeeded();
  
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [windowTitle]);
    
    let stdout = "";
    let stderr = "";
    
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    
    child.on("error", (error) => {
      reject(new Error(`Failed to execute accessibility extractor: ${error.message}`));
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
              console.log("\n📋 System Settings has been opened to the Accessibility page.");
              console.log("\nPlease follow these steps:");
              console.log("  1. Find your terminal app in the list (Terminal, iTerm2, VS Code, etc.)");
              console.log("  2. Toggle the checkbox to enable accessibility");
              console.log("  3. You may need to restart your terminal app\n");
              
              await waitForUserInput("Press Enter when ready to retry...");
              
              // Retry the operation
              try {
                const tree = await getAccessibilityTree(windowTitle, false);
                resolve(tree);
                return;
              } catch (retryError: any) {
                reject(new Error(`Still unable to access accessibility API: ${retryError.message}`));
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
        
        reject(new Error(`Process exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      
      try {
        const tree = JSON.parse(stdout);
        if (tree.error) {
          reject(new Error(tree.error));
        } else {
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
      reject(new Error(`Failed to execute accessibility extractor: ${error.message}`));
    });
    
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}: ${stderr || stdout}`));
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

export async function getDisplayScreenshotForRect(rect: WindowDimensions): Promise<FullScreenshotResult> {
  const executable = await compileSwiftIfNeeded();
  const args = [
    "--full-screenshot-for-rect",
    String(rect.x),
    String(rect.y),
    String(rect.width),
    String(rect.height)
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", (error) => {
      reject(new Error(`Failed to execute accessibility extractor: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}: ${stderr || stdout}`));
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
    acc[window.app].push(window.title);
    return acc;
  }, {} as Record<string, string[]>);
  
  for (const [appName, windowTitles] of Object.entries(windowsByApp)) {
    console.log(`\n  📦 ${appName}:`);
    for (const title of windowTitles) {
      console.log(`    • "${title}"`);
    }
  }
  
  console.log("\n💡 You can use any part of the window title to search.");
  console.log("   Example: bun run src/index.ts Safari");
}

function calculateMatchScore(node: A11yNode, searchCriteria: Partial<A11yNode>): number {
  let score = 0;
  let totalCriteria = 0;

  for (const [key, value] of Object.entries(searchCriteria)) {
    if (value === undefined || value === null) continue;
    
    totalCriteria++;
    const nodeValue = (node as any)[key];
    
    if (key === 'position' || key === 'size') {
      if (Array.isArray(nodeValue) && Array.isArray(value) && 
          nodeValue.length === 2 && value.length === 2) {
        if (nodeValue[0] === value[0] && nodeValue[1] === value[1]) {
          score += 10;
        }
      }
    } else if (typeof value === 'string' && typeof nodeValue === 'string') {
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

function searchTree(node: A11yNode, searchCriteria: Partial<A11yNode>): A11yNode[] {
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

export function findElement(tree: A11yNode, searchCriteria: Partial<A11yNode>): A11yNode | null {
  const matches = searchTree(tree, searchCriteria);
  
  if (matches.length === 0) {
    return null;
  }
  
  matches.sort((a, b) => {
    const scoreA = calculateMatchScore(a, searchCriteria);
    const scoreB = calculateMatchScore(b, searchCriteria);
    return scoreB - scoreA;
  });
  
  return matches[0];
}

export async function focusWindow(windowTitle: string): Promise<boolean> {
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
      reject(new Error(`Failed to execute accessibility extractor: ${error.message}`));
    });
    
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(false); // Focus failed, but don't throw error
        return;
      }
      
      try {
        const result = JSON.parse(stdout);
        resolve(result.success === true);
      } catch (error) {
        resolve(false); // Parsing failed, assume focus failed
      }
    });
  });
}

export async function clickElement(node: A11yNode, windowInfo?: WindowDimensions): Promise<void> {
  if (!node.position || !node.size) {
    throw new Error("Element must have position and size to be clickable");
  }
  
  const centerX = node.position[0] + node.size[0] / 2;
  const centerY = node.position[1] + node.size[1] / 2;
  
  console.log(`Clicking at normalized coordinates: [${centerX}, ${centerY}]`);
  if (windowInfo) {
    console.log(`Original coordinates: [${node.position[0]}, ${node.position[1]}]`);
    console.log(`Window info: position=[${windowInfo.x}, ${windowInfo.y}], size=[${windowInfo.width}, ${windowInfo.height}]`);
  }

  const executable = await compileSwiftIfNeeded();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ["--click-absolute", String(centerX), String(centerY)]);
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data.toString(); });
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

export { 
  drawBoundingBox, 
  drawMultipleBoundingBoxes, 
  getImageDimensions, 
  normalizeCoordinatesToScreenshot,
  normalizeSizeToScreenshot,
  normalizeScreenCoordinatesToFullScreenshot,
  drawCircleAtScreenCoordinatesOnFullScreenshot,
  type BoundingBoxOptions,
  type CircleOptions 
} from './utils.js';