import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { A11yNode } from ".";
import { listAvailableWindows } from "./index.js";

export const methodSchema = z.enum(["click"]);

const actResponseSchema = z.object({
  method: methodSchema,
  window: z.string(),
});

export type ActResponse = z.infer<typeof actResponseSchema>;

export async function act(
  prompt: string,
  model: LanguageModel,
  a11y: A11yNode
) {
  // Get the list of available windows with their IDs
  let windowsInfo = "";
  try {
    const windowList = await listAvailableWindows();
    const windowsText = windowList.availableWindows
      .map((w) => `  • "${w.title}" (App: ${w.app}, ID: ${w.id})`)
      .join("\n");
    windowsInfo = `\n\nAvailable Windows:\n${windowsText}\n`;
  } catch (error) {
    console.warn("Failed to get window list:", error);
    windowsInfo = "\n\nNote: Unable to retrieve available windows list.\n";
  }

  // First, generate the method to use like "click"
  const methodResponse = await generateObject({
    model,
    schema: actResponseSchema,
    prompt: `
	You are a helpful assistant that can act on a given prompt.
	You will be given a prompt and a list of available actions. The actions are:
	${Object.values(methodSchema.enum).join(", ")}
	
	Here are the available windows:
	${windowsInfo}
	
	Given an instruction like "click the refresh button on edge", you should return the following JSON:
	{
		"method": "click",
		"window": "window-id-of-the-window-to-act-on",
	}
	
	Use the exact window ID from the available windows list above. If the instruction mentions a specific app or window title, match it to the corresponding window ID.
	`,
  });
  return methodResponse.object;
}
