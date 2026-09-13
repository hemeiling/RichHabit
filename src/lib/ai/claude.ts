import Anthropic from "@anthropic-ai/sdk";
import { AiFailed, type AiProvider } from "./provider";

/**
 * Claude, through Anthropic's official SDK. Server-only.
 *
 * Structured output comes from a single forced tool call: the model is given
 * one tool whose input schema is the shape we want, and told to use it. What
 * comes back is that tool's input, which the caller still validates — a schema
 * the model was asked to follow is not a guarantee that it did.
 *
 * Errors are reduced to a status code before they leave this file. The SDK's
 * error objects can carry request details, and none of that may reach a log.
 */
export function createClaudeProvider(apiKey: string, model: string): AiProvider {
  // The key is scoped to one Anthropic workspace, so requests need no workspace header.
  const client = new Anthropic({ apiKey, maxRetries: 1 });

  return {
    name: "claude",
    async generateStructured(request) {
      let message: Anthropic.Message;
      try {
        message = await client.messages.create(
          {
            model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: [{ role: "user", content: request.prompt }],
            tools: [{
              name: request.toolName,
              description: request.toolDescription,
              input_schema: request.schema as Anthropic.Tool.InputSchema,
            }],
            tool_choice: { type: "tool", name: request.toolName },
          },
          { timeout: request.timeoutMs },
        );
      } catch (e) {
        const status = e instanceof Anthropic.APIError && typeof e.status === "number" ? e.status : null;
        throw new AiFailed(status);
      }
      const block = message.content.find((c) => c.type === "tool_use");
      return block && block.type === "tool_use" ? block.input : null;
    },
  };
}
