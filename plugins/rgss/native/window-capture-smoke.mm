#import "window-capture.h"
#include <stdio.h>

@interface AnimatedGameView : NSView
@property(nonatomic) CGFloat phase;
@end
@implementation AnimatedGameView
- (void)drawRect:(NSRect)dirtyRect {
  [[NSColor colorWithHue:self.phase saturation:0.8 brightness:0.8 alpha:1] setFill];
  NSRectFill(self.bounds);
}
@end

// Tests real ScreenCaptureKit frames without an installed game or screenshot files.
int main() {
  @autoreleasepool {
    if (@available(macOS 14.4, *)) {
      [NSApplication sharedApplication];
      [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
      NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(50, 50, 544, 416)
        styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
      AnimatedGameView *view = [[AnimatedGameView alloc] initWithFrame:window.contentView.bounds];
      window.contentView = view;
      [window orderBack:nil];
      ChayaWindowCapture *capture = [ChayaWindowCapture new];
      BOOL allPassed = YES;
      for (NSNumber *silent in @[@NO, @YES]) {
        if (silent.boolValue) {
          window.alphaValue = 1;
          [window setFrameOrigin:NSMakePoint(-20000, -20000)];
          [window orderBack:nil];
        }
        __block int frames = 0;
        __block BOOL failed = NO;
        __block BOOL dimensions = YES;
        NSMutableSet *images = [NSMutableSet set];
        NSString *generation = NSUUID.UUID.UUIDString;
        [capture startWindow:window generation:generation callback:^(NSDictionary *packet) {
          if (packet[@"error"]) {
            fprintf(stderr, "Native capture error (silent=%d): %s\n", silent.boolValue, [packet[@"error"] UTF8String]);
            failed = YES;
            return;
          }
          ++frames;
          dimensions = dimensions && [packet[@"width"] integerValue] == 544 && [packet[@"height"] integerValue] == 416;
          [images addObject:packet[@"image"]];
          [capture acknowledge:generation sequence:packet[@"sequence"]];
        }];
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:8];
        while (deadline.timeIntervalSinceNow > 0 && !failed && frames < 30) {
          view.phase = fmod(view.phase + 0.01, 1.0);
          [view setNeedsDisplay:YES];
          [view displayIfNeeded];
          [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1.0/60]];
        }
        BOOL pass = !failed && frames >= 10 && images.count >= 3 && dimensions;
        fprintf(stderr, "Native capture: silent=%d frames=%d unique=%lu dimensions=%d passed=%d\n",
          silent.boolValue, frames, (unsigned long)images.count, dimensions, pass);
        allPassed = allPassed && pass;
        [capture stop];
        [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.2]];
      }
      [window orderOut:nil];
      return allPassed ? 0 : 1;
    }
    fprintf(stderr, "Native capture smoke requires macOS 14.4 for consent-free own-window testing\n");
    return 2;
  }
}
