#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#import "window-capture.h"
#include <deque>
#include <mutex>
#include <string>

static BOOL IsSilentMode(void) {
  const char *s1 = getenv("CHAYA_RGSS_SILENT");
  const char *s2 = getenv("CHAYA_SILENT_MODE");
  return (s1 && strcmp(s1, "1") == 0) || (s2 && strcmp(s2, "1") == 0);
}

static void SwizzleMethod(Class cls, SEL origSel, SEL newSel) {
  Method origMethod = class_getInstanceMethod(cls, origSel);
  Method newMethod = class_getInstanceMethod(cls, newSel);
  if (!origMethod || !newMethod) return;
  if (class_addMethod(cls, origSel, method_getImplementation(newMethod), method_getTypeEncoding(newMethod))) {
    class_replaceMethod(cls, newSel, method_getImplementation(origMethod), method_getTypeEncoding(origMethod));
  } else {
    method_exchangeImplementations(origMethod, newMethod);
  }
}

@interface NSWindow (ChayaSilent)
- (void)chaya_makeKeyAndOrderFront:(id)sender;
- (void)chaya_orderFront:(id)sender;
- (void)chaya_orderFrontRegardless;
- (void)chaya_setFrame:(NSRect)frameRect display:(BOOL)flag;
@end

// Offscreen windows must stay opaque: alpha zero stops ScreenCaptureKit updates.
@implementation NSWindow (ChayaSilent)
- (void)chaya_makeKeyAndOrderFront:(id)sender {
  if (IsSilentMode()) {
    [self setAlphaValue:1.0];
    [self setIgnoresMouseEvents:YES];
    [self setCollectionBehavior:NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorTransient];
    [self setFrame:NSMakeRect(-20000, -20000, self.frame.size.width, self.frame.size.height) display:NO];
    [self orderBack:nil];
    return;
  }
  [self chaya_makeKeyAndOrderFront:sender];
}

- (void)chaya_orderFront:(id)sender {
  if (IsSilentMode()) {
    [self setAlphaValue:1.0];
    [self setIgnoresMouseEvents:YES];
    [self setCollectionBehavior:NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorTransient];
    [self setFrame:NSMakeRect(-20000, -20000, self.frame.size.width, self.frame.size.height) display:NO];
    [self orderBack:nil];
    return;
  }
  [self chaya_orderFront:sender];
}

- (void)chaya_orderFrontRegardless {
  if (IsSilentMode()) {
    [self setAlphaValue:1.0];
    [self setIgnoresMouseEvents:YES];
    [self setCollectionBehavior:NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorTransient];
    [self setFrame:NSMakeRect(-20000, -20000, self.frame.size.width, self.frame.size.height) display:NO];
    [self orderBack:nil];
    return;
  }
  [self chaya_orderFrontRegardless];
}

- (void)chaya_setFrame:(NSRect)frameRect display:(BOOL)flag {
  if (IsSilentMode()) {
    frameRect.origin = NSMakePoint(-20000, -20000);
    [self chaya_setFrame:frameRect display:NO];
    [self setAlphaValue:1.0];
    [self setIgnoresMouseEvents:YES];
    return;
  }
  [self chaya_setFrame:frameRect display:flag];
}
@end

@interface NSApplication (ChayaSilent)
- (void)chaya_activateIgnoringOtherApps:(BOOL)flag;
@end

@implementation NSApplication (ChayaSilent)
- (void)chaya_activateIgnoringOtherApps:(BOOL)flag {
  if (IsSilentMode()) {
    return;
  }
  [self chaya_activateIgnoringOtherApps:flag];
}
@end

