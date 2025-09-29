import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { A11yNode } from ".";
import { listAvailableWindows } from "./index.js";

export const methodSchema = z.enum(["click"]);

const actResponseSchema = z.object({
  method: methodSchema,
  windowId: z.string(),
});

export type ActResponse = z.infer<typeof actResponseSchema>;

export async function act(
  prompt: string,
  model: LanguageModel
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
  return methodResponse.object;
}
