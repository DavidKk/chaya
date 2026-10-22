import Foundation
import Translation

struct Request: Codable {
    let id: String
    let type: String // "translate" | "batch" | "check" | "ping"
    let text: String?
    let source: String?
    let target: String?
    let items: [BatchItem]?
}

struct BatchItem: Codable {
    let id: String
    let text: String
}

struct Response: Codable {
    let id: String
    let success: Bool
    let result: String?
    let status: String?
    let error: String?
    let message: String?
}

@available(macOS 15.0, *)
actor TranslationCoordinator {
    private var sessions: [String: TranslationSession] = [:]
    private let availability = LanguageAvailability()

    private func sessionKey(source: String, target: String) -> String {
        return "\(source)->\(target)"
    }

    // Generic English can resolve to US English even when only the UK pack is installed.
    // Keep status checks and translation sessions on the same installed language pair.
    private func installedPair(source: String, target: String) async -> (Locale.Language, Locale.Language) {
        let sources = source == "en" ? ["en", "en-US", "en-GB"] : [source]
        let targets = target == "en" ? ["en", "en-US", "en-GB"] : [target]
        for src in sources {
            for tgt in targets {
                let s = Locale.Language(identifier: src)
                let t = Locale.Language(identifier: tgt)
                if await availability.status(from: s, to: t) == .installed { return (s, t) }
            }
        }
        return (Locale.Language(identifier: source), Locale.Language(identifier: target))
    }

    func checkStatus(source: String, target: String) async -> (status: String, error: String?, message: String?) {
        let (s, t) = await installedPair(source: source, target: target)
        let status = await availability.status(from: s, to: t)
        switch status {
        case .installed:
            return ("installed", nil, nil)
        case .supported:
            return ("supported", "not_installed", "Language model supported but offline pack not installed")
        case .unsupported:
            return ("unsupported", "unsupported", "Language pair not supported by Apple Translation")
        @unknown default:
            return ("unknown", "unknown", "Unknown language availability status")
        }
    }

    func getOrCreateSession(source: String, target: String) async -> TranslationSession {
        let key = sessionKey(source: source, target: target)
        if let existing = sessions[key] {
            return existing
        }
        let (s, t) = await installedPair(source: source, target: target)
        let session = TranslationSession(installedSource: s, target: t)
        sessions[key] = session
        return session
    }

    func translateBatch(id: String, items: [BatchItem], source: String, target: String) async {
        let started = ProcessInfo.processInfo.systemUptime
        let reused = sessions[sessionKey(source: source, target: target)] != nil
        func timing(_ stage: String) {
            guard ProcessInfo.processInfo.environment["CHAYA_TRANSLATE_DEBUG"] == "1" else { return }
            let ms = Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
            let message = "[apple-native-timing] id=\(id) stage=\(stage) atMs=\(Int(Date().timeIntervalSince1970 * 1000)) elapsedMs=\(ms) items=\(items.count) sourceChars=\(items.reduce(0) { $0 + $1.text.unicodeScalars.count }) sessionReused=\(reused)\n"
            FileHandle.standardError.write(Data(message.utf8))
        }
        timing("received")
        let session = await getOrCreateSession(source: source, target: target)
        timing("session_ready")
        let requests = items.map { TranslationSession.Request(sourceText: $0.text, clientIdentifier: $0.id) }
        var pending = Set(items.map { $0.id })
        do {
            for try await response in session.translate(batch: requests) {
                guard let itemId = response.clientIdentifier, pending.remove(itemId) != nil else { continue }
                if pending.count == items.count - 1 { timing("first_result") }
                sendResponse(Response(id: itemId, success: true, result: response.targetText,
                                      status: nil, error: nil, message: nil))
            }
        } catch {
            for itemId in pending {
                sendResponse(Response(id: itemId, success: false, result: nil, status: nil,
                                      error: "translation_error", message: error.localizedDescription))
            }
            pending.removeAll()
        }
        for itemId in pending {
            sendResponse(Response(id: itemId, success: false, result: nil, status: nil,
                                  error: "missing_result", message: "No result returned for batch item"))
        }
        timing("finished")
    }

    func translate(text: String, source: String, target: String) async throws -> String {
        let session = await getOrCreateSession(source: source, target: target)
        let response = try await session.translate(text)
        return response.targetText
    }
}

func sendResponse(_ response: Response) {
    do {
        let data = try JSONEncoder().encode(response)
        if let str = String(data: data, encoding: .utf8) {
            print(str)
            fflush(stdout)
        }
    } catch {
        fputs("Failed to encode response\n", stderr)
    }
}

@available(macOS 15.0, *)
@main
struct TranslatorDaemon {
    static func main() async {
        let coordinator = TranslationCoordinator()
        
        while let line = readLine() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }
            
            guard let data = trimmed.data(using: .utf8),
                  let req = try? JSONDecoder().decode(Request.self, from: data) else {
                sendResponse(Response(
                    id: "unknown",
                    success: false,
                    result: nil,
                    status: nil,
                    error: "invalid_json",
                    message: "Failed to parse JSON request"
                ))
                continue
            }
            
            if req.type == "ping" {
                sendResponse(Response(
                    id: req.id,
                    success: true,
                    result: "pong",
                    status: "ready",
                    error: nil,
                    message: nil
                ))
                continue
            }
            
            let source = req.source ?? "ja"
            let target = req.target ?? "zh-Hans"
            
            if req.type == "check" {
                let res = await coordinator.checkStatus(source: source, target: target)
                sendResponse(Response(
                    id: req.id,
                    success: res.error == nil,
                    result: nil,
                    status: res.status,
                    error: res.error,
                    message: res.message
                ))
                continue
            }
            
            if req.type == "batch" {
                guard let items = req.items, !items.isEmpty, items.count <= 40,
                      Set(items.map { $0.id }).count == items.count,
                      items.allSatisfy({ !$0.text.isEmpty && $0.text.count <= 20000 }),
                      items.reduce(0, { $0 + $1.text.count }) <= 40000 else {
                    sendResponse(Response(id: req.id, success: false, result: nil, status: nil,
                                          error: "invalid_batch", message: "Invalid translation batch"))
                    continue
                }
                await coordinator.translateBatch(id: req.id, items: items, source: source, target: target)
                continue
            }

            if req.type == "translate" {
                guard let text = req.text, !text.isEmpty else {
                    sendResponse(Response(
                        id: req.id,
                        success: true,
                        result: "",
                        status: nil,
                        error: nil,
                        message: nil
                    ))
                    continue
                }
                
                do {
                    let translated = try await coordinator.translate(text: text, source: source, target: target)
                    sendResponse(Response(
                        id: req.id,
                        success: true,
                        result: translated,
                        status: nil,
                        error: nil,
                        message: nil
                    ))
                } catch {
                    let errDesc = String(describing: error)
                    var errCode = "translation_error"
                    var message = error.localizedDescription
                    if errDesc.contains("notInstalled") {
                        errCode = "not_installed"
                        message = "Apple offline language pack not installed. Please download the language pack in macOS System Settings -> General -> Language & Region -> Translation Languages."
                    }
                    sendResponse(Response(
                        id: req.id,
                        success: false,
                        result: nil,
                        status: nil,
                        error: errCode,
                        message: message
                    ))
                }
                continue
            }
            
            sendResponse(Response(
                id: req.id,
                success: false,
                result: nil,
                status: nil,
                error: "unknown_type",
                message: "Unsupported request type: \(req.type)"
            ))
        }
    }
}
