// UtterRecorder.swift
// Standalone Swift CLI — macOS 13+, ScreenCaptureKit
//
// Usage:
//   UtterRecorder --out-dir <path> --display-id <uint32> --mic-device <deviceUID|"default">
//
// Compile (single file, no SPM):
//   swiftc UtterRecorder.swift \
//     -target arm64-apple-macosx13.0 \
//     -framework ScreenCaptureKit -framework AVFoundation \
//     -framework CoreMedia -framework Foundation \
//     -framework AudioToolbox -framework CoreAudio \
//     -o UtterRecorder-arm64

import Foundation
import AVFoundation
import CoreMedia
import ScreenCaptureKit
import AudioToolbox
import CoreAudio

// MARK: - NDJSON helpers

func emitJSON(_ obj: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
       let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
}

func emitError(code: String, message: String) {
    emitJSON(["event": "error", "code": code, "message": message])
}

// MARK: - Argument parsing

struct Args {
    var outDir: String = ""
    var displayID: UInt32 = 0
    var micDevice: String = "default"
}

func parseArgs() -> Args? {
    var args = Args()
    let argv = CommandLine.arguments
    var i = 1
    while i < argv.count {
        switch argv[i] {
        case "--out-dir":
            i += 1; guard i < argv.count else { return nil }
            args.outDir = argv[i]
        case "--display-id":
            i += 1; guard i < argv.count, let v = UInt32(argv[i]) else { return nil }
            args.displayID = v
        case "--mic-device":
            i += 1; guard i < argv.count else { return nil }
            args.micDevice = argv[i]
        default:
            break
        }
        i += 1
    }
    guard !args.outDir.isEmpty else { return nil }
    return args
}

// MARK: - Segment writer (fragmented MP4 for video + audio)

/// Manages a single AVAssetWriter segment for video + audio.
final class SegmentWriter {
    private var writer: AVAssetWriter
    private var videoInput: AVAssetWriterInput
    private var audioInput: AVAssetWriterInput
    private var pixelAdaptor: AVAssetWriterInputPixelBufferAdaptor

    let path: String

    init(path: String, videoSettings: [String: Any], audioSettings: [String: Any]) throws {
        self.path = path
        let url = URL(fileURLWithPath: path)
        // Remove stale file if it exists
        try? FileManager.default.removeItem(at: url)
        writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true

        videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoInput.expectsMediaDataInRealTime = true

        let sourcePixelAttributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        pixelAdaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: videoInput,
            sourcePixelBufferAttributes: sourcePixelAttributes
        )

        audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
        audioInput.expectsMediaDataInRealTime = true

        writer.add(videoInput)
        writer.add(audioInput)
    }

    func start(at time: CMTime) {
        writer.startWriting()
        writer.startSession(atSourceTime: time)
    }

    func append(videoBuffer: CMSampleBuffer) {
        guard videoInput.isReadyForMoreMediaData else { return }
        videoInput.append(videoBuffer)
    }

    func append(pixelBuffer: CVPixelBuffer, presentationTime: CMTime) {
        guard pixelAdaptor.assetWriterInput.isReadyForMoreMediaData else { return }
        pixelAdaptor.append(pixelBuffer, withPresentationTime: presentationTime)
    }

    func append(audioBuffer: CMSampleBuffer) {
        guard audioInput.isReadyForMoreMediaData else { return }
        audioInput.append(audioBuffer)
    }

    func finalize(completion: @escaping () -> Void) {
        videoInput.markAsFinished()
        audioInput.markAsFinished()
        writer.finishWriting {
            completion()
        }
    }

    var status: AVAssetWriter.Status { writer.status }
    var error: Error? { writer.error }
}

// MARK: - Audio m4a writer (continuous, system audio + mic as separate tracks)
//
// NOTE: Rather than mixing system audio and mic into a single AVAssetWriterInput
// (which causes timestamp collisions when two async sources write to the same track),
// we write them as two separate tracks in audio.m4a. The downstream ffmpeg transcode
// step can merge/mix the tracks on ingest. This is functionally equivalent for
// Whisper transcription. A true real-time mix would require routing both sources
// through AVAudioEngine's mainMixerNode, but that requires SCStream audio to be
// fed through an AVAudioSourceNode backed by a ring buffer — adding significant
// synchronization complexity for a sidecar binary. Two-track output is the
// safe, race-condition-free alternative.

