#import <Cocoa/Cocoa.h>
#include <dlfcn.h>
#include <stdio.h>

// Optional real-WebKit smoke test; requires a macOS GUI login, but no installed game.
int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc != 2) return 2;
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 320, 240)
      styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    [window orderBack:nil];
    void *library = dlopen(argv[1], RTLD_NOW);
    if (!library) { fprintf(stderr, "%s\n", dlerror()); return 2; }
    auto create = (int (*)(const char *, const char *))dlsym(library, "chaya_overlay_create");
    auto poll = (int (*)(char *, int))dlsym(library, "chaya_overlay_poll");
    auto evaluate = (void (*)(const char *))dlsym(library, "chaya_overlay_eval");
    auto dispose = (void (*)())dlsym(library, "chaya_overlay_dispose");
    if (!create || !poll || !evaluate || !dispose) return 2;
    NSString *directory = [NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
    [[NSFileManager defaultManager] createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *file = [directory stringByAppendingPathComponent:@"smoke.html"];
    [@"<!doctype html><title>Native smoke</title>" writeToFile:file atomically:YES encoding:NSUTF8StringEncoding error:nil];
    if (!create(file.UTF8String, "{\"roomId\":\"native-smoke\"}")) return 2;
    bool ready = false, roundTrip = false;
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:20];
    char buffer[262145];
    while ([deadline timeIntervalSinceNow] > 0 && !roundTrip) {
      [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
      int length;
      while ((length = poll(buffer, sizeof(buffer))) > 0) {
        NSData *data = [NSData dataWithBytes:buffer length:length];
        NSDictionary *packet = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if ([packet[@"type"] isEqual:@"host.ready"]) {
          ready = true;
          evaluate(R"JS((async () => {
            const post = (message) => window.webkit.messageHandlers.chaya.postMessage(JSON.stringify(message));
            post({type:'host.regions',rects:[{x:0,y:0,width:10,height:10}]});
            const a = new RTCPeerConnection({iceServers:[]});
            const b = new RTCPeerConnection({iceServers:[]});
            const wait = (peer) => new Promise((resolve) => {
              if (peer.iceGatheringState === 'complete') return resolve();
              peer.onicegatheringstatechange = () => { if (peer.iceGatheringState === 'complete') resolve(); };
            });
            const channel = a.createDataChannel('native-smoke');
            b.ondatachannel = (event) => { event.channel.onmessage = (message) => {
              post({type:'native.smoke',room:window.__CHAYA_RGSS_CONFIG__.roomId,rtc:typeof RTCPeerConnection,text:message.data});
              a.close(); b.close();
            }; };
            channel.onopen = () => channel.send('中文\nround trip');
            await a.setLocalDescription(await a.createOffer()); await wait(a);
            await b.setRemoteDescription(a.localDescription);
            await b.setLocalDescription(await b.createAnswer()); await wait(b);
            await a.setRemoteDescription(b.localDescription);
          })().catch((error) => window.webkit.messageHandlers.chaya.postMessage(JSON.stringify({type:'native.error',error:String(error)}))))JS");
        }
        if ([packet[@"type"] isEqual:@"native.error"]) fprintf(stderr, "%s\n", [packet[@"error"] UTF8String]);
        if ([packet[@"type"] isEqual:@"native.smoke"]) {
          roundTrip = [packet[@"room"] isEqual:@"native-smoke"] && [packet[@"rtc"] isEqual:@"function"] && [packet[@"text"] isEqual:@"中文\nround trip"];
        }
      }
    }
    for (NSView *view in window.contentView.subviews) {
      if ([view isKindOfClass:NSClassFromString(@"ChayaWebView")]) {
        bool passThrough = [view hitTest:NSMakePoint(200, 100)] == nil;
        bool captures = [view hitTest:NSMakePoint(5, window.contentView.bounds.size.height - 5)] != nil;
        fprintf(stderr, "Native hit-test: passThrough=%d captures=%d DataChannel=%d\n", passThrough, captures, roundTrip);
        roundTrip = roundTrip && passThrough && captures;
      }
    }
    dispose();
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
    [window orderOut:nil];
    [[NSFileManager defaultManager] removeItemAtPath:directory error:nil];
    if (!ready || !roundTrip) { fprintf(stderr, "Native WKWebView smoke failed (ready=%d, roundTrip=%d)\n", ready, roundTrip); return 1; }
    puts("Native WKWebView attach, initialization, JS bridge, DataChannel transfer and hit-test smoke passed");
    return 0;
  }
}
