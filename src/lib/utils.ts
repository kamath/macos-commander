import sharp from 'sharp';
import type { A11yNode, WindowDimensions } from './index.js';

export async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not get image dimensions");
  }
  
  return {
    width: metadata.width,
    height: metadata.height
  };
}

/**
 * Normalizes coordinates from screen/window coordinates to screenshot pixel coordinates
 * @param screenCoords - The original screen coordinates [x, y]
 * @param windowInfo - Information about the window (position and dimensions)
 * @param screenshotDimensions - The actual dimensions of the screenshot
 * @returns Normalized coordinates [x, y] that match the screenshot pixels
 */
export function normalizeCoordinatesToScreenshot(
  screenCoords: [number, number],
  windowInfo: WindowDimensions,
  screenshotDimensions: { width: number; height: number }
): [number, number] {
  const [screenX, screenY] = screenCoords;
  
  // Convert from global screen coordinates to window-relative coordinates
  const windowRelativeX = screenX - windowInfo.x;
  const windowRelativeY = screenY - windowInfo.y;
  
  // Calculate scaling factors between window dimensions and screenshot dimensions
  const scaleX = screenshotDimensions.width / windowInfo.width;
  const scaleY = screenshotDimensions.height / windowInfo.height;
  
  // Apply scaling to get screenshot pixel coordinates
  const normalizedX = windowRelativeX * scaleX;
  const normalizedY = windowRelativeY * scaleY;
  
  // Ensure coordinates are within screenshot bounds
  const clampedX = Math.max(0, Math.min(normalizedX, screenshotDimensions.width));
  const clampedY = Math.max(0, Math.min(normalizedY, screenshotDimensions.height));
  
  return [clampedX, clampedY];
}

/**
 * Normalizes size from window dimensions to screenshot pixel dimensions
 * @param size - The original size [width, height]
 * @param windowInfo - Information about the window (position and dimensions)
 * @param screenshotDimensions - The actual dimensions of the screenshot
 * @returns Normalized size [width, height] that matches the screenshot pixels
 */
export function normalizeSizeToScreenshot(
  size: [number, number],
  windowInfo: WindowDimensions,
  screenshotDimensions: { width: number; height: number }
): [number, number] {
  const [width, height] = size;
  
  // Calculate scaling factors between window dimensions and screenshot dimensions
  const scaleX = screenshotDimensions.width / windowInfo.width;
  const scaleY = screenshotDimensions.height / windowInfo.height;
  
  // Apply scaling to get screenshot pixel dimensions
  const normalizedWidth = width * scaleX;
  const normalizedHeight = height * scaleY;
  
  return [normalizedWidth, normalizedHeight];
}

export interface BoundingBoxOptions {
  color?: string;
  thickness?: number;
  opacity?: number;
}

