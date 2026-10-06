import Cocoa
import WebKit
import CFNetwork
import UniformTypeIdentifiers
import Darwin

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var children: [Process] = []
    var quitting = false
    var origin = ""
    var ttsPort: UInt16 = 0
    let smoke = CommandLine.arguments.contains("--smoke-test")
    var smokeStarted = false
    var smokeDeadline = Date().addingTimeInterval(140)
    var timer: Timer?
    let resources = Bundle.main.resourceURL!
    var full: Bool { FileManager.default.fileExists(atPath: resources.appendingPathComponent("kokoro/kokoro-mlx").path) }
    var state: URL {
        if smoke { return FileManager.default.temporaryDirectory.appendingPathComponent("ChainFlow-smoke-\(ProcessInfo.processInfo.processIdentifier)") }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(full ? "ChainFlow AI Sheets Full" : "ChainFlow AI Sheets Lite")
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        menu()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = smoke ? .nonPersistent() : .default()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self; web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 820), styleMask: [.titled,.closable,.miniaturizable,.resizable], backing: .buffered, defer: false)
        window.title = full ? "ChainFlow AI Sheets · MLX" : "ChainFlow AI Sheets · Lite"
        window.minSize = NSSize(width: 720, height: 480); window.contentView = web; window.delegate = self; window.center(); window.makeKeyAndOrderFront(nil)
        web.loadHTMLString("<meta charset='utf-8'><style>body{font:18px -apple-system;padding:64px;color:#25364a}small{color:#64748b}</style><h1>ChainFlow AI Sheets</h1><p>正在启动应用…</p><small>首次打开可能需要稍等片刻。内置朗读模型按需启用。</small>", baseURL: nil)
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.global(qos: .userInitiated).async {
            do { try self.start(); DispatchQueue.main.async { self.web.load(URLRequest(url: URL(string:self.origin)!)); if self.smoke { self.timer = Timer.scheduledTimer(withTimeInterval:0.5,repeats:true) { _ in self.checkSmoke() } } } }
            catch { DispatchQueue.main.async { self.fail("无法启动应用。端口可能已被其他程序使用，或安装包不完整。请退出后重新打开。") } }
        }
    }
    func menu() {
        let root=NSMenu(); let item=NSMenuItem(); root.addItem(item); let app=NSMenu(); item.submenu=app
        app.addItem(withTitle:"关于 ChainFlow AI Sheets",action:#selector(about),keyEquivalent:"")
        app.addItem(.separator()); app.addItem(withTitle:"退出 ChainFlow AI Sheets",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
        let editItem=NSMenuItem(); root.addItem(editItem); let edit=NSMenu(title:"编辑"); editItem.submenu=edit
        for (title,action,key) in [("撤销","undo:","z"),("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")] {edit.addItem(withTitle:title,action:NSSelectorFromString(action),keyEquivalent:key)}
        NSApp.mainMenu=root
    }
    @objc func about() { let alert=NSAlert(); alert.messageText="ChainFlow AI Sheets 0.2.0"; alert.informativeText="\(full ? "完整版 · Apple Silicon MLX/Metal 朗读" : "精简版 · 第三方 TTS")\n未签名、未公证测试版。表格保存在此应用；API 使用自己的密钥，Agent 首次使用需登录 ChatGPT。"; alert.runModal() }
    func sparePort() throws -> UInt16 {
        let fd=socket(AF_INET,SOCK_STREAM,0); if fd<0 {throw NSError(domain:"socket",code:1)}; defer{close(fd)}
        var address=sockaddr_in(); address.sin_len=UInt8(MemoryLayout<sockaddr_in>.size); address.sin_family=sa_family_t(AF_INET); address.sin_addr.s_addr=inet_addr("127.0.0.1"); address.sin_port=0
        let result=withUnsafePointer(to:&address){p in p.withMemoryRebound(to:sockaddr.self,capacity:1){Darwin.bind(fd,$0,socklen_t(MemoryLayout<sockaddr_in>.size))}}
        if result != 0 {throw NSError(domain:"bind",code:1)}
        var size=socklen_t(MemoryLayout<sockaddr_in>.size); _=withUnsafeMutablePointer(to:&address){p in p.withMemoryRebound(to:sockaddr.self,capacity:1){getsockname(fd,$0,&size)}}
        return UInt16(bigEndian:address.sin_port)
    }
    func start() throws {
        try FileManager.default.createDirectory(at:state,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        var env:[String:String] = ["HOME":NSHomeDirectory(),"PATH":"/usr/bin:/bin:/usr/sbin:/sbin","LANG":"en_US.UTF-8","NODE_ENV":"production","NEXT_TELEMETRY_DISABLED":"1","CHAINFLOW_PARENT_PID":String(ProcessInfo.processInfo.processIdentifier),"CHAINFLOW_DESKTOP_STATE":state.path]
        if let settings=CFNetworkCopySystemProxySettings()?.takeRetainedValue() as? [String:Any] {
            for prefix in ["HTTPS","HTTP"] {if (settings[prefix+"Enable"] as? Int)==1,let host=settings[prefix+"Proxy"] as? String, ["127.0.0.1","localhost"].contains(host),let port=settings[prefix+"Port"] as? Int {env["CHAINFLOW_HTTP_PROXY"]="http://\(host):\(port)";break}}
        }
        #if arch(arm64)
        let arch="arm64"
        #else
        let arch="x64"
        #endif
        env["CHAINFLOW_CODEX_BIN"]=resources.appendingPathComponent("codex-\(arch)").path
        if full {
            env["CHAINFLOW_BUNDLED_KOKORO"]="1"
        }
        let port = smoke ? Int(try sparePort()) : (full ? 3005 : 3004)
        origin="http://127.0.0.1:\(port)";env["PORT"]=String(port)
        try child(resources.appendingPathComponent("node-\(arch)"),args:["dist-docker/desktop.mjs"],env:env)
        if !wait(origin+"/healthz",seconds:40){throw NSError(domain:"server",code:1)}
    }
    func child(_ url:URL,args:[String],env:[String:String]) throws {
        let task=Process();task.executableURL=url;task.arguments=args;task.currentDirectoryURL=resources;task.environment=env
        // No request, provider, credential or model text enters a persistent log.
        task.standardOutput=FileHandle.nullDevice;task.standardError=FileHandle.nullDevice
        task.terminationHandler={_ in DispatchQueue.main.async {if !self.quitting {self.fail("后台服务已停止，请退出并重新打开应用。")}}}
        try task.run();children.append(task)
    }
    func wait(_ url:String,seconds:Int)->Bool {
        let deadline=Date().addingTimeInterval(TimeInterval(seconds))
        while Date()<deadline {
            if children.contains(where:{!$0.isRunning}) {return false}
            let gate=DispatchSemaphore(value:0);var ok=false
            var request=URLRequest(url:URL(string:url)!);request.timeoutInterval=0.5;request.cachePolicy = .reloadIgnoringLocalCacheData
            URLSession.shared.dataTask(with:request){_,response,_ in ok=(response as? HTTPURLResponse)?.statusCode==200;gate.signal()}.resume()
            _=gate.wait(timeout:.now()+1);if ok{return true};Thread.sleep(forTimeInterval:0.2)
        };return false
    }
    func fail(_ message:String){if quitting{return};if smoke{print("SMOKE_FAILED");NSApp.terminate(nil);return};let alert=NSAlert();alert.messageText="ChainFlow 启动失败";alert.informativeText=message;alert.runModal();NSApp.terminate(nil)}
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool {true}
    func applicationWillTerminate(_ notification:Notification){quitting=true;timer?.invalidate();for p in children.reversed(){if p.isRunning{p.terminate()}};let deadline=Date().addingTimeInterval(5);while children.contains(where:{$0.isRunning})&&Date()<deadline{Thread.sleep(forTimeInterval:0.05)};for p in children where p.isRunning{kill(p.processIdentifier,SIGKILL)};if smoke{try? FileManager.default.removeItem(at:state)}}
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
        guard let url=action.request.url else{decisionHandler(.cancel);return}
        if action.shouldPerformDownload {decisionHandler(.download);return}
        if url.absoluteString.hasPrefix(origin+"/")||["about","blob"].contains(url.scheme ?? ""){decisionHandler(.allow);return}
        if ["https","http"].contains(url.scheme ?? ""){NSWorkspace.shared.open(url)};decisionHandler(.cancel)
    }
    func webView(_ webView:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for action:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView?{if let url=action.request.url,url.scheme=="https"{NSWorkspace.shared.open(url)};return nil}
    func webView(_ webView:WKWebView,runOpenPanelWith parameters:WKOpenPanelParameters,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping([URL]?)->Void){let panel=NSOpenPanel();panel.allowedContentTypes=[.json];panel.allowsMultipleSelection=false;panel.beginSheetModal(for:window){result in completionHandler(result == .OK ? panel.urls:nil)}}
    func webView(_ webView:WKWebView,navigationAction:WKNavigationAction,didBecome download:WKDownload){download.delegate=self}
    func webView(_ webView:WKWebView,navigationResponse:WKNavigationResponse,didBecome download:WKDownload){download.delegate=self}
    func download(_ download:WKDownload,decideDestinationUsing response:URLResponse,suggestedFilename:String,completionHandler:@escaping(URL?)->Void){let panel=NSSavePanel();panel.nameFieldStringValue=suggestedFilename;panel.beginSheetModal(for:window){result in completionHandler(result == .OK ? panel.url:nil)}}
    func checkSmoke(){
        if Date()>smokeDeadline{fail("Smoke timeout");return};if smokeStarted{return}
        web.evaluateJavaScript("document.querySelector('[data-ready]')?.dataset.ready === 'true'"){value,error in
            guard value as? Bool==true else{return};self.smokeStarted=true
            let test="""
            (async()=>{const caps=await(await fetch('/api/capabilities')).json();const agent=await fetch('/api/local-agent/status',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const agentData=await agent.json();const uiOnly=\(CommandLine.arguments.contains("--smoke-tts-ui") ? "true" : "false");const waitFor=async fn=>{for(let i=0;i<200;i++){const found=fn();if(found)return found;await new Promise(ok=>setTimeout(ok,30));}throw Error('UI timeout');};if(caps.builtinTts&&uiOnly){Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('配置 TTS')).click();const enable=await waitFor(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='启用内置模型'&&!b.disabled));enable.click();await waitFor(()=>document.querySelector('[role="alert"]')?.textContent.includes('900'));const box=document.querySelector('.memory-choice input');if(!box||box.checked)throw Error('Consent default wrong');document.querySelector('[role="alert"]').scrollIntoView({block:'center'});}let speech=null;if(caps.builtinTts&&!uiOnly){const before=await(await fetch('/api/local-tts/runtime',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'inspect'})})).json();if(before.loaded||before.autoLoad)throw Error('Default model loaded');const load=await fetch('/api/local-tts/runtime',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'load',autoLoad:false,acceptedMemoryWarning:true})});if(!load.ok)throw Error('Load failed');const r=await fetch('/api/local-tts/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'builtin',model:'kokoro',input:'写真をフレームに入れました。',language:'ja',voice:'jf_alpha',speed:1})});const b=await r.arrayBuffer();speech={status:r.status,bytes:b.byteLength,wave:String.fromCharCode(...new Uint8Array(b,8,4))};}return JSON.stringify({caps,uiWarning:uiOnly?document.querySelector('[role="alert"]')?.textContent:null,agent:{status:agent.status,code:agentData.error?.code},speech,rows:document.querySelectorAll('tbody tr').length,ready:document.querySelector('[data-ready]').dataset.ready});})()
            """
            self.web.callAsyncJavaScript("return await "+test,arguments:[:],in:nil,in:.page){result in
                switch result{case .success(let data):print("SMOKE_RESULT \(data)");case .failure:print("SMOKE_FAILED_WEBKIT")}
                if let i=CommandLine.arguments.firstIndex(of:"--smoke-screenshot"),CommandLine.arguments.count>i+1 {
                    self.web.takeSnapshot(with:nil){image,_ in
                        if let tiff=image?.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff),let png=bitmap.representation(using:.png,properties:[:]) {try? png.write(to:URL(fileURLWithPath:CommandLine.arguments[i+1]))}
                        NSApp.terminate(nil)
                    }
                } else {NSApp.terminate(nil)}
            }
        }
    }
}
let application=NSApplication.shared
let delegate=AppDelegate();application.delegate=delegate;application.run()
