import { google } from "@ai-sdk/google";
import { act } from "./lib/inference.js";
import * as readline from "readline";
import chalk from "chalk";

async function main() {
  // Get the prompt from CLI arguments
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Start REPL if no CLI arguments provided
    await startRepl();
  } else {
    // Execute single command if CLI arguments provided
    const prompt = args.join(" ");
    console.log(`Executing action: "${prompt}"`);
    await act(prompt, google("gemini-2.0-flash"));
  }
}

async function startRepl() {
  console.log("🤖 Accessibility Action REPL");
  console.log("Type 'exit' or 'quit' to stop, or 'help' for more info\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const model = google("gemini-2.0-flash");

  while (true) {
    try {
      const input = await new Promise<string>((resolve) => {
        rl.question(chalk.yellow("What do you want to do? "), resolve);
      });

      const prompt = input.trim();

      // Handle special commands
      if (prompt === "exit" || prompt === "quit") {
        console.log("Goodbye! 👋");
        break;
      }

      if (prompt === "help") {
        console.log("\n📖 Available commands:");
        console.log(
          "  • Type any action you want to perform (e.g., 'click the back button on edge')"
        );
        console.log("  • 'exit' or 'quit' - Stop the REPL");
        console.log("  • 'help' - Show this help message");
        console.log("");
        continue;
      }

      if (prompt === "") {
        console.log("Please enter a command or 'help' for more info.\n");
        continue;
      }

      console.log(`\n🔄 Executing: "${prompt}"`);
      console.log("─".repeat(50));

      try {
        await act(prompt, model);
        console.log("─".repeat(50));
        console.log("✅ Action completed!\n");
      } catch (error: any) {
        console.log("─".repeat(50));
        console.error("❌ Error:", error.message);
        console.log("");
      }
    } catch (error) {
      console.error("❌ REPL Error:", error);
      break;
    }
  }

  rl.close();
}

main().catch(console.error);