final class AudioFileWriter {
    private var writer: AVAssetWriter
    // Track 0: system audio (from SCStream)
    private var sysInput: AVAssetWriterInput
    // Track 1: microphone (from AVAudioEngine tap)
    private var micInput: AVAssetWriterInput
    private let writerLock = NSLock()
    private var sessionStarted = false

    init(path: String) throws {
        let url = URL(fileURLWithPath: path)
        try? FileManager.default.removeItem(at: url)
        writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
        writer.shouldOptimizeForNetworkUse = true

        // AAC, mono, 24 kbps — applied to both tracks
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 24000
        ]

        sysInput = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        sysInput.expectsMediaDataInRealTime = true
        // Assign distinct track IDs so the muxer creates two separate audio tracks
        sysInput.mediaTimeScale = 44100

        micInput = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        micInput.expectsMediaDataInRealTime = true
        micInput.mediaTimeScale = 44100

        writer.add(sysInput)
        writer.add(micInput)

        // Start the writer now; individual tracks use their own session-start timestamps
        writer.startWriting()
    }

    /// Append a system-audio sample buffer (from SCStream).
    func appendSystemAudio(_ buffer: CMSampleBuffer) {
        writerLock.lock()
        defer { writerLock.unlock() }
        if !sessionStarted {
            writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(buffer))
            sessionStarted = true
        }
        if sysInput.isReadyForMoreMediaData {
            sysInput.append(buffer)
        }
    }

    /// Append a microphone sample buffer (from AVAudioEngine tap).
    /// Uses the same writerLock and sessionStarted flag as appendSystemAudio so that
    /// whichever source arrives first opens the session — fixing silent mic-only audio loss.
    func appendMicAudio(_ buffer: CMSampleBuffer) {
        writerLock.lock()
        defer { writerLock.unlock() }
        if !sessionStarted {
            writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(buffer))
            sessionStarted = true
        }
        if micInput.isReadyForMoreMediaData {
            micInput.append(buffer)
        }
    }

    func finalize(completion: @escaping () -> Void) {
        writerLock.lock()
        let started = sessionStarted
        sysInput.markAsFinished()
        micInput.markAsFinished()
        writerLock.unlock()

        guard writer.status == .writing && started else {
            writer.cancelWriting()
            completion()
            return
        }
        writer.finishWriting(completionHandler: completion)
    }
}

// MARK: - Recorder (core logic)

