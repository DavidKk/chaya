#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <memory>
#include <regex>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>
#include "translator/parser.h"
#include "translator/response.h"
#include "translator/response_options.h"
#include "translator/service.h"

namespace fs = std::filesystem;
using Json = nlohmann::json;
using marian::bergamot::BlockingService;
using marian::bergamot::TranslationModel;

std::string environment(const char* name) {
  const char* value = std::getenv(name);
  return value ? value : "";
}

fs::path packsRoot() {
  const auto explicitRoot = environment("CHAYA_BERGAMOT_PACKS_DIR");
  if (!explicitRoot.empty()) return explicitRoot;
  const auto dataHome = environment("XDG_DATA_HOME");
  if (!dataHome.empty()) return fs::path(dataHome) / "chaya/translation-packs";
  const auto home = environment("HOME");
  if (home.empty()) throw std::runtime_error("HOME or CHAYA_BERGAMOT_PACKS_DIR must be set");
  return fs::path(home) / ".local/share/chaya/translation-packs";
}

std::vector<std::string> splitLines(const std::string& text) {
  std::vector<std::string> lines;
  std::string current;
  for (const char ch : text) {
    if (ch == '\n') {
      lines.push_back(current);
      current.clear();
    } else if (ch != '\r') {
      current.push_back(ch);
    }
  }
  lines.push_back(current);
  return lines;
}

bool blankLine(const std::string& line) {
  return line.find_first_not_of(" \t") == std::string::npos;
}

std::string joinLines(const std::vector<std::string>& lines) {
  std::string out;
  for (size_t i = 0; i < lines.size(); ++i) {
    if (i) out.push_back('\n');
    out += lines[i];
  }
  return out;
}

/** Translate each line on its own and keep the original line count, including blanks. */
std::string translateLines(BlockingService& service, const std::shared_ptr<TranslationModel>& model, std::string text) {
  const auto lines = splitLines(text);
  std::vector<std::string> sources;
  std::vector<size_t> indexes;
  sources.reserve(lines.size());
  for (size_t i = 0; i < lines.size(); ++i) {
    if (blankLine(lines[i])) continue;
    sources.push_back(lines[i]);
    indexes.push_back(i);
  }
  if (sources.empty()) return joinLines(lines);
  const std::vector<marian::bergamot::ResponseOptions> options(sources.size());
  const auto results = service.translateMultiple(model, std::move(sources), options);
  if (results.size() != indexes.size()) throw std::runtime_error("Bergamot returned a different number of lines");
  auto translated = lines;
  for (size_t i = 0; i < indexes.size(); ++i) {
    auto line = results[i].target.text;
    for (char& ch : line) {
      if (ch == '\n' || ch == '\r') ch = ' ';
    }
    translated[indexes[i]] = std::move(line);
  }
  return joinLines(translated);
}

fs::path packConfig(const Json& request) {
  const auto from = request.at("from").get<std::string>();
  const auto to = request.at("to").get<std::string>();
  const std::regex language("^[a-z]{2,3}(-[A-Za-z]{2,4})?$");
  if (!std::regex_match(from, language) || !std::regex_match(to, language)) {
    throw std::runtime_error("Invalid translation language code");
  }
  return packsRoot() / (from + "_" + to) / "config.yml";
}

int main() {
  std::unique_ptr<BlockingService> service;
  std::shared_ptr<TranslationModel> model;
  fs::path loadedConfig;
  std::string line;
  while (std::getline(std::cin, line)) {
    Json response = {{"id", nullptr}, {"success", false}};
    try {
      const auto request = Json::parse(line);
      response["id"] = request.at("id").get<std::string>();
      const auto action = request.at("action").get<std::string>();
      if (action != "check" && action != "translate") throw std::runtime_error("Unknown Bergamot action");
      const auto config = packConfig(request);
      const bool installed = fs::is_regular_file(config);
      if (!installed) {
        if (action == "translate") throw std::runtime_error("Language pack not installed: " + config.string());
        response.update({{"success", true}, {"installed", false}, {"path", config.parent_path().string()}});
      } else {
        const auto started = std::chrono::steady_clock::now();
        if (loadedConfig != config) {
          model.reset();
          loadedConfig.clear();
          auto options = marian::bergamot::parseOptionsFromFilePath(config.string());
          options->set("quiet", true);
          options->set("quiet-translation", true);
          options->set("cpu-threads", 1);
          if (!service) service = std::make_unique<BlockingService>(BlockingService::Config{});
          model = std::make_shared<TranslationModel>(options);
          loadedConfig = config;
        }
        if (action == "check") {
          response.update({{"success", true}, {"installed", true}, {"path", config.parent_path().string()}});
        } else {
          auto text = request.at("text").get<std::string>();
          if (text.size() > 80000) throw std::runtime_error("Translation text exceeds 80000 bytes");
          const auto translated = translateLines(*service, model, std::move(text));
          const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
          response.update({{"success", true}, {"translatedText", translated}, {"durationMs", duration}});
        }
      }
    } catch (const std::exception& error) {
      response["error"] = error.what();
    }
    std::cout << response.dump() << std::endl;
  }
  return 0;
}
