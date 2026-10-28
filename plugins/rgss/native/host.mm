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
+ (NSCursor *)blankCursor;
- (NSView *)gameView;
- (NSFocusRingType)focusRingType;
- (BOOL)containsInteractivePoint:(NSPoint)point;
@end
@implementation ChayaWebView
+ (NSCursor *)blankCursor {
  static NSCursor *cursor = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    NSImage *img = [[NSImage alloc] initWithSize:NSMakeSize(1, 1)];
    cursor = [[NSCursor alloc] initWithImage:img hotSpot:NSZeroPoint];
  });
  return cursor;
}
- (NSFocusRingType)focusRingType {
  return NSFocusRingTypeNone;
}
- (NSView *)gameView {
  for (NSView *sub in self.superview.subviews) {
    if (sub != self) return sub;
  }
  return self.superview;
}
- (void)resetCursorRects {
  [self discardCursorRects];
  [self addCursorRect:self.bounds cursor:[ChayaWebView blankCursor]];
  for (NSValue *value in self.regions) {
    NSRect r = value.rectValue;
    if (!self.isFlipped) r.origin.y = self.bounds.size.height - (r.origin.y + r.size.height);
    [self addCursorRect:r cursor:[NSCursor arrowCursor]];
  }
}
- (BOOL)containsInteractivePoint:(NSPoint)point {
  NSPoint local = [self convertPoint:point fromView:self.superview];
  // DOM coordinates have a top-left origin.
  if (!self.isFlipped) local.y = self.bounds.size.height - local.y;
  for (NSValue *value in self.regions) {
    if (NSPointInRect(local, value.rectValue)) return YES;
  }
  return NO;
}
- (NSView *)hitTest:(NSPoint)point {
  return [self containsInteractivePoint:point] ? [super hitTest:point] : nil;
}
- (void)mouseUp:(NSEvent *)event {
  [super mouseUp:event];
}
@end

@interface ChayaHost : NSObject <WKScriptMessageHandler, WKNavigationDelegate>
@property(nonatomic, strong) ChayaWebView *view;
@property(nonatomic, strong) NSTimer *attachTimer;
@property(nonatomic, strong) NSURL *url;
@property(nonatomic, strong) id keyMonitor;
@property(nonatomic, copy) NSString *configuration;
@property(nonatomic, assign) BOOL overlayOpen;
@property(nonatomic, strong) NSTimer *pointerTimer;
@property(nonatomic, strong) NSNumber *pointerActive;
@property(nonatomic, strong) NSMenuItem *editMenuItem;
@end
@implementation ChayaHost
- (void)updatePointer {
  NSWindow *window = self.view.window;
  NSPoint point = [window convertPointFromScreen:NSEvent.mouseLocation];
  point = [window.contentView convertPoint:point fromView:nil];
  BOOL active = window.isKeyWindow && [self.view containsInteractivePoint:point];
  if (self.pointerActive && self.pointerActive.boolValue == active) return;
  self.pointerActive = @(active);
  enqueue(active ? @"{\"type\":\"host.pointer\",\"active\":true}" : @"{\"type\":\"host.pointer\",\"active\":false}");
}
- (void)installEditMenu {
  // Standard AppKit actions reach the focused WebKit editor through the responder chain.
  for (NSMenuItem *item in NSApp.mainMenu.itemArray) {
    if ([item.submenu indexOfItemWithTarget:nil andAction:@selector(selectAll:)] >= 0 && item.submenu) return;
  }
  if (!NSApp.mainMenu) NSApp.mainMenu = [[NSMenu alloc] initWithTitle:@""];
  self.editMenuItem = [[NSMenuItem alloc] initWithTitle:@"Edit" action:nil keyEquivalent:@""];
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Edit"];
  [menu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
  NSMenuItem *redo = [menu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"z"];
  redo.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
  [menu addItem:NSMenuItem.separatorItem];
  [menu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
  [menu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
  [menu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
  [menu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
  self.editMenuItem.submenu = menu;
  [NSApp.mainMenu addItem:self.editMenuItem];
}
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
    [self.view.window resetCursorRects];
    [self updatePointer];
    return;
  }
  if ([packet[@"type"] isEqual:@"host.overlay"]) {
    BOOL nextOpen = [packet[@"open"] boolValue];
    self.overlayOpen = nextOpen;
    if (nextOpen) {
      [self.view.window makeFirstResponder:self.view];
    } else {
      NSView *game = [self.view gameView];
      if (game) [self.view.window makeFirstResponder:game];
      else if (self.view.window.contentView) [self.view.window makeFirstResponder:self.view.window.contentView];
    }
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
  [self.view setFocusRingType:NSFocusRingTypeNone];
  [window.contentView addSubview:self.view];
  [self installEditMenu];
  self.pointerTimer = [NSTimer scheduledTimerWithTimeInterval:1.0 / 60.0 target:self selector:@selector(updatePointer) userInfo:nil repeats:YES];
  __weak ChayaHost *weakHost = self;
  self.keyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:(NSEventMaskKeyDown | NSEventMaskKeyUp) handler:^NSEvent *(NSEvent *event) {
    ChayaHost *owner = weakHost;
    if (!owner || event.window != owner.view.window) return event;
    if (event.type == NSEventTypeKeyDown) {
      NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
      BOOL hasNonShiftModifiers = (mods & (NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagOption)) != 0;
      if ((event.keyCode == 50 || event.keyCode == 109) && !event.isARepeat && !hasNonShiftModifiers) {
        [owner.view evaluateJavaScript:@"document.dispatchEvent(new Event('chaya:toggle'))" completionHandler:nil];
        return nil;
      }
      if (event.keyCode == 53) {
        [owner.view evaluateJavaScript:@"document.dispatchEvent(new Event('chaya:esc'))" completionHandler:nil];
        return nil;
      }
    }
    NSResponder *firstResponder = event.window.firstResponder;
    BOOL focusedInWeb = [firstResponder isKindOfClass:[NSView class]] && [(NSView *)firstResponder isDescendantOf:owner.view];
    if (owner.overlayOpen || focusedInWeb) {
      if (!focusedInWeb) {
        if (event.type != NSEventTypeKeyDown || ![event.window makeFirstResponder:owner.view]) return nil;
      }
      return event;
    }
    return event;
  }];
  [self.view loadFileURL:self.url allowingReadAccessToURL:[self.url URLByDeletingLastPathComponent]];
}
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)navigation {
  enqueue(@"{\"type\":\"host.ready\"}");
}
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decision {
  decision([action.request.URL.standardizedURL.path isEqual:self.url.standardizedURL.path] ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (void)dispose {
  [self.attachTimer invalidate]; self.attachTimer = nil;
  [self.pointerTimer invalidate]; self.pointerTimer = nil;
  if (self.editMenuItem) [NSApp.mainMenu removeItem:self.editMenuItem];
  self.editMenuItem = nil;
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
