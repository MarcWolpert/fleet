// SPDX-License-Identifier: GPL-3.0-or-later
// The space bar doubles as the window's title bar. The page reports where its pills and buttons are;
// a click anywhere else in the band drags the window.
import CoreGraphics
import Foundation

/// Whether a click at `pt` (the web view's points, top-left origin) lands on the space bar's empty
/// part. `band` and `regions` are the page's, in CSS pixels; at a page zoom other than 100% (Cmd+,
/// Cmd-) a CSS pixel is `zoom` points, so the click is compared in CSS pixels.
func titleBarDrags(_ pt: NSPoint, band: CGFloat, regions: [NSRect], zoom: CGFloat) -> Bool {
    let z = zoom > 0 ? zoom : 1
    let p = NSPoint(x: pt.x / z, y: pt.y / z)
    return p.y <= band && !regions.contains(where: { $0.insetBy(dx: -2, dy: -2).contains(p) })
}