export async function drawBoundingBox(
  screenshotPath: string, 
  element: A11yNode, 
  outputPath?: string,
  options: BoundingBoxOptions = {},
  windowInfo?: WindowDimensions
): Promise<string> {
  if (!element.position || !element.size) {
    throw new Error("Element must have position and size to draw bounding box");
  }

  const {
    color = 'red',
    thickness = 3,
    opacity = 0.8
  } = options;

  // Load the screenshot to get its dimensions
  const image = sharp(screenshotPath);
  const metadata = await image.metadata();
  
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not get image dimensions");
  }

  const screenshotDimensions = { width: metadata.width, height: metadata.height };
  
  console.log(`Screenshot dimensions: ${screenshotDimensions.width}x${screenshotDimensions.height}`);
  console.log(`Element screen position: [${element.position[0]}, ${element.position[1]}], size: [${element.size[0]}, ${element.size[1]}]`);
  
  let x: number, y: number, width: number, height: number;
  
  if (windowInfo) {
    console.log(`Window info: position=[${windowInfo.x}, ${windowInfo.y}], size=[${windowInfo.width}, ${windowInfo.height}]`);
    
    // Use the new normalization functions
    const [normalizedX, normalizedY] = normalizeCoordinatesToScreenshot(
      element.position, 
      windowInfo, 
      screenshotDimensions
    );
    const [normalizedWidth, normalizedHeight] = normalizeSizeToScreenshot(
      element.size, 
      windowInfo, 
      screenshotDimensions
    );
    
    x = normalizedX;
    y = normalizedY;
    width = normalizedWidth;
    height = normalizedHeight;
    
    console.log(`Normalized coordinates: [${x}, ${y}], size: [${width}, ${height}]`);
  } else {
    // Fallback: use coordinates as-is (assume they're already in screenshot space)
    [x, y] = element.position;
    [width, height] = element.size;
    console.log(`Using coordinates as-is: [${x}, ${y}], size: [${width}, ${height}]`);
  }

  // Convert color name to RGB values
  const colorMap: Record<string, [number, number, number]> = {
    red: [255, 0, 0],
    green: [0, 255, 0],
    blue: [0, 0, 255],
    yellow: [255, 255, 0],
    purple: [128, 0, 128],
    orange: [255, 165, 0],
    white: [255, 255, 255],
    black: [0, 0, 0]
  };

  const [r, g, b] = colorMap[color] || colorMap.red;

  // Create an SVG overlay for the bounding box
  const svg = `
    <svg width="${metadata.width}" height="${metadata.height}" xmlns="http://www.w3.org/2000/svg">
      <rect 
        x="${x}" 
        y="${y}" 
        width="${width}" 
        height="${height}" 
        fill="none" 
        stroke="rgb(${r}, ${g}, ${b})" 
        stroke-width="${thickness}"
        stroke-opacity="${opacity}"
      />
    </svg>
  `;

  // Composite the bounding box onto the image
  const result = await image
    .composite([{
      input: Buffer.from(svg),
      top: 0,
      left: 0
    }])
    .png();

  // Determine output path
  const finalOutputPath = outputPath || screenshotPath.replace(/\.(png|jpg|jpeg)$/i, '_annotated.png');
  
  // Save the result
  await result.toFile(finalOutputPath);
  
  return finalOutputPath;
}

export async function drawMultipleBoundingBoxes(
  screenshotPath: string,
  elements: { element: A11yNode; options?: BoundingBoxOptions }[],
  outputPath?: string,
  windowInfo?: WindowDimensions
): Promise<string> {
  // Load the screenshot
  const image = sharp(screenshotPath);
  const metadata = await image.metadata();
  
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not get image dimensions");
  }

  const screenshotDimensions = { width: metadata.width, height: metadata.height };

  // Create SVG overlays for all bounding boxes
  let svgRects = '';
  
  elements.forEach(({ element, options = {} }) => {
    if (!element.position || !element.size) return;

    const {
      color = 'red',
      thickness = 3,
      opacity = 0.8
    } = options;

    let x: number, y: number, width: number, height: number;
    
    if (windowInfo) {
      // Use the new normalization functions
      const [normalizedX, normalizedY] = normalizeCoordinatesToScreenshot(
        element.position, 
        windowInfo, 
        screenshotDimensions
      );
      const [normalizedWidth, normalizedHeight] = normalizeSizeToScreenshot(
        element.size, 
        windowInfo, 
        screenshotDimensions
      );
      
      x = normalizedX;
      y = normalizedY;
      width = normalizedWidth;
      height = normalizedHeight;
    } else {
      // Fallback: use coordinates as-is (assume they're already in screenshot space)
      [x, y] = element.position;
      [width, height] = element.size;
    }

    const colorMap: Record<string, [number, number, number]> = {
      red: [255, 0, 0],
      green: [0, 255, 0],
      blue: [0, 0, 255],
      yellow: [255, 255, 0],
      purple: [128, 0, 128],
      orange: [255, 165, 0],
      white: [255, 255, 255],
      black: [0, 0, 0]
    };

    const [r, g, b] = colorMap[color] || colorMap.red;

    svgRects += `
      <rect 
        x="${x}" 
        y="${y}" 
        width="${width}" 
        height="${height}" 
        fill="none" 
        stroke="rgba(${r}, ${g}, ${b}, ${opacity})" 
        stroke-width="${thickness}"
      />`;
  });

  const svg = `
    <svg width="${metadata.width}" height="${metadata.height}" xmlns="http://www.w3.org/2000/svg">
      ${svgRects}
    </svg>
  `;

  // Composite all bounding boxes onto the image
  const result = await image
    .composite([{
      input: Buffer.from(svg),
      top: 0,
      left: 0
    }])
    .png();

  // Determine output path
  const finalOutputPath = outputPath || screenshotPath.replace(/\.(png|jpg|jpeg)$/i, '_annotated.png');
  
  // Save the result
  await result.toFile(finalOutputPath);
  
  return finalOutputPath;
}

