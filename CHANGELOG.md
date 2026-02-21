# Changelog

All notable changes to this project will be documented in this file.

## [5.1.0] - WIP

### Added
- [All] New `PluginTool` format for defining tools in `CustomToolPlugin` and `MultiToolPlugin`
- [All] Tool execution delegate for external per-request tools
- [All] Expose provider base URLs programmatically
- [Google] Base URL support
- [Ollama] Handling of logprobs

### Changed
- N/A

### Fixed
- [All] Nested array and array-of-array tool params preservation
- [Ollama] Model variant wildcard for reasoning models

### Removed
- N/A


## [5.0.1] - 2025-01-27

### Fixed
- [All] Text content generated before tool calls is now preserved in the conversation thread

## [5.0.0] - 2025-01-26

### Added
- [All] Hooks system for customizing tool call behavior
- [All] Request cooldown for rate limit management
- [OpenAI] Service tiering and timeout configuration
- [OpenAI] More baseURL overrides
- [OpenRouter] Reasoning details support
- [Google] Support for Gemini 3 Preview (thoughtSignature)
- [Google] Support for Nano Banana Pro

### Changed
- [All] Major refactoring of tool call handling with normalized processing across all providers
- [All] Function calls injection in message threads
- [All] Improved typing for streaming contexts and payloads

### Fixed
- [Google] Multi tool calling
- [Google] Model capabilities
- [Anthropic] Multi tool calling
- [Deepseek] Function calling with Deepseek-Reasoner
- [Mistral] Reasoning tokens

### Removed
- N/A
