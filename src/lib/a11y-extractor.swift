import Cocoa
import ApplicationServices

struct A11yNode: Codable {
    var role: String?
    var title: String?
    var description: String?
    var value: String?
    var roleDescription: String?
    var identifier: String?
    var position: CGPoint?
    var size: CGSize?
    var enabled: Bool?
    var focused: Bool?
    var selected: Bool?
    var children: [A11yNode]?
}

struct WindowDimensions: Codable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double
}

struct A11yResult: Codable {
    var window: WindowDimensions
    var a11y: A11yNode
    var screenshot: String
}

struct FullScreenshotResult: Codable {
    var display: WindowDimensions
    var screenshot: String
}

class A11yExtractor {
    static func extractTree(from element: AXUIElement, depth: Int = 0, maxDepth: Int = 15) -> A11yNode? {
        if depth > maxDepth {
            return nil
        }
        
        var node = A11yNode()
        
        // Extract role
        if let role = getAttribute(element, attribute: kAXRoleAttribute) as? String {
            node.role = role
        }
        
        // Extract title
        if let title = getAttribute(element, attribute: kAXTitleAttribute) as? String {
            node.title = title
        }
        
        // Extract description
        if let description = getAttribute(element, attribute: kAXDescriptionAttribute) as? String {
            node.description = description
        }
        
        // Extract value
        if let value = getAttribute(element, attribute: kAXValueAttribute) {
            node.value = String(describing: value)
        }
        
        // Extract role description
        if let roleDescription = getAttribute(element, attribute: kAXRoleDescriptionAttribute) as? String {
            node.roleDescription = roleDescription
        }
        
        // Extract identifier
        if let identifier = getAttribute(element, attribute: kAXIdentifierAttribute) as? String {
            node.identifier = identifier
        }
        
        // Extract position
        if let positionValue = getAttribute(element, attribute: kAXPositionAttribute) {
            var position = CGPoint.zero
            AXValueGetValue(positionValue as! AXValue, .cgPoint, &position)
            node.position = position
        }
        
        // Extract size
        if let sizeValue = getAttribute(element, attribute: kAXSizeAttribute) {
            var size = CGSize.zero
            AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
            node.size = size
        }
        
        // Extract enabled state
        if let enabled = getAttribute(element, attribute: kAXEnabledAttribute) as? Bool {
            node.enabled = enabled
        }
        
        // Extract focused state
        if let focused = getAttribute(element, attribute: kAXFocusedAttribute) as? Bool {
            node.focused = focused
        }
        
        // Extract selected state
        if let selected = getAttribute(element, attribute: kAXSelectedAttribute) as? Bool {
            node.selected = selected
        }
        
        // Extract children
        if let children = getAttribute(element, attribute: kAXChildrenAttribute) as? [AXUIElement] {
            node.children = children.compactMap { child in
                extractTree(from: child, depth: depth + 1, maxDepth: maxDepth)
            }
        }
        
        return node
    }
    
    static func getAttribute(_ element: AXUIElement, attribute: String) -> AnyObject? {
        var value: AnyObject?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        if result == .success {
            return value
        }
        return nil
    }
    
    static func getAllWindows() -> [(appName: String, windowTitle: String, element: AXUIElement)] {
        let runningApps = NSWorkspace.shared.runningApplications
        var allWindows: [(appName: String, windowTitle: String, element: AXUIElement)] = []
        
        for app in runningApps {
            guard app.activationPolicy == .regular else { continue }
            guard let appName = app.localizedName else { continue }
            
            let appElement = AXUIElementCreateApplication(app.processIdentifier)
            
            // Get windows for this application
            if let windows = getAttribute(appElement, attribute: kAXWindowsAttribute) as? [AXUIElement] {
                for window in windows {
                    if let title = getAttribute(window, attribute: kAXTitleAttribute) as? String {
                        // Skip empty titles and non-standard windows
                        if !title.isEmpty && title != "Item-0" {
                            allWindows.append((appName: appName, windowTitle: title, element: window))
                        }
                    }
                }
            }
        }
        
        return allWindows.sorted { $0.appName.lowercased() < $1.appName.lowercased() }
    }
    