__attribute__((constructor))
static void ChayaNativeHostInit(void) {
  if (IsSilentMode()) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
      Class winCls = [NSWindow class];
      SwizzleMethod(winCls, @selector(makeKeyAndOrderFront:), @selector(chaya_makeKeyAndOrderFront:));
      SwizzleMethod(winCls, @selector(orderFront:), @selector(chaya_orderFront:));
      SwizzleMethod(winCls, @selector(orderFrontRegardless), @selector(chaya_orderFrontRegardless));
      SwizzleMethod(winCls, @selector(setFrame:display:), @selector(chaya_setFrame:display:));
      Class appCls = [NSApplication class];
      SwizzleMethod(appCls, @selector(activateIgnoringOtherApps:), @selector(chaya_activateIgnoringOtherApps:));
    });
    void (^hideWindows)(void) = ^{
      [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
      for (NSWindow *w in NSApp.windows) {
        [w setAlphaValue:1.0];
        [w setIgnoresMouseEvents:YES];
        [w setCollectionBehavior:NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorTransient];
        [w setFrame:NSMakeRect(-20000, -20000, w.frame.size.width, w.frame.size.height) display:NO];
        [w orderBack:nil];
      }
    };
    if ([NSThread isMainThread]) {
      hideWindows();
    } else {
      dispatch_async(dispatch_get_main_queue(), hideWindows);
    }
  }
}

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
@property(nonatomic, strong) ChayaWindowCapture *capture;
@end
@implementation ChayaHost
- (void)updatePointer {
  NSWindow *window = self.view.window;
  if (IsSilentMode() && window) {
    if (window.alphaValue != 1.0 || window.frame.origin.x != -20000) {
      [window setAlphaValue:1.0];
      [window setFrame:NSMakeRect(-20000, -20000, window.frame.size.width, window.frame.size.height) display:NO];
      [window orderBack:nil];
    }
    return;
  }
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
  if ([packet[@"type"] isEqual:@"host.stream"]) {
    [self.capture stop];
    if ([packet[@"active"] boolValue] && self.view.window && [packet[@"generation"] isKindOfClass:NSString.class]) {
      if (!self.capture) self.capture = [ChayaWindowCapture new];
      __weak ChayaHost *weakHost = self;
      [self.capture startWindow:self.view.window generation:packet[@"generation"] callback:^(NSDictionary *frame) {
        NSData *json = [NSJSONSerialization dataWithJSONObject:frame options:0 error:nil];
        NSString *argument = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
        if (argument) [weakHost.view evaluateJavaScript:[NSString stringWithFormat:@"window.__chaya_stream_frame?.(%@)", argument] completionHandler:nil];
      }];
    }
    return;
  }
  if ([packet[@"type"] isEqual:@"host.stream.ack"]) {
    if ([packet[@"generation"] isKindOfClass:NSString.class] && [packet[@"sequence"] isKindOfClass:NSNumber.class])
      [self.capture acknowledge:packet[@"generation"] sequence:packet[@"sequence"]];
    return;
  }
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
    if (candidate.contentView) {
      if (candidate.contentView.bounds.size.width >= 320 && candidate.contentView.bounds.size.height >= 240) {
        window = candidate;
        break;
      }
    }
  }
  if (!window) return;
  [self.attachTimer invalidate]; self.attachTimer = nil;
  if (IsSilentMode()) {
    [window setAlphaValue:1.0];
    [window setIgnoresMouseEvents:YES];
    [window setCollectionBehavior:NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorTransient];
    [window setFrame:NSMakeRect(-20000, -20000, window.frame.size.width, window.frame.size.height) display:NO];
    [window orderBack:nil];
  }
  WKWebViewConfiguration *config = [WKWebViewConfiguration new];
  [config.preferences setValue:@YES forKey:@"allowFileAccessFromFileURLs"];
  [config setValue:@YES forKey:@"allowUniversalAccessFromFileURLs"];
  [config.preferences setValue:@YES forKey:@"developerExtrasEnabled"];
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
  NSURL *accessUrl = [NSURL fileURLWithPath:@"/" isDirectory:YES];
  [self.view loadFileURL:self.url allowingReadAccessToURL:accessUrl];
}
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)navigation {
  enqueue(@"{\"type\":\"host.ready\"}");
}
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decision {
  decision([action.request.URL.standardizedURL.path isEqual:self.url.standardizedURL.path] ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (void)dispose {
  [self.capture stop]; self.capture = nil;
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
