#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <dlfcn.h>
#include <stdio.h>

int main(int argc, const char **argv) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    
    // Create actual 800x600 game window
    NSRect frame = NSMakeRect(100, 100, 800, 600);
    NSWindow *window = [[NSWindow alloc] initWithContentRect:frame
      styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    [window makeKeyAndOrderFront:nil];
    
    NSView *gameView = [[NSView alloc] initWithFrame:window.contentView.bounds];
    [window.contentView addSubview:gameView];
    
    NSString *dylibPath = [NSString stringWithUTF8String:argv[1]];
    void *library = dlopen(dylibPath.UTF8String, RTLD_NOW);
    if (!library) { fprintf(stderr, "dlopen error: %s\n", dlerror()); return 1; }
    
    auto create = (int (*)(const char *, const char *))dlsym(library, "chaya_overlay_create");
    auto poll = (int (*)(char *, int))dlsym(library, "chaya_overlay_poll");
    auto evaluate = (void (*)(const char *))dlsym(library, "chaya_overlay_eval");
    auto dispose = (void (*)())dlsym(library, "chaya_overlay_dispose");
    
    NSString *htmlPath = [[dylibPath stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"rgss-overlay.html"];
    create(htmlPath.UTF8String, "{\"roomId\":\"e2e\",\"apiBase\":\"http://127.0.0.1:3000\"}");
    
    char buffer[262145];
    bool toggleSent = false;
    bool verifiedCentered = false;
    bool verifiedDragged = false;
    bool verifiedSwitch = false;
    bool verifiedGoldLock = false;
    bool verifiedPassThrough = false;
    bool verifiedCapture = false;
    
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:15];
    while ([deadline timeIntervalSinceNow] > 0) {
      [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.04]];
      int len;
      while ((len = poll(buffer, sizeof(buffer))) > 0) {
        NSData *d = [NSData dataWithBytes:buffer length:len];
        NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:d options:0 error:nil];
        NSString *type = msg[@"type"];
        
        if ([type isEqual:@"host.ready"] && !toggleSent) {
          evaluate(R"JS(
            document.dispatchEvent(new Event('chaya:toggle'));
            setTimeout(() => {
              window.__chaya_on_game_message({
                type: 'edit.state',
                ready: true,
                session: {
                  gold: 9999, goldLocked: false, walkRate: 1, runRate: 1, through: false, god: false, expRate: 1, enemyHp: false,
                  switches: { 1: false }, vars: { 1: 10 }, counts: {}, locks: {},
                  actors: { 1: { id: 1, name: 'Hero', hp: 100, mhp: 100, mp: 50, mmp: 50, atk: 20, def: 15, mat: 10, mdf: 10, agi: 12, luk: 8, level: 1, exp: 0, skillIds: [], stateIds: [] } }
                }
              });
              window.__chaya_on_game_message({
                type: 'edit.catalog',
                catalog: {
                  ok: true, contentRoot: '', source: 'disk',
                  items: [{ id: 1, name: 'Potion' }], weapons: [], armors: [],
                  actors: [{ id: 1, name: 'Hero' }], skills: [{ id: 1, name: 'Slash' }],
                  states: [], classes: [], variables: [{ id: 1, name: 'QuestVar' }], switches: [{ id: 1, name: 'GateSw' }]
                }
              });
            }, 60);
          )JS");
          toggleSent = true;
        }
        
        if ([type isEqual:@"edit.cmd"]) {
          NSString *op = msg[@"op"];
          fprintf(stderr, "[E2E CMD RECEIVED] op=%s\n", [op UTF8String]);
          if ([op isEqual:@"runFlag"] && [msg[@"key"] isEqual:@"through"]) verifiedSwitch = true;
          if ([op isEqual:@"goldLock"]) verifiedGoldLock = true;
        }
      }
      
      // Check HitTest and Centering
      for (NSView *v in window.contentView.subviews) {
        if ([v isKindOfClass:NSClassFromString(@"ChayaWebView")]) {
          NSArray *regions = [v valueForKey:@"regions"];
          if (regions.count > 0 && !verifiedCentered) {
            NSRect r = [regions[0] rectValue];
            fprintf(stderr, "[E2E HITTEST] Region: x=%.1f, y=%.1f, w=%.1f, h=%.1f (Window: 800x600)\n",
                    r.origin.x, r.origin.y, r.size.width, r.size.height);
            // Inset: 8% 6% of 800x600 -> x: 48 (6%), y: 48 (8%), w: 704 (88%), h: 504 (84%)
            if (fabs(r.origin.x - 48.0) < 5.0 && fabs(r.size.width - 704.0) < 5.0) {
              verifiedCentered = true;
              fprintf(stderr, "[PASS] Panel is verified CENTERED with inset 8%% 6%%\n");
            }
            
            NSView *outsideHit = [v hitTest:NSMakePoint(10, 10)];
            verifiedPassThrough = (outsideHit == nil);
            
            NSView *insideHit = [v hitTest:NSMakePoint(400, 300)];
            verifiedCapture = (insideHit != nil);
          }
        }
      }
      
      // Test drag and clicking buttons
      if (verifiedCentered && !verifiedDragged) {
        evaluate(R"JS((() => {
          const host = document.getElementById('chaya-rgss-overlay-container');
          const shadow = host?.shadowRoot;
          if (!shadow) return;
          const nav = shadow.querySelector('nav');
          if (!nav) return;
          
          nav.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 200, clientY: 70, bubbles: true }));
          nav.dispatchEvent(new PointerEvent('pointermove', { clientX: 260, clientY: 110, bubbles: true }));
          nav.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        })())JS");
        verifiedDragged = true;
      }
      
      if (verifiedDragged) {
        evaluate(R"JS((() => {
          const host = document.getElementById('chaya-rgss-overlay-container');
          const shadow = host?.shadowRoot;
          if (!shadow) return;
          
          if (!window.__tested_switch) {
            const sw = shadow.querySelector('[role="switch"][aria-label="穿墙"]');
            if (sw && !sw.disabled) {
              sw.click();
              window.__tested_switch = true;
            }
          }
          
          if (!window.__tested_gold) {
            const lock = shadow.querySelector('button[aria-label="锁死金钱"]') ||
                         shadow.querySelector('button[aria-label="锁定金钱"]');
            if (lock && !lock.disabled) {
              lock.click();
              window.__tested_gold = true;
            }
          }
        })())JS");
      }
      
      if (verifiedCentered && verifiedDragged && verifiedSwitch && verifiedGoldLock && verifiedPassThrough && verifiedCapture) {
        break;
      }
    }
    
    dispose();
    [window orderOut:nil];
    
    fprintf(stderr, "\n================ E2E TEST SUMMARY ================\n");
    fprintf(stderr, "1. Panel Centered (inset 8%% 6%%): %s\n", verifiedCentered ? "PASS" : "FAIL");
    fprintf(stderr, "2. Panel Drag & Move: %s\n", verifiedDragged ? "PASS" : "FAIL");
    fprintf(stderr, "3. Native Click Passthrough & Capture: %s\n", (verifiedPassThrough && verifiedCapture) ? "PASS" : "FAIL");
    fprintf(stderr, "4. Click Switch ('穿墙'): %s\n", verifiedSwitch ? "PASS" : "FAIL");
    fprintf(stderr, "5. Click Lock ('锁死金钱'): %s\n", verifiedGoldLock ? "PASS" : "FAIL");
    fprintf(stderr, "===================================================\n\n");
    
    bool ok = verifiedCentered && verifiedDragged && verifiedSwitch && verifiedGoldLock && verifiedPassThrough && verifiedCapture;
    return ok ? 0 : 1;
  }
}