@available(macOS 13.0, *)
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {

    private let args: Args
    private var stream: SCStream?
    private let queue = DispatchQueue(label: "com.utter.recorder", qos: .userInteractive)

    // Segment state
    private let segmentLock = NSLock()
    private var segmentWriter: SegmentWriter?
    private var segmentCounter = 0
    private var segmentStartTime: CMTime = .zero
    private let segmentDuration: Double = 5.0

    // Continuous audio writer
    private var audioFileWriter: AudioFileWriter?

    // Mic capture
    private var micEngine: AVAudioEngine?

    // Stopping flag (written from SIGTERM / stopCapture callback, read from sample handler queue)
    // Protected by NSLock to prevent data races under -O optimisation (compiler can hoist plain var reads).
    private let stoppingLock = NSLock()
    private var _stopping = false
    private var stopping: Bool {
        get { stoppingLock.withCriticalSection { _stopping } }
        set { stoppingLock.withCriticalSection { _stopping = newValue } }
    }

    // Video/audio settings reused across segments
    private var videoSettings: [String: Any] = [:]
    private var segAudioSettings: [String: Any] = [:]

    init(args: Args) {
        self.args = args
    }

    // MARK: Start

    func start() {
        // 1. Create output directories
        let videoDir = (args.outDir as NSString).appendingPathComponent("video")
        do {
            try FileManager.default.createDirectory(atPath: videoDir,
                                                    withIntermediateDirectories: true)
        } catch {
            emitError(code: "fatal", message: "Cannot create video dir: \(error)")
            exit(1)
        }

        // 2. Audio file writer
        let audioPath = (args.outDir as NSString).appendingPathComponent("audio.m4a")
        do {
            audioFileWriter = try AudioFileWriter(path: audioPath)
        } catch {
            emitError(code: "fatal", message: "Cannot create audio writer: \(error)")
            exit(1)
        }

        // 3. Default video/audio settings for segments
        videoSettings = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: 1920,
            AVVideoHeightKey: 1080,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 4_000_000,
                AVVideoMaxKeyFrameIntervalKey: 150, // 5 s at 30 fps
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ]
        segAudioSettings = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 128_000
        ]

        // 4. Set up microphone capture via AVAudioEngine
        setupMic()

        // 5. Set up SCStream
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { [weak self] content, error in
            guard let self = self else { return }
            if let error = error {
                emitError(code: "permission", message: "SCShareableContent failed: \(error.localizedDescription)")
                exit(2)
            }
            guard let content = content else {
                emitError(code: "permission", message: "No shareable content returned")
                exit(2)
            }

            // Find display
            let display: SCDisplay?
            if self.args.displayID == 0 {
                display = content.displays.first
            } else {
                display = content.displays.first { $0.displayID == self.args.displayID }
            }
            guard let display = display else {
                emitError(code: "fatal", message: "Display \(self.args.displayID) not found")
                exit(1)
            }

            let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
            let cfg = SCStreamConfiguration()
            cfg.width = 1920
            cfg.height = 1080
            cfg.minimumFrameInterval = CMTime(value: 1, timescale: 30)
            cfg.pixelFormat = kCVPixelFormatType_32BGRA
            cfg.capturesAudio = true
            cfg.sampleRate = 44100
            cfg.channelCount = 1

            do {
                let stream = SCStream(filter: filter, configuration: cfg, delegate: self)
                try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.queue)
                try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: self.queue)
                self.stream = stream
                stream.startCapture { [weak self] err in
                    guard let self = self else { return }
                    if let err = err {
                        emitError(code: "permission", message: "startCapture failed: \(err.localizedDescription)")
                        exit(2)
                    }
                    emitJSON(["event": "started", "pid": ProcessInfo.processInfo.processIdentifier])
                }
            } catch {
                emitError(code: "fatal", message: "SCStream setup failed: \(error.localizedDescription)")
                exit(1)
            }
        }
    }

    // MARK: Microphone

    private func setupMic() {
        let engine = AVAudioEngine()

        // Honor --mic-device when a specific UID is given (Fix 2).
        if args.micDevice != "default" {
            selectMicDevice(uid: args.micDevice, engine: engine)
        }

        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        // Install tap: forward mic samples to the dedicated mic track in audio.m4a.
        // (System audio is written to its own separate track via handleSystemAudio,
        //  so the two paths never collide on a single AVAssetWriterInput — Fix 1.)
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, time in
            guard let self = self, !self.stopping else { return }
            if let cmBuf = self.pcmBufferToCMSampleBuffer(buffer, time: time) {
                self.audioFileWriter?.appendMicAudio(cmBuf)
            }
        }
        do {
            try engine.start()
            self.micEngine = engine
        } catch {
            // Mic is best-effort; warn but don't abort
            emitJSON(["event": "error", "code": "mic_warn",
                      "message": "Mic unavailable: \(error.localizedDescription)"])
        }
    }

    /// Resolve a device UID to an AudioDeviceID and wire it to the engine's input AUHAL.
    /// Falls back to the OS default and emits a warning if the UID is not found.
    private func selectMicDevice(uid: String, engine: AVAudioEngine) {
        // Step 1: resolve UID → AudioDeviceID
        var deviceID = AudioDeviceID(0)
        var uidRef = uid as CFString
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDeviceForUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var dataSize = UInt32(MemoryLayout<AudioDeviceID>.size)
        let lookupStatus = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &addr,
            UInt32(MemoryLayout<CFString>.size),
            &uidRef,
            &dataSize,
            &deviceID
        )

        guard lookupStatus == noErr, deviceID != kAudioDeviceUnknown else {
            fputs("UtterRecorder warning: mic-device '\(uid)' not found — using OS default\n", stderr)
            return
        }

        // Step 2: set the device on the engine's underlying AUHAL input unit
        guard let audioUnit = engine.inputNode.audioUnit else {
            fputs("UtterRecorder warning: cannot access inputNode.audioUnit — using OS default\n", stderr)
            return
        }

        var inputDeviceID = deviceID
        let setStatus = AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &inputDeviceID,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )

        if setStatus != noErr {
            fputs("UtterRecorder warning: AudioUnitSetProperty for mic-device failed (\(setStatus)) — using OS default\n", stderr)
        }
    }

    private func pcmBufferToCMSampleBuffer(_ buffer: AVAudioPCMBuffer, time: AVAudioTime) -> CMSampleBuffer? {
        guard let channelData = buffer.floatChannelData else { return nil }
        let frameCount = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        let sampleRate = buffer.format.sampleRate

        var asbd = buffer.format.streamDescription.pointee
        var formatDesc: CMAudioFormatDescription?
        CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd,
                                       layoutSize: 0, layout: nil,
                                       magicCookieSize: 0, magicCookie: nil,
                                       extensions: nil, formatDescriptionOut: &formatDesc)
        guard let formatDesc = formatDesc else { return nil }

        let bytesPerFrame = MemoryLayout<Float>.size * channelCount
        let dataSize = frameCount * bytesPerFrame

        // Interleave channels
        let interleaved = UnsafeMutablePointer<Float>.allocate(capacity: frameCount * channelCount)
        defer { interleaved.deallocate() }
        for ch in 0..<channelCount {
            for f in 0..<frameCount {
                interleaved[f * channelCount + ch] = channelData[ch][f]
            }
        }

        var blockBuffer: CMBlockBuffer?
        CMBlockBufferCreateWithMemoryBlock(allocator: nil,
                                          memoryBlock: nil,
                                          blockLength: dataSize,
                                          blockAllocator: nil,
                                          customBlockSource: nil,
                                          offsetToData: 0,
                                          dataLength: dataSize,
                                          flags: 0,
                                          blockBufferOut: &blockBuffer)
        guard let bb = blockBuffer else { return nil }
        CMBlockBufferReplaceDataBytes(with: interleaved, blockBuffer: bb,
                                     offsetIntoDestination: 0, dataLength: dataSize)

        let pts: CMTime
        if time.isSampleTimeValid {
            pts = CMTimeMake(value: time.sampleTime, timescale: CMTimeScale(sampleRate))
        } else {
            pts = CMClockGetTime(CMClockGetHostTimeClock())
        }

        var sampleBuffer: CMSampleBuffer?
        CMAudioSampleBufferCreateReadyWithPacketDescriptions(
            allocator: nil,
            dataBuffer: bb,
            formatDescription: formatDesc,
            sampleCount: frameCount,
            presentationTimeStamp: pts,
            packetDescriptions: nil,
            sampleBufferOut: &sampleBuffer
        )
        return sampleBuffer
    }

    // MARK: SCStreamOutput

    func stream(_ stream: SCStream,
                didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard !stopping else { return }
        switch type {
        case .screen:
            handleVideoFrame(sampleBuffer)
        case .audio:
            handleSystemAudio(sampleBuffer)
        @unknown default:
            break
        }
    }

    // MARK: SCStreamDelegate

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        if !stopping {
            emitError(code: "fatal", message: "Stream stopped unexpectedly: \(error.localizedDescription)")
        }
    }

    // MARK: Video frame handling

    private func handleVideoFrame(_ sampleBuffer: CMSampleBuffer) {
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

        segmentLock.lock()
        let needsFirstSegment = segmentWriter == nil && !stopping
        if needsFirstSegment {
            segmentStartTime = pts
        }
        let elapsed = needsFirstSegment ? 0 :
            CMTimeGetSeconds(CMTimeSubtract(pts, segmentStartTime))
        let needsRoll = !needsFirstSegment && elapsed >= segmentDuration && !stopping

        if needsRoll {
            let oldWriter = segmentWriter
            let oldCounter = segmentCounter
            segmentCounter += 1
            segmentStartTime = pts
            segmentWriter = nil
            segmentLock.unlock()

            let newStartTime = pts
            finalizeSegment(oldWriter, counter: oldCounter) { [weak self] in
                self?.openNewSegment(startTime: newStartTime)
            }
            return // don't append this frame; next frame will hit the new segment
        }

        let writer = segmentWriter
        segmentLock.unlock()

        if needsFirstSegment {
            openNewSegment(startTime: pts)
            // Append to the freshly opened segment
            segmentLock.lock()
            let w = segmentWriter
            segmentLock.unlock()
            w?.append(videoBuffer: sampleBuffer)
        } else {
            writer?.append(videoBuffer: sampleBuffer)
        }
    }

    private func openNewSegment(startTime: CMTime) {
        let videoDir = (args.outDir as NSString).appendingPathComponent("video")
        let idx: Int = segmentLock.withCriticalSection { segmentCounter }
        let filename = String(format: "part-%03d.mp4", idx)
        let path = (videoDir as NSString).appendingPathComponent(filename)
        do {
            let w = try SegmentWriter(path: path,
                                      videoSettings: videoSettings,
                                      audioSettings: segAudioSettings)
            w.start(at: startTime)
            segmentLock.lock()
            segmentWriter = w
            segmentLock.unlock()
        } catch {
            emitError(code: "fatal", message: "Cannot open segment \(path): \(error)")
        }
    }

    private func finalizeSegment(_ writer: SegmentWriter?, counter: Int, then next: (() -> Void)? = nil) {
        guard let writer = writer else { next?(); return }
        writer.finalize {
            let seq = counter
            let path = writer.path
            emitJSON(["event": "chunk", "kind": "video", "seq": seq, "path": path])
            next?()
        }
    }

    // MARK: System audio handling

    private func handleSystemAudio(_ sampleBuffer: CMSampleBuffer) {
        // Write to the system-audio track in audio.m4a (Fix 1: separate track from mic).
        audioFileWriter?.appendSystemAudio(sampleBuffer)
        // Also forward to the current segment's single audio input.
        // The segment audio input receives only system audio; mic is not mixed in
        // at the segment level (the segment is primarily for video preview, not transcription).
        segmentLock.lock()
        let writer = segmentWriter
        segmentLock.unlock()
        writer?.append(audioBuffer: sampleBuffer)
    }

    // MARK: Stop

    func stop() {
        stopping = true
        micEngine?.inputNode.removeTap(onBus: 0)
        micEngine?.stop()

        stream?.stopCapture { [weak self] error in
            guard let self = self else { return }
            if let error = error {
                emitError(code: "fatal", message: "stopCapture error: \(error.localizedDescription)")
            }
            self.finalizeAll()
        }
    }

    private func finalizeAll() {
        segmentLock.lock()
        let lastWriter = segmentWriter
        let lastCounter = segmentCounter
        segmentWriter = nil
        segmentLock.unlock()

        let group = DispatchGroup()

        // Finalize last video segment
        group.enter()
        finalizeSegment(lastWriter, counter: lastCounter) {
            group.leave()
        }

        // Finalize continuous audio
        group.enter()
        audioFileWriter?.finalize {
            group.leave()
        }

        group.notify(queue: .main) {
            emitJSON(["event": "stopped"])
            exit(0)
        }
    }
}

// MARK: - NSLock helper

extension NSLock {
    @discardableResult
    func withCriticalSection<T>(_ body: () -> T) -> T {
        lock()
        defer { unlock() }
        return body()
    }
}

// MARK: - Main

guard #available(macOS 13.0, *) else {
    emitError(code: "fatal", message: "macOS 13.0 or later required")
    exit(1)
}

guard let args = parseArgs() else {
    fputs("Usage: UtterRecorder --out-dir <path> --display-id <uint32> --mic-device <deviceUID|default>\n", stderr)
    exit(1)
}

let recorder = Recorder(args: args)
recorder.start()

// SIGTERM handler: use DispatchSource because signal() requires a C function pointer
// and cannot capture Swift closures that reference objects.
signal(SIGTERM, SIG_IGN) // ignore at POSIX level so DispatchSource gets it
let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigtermSource.setEventHandler {
    recorder.stop()
}
sigtermSource.resume()

// Keep the run loop alive until the recorder signals it is done
// (stoppedSemaphore.signal() is called from finalizeAll, which posts back to .main,
//  so we must not block .main — instead spin the run loop).
RunLoop.main.run(until: Date(timeIntervalSinceNow: 60 * 60 * 24)) // up to 24 h
