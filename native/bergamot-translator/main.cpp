#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <memory>
#include <regex>
#include <stdexcept>
#include <string>

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
          auto results = service->translateMultiple(model, {std::move(text)}, {marian::bergamot::ResponseOptions{}});
          const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
          response.update({{"success", true}, {"translatedText", results.at(0).target.text}, {"durationMs", duration}});
        }
      }
    } catch (const std::exception& error) {
      response["error"] = error.what();
    }
    std::cout << response.dump() << std::endl;
  }
  return 0;
}
