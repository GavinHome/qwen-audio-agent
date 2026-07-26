import AudioToolbox
import Foundation

private let voiceSampleRate = 48_000.0

private struct Command: Decodable {
    let type: String
    let audio: String?
    let sampleRate: Double?
    let enabled: Bool?
}

private func pcmFormat(sampleRate: Double) -> AudioStreamBasicDescription {
    AudioStreamBasicDescription(
        mSampleRate: sampleRate,
        mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
        mBytesPerPacket: 2,
        mFramesPerPacket: 1,
        mBytesPerFrame: 2,
        mChannelsPerFrame: 1,
        mBitsPerChannel: 16,
        mReserved: 0
    )
}

private func check(_ status: OSStatus, _ operation: String) throws {
    guard status == noErr else {
        throw NSError(
            domain: "QwenAudioAgentVoiceIO",
            code: Int(status),
            userInfo: [
                NSLocalizedDescriptionKey:
                    "\(operation)失败（CoreAudio \(status)）",
            ]
        )
    }
}

private func resample(
    _ input: UnsafeBufferPointer<Int16>,
    from sourceRate: Double,
    to targetRate: Double
) -> [Int16] {
    guard !input.isEmpty else { return [] }
    if abs(sourceRate - targetRate) < 1 {
        return Array(input)
    }
    let outputCount = max(
        1,
        Int((Double(input.count) * targetRate / sourceRate).rounded())
    )
    var output = [Int16](repeating: 0, count: outputCount)
    let sourceStep = sourceRate / targetRate
    for index in 0..<outputCount {
        let position = min(Double(input.count - 1), Double(index) * sourceStep)
        let lower = Int(position)
        let upper = min(input.count - 1, lower + 1)
        let fraction = position - Double(lower)
        let value =
            Double(input[lower]) * (1 - fraction)
            + Double(input[upper]) * fraction
        output[index] = Int16(
            max(Double(Int16.min), min(Double(Int16.max), value.rounded()))
        )
    }
    return output
}

private final class SampleQueue {
    private let lock = NSLock()
    private var samples: [Int16] = []
    private var offset = 0

    func append(_ values: [Int16]) {
        guard !values.isEmpty else { return }
        lock.lock()
        if offset > 16_384, offset * 2 > samples.count {
            samples.removeFirst(offset)
            offset = 0
        }
        samples.append(contentsOf: values)
        lock.unlock()
    }

    func read(into destination: UnsafeMutableBufferPointer<Int16>) {
        lock.lock()
        let available = max(0, samples.count - offset)
        let count = min(available, destination.count)
        if count > 0 {
            samples.withUnsafeBufferPointer { source in
                destination.baseAddress?.update(
                    from: source.baseAddress!.advanced(by: offset),
                    count: count
                )
            }
            offset += count
        }
        lock.unlock()
        if count < destination.count {
            destination.baseAddress?.advanced(by: count).initialize(
                repeating: 0,
                count: destination.count - count
            )
        }
    }

    func clear() {
        lock.lock()
        samples.removeAll(keepingCapacity: true)
        offset = 0
        lock.unlock()
    }
}

private final class VoiceIO {
    private let outputQueue = DispatchQueue(label: "qwen-audio-agent.voice-io.output")
    private let captureLock = NSLock()
    private let playback = SampleQueue()
    private let captureSampleRate: Double
    private let playbackSampleRate: Double
    private var captureEnabled = true
    private var audioUnit: AudioUnit?
    private var isRunning = false

    init(captureSampleRate: Double, playbackSampleRate: Double) {
        self.captureSampleRate = captureSampleRate
        self.playbackSampleRate = playbackSampleRate
    }

    func start() throws {
        var description = AudioComponentDescription(
            componentType: kAudioUnitType_Output,
            componentSubType: kAudioUnitSubType_VoiceProcessingIO,
            componentManufacturer: kAudioUnitManufacturer_Apple,
            componentFlags: 0,
            componentFlagsMask: 0
        )
        guard let component = AudioComponentFindNext(nil, &description) else {
            throw NSError(
                domain: "QwenAudioAgentVoiceIO",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "找不到 VoiceProcessingIO"]
            )
        }

