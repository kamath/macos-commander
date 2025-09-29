import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { A11yNode, A11yResult } from ".";
import {
  displayAvailableWindows,
  focusWindow,
  getAccessibilityTreeById,
  getImageDimensions,
  listAvailableWindows,
  searchWindow,
} from "./index.js";
import { click } from "./actions.js";

export const methodSchema = z.enum(["click"]);

const actResponseSchema = z.object({
  method: methodSchema,
  windowId: z.string(),
});

const findElementResponseSchema = z.object({
  nodeId: z.string(),
  reasoning: z.string().optional(),
});

export type ActResponse = z.infer<typeof actResponseSchema>;
export type FindElementResponse = z.infer<typeof findElementResponseSchema>;

export async function findElement(
  tree: A11yNode,
  description: string,
  model: LanguageModel
): Promise<string | null> {
  function serializeA11yTree(node: A11yNode, depth: number = 0): string {
    const indent = "  ".repeat(depth);
    const properties = [];

    if (node.role) properties.push(`role: ${node.role}`);
    if (node.title) properties.push(`title: "${node.title}"`);
    if (node.description) properties.push(`description: "${node.description}"`);
    if (node.value) properties.push(`value: "${node.value}"`);
    if (node.roleDescription)
      properties.push(`roleDescription: "${node.roleDescription}"`);
    if (node.identifier) properties.push(`identifier: "${node.identifier}"`);
    if (node.enabled !== undefined) properties.push(`enabled: ${node.enabled}`);
    if (node.focused !== undefined) properties.push(`focused: ${node.focused}`);
    if (node.selected !== undefined)
      properties.push(`selected: ${node.selected}`);

    const propsStr = properties.length > 0 ? ` (${properties.join(", ")})` : "";
    let result = `${indent}Node ID: ${node.id}${propsStr}\n`;

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        result += serializeA11yTree(child, depth + 1);
      }
    }

    return result;
  }

  const treeString = serializeA11yTree(tree);

  try {
    const response = await generateObject({
      model,
      schema: findElementResponseSchema,
      prompt: `
You are an expert at analyzing accessibility trees to find specific UI elements.

Given this accessibility tree and a description of what to find, return the exact node ID of the element that best matches the description.

<accessibility-tree>
${treeString}
</accessibility-tree>

Find the element that matches this description: "${description}"

Rules:
1. Return the exact node ID as it appears in the tree
2. Look for elements based on role, title, description, value, or other properties
3. If multiple elements could match, choose the most specific one
4. Consider context - buttons for actions, text fields for input, etc.
5. If no element matches well, return an empty string for nodeId

Return only the node ID of the best matching element.
`,
    });

    return response.object.nodeId || null;
  } catch (error) {
    console.error("Error finding element with AI:", error);
    return null;
  }
}

export async function act(
  prompt: string,
  model: LanguageModel,
  debug: boolean = true
): Promise<ActResponse> {
  // Get the list of available windows with their IDs
  const windowList = await listAvailableWindows();
  const windowsText = windowList.availableWindows
    .map((w) => `  • "${w.title}" (App: ${w.app}, ID: ${w.id})`)
    .join("\n");

  // First, generate the method to use like "click"
  const methodResponse = await generateObject({
    model,
    schema: actResponseSchema,
    prompt: `
	You are a helpful assistant that can act on a given prompt.
	You will be given a prompt and a list of available actions. The actions are:
	<actions>
	${Object.values(methodSchema.enum).join(", ")}
	</actions>
	
	Available Windows:
	<available-windows>
	${windowsText}
	</available-windows>
	
	Given an instruction like "click the refresh button on edge", you should return the following JSON:
	{
		"method": "click",
		"window": "window-id-of-the-window-to-act-on",
	}
	
	Use the exact window ID from the available windows list above. If the instruction mentions a specific app or window title, match it to the corresponding window ID.

	Lastly, the instruction is as follows:
	<instruction>
		${prompt}
	</instruction>
	`,
  });

  const { method, windowId } = methodResponse.object;

  try {
    // Focus the window before processing
    console.log("Focusing window...");
    const focusSuccess = await focusWindow(windowId);
    if (focusSuccess) {
      console.log("✅ Window focused successfully");
    } else {
      console.log("⚠️  Failed to focus window, continuing anyway...");
    }

    const result = await getAccessibilityTreeById(windowId);

    // Save screenshot if available
    const screenshotFile = `data/screenshot.png`;
    if (debug) {
      if (result.screenshot && result.screenshot.length > 0) {
        try {
          const screenshotBuffer = Buffer.from(result.screenshot, "base64");
          await Bun.write(screenshotFile, screenshotBuffer);
          console.log(`Screenshot saved to: ${screenshotFile}`);

          // Log screenshot dimensions
          const dimensions = await getImageDimensions(screenshotFile);
          console.log(
            `Screenshot dimensions: ${dimensions.width}x${dimensions.height}`
          );
        } catch (error) {
          console.warn("Failed to save screenshot:", error);
        }
      }
    }

    // Create a copy of result without the large base64 screenshot for JSON output
    const jsonResult = {
      window: result.window,
      a11y: result.a11y,
      screenshot: result.screenshot
        ? screenshotFile
        : "No screenshot available",
    };

    // Optional: Save to file
    if (debug) {
      const outputFile = `data/${windowId
        .toLowerCase()
        .replace(/\s+/g, "-")}-a11y-tree.json`;
      await Bun.write(outputFile, JSON.stringify(jsonResult, null, 2));
      console.log(`\nResult saved to: ${outputFile}`);
    }

    switch (method) {
      case "click":
        await actClick(result, screenshotFile, prompt, model);
        break;
    }
  } catch (error: any) {
    console.error("\nError:", error.message);

    // Show available windows if the window wasn't found
    if (error.availableWindows) {
      displayAvailableWindows(error.availableWindows);
    } else if (error.message.includes("accessibility permissions")) {
      console.error("\nTo grant accessibility permissions:");
      console.error(
        "1. Open System Settings > Privacy & Security > Accessibility"
      );
      console.error(
        "2. Click the '+' button and add your terminal app (Terminal, iTerm2, etc.)"
      );
      console.error(
        "3. Make sure the checkbox next to your terminal app is checked"
      );
      console.error("4. You may need to restart your terminal");
    }

    process.exit(1);
  }
  return methodResponse.object;
}

async function actClick(
  result: A11yResult,
  screenshotFile: string,
  prompt: string,
  model: LanguageModel
) {
  console.log(`\nFinding element for: ${prompt}...`);
  const nodeId = await findElement(result.a11y, prompt, model);

  if (nodeId) {
    console.log(`Found element with ID: ${nodeId}`);
    await click(nodeId, {
      tree: result.a11y,
      windowInfo: result.window,
      screenshotPath: result.screenshot ? screenshotFile : undefined,
    });
  } else {
    console.log("Element not found");
  }
}
