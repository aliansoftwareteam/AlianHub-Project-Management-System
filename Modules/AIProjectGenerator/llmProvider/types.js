/**
 * Shared interface for LLM providers used by the AI Project Generator.
 *
 * @typedef {Object} ChatMessage
 * @property {"system"|"user"|"assistant"} role
 * @property {string} content
 *
 * @typedef {Object} ChatOptions
 * @property {ChatMessage[]} messages          - User / assistant turn history (no system here).
 * @property {string} [systemPrompt]           - System instructions sent separately.
 * @property {boolean} [jsonMode]              - Force JSON-only output if the provider supports it.
 * @property {number} [maxTokens]              - Max output tokens.
 * @property {number} [temperature]            - 0..1.
 *
 * @typedef {Object} ChatResult
 * @property {string} content                  - Raw text content of the assistant turn.
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} totalTokens
 * @property {string} model                    - Model id actually used (for logging).
 *
 * @typedef {Object} LlmProvider
 * @property {string} name                                                   - "openai" | "anthropic"
 * @property {boolean} isConfigured                                          - Both key + model set.
 * @property {(opts: ChatOptions) => Promise<ChatResult>} chat               - Non-streaming chat.
 */

module.exports = {};
