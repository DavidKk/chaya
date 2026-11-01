#import "window-capture.h"
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreImage/CoreImage.h>
#import <ImageIO/ImageIO.h>

API_AVAILABLE(macos(12.3))
@interface ChayaWindowCapture () <SCStreamOutput, SCStreamDelegate> {
  dispatch_queue_t _queue;
  SCStream *_stream;
  CIContext *_context;
  NSString *_generation;
  void (^_callback)(NSDictionary *);
  id _activity;
  NSUInteger _revision;
  NSUInteger _sequence;
  NSUInteger _pending;
  CFTimeInterval _sentAt;
  BOOL _received;
}
@end

@implementation ChayaWindowCapture
- (instancetype)init {
  if ((self = [super init])) {
    _queue = dispatch_queue_create("chaya.window.capture", DISPATCH_QUEUE_SERIAL);
    _context = [CIContext contextWithOptions:@{kCIContextCacheIntermediates: @NO}];
  }
  return self;
}
- (void)emit:(NSDictionary *)packet {
  void (^callback)(NSDictionary *) = _callback;
  if (callback) dispatch_async(dispatch_get_main_queue(), ^{ callback(packet); });
}
- (void)cleanup {
  SCStream *stream = _stream;
  _stream = nil;
  if (stream) [stream stopCaptureWithCompletionHandler:^(NSError *error) {}];
  if (_activity) [[NSProcessInfo processInfo] endActivity:_activity];
  _activity = nil;
  _pending = 0;
  _callback = nil;
}
- (void)fail:(NSString *)reason {
  [self emit:@{@"generation": _generation ?: @"", @"error": reason}];
  [self cleanup];
}
- (void)startWindow:(NSWindow *)window generation:(NSString *)generation callback:(void (^)(NSDictionary *))callback {
  CGWindowID windowID = (CGWindowID)window.windowNumber;
  NSSize content = window.contentView.bounds.size;
  NSSize frame = window.frame.size;
  dispatch_async(_queue, ^{
    [self cleanup];
    NSUInteger revision = ++self->_revision;
    self->_generation = [generation copy];
    self->_callback = [callback copy];
    self->_received = NO;
    self->_sequence = 0;
    if (@available(macOS 12.3, *)) {
      void (^availableContent)(SCShareableContent *, NSError *) = ^(SCShareableContent *available, NSError *error) {
          dispatch_async(self->_queue, ^{
            if (revision != self->_revision) return;
            if (error) { [self fail:[@"Window capture unavailable: " stringByAppendingString:error.localizedDescription]]; return; }
            SCWindow *target = nil;
            for (SCWindow *candidate in available.windows) if (candidate.windowID == windowID) { target = candidate; break; }
            if (!target) { [self fail:@"Attached game window is not available for capture"]; return; }
            SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:target];
            SCStreamConfiguration *config = [SCStreamConfiguration new];
            double scale = MIN(1.0, 1280.0 / MAX(content.width, content.height));
            config.width = MAX(2, (NSUInteger)(content.width * scale));
            config.height = MAX(2, (NSUInteger)(content.height * scale));
            CGFloat inset = MAX(0, (frame.width - content.width) / 2);
            config.sourceRect = CGRectMake(inset, MAX(0, frame.height - content.height - inset), content.width, content.height);
            config.minimumFrameInterval = CMTimeMake(1, 30);
            config.queueDepth = 3;
            config.showsCursor = NO;
            config.pixelFormat = kCVPixelFormatType_32BGRA;
            self->_stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:self];
            NSError *outputError = nil;
            if (![self->_stream addStreamOutput:self type:SCStreamOutputTypeScreen sampleHandlerQueue:self->_queue error:&outputError]) {
              [self fail:[@"Window capture output failed: " stringByAppendingString:outputError.localizedDescription ?: @"unknown error"]];
              return;
            }
            self->_activity = [[NSProcessInfo processInfo] beginActivityWithOptions:NSActivityUserInitiatedAllowingIdleSystemSleep reason:@"Chaya live window capture"];
            [self->_stream startCaptureWithCompletionHandler:^(NSError *startError) {
              dispatch_async(self->_queue, ^{
                if (revision == self->_revision && startError) [self fail:[@"Window capture start failed: " stringByAppendingString:startError.localizedDescription]];
              });
            }];
          });
        };
      if (@available(macOS 14.4, *)) {
        [SCShareableContent getCurrentProcessShareableContentWithCompletionHandler:availableContent];
      } else {
        [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:NO completionHandler:availableContent];
      }
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC), self->_queue, ^{
        if (revision == self->_revision && self->_callback && !self->_received) [self fail:@"Window capture first frame timed out"];
      });
    } else {
      [self fail:@"Live window capture requires macOS 12.3 or later"];
    }
  });
}
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type API_AVAILABLE(macos(12.3)) {
  if (stream != _stream || type != SCStreamOutputTypeScreen || !CMSampleBufferIsValid(sample)) return;
  NSArray *attachments = (__bridge NSArray *)CMSampleBufferGetSampleAttachmentsArray(sample, NO);
  NSNumber *status = attachments.firstObject[SCStreamFrameInfoStatus];
  if (!status || status.integerValue != SCFrameStatusComplete) return;
  CFTimeInterval now = NSProcessInfo.processInfo.systemUptime;
  if (_pending && now - _sentAt < 0.5) return;
  CVPixelBufferRef pixels = CMSampleBufferGetImageBuffer(sample);
  if (!pixels) return;
  @autoreleasepool {
    CIImage *image = [CIImage imageWithCVPixelBuffer:pixels];
    NSData *jpeg = [_context JPEGRepresentationOfImage:image colorSpace:NSColorSpace.sRGBColorSpace.CGColorSpace
      options:@{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality: @0.72}];
    if (!jpeg || jpeg.length > 2 * 1024 * 1024) return;
    _received = YES;
    _pending = ++_sequence;
    _sentAt = now;
    [self emit:@{@"generation": _generation, @"sequence": @(_pending),
      @"image": [@"data:image/jpeg;base64," stringByAppendingString:[jpeg base64EncodedStringWithOptions:0]],
      @"width": @(CVPixelBufferGetWidth(pixels)), @"height": @(CVPixelBufferGetHeight(pixels))}];
  }
}
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error API_AVAILABLE(macos(12.3)) {
  dispatch_async(_queue, ^{
    if (stream == self->_stream) [self fail:[@"Window capture stopped: " stringByAppendingString:error.localizedDescription]];
  });
}
- (void)acknowledge:(NSString *)generation sequence:(NSNumber *)sequence {
  dispatch_async(_queue, ^{
    if ([generation isEqual:self->_generation] && sequence.unsignedIntegerValue == self->_pending) self->_pending = 0;
  });
}
- (void)stop {
  dispatch_async(_queue, ^{
    ++self->_revision;
    [self cleanup];
  });
}
@end