    static func getWindowDimensions(from element: AXUIElement) -> WindowDimensions? {
        var position = CGPoint.zero
        var size = CGSize.zero
        
        // Get position
        if let positionValue = getAttribute(element, attribute: kAXPositionAttribute) {
            AXValueGetValue(positionValue as! AXValue, .cgPoint, &position)
        }
        
        // Get size
        if let sizeValue = getAttribute(element, attribute: kAXSizeAttribute) {
            AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
        }
        
        return WindowDimensions(
            x: Double(position.x),
            y: Double(position.y),
            width: Double(size.width),
            height: Double(size.height)
        )
    }
    
    static func captureWindowScreenshotAsBase64(from element: AXUIElement) -> String? {
        // Use coordinates-based capture with screencapture command
        guard let dimensions = getWindowDimensions(from: element) else {
            return nil
        }
        
        return captureWindowByCoordinatesAsBase64(dimensions: dimensions)
    }
    
    static func captureWindowByCoordinatesAsBase64(dimensions: WindowDimensions) -> String? {
        let tempFile = "/tmp/window_screenshot_\(ProcessInfo.processInfo.processIdentifier).png"
        
        // Create region string for screencapture
        let region = "\(Int(dimensions.x)),\(Int(dimensions.y)),\(Int(dimensions.width)),\(Int(dimensions.height))"
        
        let task = Process()
        task.launchPath = "/usr/sbin/screencapture"
        task.arguments = ["-R", region, "-x", tempFile]
        
        task.launch()
        task.waitUntilExit()
        
        if task.terminationStatus == 0 {
            // Read the captured file and convert to base64
            if let imageData = NSData(contentsOfFile: tempFile) {
                // Clean up temp file
                try? FileManager.default.removeItem(atPath: tempFile)
                return imageData.base64EncodedString()
            }
        }
        
        // Clean up temp file on failure
        try? FileManager.default.removeItem(atPath: tempFile)
        return nil
    }
    
    static func getMainScreenDimensions() -> WindowDimensions? {
        guard let screen = NSScreen.main else {
            return nil
        }
        let frame = screen.frame
        return WindowDimensions(
            x: 0,
            y: 0,
            width: Double(frame.width),
            height: Double(frame.height)
        )
    }
    
    static func captureFullDisplayScreenshotAsBase64() -> String? {
        let tempFile = "/tmp/full_screenshot_\(ProcessInfo.processInfo.processIdentifier).png"
        let task = Process()
        task.launchPath = "/usr/sbin/screencapture"
        task.arguments = ["-x", tempFile]
        
        task.launch()
        task.waitUntilExit()
        
        if task.terminationStatus == 0 {
            if let imageData = NSData(contentsOfFile: tempFile) {
                try? FileManager.default.removeItem(atPath: tempFile)
                return imageData.base64EncodedString()
            }
        }
        
        try? FileManager.default.removeItem(atPath: tempFile)
        return nil
    }
    
    static func findWindow(withTitle searchTitle: String) -> AXUIElement? {
        let allWindows = getAllWindows()
        
        for window in allWindows {
            if window.windowTitle.lowercased().contains(searchTitle.lowercased()) {
                return window.element
            }
        }
        
        return nil
    }
    
    static func focusWindow(_ element: AXUIElement) -> Bool {
        // First, try to raise the window using AXRaise action
        let raiseResult = AXUIElementPerformAction(element, kAXRaiseAction as CFString)
        
        // Get the process ID directly from the window element
        var pid: pid_t = 0
        let pidResult = AXUIElementGetPid(element, &pid)
        
        if pidResult == .success {
            // Get the NSRunningApplication for this process
            if let runningApp = NSRunningApplication(processIdentifier: pid) {
                // Activate the application (bring it to front)
                // Use the newer API without deprecated options
                let activateResult = runningApp.activate()
                
                // Also try to focus the specific window
                let focusResult = AXUIElementPerformAction(element, kAXRaiseAction as CFString)
                
                return activateResult && (raiseResult == .success || focusResult == .success)
            }
        }
        
        return raiseResult == .success
    }
}