        var unit: AudioUnit?
        try check(
            AudioComponentInstanceNew(component, &unit),
            "创建 VoiceProcessingIO"
        )
        guard let unit else {
            throw NSError(
                domain: "QwenAudioAgentVoiceIO",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "VoiceProcessingIO 创建为空"]
            )
        }
        audioUnit = unit

        var enabled: UInt32 = 1
        try check(
            AudioUnitSetProperty(
                unit,
                kAudioOutputUnitProperty_EnableIO,
                kAudioUnitScope_Input,
                1,
                &enabled,
                UInt32(MemoryLayout<UInt32>.size)
            ),
            "启用麦克风"
        )

        // VoiceProcessingIO requires both client sides to share one format.
        // Bus 0 input is the far-end playback reference; bus 1 output is the
        // echo-cancelled microphone signal.
        var format = pcmFormat(sampleRate: voiceSampleRate)
        let formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        try check(
            AudioUnitSetProperty(
                unit,
                kAudioUnitProperty_StreamFormat,
                kAudioUnitScope_Input,
                0,
                &format,
                formatSize
            ),
            "设置播放格式"
        )
        try check(
            AudioUnitSetProperty(
                unit,
                kAudioUnitProperty_StreamFormat,
                kAudioUnitScope_Output,
                1,
                &format,
                formatSize
            ),
            "设置录音格式"
        )

        var playbackHandler = AURenderCallbackStruct(
            inputProc: playbackCallback,
            inputProcRefCon: Unmanaged.passUnretained(self).toOpaque()
        )
        try check(
            AudioUnitSetProperty(
                unit,
                kAudioUnitProperty_SetRenderCallback,
                kAudioUnitScope_Input,
                0,
                &playbackHandler,
                UInt32(MemoryLayout<AURenderCallbackStruct>.size)
            ),
            "设置播放回调"
        )

        var captureHandler = AURenderCallbackStruct(
            inputProc: captureCallback,
            inputProcRefCon: Unmanaged.passUnretained(self).toOpaque()
        )
        try check(
            AudioUnitSetProperty(
                unit,
                kAudioOutputUnitProperty_SetInputCallback,
                kAudioUnitScope_Global,
                1,
                &captureHandler,
                UInt32(MemoryLayout<AURenderCallbackStruct>.size)
            ),
            "设置录音回调"
        )

        try check(AudioUnitInitialize(unit), "初始化 VoiceProcessingIO")
        try check(AudioOutputUnitStart(unit), "启动 VoiceProcessingIO")
        isRunning = true
        emit([
            "type": "ready",
            "aec": true,
            "inputSampleRate": captureSampleRate,
            "voiceProcessingSampleRate": voiceSampleRate,
        ])
    }

    func setCaptureEnabled(_ enabled: Bool) {
        captureLock.lock()
        captureEnabled = enabled
        captureLock.unlock()
    }

    private func shouldCapture() -> Bool {
        captureLock.lock()
        defer { captureLock.unlock() }
        return captureEnabled
    }

    func renderPlayback(
        frameCount: UInt32,
        buffers: UnsafeMutablePointer<AudioBufferList>?
    ) -> OSStatus {
        guard let buffers else { return noErr }
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        for buffer in list {
            guard let data = buffer.mData else { continue }
            let sampleCount = Int(buffer.mDataByteSize) / MemoryLayout<Int16>.size
            let destination = data.bindMemory(to: Int16.self, capacity: sampleCount)
            playback.read(
                into: UnsafeMutableBufferPointer(
                    start: destination,
                    count: sampleCount
                )
            )
        }
        return noErr
    }

    func capture(
        flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
        timestamp: UnsafePointer<AudioTimeStamp>,
        frameCount: UInt32
    ) -> OSStatus {
        guard let audioUnit else { return kAudio_ParamError }
        var samples = [Int16](repeating: 0, count: Int(frameCount))
        let status = samples.withUnsafeMutableBytes { bytes -> OSStatus in
            var list = AudioBufferList(
                mNumberBuffers: 1,
                mBuffers: AudioBuffer(
                    mNumberChannels: 1,
                    mDataByteSize: UInt32(bytes.count),
                    mData: bytes.baseAddress
                )
            )
            return AudioUnitRender(
                audioUnit,
                flags,
                timestamp,
                1,
                frameCount,
                &list
            )
        }
        guard status == noErr, shouldCapture() else { return status }

        let converted = samples.withUnsafeBufferPointer {
            resample($0, from: voiceSampleRate, to: captureSampleRate)
        }
        let data = converted.withUnsafeBytes { Data($0) }
        emit([
            "type": "audio",
            "audio": data.base64EncodedString(),
            "sampleRate": captureSampleRate,
        ])
        return noErr
    }

    func play(base64: String, sampleRate: Double) {
        guard
            let data = Data(base64Encoded: base64),
            !data.isEmpty,
            abs(sampleRate - playbackSampleRate) < 1
        else { return }
        let converted = data.withUnsafeBytes { bytes -> [Int16] in
            let input = bytes.bindMemory(to: Int16.self)
            return resample(
                input,
                from: playbackSampleRate,
                to: voiceSampleRate
            )
        }
        playback.append(converted)
    }

    func clearPlayback() {
        playback.clear()
    }

    func stop() {
        guard let audioUnit else { return }
        if isRunning {
            AudioOutputUnitStop(audioUnit)
            isRunning = false
        }
        AudioUnitUninitialize(audioUnit)
        AudioComponentInstanceDispose(audioUnit)
        self.audioUnit = nil
    }

    private func emit(_ payload: [String: Any]) {
        outputQueue.async {
            guard
                let data = try? JSONSerialization.data(withJSONObject: payload),
                var line = String(data: data, encoding: .utf8)
            else { return }
            line.append("\n")
            FileHandle.standardOutput.write(Data(line.utf8))
        }
    }
}