/**
 * Normalizes global screen coordinates to full-display screenshot pixel coordinates
 * Uses the same scaling approach as window normalization, but relative to the display.
 */
export function normalizeScreenCoordinatesToFullScreenshot(
  screenCoords: [number, number],
  displayInfo: WindowDimensions,
  screenshotDimensions: { width: number; height: number }
): [number, number] {
  const [screenX, screenY] = screenCoords;
  const displayRelativeX = screenX - displayInfo.x;
  const displayRelativeY = screenY - displayInfo.y;
  const scaleX = screenshotDimensions.width / displayInfo.width;
  const scaleY = screenshotDimensions.height / displayInfo.height;
  const normalizedX = displayRelativeX * scaleX;
  const normalizedY = displayRelativeY * scaleY;
  const clampedX = Math.max(0, Math.min(normalizedX, screenshotDimensions.width));
  const clampedY = Math.max(0, Math.min(normalizedY, screenshotDimensions.height));
  return [clampedX, clampedY];
}

export interface CircleOptions {
  color?: string;
  thickness?: number; // stroke width
  radius?: number;
  opacity?: number;
}

export async function drawCircleAtScreenCoordinatesOnFullScreenshot(
  screenshotPath: string,
  screenCoords: [number, number],
  displayInfo: WindowDimensions,
  outputPath?: string,
  options: CircleOptions = {}
): Promise<{
	finalOutputPath: string;
	cx: number;
	cy: number;
}> {
  const image = sharp(screenshotPath);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not get image dimensions");
  }
  const screenshotDimensions = { width: metadata.width, height: metadata.height };

  const {
    color = 'yellow',
    thickness = 12,
    radius = 18,
    opacity = 1
  } = options;

  const [cx, cy] = normalizeScreenCoordinatesToFullScreenshot(
    screenCoords,
    displayInfo,
    screenshotDimensions
  );

  const colorMap: Record<string, [number, number, number]> = {
    red: [255, 0, 0],
    green: [0, 255, 0],
    blue: [0, 0, 255],
    yellow: [255, 255, 0],
    purple: [128, 0, 128],
    orange: [255, 165, 0],
    white: [255, 255, 255],
    black: [0, 0, 0]
  };
  const [r, g, b] = colorMap[color] || colorMap.yellow;

  const svg = `
    <svg width="${metadata.width}" height="${metadata.height}" xmlns="http://www.w3.org/2000/svg">
      <circle 
        cx="${cx}" 
        cy="${cy}" 
        r="${radius}" 
        fill="none" 
        stroke="rgba(${r}, ${g}, ${b}, ${opacity})" 
        stroke-width="${thickness}"
      />
    </svg>
  `;

  const result = await image
    .composite([{
      input: Buffer.from(svg),
      top: 0,
      left: 0
    }])
    .png();

  const finalOutputPath = outputPath || screenshotPath.replace(/\.(png|jpg|jpeg)$/i, '_with_circle.png');
  await result.toFile(finalOutputPath);
  return {
	finalOutputPath,
	cx,
	cy
  };
}