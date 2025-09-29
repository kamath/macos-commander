import { google } from "@ai-sdk/google";
import { act } from "./lib/inference.js";

async function main() {
  // Get the prompt from CLI arguments
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Error: Please provide a prompt as a command line argument.");
    console.error('Usage: bun run src/index.ts "your prompt here"');
    console.error(
      'Example: bun run src/index.ts "click the back button on edge"'
    );
    process.exit(1);
  }

  const prompt = args.join(" ");
  console.log(`Executing action: "${prompt}"`);

  await act(prompt, google("gemini-2.0-flash"));
}

main().catch(console.error);
