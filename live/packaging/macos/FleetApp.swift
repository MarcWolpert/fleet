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

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var server: Process?
    var tries = 0

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        if !serverAnswers() { startServer() }
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")  // no white flash before the page paints
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1500, height: 950),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Fleet"
        window.backgroundColor = NSColor(calibratedRed: 0.078, green: 0.078, blue: 0.086, alpha: 1)
        window.minSize = NSSize(width: 760, height: 520)
        window.contentView = web
        window.setFrameAutosaveName("FleetMainWindow")
        if !window.setFrameUsingName("FleetMainWindow") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        load()
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

    @objc func reloadPage(_ s: Any?) { web.reload() }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Fleet", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
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
        view.addItem(withTitle: "Reload", action: #selector(reloadPage(_:)), keyEquivalent: "r")
        viewItem.submenu = view
        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winItem.submenu = win
        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
