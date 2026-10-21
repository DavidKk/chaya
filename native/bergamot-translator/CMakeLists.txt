cmake_minimum_required(VERSION 3.24)
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)
project(chaya_bergamot_translator LANGUAGES CXX C)

include(FetchContent)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(COMPILE_CUDA OFF CACHE BOOL "" FORCE)
set(COMPILE_SERVER OFF CACHE BOOL "" FORCE)
set(COMPILE_TESTS OFF CACHE BOOL "" FORCE)
set(COMPILE_UNIT_TESTS OFF CACHE BOOL "" FORCE)
set(COMPILE_EXAMPLES OFF CACHE BOOL "" FORCE)
set(COMPILE_PYTHON OFF CACHE BOOL "" FORCE)
set(USE_FBGEMM OFF CACHE BOOL "" FORCE)
set(USE_SENTENCEPIECE ON CACHE BOOL "" FORCE)
set(GIT_SUBMODULE OFF CACHE BOOL "" FORCE)
FetchContent_Declare(bergamot
  GIT_REPOSITORY https://github.com/browsermt/bergamot-translator.git
  GIT_TAG 9271618ebbdc5d21ac4dc4df9e72beb7ce644774
  GIT_SUBMODULES 3rd_party/marian-dev 3rd_party/ssplit-cpp
  GIT_SUBMODULES_RECURSE TRUE)
FetchContent_Declare(json
  URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
  URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(bergamot json)

if(APPLE)
  target_compile_definitions(zlib PRIVATE fdopen=fdopen)
endif()
if(CMAKE_CXX_COMPILER_ID MATCHES "Clang" AND CMAKE_CXX_COMPILER_VERSION VERSION_GREATER_EQUAL 16)
  set_property(SOURCE "${bergamot_SOURCE_DIR}/3rd_party/marian-dev/src/3rd_party/ExceptionWithCallStack.cpp"
    TARGET_DIRECTORY marian APPEND PROPERTY COMPILE_OPTIONS -Wno-error=vla-cxx-extension)
  set(SPM_TRAINER "${bergamot_SOURCE_DIR}/3rd_party/marian-dev/src/3rd_party/sentencepiece/src/trainer_interface.cc")
  file(READ "${SPM_TRAINER}" SPM_TRAINER_SOURCE)
  string(REPLACE "constexpr unicode_script::ScriptType kAnyType" "const unicode_script::ScriptType kAnyType"
    SPM_TRAINER_PATCHED "${SPM_TRAINER_SOURCE}")
  if(NOT SPM_TRAINER_SOURCE STREQUAL SPM_TRAINER_PATCHED)
    file(WRITE "${SPM_TRAINER}" "${SPM_TRAINER_PATCHED}")
  endif()
endif()

add_executable(chaya-bergamot-translator main.cpp)
target_link_libraries(chaya-bergamot-translator PRIVATE bergamot-translator nlohmann_json::nlohmann_json)
install(TARGETS chaya-bergamot-translator RUNTIME DESTINATION . COMPONENT chaya)
