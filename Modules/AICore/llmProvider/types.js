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
 * @property {string} [provider]               - Which registry adapter should answer. Honoured by
 *                                               getProvider() only while AI_MODEL_ROUTER is on.
 * @property {string} [model]                  - Model id to send instead of the adapter's configured
 *                                               one. Honoured only while AI_MODEL_ROUTER is on, and
 *                                               priced by the spend meter like any other model.
 * @property {boolean} [jsonMode]              - Force JSON-only output if the provider supports it.
 * @property {number} [maxTokens]              - Max output tokens.
 * @property {number} [temperature]            - 0..1.
 * @property {{feature:string, companyId:string, userId?:string, runId?:string, account?:string}} spend
 *                                             - Ledger context: which feature is spending, for which tenant.
 *
 * @typedef {Object} ChatResult
 * @property {string} content                  - Raw text content of the assistant turn.
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} totalTokens
 * @property {string} model                    - Model id actually used (for logging).
 *
 * @typedef {Object} ProviderCapabilities
 * @property {string} structuredOutput         - How this vendor is asked for JSON: see normalise.STRUCTURED_OUTPUT.
 * @property {number} defaultMaxTokens         - Output ceiling used when the caller names none.
 * @property {(model: string) => number} maxOutputTokens    - This model's hard output ceiling.
 * @property {(model: string) => boolean} isReasoningModel  - Thinks before answering: roomier budget, longer timeout.
 * @property {boolean} omitTemperatureWhenReasoning         - Reasoning models here reject an explicit temperature.
 *
 * @typedef {Object} LlmProvider
 * @property {string} name                                                   - A key of the registry: "openai" | "anthropic" | "deepseek" | "google".
 * @property {boolean} isConfigured                                          - Both key + model set.
 * @property {ProviderCapabilities} capabilities                             - What normalise.js reads to shape one request.
 * @property {(opts: ChatOptions) => Promise<ChatResult>} chat               - Non-streaming chat.
 */

module.exports = {};
