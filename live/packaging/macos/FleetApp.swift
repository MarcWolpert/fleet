// SPDX-License-Identifier: GPL-3.0-or-later
// Fleet for macOS: a native window around Fleet Live.
//
// On launch it uses a Fleet Live server already listening on 127.0.0.1:4518, or starts the one
// bundled in Contents/Resources/live with the first Python 3.11+ it finds. Quitting stops only a
// server it started (which saves its state and closes its SSH sessions on the way out).
import Cocoa
import WebKit

let port = 4518
let base = "http://127.0.0.1:\(port)/"

/// The page's space bar doubles as the title bar: clicks on its empty parts drag the window (and a
/// double-click zooms or minimizes, per the system setting); clicks on its pills and buttons go to the page.
final class FleetWebView: WKWebView {
    var band: CGFloat = 52
    var regions: [NSRect] = []
    override func mouseDown(with e: NSEvent) {
        let p = convert(e.locationInWindow, from: nil)
        let y = isFlipped ? p.y : bounds.height - p.y
        if titleBarDrags(NSPoint(x: p.x, y: y), band: band, regions: regions, zoom: pageZoom) {
            if e.clickCount == 2 {
                switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize" {
                case "Minimize": window?.performMiniaturize(nil)
                case "None": break
                default: window?.performZoom(nil)
                }
            } else {
                window?.performDrag(with: e)
            }
            return
        }
        super.mouseDown(with: e)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: FleetWebView!
    var server: Process?
    var tries = 0

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        if !serverAnswers() { startServer() }
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        cfg.userContentController.add(self, name: "fleet")
        web = FleetWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")  // no white flash before the page paints
        let z = UserDefaults.standard.double(forKey: "FleetZoom")
        if z >= 0.5 && z <= 2.5 { web.pageZoom = CGFloat(z) }
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1500, height: 950),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "Fleet"
        // One bar, like herdr: no separate title strip; a unified toolbar makes the title bar 52 pt tall
        // so the traffic lights sit centred in the page's space bar.
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        let toolbar = NSToolbar(identifier: "FleetBar")
        toolbar.showsBaselineSeparator = false
        window.toolbar = toolbar
        window.toolbarStyle = .unified
        // the theme's frame colour (the page sends it whenever the theme changes), so nothing flashes
        window.backgroundColor = NSColor(fleetHex: UserDefaults.standard.string(forKey: "FleetThemeBG") ?? "")
            ?? NSColor(calibratedRed: 0.078, green: 0.078, blue: 0.086, alpha: 1)
        if UserDefaults.standard.object(forKey: "FleetThemeDark") != nil {
            window.appearance = NSAppearance(named: UserDefaults.standard.bool(forKey: "FleetThemeDark") ? .darkAqua : .aqua)
        }
        window.minSize = NSSize(width: 760, height: 520)
        window.contentView = web
        window.setFrameAutosaveName("FleetMainWindow")
        if !window.setFrameUsingName("FleetMainWindow") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        load()
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let d = m.body as? [String: Any] else { return }
        if let b = d["band"] as? Double { web.band = CGFloat(b) }
        if let bg = d["bg"] as? String, let c = NSColor(fleetHex: bg) {
            window.backgroundColor = c
            UserDefaults.standard.set(bg, forKey: "FleetThemeBG")
        }
        if let dark = d["dark"] as? Bool {
            window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)  // traffic lights, scroll bars, file panels
            UserDefaults.standard.set(dark, forKey: "FleetThemeDark")
        }
        if let z = d["zoom"] as? String { zoom(z) }
        if let rs = d["regions"] as? [[Double]] {
            web.regions = rs.filter { $0.count == 4 }.map { NSRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
        }
    }

    func load() { web.load(URLRequest(url: URL(string: base + "?native=1")!)) }

    // The server can take a moment to start (or to restart after a settings change): keep trying.
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { retry() }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { retry() }
    func retry() {
        tries += 1
        if tries == 6 && server == nil && !serverAnswers() { startServer() }  // ~3 s without a server: run our own
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.load() }
    }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { tries = 0 }

    func serverAnswers() -> Bool {
        var ok = false
        let done = DispatchSemaphore(value: 0)
        var req = URLRequest(url: URL(string: base + "api/fleet")!)
        req.timeoutInterval = 1.5
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            ok = (resp as? HTTPURLResponse)?.statusCode == 200
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 2)
        return ok
    }

    func findPython() -> String? {
        for p in ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/opt/local/bin/python3", "/usr/bin/python3"]
        where FileManager.default.isExecutableFile(atPath: p) {
            let t = Process()
            t.executableURL = URL(fileURLWithPath: p)
            t.arguments = ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"]
            t.standardOutput = FileHandle.nullDevice
            t.standardError = FileHandle.nullDevice
            if (try? t.run()) != nil {
                t.waitUntilExit()
                if t.terminationStatus == 0 { return p }
            }
        }
        return nil
    }

    func startServer() {
        guard let py = findPython() else {
            let a = NSAlert()
            a.messageText = "Fleet needs Python 3.11 or newer"
            a.informativeText = "Install it with Homebrew (brew install python) and open Fleet again."
            a.runModal()
            NSApp.terminate(nil)
            return
        }
        let script = Bundle.main.resourceURL!.appendingPathComponent("live/fleet_live.py").path
        let p = Process()
        p.executableURL = URL(fileURLWithPath: py)
        p.arguments = [script, "--port", "\(port)", "--no-watch"]
        var env = ProcessInfo.processInfo.environment  // apps opened from Finder get a short PATH
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + (env["PATH"] ?? "")
        p.environment = env
        let log = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Fleet.log")
        FileManager.default.createFile(atPath: log.path, contents: nil)
        if let h = try? FileHandle(forWritingTo: log) { p.standardOutput = h; p.standardError = h }
        if (try? p.run()) != nil { server = p }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ n: Notification) {
        guard let p = server, p.isRunning else { return }
        p.terminate()  // SIGTERM: the server saves its state and stops its SSH sessions
        let deadline = Date().addingTimeInterval(3)
        while p.isRunning && Date() < deadline { usleep(50_000) }
    }

    // Links that want a new window open in the default browser.
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction,
                 windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { NSWorkspace.shared.open(u) }
        return nil
    }

    // <input type="file"> (Settings → Import theme): WebKit asks the app to show the open panel.
    func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo,
                 completionHandler done: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = p.allowsMultipleSelection
        panel.beginSheetModal(for: window) { r in done(r == .OK ? panel.urls : nil) }
    }

    @objc func reloadPage(_ s: Any?) { web.reload() }

    // Text size (⌘+ ⌘− ⌘0), kept for next time.
    static let zoomSteps: [CGFloat] = [0.67, 0.75, 0.85, 0.92, 1.0, 1.1, 1.2, 1.35, 1.5, 1.7, 2.0]
    func zoom(_ how: String) {
        let cur = web.pageZoom, steps = AppDelegate.zoomSteps
        var next: CGFloat = 1.0
        if how == "in" { next = steps.first(where: { $0 > cur + 0.001 }) ?? steps.last! }
        if how == "out" { next = steps.last(where: { $0 < cur - 0.001 }) ?? steps.first! }
        web.pageZoom = next
        UserDefaults.standard.set(Double(next), forKey: "FleetZoom")
    }
    @objc func zoomIn(_ s: Any?) { zoom("in") }
    @objc func zoomOut(_ s: Any?) { zoom("out") }
    @objc func zoomReset(_ s: Any?) { zoom("reset") }
    // Menu commands the page carries out (the same ones as its keyboard shortcuts).
    @objc func pageCommand(_ s: NSMenuItem) {
        guard let c = s.representedObject as? String else { return }
        web.evaluateJavaScript("window.fleetCommand && window.fleetCommand(\(c))", completionHandler: nil)
    }
    func cmdItem(_ title: String, _ js: String, _ key: String, _ mods: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: #selector(pageCommand(_:)), keyEquivalent: key)
        i.keyEquivalentModifierMask = mods
        i.representedObject = js
        i.target = self
        return i
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Fleet", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(cmdItem("Settings…", "'settings'", ","))
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Fleet", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Fleet", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        // Edit: copy, paste and select-all in the settings fields and the process filter.
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View")
        view.addItem(cmdItem("Go to…", "'goto'", "k"))
        view.addItem(cmdItem("Find", "'find'", "f"))
        view.addItem(cmdItem("Back", "'back'", "["))
        view.addItem(cmdItem("Forward", "'fwd'", "]"))
        view.addItem(cmdItem("Details", "'details'", "d"))
        view.addItem(cmdItem("Dock Details", "'dock'", "d", [.command, .shift]))
        view.addItem(.separator())
        for (i, (t, k)) in [("CPU", "cpu"), ("Memory", "mem"), ("GPU", "gpu"), ("Disk I/O", "disk"), ("Network", "net")].enumerated() {
            view.addItem(cmdItem(t, "'metric', '\(k)'", "\(i + 1)", [.option]))
        }
        view.addItem(.separator())
        view.addItem(withTitle: "Actual Size", action: #selector(zoomReset(_:)), keyEquivalent: "0")
        view.addItem(withTitle: "Zoom In", action: #selector(zoomIn(_:)), keyEquivalent: "+")
        view.addItem(withTitle: "Zoom Out", action: #selector(zoomOut(_:)), keyEquivalent: "-")
        view.addItem(.separator())
        view.addItem(withTitle: "Reload", action: #selector(reloadPage(_:)), keyEquivalent: "r")
        viewItem.submenu = view
        let spaceItem = NSMenuItem(); main.addItem(spaceItem)
        let spaces = NSMenu(title: "Spaces")
        spaces.addItem(cmdItem("Previous Space", "'space-step', -1", "{"))
        spaces.addItem(cmdItem("Next Space", "'space-step', 1", "}"))
        spaces.addItem(.separator())
        spaces.addItem(cmdItem("All Machines", "'space', 0", "1"))
        for n in 2...9 { spaces.addItem(cmdItem("Space \(n)", "'space', \(n - 1)", "\(n)")) }
        spaces.addItem(.separator())
        spaces.addItem(cmdItem("New Space…", "'newspace'", "n"))
        spaces.addItem(cmdItem("Pin or Unpin Selection (P)", "'pin'", ""))  // a bare P in the page; a menu key would fire while typing
        spaces.addItem(cmdItem("Open Terminal on Selection", "'terminal'", "t"))
        spaceItem.submenu = spaces
        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winItem.submenu = win
        let helpItem = NSMenuItem(); main.addItem(helpItem)
        let help = NSMenu(title: "Help")
        help.addItem(cmdItem("Keyboard Shortcuts", "'keys'", "/"))
        helpItem.submenu = help
        NSApp.mainMenu = main
        NSApp.helpMenu = help
        NSApp.windowsMenu = win
    }
}

extension NSColor {
    /// "#rrggbb" → a colour; anything else → nil
    convenience init?(fleetHex s: String) {
        let h = s.hasPrefix("#") ? String(s.dropFirst()) : s
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
