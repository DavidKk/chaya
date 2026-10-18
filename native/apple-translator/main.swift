import Foundation
import Translation

struct Request: Codable {
    let id: String
    let type: String // "translate" | "check" | "ping"
    let text: String?
    let source: String?
    let target: String?
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

    func checkStatus(source: String, target: String) async -> (status: String, error: String?, message: String?) {
        let s = Locale.Language(identifier: source)
        let t = Locale.Language(identifier: target)
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

    func getOrCreateSession(source: String, target: String) -> TranslationSession {
        let key = sessionKey(source: source, target: target)
        if let existing = sessions[key] {
            return existing
        }
        let s = Locale.Language(identifier: source)
        let t = Locale.Language(identifier: target)
        let session = TranslationSession(installedSource: s, target: t)
        sessions[key] = session
        return session
    }

    func translate(text: String, source: String, target: String) async throws -> String {
        let session = getOrCreateSession(source: source, target: target)
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
                    if errDesc.contains("notInstalled") {
                        errCode = "not_installed"
                    }
                    sendResponse(Response(
                        id: req.id,
                        success: false,
                        result: nil,
                        status: nil,
                        error: errCode,
                        message: error.localizedDescription
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
