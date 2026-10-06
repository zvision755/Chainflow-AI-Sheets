import Cocoa
let size=1024
let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:size,pixelsHigh:size,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:rep)
NSColor(calibratedRed:0.12,green:0.30,blue:0.93,alpha:1).setFill();NSBezierPath(roundedRect:NSRect(x:32,y:32,width:960,height:960),xRadius:215,yRadius:215).fill()
for n in 0..<3 {NSColor.white.withAlphaComponent(1-Double(n)*0.23).setFill();NSBezierPath(roundedRect:NSRect(x:225+55*n,y:590-175*n,width:470,height:125),xRadius:35,yRadius:35).fill()}
NSGraphicsContext.restoreGraphicsState();try rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
