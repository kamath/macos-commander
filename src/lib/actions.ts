import {
  type A11yNode,
  type WindowDimensions,
  clickElement,
  getDisplayScreenshotForRect,
  drawMultipleBoundingBoxes,
  drawCircleAtScreenCoordinatesOnFullScreenshot,
} from "./index.js";

interface ClickOptions {
  tree: A11yNode;
  windowInfo: WindowDimensions;
  screenshotPath?: string;
  boundingBoxOutputPath?: string;
  fullScreenshotPath?: string;
  fullScreenshotAnnotatedPath?: string;
}

function findNodeById(node: A11yNode, targetId: string): A11yNode | null {
  if (node.id === targetId) {
    return node;
  }

  if (!node.children) {
    return null;
  }

  for (const child of node.children) {
    const found = findNodeById(child, targetId);
    if (found) {
      return found;
    }
  }

  return null;
}

export async function click(
  nodeId: string,
  options: ClickOptions
): Promise<void> {
  const {
    tree,
    windowInfo,
    screenshotPath,
    boundingBoxOutputPath = "data/screenshot_multi_test.png",
    fullScreenshotPath = "data/full_screenshot.png",
    fullScreenshotAnnotatedPath = "data/full_screenshot_with_click.png",
  } = options;

  const targetNode = findNodeById(tree, nodeId);

  if (!targetNode) {
    throw new Error(`Node with id "${nodeId}" not found in accessibility tree`);
  }

  console.log(`Found node ${nodeId}:`, {
    role: targetNode.role,
    title: targetNode.title,
    description: targetNode.description,
    position: targetNode.position,
    size: targetNode.size,
  });

  if (!targetNode.position || !targetNode.size) {
    throw new Error(
      `Node ${nodeId} does not have position/size and cannot be clicked`
    );
  }

  if (screenshotPath) {
    try {
      const annotatedPath = await drawMultipleBoundingBoxes(
        screenshotPath,
        [{ element: targetNode, options: { color: "red", thickness: 3 } }],
        boundingBoxOutputPath,
        windowInfo
      );
      console.log(`Annotated screenshot saved to: ${annotatedPath}`);
    } catch (error) {
      console.warn(`Failed to draw bounding box for node ${nodeId}:`, error);
    }
  }

  try {
    const full = await getDisplayScreenshotForRect(windowInfo);
    if (full.screenshot && full.screenshot.length > 0) {
      const fullBuffer = Buffer.from(full.screenshot, "base64");
      await Bun.write(fullScreenshotPath, fullBuffer);
      const clickX = targetNode.position[0] + targetNode.size[0] / 2;
      const clickY = targetNode.position[1] + targetNode.size[1] / 2;
      const {
        finalOutputPath: annotatedFull,
        cx,
        cy,
      } = await drawCircleAtScreenCoordinatesOnFullScreenshot(
        fullScreenshotPath,
        [clickX, clickY],
        full.display,
        fullScreenshotAnnotatedPath,
        { color: "yellow", thickness: 16, radius: 22, opacity: 1 }
      );
      console.log(`Full display screenshot saved to: ${fullScreenshotPath}`);
      console.log(
        `Full display screenshot with click saved to: ${annotatedFull}`
      );
      console.log(`Click coordinates in global screen: [${clickX}, ${clickY}]`);
      console.log(
        `Click coordinates within full display screenshot: [${cx}, ${cy}]`
      );
    }
  } catch (error) {
    console.warn(
      `Failed to create full display screenshot with click for node ${nodeId}:`,
      error
    );
  }

  await clickElement(targetNode, windowInfo);
  console.log(`Clicked node ${nodeId}!`);
}
