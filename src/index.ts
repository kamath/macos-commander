import { 
  getAccessibilityTree, 
  listAvailableWindows,
  displayAvailableWindows,
  findElement,
  clickElement,
  drawBoundingBox,
  type A11yResult,
  type WindowInfo,
  getImageDimensions,
  drawMultipleBoundingBoxes
} from "./lib/index.js";

async function main() {
  const windowName = process.argv[2];
  
  if (!windowName) {
    console.error("Usage: bun run src/index.ts <window-name>");
    console.error("       bun run src/index.ts --list  (to list all windows)");
    console.error("\nExample: bun run src/index.ts Cursor");
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
	const screenshotFile = `data/screenshot.png`;
    if (result.screenshot && result.screenshot.length > 0) {
      try {
        const screenshotBuffer = Buffer.from(result.screenshot, 'base64');
        await Bun.write(screenshotFile, screenshotBuffer);
        console.log(`Screenshot saved to: ${screenshotFile}`);
        
        // Log screenshot dimensions
        const dimensions = await getImageDimensions(screenshotFile);
        console.log(`Screenshot dimensions: ${dimensions.width}x${dimensions.height}`);
      } catch (error) {
        console.warn("Failed to save screenshot:", error);
      }
    }
    
    // Create a copy of result without the large base64 screenshot for JSON output
    const jsonResult = {
      window: result.window,
      a11y: result.a11y,
      screenshot: result.screenshot ? screenshotFile : "No screenshot available"
    };
    
    // Optional: Save to file
    const outputFile = `data/${windowName.toLowerCase().replace(/\s+/g, '-')}-a11y-tree.json`;
    await Bun.write(outputFile, JSON.stringify(jsonResult, null, 2));
    console.log(`\nResult saved to: ${outputFile}`);
    
    // Example: Find and click the Refresh button
    console.log("\nExample: Finding Refresh button...");
    const refreshButton = findElement(result.a11y, {
      role: "AXButton",
      description: "Refresh"
    });
    
    if (refreshButton) {
      console.log("Found Refresh button:", {
        description: refreshButton.description,
        position: refreshButton.position,
        size: refreshButton.size
      });
      
      // Draw bounding box around the refresh button
      if (result.screenshot && screenshotFile) {
        console.log("Window info:", result.window);
        
        const [screenX, screenY] = refreshButton.position!;
        const [width, height] = refreshButton.size!;
        const window = result.window;
        
        console.log(`Converting coordinates:`);
        console.log(`  Screen coords: [${screenX}, ${screenY}]`);
        console.log(`  Window position: [${window.x}, ${window.y}]`);
        console.log(`  Element size: [${width}, ${height}]`);
        
        const testElements = [
          // Use the original screen coordinates - normalization will be handled automatically
          {
            element: refreshButton,
            options: { color: 'red', thickness: 3 }
          }
        ];
        
        // Pass the window info to enable coordinate normalization
        const annotatedPath = await drawMultipleBoundingBoxes(
          screenshotFile, 
          testElements,
          'data/screenshot_multi_test.png',
          window  // Pass window info for coordinate normalization
        );
        console.log(`Test screenshot with multiple boxes saved to: ${annotatedPath}`);
      }
      
      // Uncomment to actually click it:
      // await clickElement(refreshButton);
      // console.log("Clicked Refresh button!");
    } else {
      console.log("Refresh button not found");
    }
    
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

main().catch(console.error);