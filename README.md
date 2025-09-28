# macOS Accessibility Tree Extractor

Extract the accessibility tree from any macOS window as JSON. This tool allows you to inspect the UI structure of any application window for automation, testing, or accessibility purposes.

## Features

- Extract complete accessibility tree from any window
- **Capture window screenshots** automatically as PNG files
- Search windows by title (partial match supported)
- **List all available windows** when target not found
- **Automatic permission prompts** with System Settings integration
- Export tree as formatted JSON
- TypeScript/Bun support
- Automatic Swift compilation

## Prerequisites

- macOS
- Bun runtime (`curl -fsSL https://bun.sh/install | bash`)
- Xcode Command Line Tools (for Swift compilation)
- Accessibility permissions for your terminal

## Installation

```bash
bun install
```

## Usage

### Command Line

```bash
# Search for a window by name
bun run start "Window Name"
# or
bun run src/index.ts "Window Name"

# List all available windows
bun run list
# or
bun run src/index.ts --list

# Examples
bun run start Finder
bun run start Safari
bun run start "Visual Studio Code"
bun run start Cursor    # Partial match works too
```

### As a Library

```typescript
import { getAccessibilityTree, listAvailableWindows } from 'macos-a11y-tree';

// Extract accessibility tree
const tree = await getAccessibilityTree("Finder");
console.log(tree);

// List all available windows
const windows = await listAvailableWindows();
console.log(windows.availableWindows);
```

## Granting Accessibility Permissions

**IMPORTANT**: This tool requires accessibility permissions to function.

1. Open **System Settings** > **Privacy & Security** > **Accessibility**
2. Click the lock icon and authenticate
3. Click the **+** button
4. Navigate to your terminal application:
   - For Terminal.app: `/System/Applications/Utilities/Terminal.app`
   - For iTerm2: `/Applications/iTerm.app`
   - For VS Code Terminal: `/Applications/Visual Studio Code.app`
5. Ensure the checkbox next to your terminal is **checked**
6. Restart your terminal application

## Output Format

The tool outputs a hierarchical JSON structure with the following properties for each UI element:

```typescript
interface A11yNode {
  role?: string;           // Element type (e.g., "AXWindow", "AXButton")
  title?: string;          // Element title/label
  description?: string;    // Additional description
  value?: string;          // Current value (for inputs, etc.)
  roleDescription?: string;// Human-readable role description
  identifier?: string;     // Unique identifier
  position?: {            // Screen position
    x: number;
    y: number;
  };
  size?: {                // Element dimensions
    width: number;
    height: number;
  };
  enabled?: boolean;       // Is element enabled?
  focused?: boolean;       // Is element focused?
  selected?: boolean;      // Is element selected?
  children?: A11yNode[];   // Child elements
}
```

## Example Output

```json
{
  "window": {
    "x": 100,
    "y": 50,
    "width": 800,
    "height": 600
  },
  "screenshot": "screenshot.png",
  "a11y": {
    "role": "AXWindow",
    "title": "Documents",
    "roleDescription": "standard window",
    "position": { "x": 100, "y": 50 },
    "size": { "width": 800, "height": 600 },
    "enabled": true,
    "focused": true,
    "children": [
      {
        "role": "AXButton",
        "title": "Close",
        "roleDescription": "close button",
        "enabled": true
      }
    ]
  }
}
```

## Files Generated

When you run the tool, it creates several files:

- `screenshot.png` - Screenshot of the captured window
- `{window-name}-a11y-tree.json` - JSON file with window dimensions and accessibility tree
- `a11y-extractor` - Compiled Swift executable (auto-generated)

## Troubleshooting

### "This application needs accessibility permissions"

Follow the steps in [Granting Accessibility Permissions](#granting-accessibility-permissions) above.

### "Window not found"

- The tool will automatically show all available windows when a window isn't found
- Ensure the window is open and visible
- Try using a partial name match (case-insensitive)
- Use `bun run index.ts --list` to see all available windows

### Compilation errors

Ensure Xcode Command Line Tools are installed:
```bash
xcode-select --install
```

## How It Works

1. **TypeScript Interface**: The main `index.ts` provides the API and handles compilation
2. **Swift Extractor**: `a11y-extractor.swift` uses native macOS APIs to access the accessibility tree
3. **Auto-compilation**: The Swift code is automatically compiled on first run
4. **JSON Export**: The tree is serialized to JSON for easy consumption

## License

MIT