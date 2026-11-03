#import <Cocoa/Cocoa.h>

/** Captures only the attached game window. All frame work stays off Ruby's thread. */
@interface ChayaWindowCapture : NSObject
- (void)startWindow:(NSWindow *)window generation:(NSString *)generation
          callback:(void (^)(NSDictionary *packet))callback;
- (void)acknowledge:(NSString *)generation sequence:(NSNumber *)sequence;
- (void)stop;
@end
