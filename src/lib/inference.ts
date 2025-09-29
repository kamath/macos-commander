import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { A11yNode } from ".";

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
  // First, generate the method to use like "click"
  const methodResponse = await generateObject({
    model,
    schema: actResponseSchema,
    prompt: `
	You are a helpful assistant that can act on a given prompt.
	You will be given a prompt and a list of available actions. The actions are:
	${Object.values(methodSchema.enum).join(", ")}
	Given an instruction like "click the refresh button on edge", you should return the following JSON:
	{
		"method": "click",
		"nodeId": "1.1." // or whatever the node id is in the accessibility tree below
	}
	`,
  });
  return methodResponse.object;
}
