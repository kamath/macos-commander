import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { exec } from "child_process";

const execAsync = promisify(exec);

interface A11yNode {
  role?: string;
  title?: string;
  description?: string;
  value?: string;
  roleDescription?: string;
  identifier?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  enabled?: boolean;
  focused?: boolean;
  selected?: boolean;
  children?: A11yNode[];
}

interface WindowDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface A11yResult {
  window: WindowDimensions;
  a11y: A11yNode;
  screenshot: string;
}

interface WindowInfo {
  app: string;
  title: string;
}

interface WindowListResponse {
  availableWindows: WindowInfo[];
}

interface ErrorWithWindows {
  error: string;
  availableWindows: WindowInfo[];
}

async function compileSwiftIfNeeded(): Promise<string> {
  const swiftFile = join(process.cwd(), "a11y-extractor.swift");
  const executableFile = join(process.cwd(), "a11y-extractor");
  
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

async function waitForUserInput(message: string): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(message);
    process.stdin.once('data', () => {
      resolve();
    });
    process.stdin.resume();
  });
}

async function listAvailableWindows(): Promise<WindowListResponse> {
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

async function getAccessibilityTree(windowTitle: string, autoRetry: boolean = true): Promise<A11yResult> {
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

function displayAvailableWindows(windows: WindowInfo[]) {
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
  console.log("   Example: bun run index.ts Safari");
}

async function main() {
  const windowName = process.argv[2];
  
  if (!windowName) {
    console.error("Usage: bun run index.ts <window-name>");
    console.error("       bun run index.ts --list  (to list all windows)");
    console.error("\nExample: bun run index.ts Cursor");
    process.exit(1);
  }
  
  // Handle listing all windows
  if (windowName.toLowerCase() === "--list" || windowName.toLowerCase() === "list") {
    try {
      console.log("Getting list of available windows...");
      const result = await listAvailableWindows();
      displayAvailableWindows(result.availableWindows);
      process.exit(0);
    } catch (error: any) {
      console.error("\nError listing windows:", error.message);
      process.exit(1);
    }
  }
  
  try {
    console.log(`Searching for window containing: "${windowName}"...`);
    const result = await getAccessibilityTree(windowName);
    
    // Save screenshot if available
    if (result.screenshot && result.screenshot.length > 0) {
      try {
        const screenshotBuffer = Buffer.from(result.screenshot, 'base64');
        await Bun.write("screenshot.png", screenshotBuffer);
        console.log("Screenshot saved to: screenshot.png");
      } catch (error) {
        console.warn("Failed to save screenshot:", error);
      }
    }
    
    // Create a copy of result without the large base64 screenshot for JSON output
    const jsonResult = {
      window: result.window,
      a11y: result.a11y,
      screenshot: result.screenshot ? "screenshot.png" : "No screenshot available"
    };
    
    // Output the result as formatted JSON
    console.log("\nWindow & Accessibility Tree:");
    console.log(JSON.stringify(jsonResult, null, 2));
    
    // Optional: Save to file
    const outputFile = `${windowName.toLowerCase().replace(/\s+/g, '-')}-a11y-tree.json`;
    await Bun.write(outputFile, JSON.stringify(jsonResult, null, 2));
    console.log(`\nResult saved to: ${outputFile}`);
    
  } catch (error: any) {
    console.error("\nError:", error.message);
    
    // Show available windows if the window wasn't found
    if (error.availableWindows) {
      displayAvailableWindows(error.availableWindows);
    } else if (error.message.includes("accessibility permissions")) {
      console.error("\nTo grant accessibility permissions:");
      console.error("1. Open System Settings > Privacy & Security > Accessibility");
      console.error("2. Click the '+' button and add your terminal app (Terminal, iTerm2, etc.)");
      console.error("3. Make sure the checkbox next to your terminal app is checked");
      console.error("4. You may need to restart your terminal");
    }
    
    process.exit(1);
  }
}

// Export functions for use as a library
export { 
  getAccessibilityTree, 
  listAvailableWindows,
  compileSwiftIfNeeded, 
  waitForUserInput, 
  displayAvailableWindows
};

export type { 
  A11yNode,
  WindowDimensions,
  A11yResult, 
  WindowInfo, 
  WindowListResponse 
};

// Run main if executed directly
if (import.meta.main) {
  main().catch(console.error);
}