func main() {
    // Check if we have accessibility permissions
    if !AXIsProcessTrusted() {
        // Open System Settings directly to Privacy & Security > Accessibility
        let workspace = NSWorkspace.shared
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            workspace.open(url)
        }
        
        print("{\"error\": \"Accessibility permissions required. System Settings has been opened to the Accessibility page. Please grant permissions to your terminal app and try again.\", \"needsPermission\": true}")
        exit(1)
    }
    
    // Get the window title from command line arguments
    let arguments = CommandLine.arguments
    guard arguments.count > 1 else {
        print("{\"error\": \"Please provide a window title as an argument\"}")
        exit(1)
    }
    
    let windowTitle = arguments[1]
    
    // Handle special case for focusing a window
    if arguments.count > 2 && arguments[1].lowercased() == "--focus" {
        let focusWindowTitle = arguments[2]
        
        guard let window = A11yExtractor.findWindow(withTitle: focusWindowTitle) else {
            print("{\"success\": false, \"error\": \"Window with title containing '\(focusWindowTitle)' not found\"}")
            exit(1)
        }
        
        let focusSuccess = A11yExtractor.focusWindow(window)
        print("{\"success\": \(focusSuccess)}")
        exit(focusSuccess ? 0 : 1)
    }
    
    // Handle special case for listing all windows
    if windowTitle.lowercased() == "--list" || windowTitle.lowercased() == "list" {
        let allWindows = A11yExtractor.getAllWindows()
        
        var windowList: [[String: String]] = []
        for window in allWindows {
            windowList.append([
                "app": window.appName,
                "title": window.windowTitle
            ])
        }
        
        let result = ["availableWindows": windowList]
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        
        do {
            let jsonData = try encoder.encode(result)
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                print(jsonString)
            }
        } catch {
            print("{\"error\": \"Failed to encode window list: \(error)\"}")
        }
        exit(0)
    }
    
    // Handle full display screenshot capture
    if windowTitle.lowercased() == "--full-screenshot" {
        guard let display = A11yExtractor.getMainScreenDimensions(),
              let screenshotBase64 = A11yExtractor.captureFullDisplayScreenshotAsBase64() else {
            print("{\"error\": \"Failed to capture full display screenshot\"}")
            exit(1)
        }
        
        let result = FullScreenshotResult(display: display, screenshot: screenshotBase64)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        
        do {
            let jsonData = try encoder.encode(result)
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                print(jsonString)
            }
        } catch {
            print("{\"error\": \"Failed to encode full screenshot result: \(error)\"}")
            exit(1)
        }
        exit(0)
    }
    
    // Find the window
    guard let window = A11yExtractor.findWindow(withTitle: windowTitle) else {
        // Get all available windows to show suggestions
        let allWindows = A11yExtractor.getAllWindows()
        var availableWindows: [[String: String]] = []
        
        for window in allWindows {
            availableWindows.append([
                "app": window.appName,
                "title": window.windowTitle
            ])
        }
        
        let errorResponse = [
            "error": "Window with title containing '\(windowTitle)' not found",
            "availableWindows": availableWindows
        ] as [String: Any]
        
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: errorResponse, options: [.prettyPrinted, .sortedKeys])
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                print(jsonString)
            }
        } catch {
            print("{\"error\": \"Window with title containing '\(windowTitle)' not found\"}")
        }
        exit(1)
    }
    
    // Focus the window before processing
    let focusSuccess = A11yExtractor.focusWindow(window)
    if !focusSuccess {
        // Continue anyway, but log a warning in the result
        // We'll add this to the result structure later
    }
    
    // Extract window dimensions
    guard let windowDimensions = A11yExtractor.getWindowDimensions(from: window) else {
        print("{\"error\": \"Failed to extract window dimensions\"}")
        exit(1)
    }
    
    // Capture screenshot as base64
    let screenshotBase64 = A11yExtractor.captureWindowScreenshotAsBase64(from: window) ?? ""
    
    // Extract the accessibility tree
    if let tree = A11yExtractor.extractTree(from: window) {
        let result = A11yResult(window: windowDimensions, a11y: tree, screenshot: screenshotBase64)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        
        do {
            let jsonData = try encoder.encode(result)
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                print(jsonString)
            }
        } catch {
            print("{\"error\": \"Failed to encode accessibility result: \(error)\"}")
            exit(1)
        }
    } else {
        print("{\"error\": \"Failed to extract accessibility tree\"}")
        exit(1)
    }
}

main()