private func playbackCallback(
    _ refCon: UnsafeMutableRawPointer,
    _ flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
    _ timestamp: UnsafePointer<AudioTimeStamp>,
    _ bus: UInt32,
    _ frames: UInt32,
    _ data: UnsafeMutablePointer<AudioBufferList>?
) -> OSStatus {
    Unmanaged<VoiceIO>.fromOpaque(refCon).takeUnretainedValue()
        .renderPlayback(frameCount: frames, buffers: data)
}

private func captureCallback(
    _ refCon: UnsafeMutableRawPointer,
    _ flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
    _ timestamp: UnsafePointer<AudioTimeStamp>,
    _ bus: UInt32,
    _ frames: UInt32,
    _ data: UnsafeMutablePointer<AudioBufferList>?
) -> OSStatus {
    Unmanaged<VoiceIO>.fromOpaque(refCon).takeUnretainedValue()
        .capture(flags: flags, timestamp: timestamp, frameCount: frames)
}

private func argument(_ name: String, fallback: Double) -> Double {
    guard
        let index = CommandLine.arguments.firstIndex(of: name),
        CommandLine.arguments.indices.contains(index + 1),
        let value = Double(CommandLine.arguments[index + 1]),
        value > 0
    else { return fallback }
    return value
}

do {
    let voiceIO = VoiceIO(
        captureSampleRate: argument("--capture-rate", fallback: 16_000),
        playbackSampleRate: argument("--playback-rate", fallback: 24_000)
    )
    try voiceIO.start()
    while let line = readLine() {
        guard
            let data = line.data(using: .utf8),
            let command = try? JSONDecoder().decode(Command.self, from: data)
        else { continue }
        switch command.type {
        case "play":
            if let audio = command.audio {
                voiceIO.play(
                    base64: audio,
                    sampleRate: command.sampleRate ?? 24_000
                )
            }
        case "clear":
            voiceIO.clearPlayback()
        case "capture":
            voiceIO.setCaptureEnabled(command.enabled != false)
        case "close":
            voiceIO.stop()
            exit(0)
        default:
            continue
        }
    }
    voiceIO.stop()
} catch {
    let payload: [String: Any] = [
        "type": "error",
        "message": error.localizedDescription,
    ]
    if
        let data = try? JSONSerialization.data(withJSONObject: payload),
        let line = String(data: data, encoding: .utf8)
    {
        FileHandle.standardOutput.write(Data("\(line)\n".utf8))
    }
    exit(1)
}
