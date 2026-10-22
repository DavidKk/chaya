#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <deque>
#include <mutex>
#include <string>

// WebKit stays on AppKit's main thread. Ruby only exchanges bounded JSON queues.
static std::mutex messagesMutex;
static std::deque<std::string> messages;
static const size_t maxMessage = 256 * 1024;
static void enqueue(NSString *text) {
  NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding];
  if (!data || data.length > maxMessage) return;
  std::lock_guard<std::mutex> guard(messagesMutex);
  if (messages.size() < 128) messages.emplace_back((const char *)data.bytes, data.length);
}

@interface ChayaWebView : WKWebView
@property(nonatomic, copy) NSArray<NSValue *> *regions;
@end
@implementation ChayaWebView
- (NSView *)hitTest:(NSPoint)point {
  NSPoint local = [self convertPoint:point fromView:self.superview];
  // DOM coordinates have a top-left origin.
  if (!self.isFlipped) local.y = self.bounds.size.height - local.y;
  for (NSValue *value in self.regions) {
    if (NSPointInRect(local, value.rectValue)) return [super hitTest:point];
  }
  return nil;
}
@end

@interface ChayaHost : NSObject <WKScriptMessageHandler, WKNavigationDelegate>
@property(nonatomic, strong) ChayaWebView *view;
@property(nonatomic, strong) NSTimer *attachTimer;
@property(nonatomic, strong) NSURL *url;
@property(nonatomic, strong) id keyMonitor;
@property(nonatomic, copy) NSString *configuration;
@end
@implementation ChayaHost
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
  if (![message.body isKindOfClass:NSString.class] || message.webView != self.view || !message.frameInfo.mainFrame) return;
  NSData *data = [message.body dataUsingEncoding:NSUTF8StringEncoding];
  if (data.length > maxMessage) return;
  NSDictionary *packet = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![packet isKindOfClass:NSDictionary.class]) return;
  if ([packet[@"type"] isEqual:@"host.regions"]) {
    NSMutableArray *regions = [NSMutableArray array];
    NSArray *rects = packet[@"rects"];
    if (![rects isKindOfClass:NSArray.class] || rects.count > 256) return;
    for (NSDictionary *rect in rects) {
      if (![rect isKindOfClass:NSDictionary.class]) continue;
      NSNumber *x = rect[@"x"], *y = rect[@"y"], *w = rect[@"width"], *h = rect[@"height"];
      if (![x isKindOfClass:NSNumber.class] || ![y isKindOfClass:NSNumber.class] || ![w isKindOfClass:NSNumber.class] || ![h isKindOfClass:NSNumber.class]) continue;
      [regions addObject:[NSValue valueWithRect:NSMakeRect(x.doubleValue, y.doubleValue, w.doubleValue, h.doubleValue)]];
    }
    self.view.regions = regions;
    return;
  }
  enqueue(message.body);
}
- (void)attach {
  NSWindow *window = nil;
  for (NSWindow *candidate in NSApp.windows) {
    if (candidate.visible && candidate.contentView && candidate.canBecomeKeyWindow) {
      if (candidate.contentView.bounds.size.width >= 320 && candidate.contentView.bounds.size.height >= 240) {
        window = candidate;
        break;
      }
    }
  }
  if (!window) return;
  [self.attachTimer invalidate]; self.attachTimer = nil;
  WKWebViewConfiguration *config = [WKWebViewConfiguration new];
  [config.userContentController addScriptMessageHandler:self name:@"chaya"];
  NSString *source = [@"window.__CHAYA_RGSS_CONFIG__=" stringByAppendingString:self.configuration];
  [config.userContentController addUserScript:[[WKUserScript alloc] initWithSource:source injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
  self.view = [[ChayaWebView alloc] initWithFrame:window.contentView.bounds configuration:config];
  self.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  self.view.regions = @[];
  self.view.navigationDelegate = self;
  [self.view setValue:@NO forKey:@"drawsBackground"];
  [window.contentView addSubview:self.view];
  __weak ChayaHost *weakHost = self;
  self.keyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
    ChayaHost *owner = weakHost;
    if (owner && event.window == owner.view.window && event.keyCode == 109 && !event.isARepeat) {
      [owner.view evaluateJavaScript:@"document.dispatchEvent(new Event('chaya:toggle'))" completionHandler:nil];
      return nil;
    }
    return event;
  }];
  [self.view loadFileURL:self.url allowingReadAccessToURL:[self.url URLByDeletingLastPathComponent]];
}
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)navigation {
  enqueue(@"{\"type\":\"host.ready\"}");
}
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decision {
  decision([action.request.URL.path isEqual:self.url.path] ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (void)dispose {
  [self.attachTimer invalidate]; self.attachTimer = nil;
  if (self.keyMonitor) [NSEvent removeMonitor:self.keyMonitor]; self.keyMonitor = nil;
  [self.view.configuration.userContentController removeScriptMessageHandlerForName:@"chaya"];
  [self.view stopLoading]; [self.view removeFromSuperview]; self.view = nil;
}
@end
static ChayaHost *host;
extern "C" int chaya_overlay_create(const char *path, const char *configuration) {
  NSString *file = path ? [NSString stringWithUTF8String:path] : nil;
  NSString *json = configuration ? [NSString stringWithUTF8String:configuration] : nil;
  if (!file || !json || ![[NSFileManager defaultManager] fileExistsAtPath:file]) return 0;
  dispatch_async(dispatch_get_main_queue(), ^{
    [host dispose]; host = [ChayaHost new];
    host.url = [NSURL fileURLWithPath:file]; host.configuration = json;
    host.attachTimer = [NSTimer scheduledTimerWithTimeInterval:0.1 target:host selector:@selector(attach) userInfo:nil repeats:YES];
    [host attach];
  });
  return 1;
}
extern "C" int chaya_overlay_poll(char *buffer, int capacity) {
  std::lock_guard<std::mutex> guard(messagesMutex);
  if (messages.empty() || capacity <= 0) return 0;
  const std::string &text = messages.front();
  if ((int)text.size() + 1 > capacity) return -(int)text.size() - 1;
  memcpy(buffer, text.c_str(), text.size() + 1);
  int size = (int)text.size(); messages.pop_front(); return size;
}
extern "C" void chaya_overlay_eval(const char *source) {
  NSString *script = source ? [NSString stringWithUTF8String:source] : nil;
  if (script) dispatch_async(dispatch_get_main_queue(), ^{ [host.view evaluateJavaScript:script completionHandler:nil]; });
}
extern "C" void chaya_overlay_dispose() {
  dispatch_async(dispatch_get_main_queue(), ^{ [host dispose]; host = nil; });
  std::lock_guard<std::mutex> guard(messagesMutex); messages.clear();
}
