Below is a focused “diff‑level” checklist of the exact changes you must make inside src/providers/openai.ts (and two small helpers) so that o3 / o4 models work through the new responses API and the Missing required parameter: ‘tools[0].type’ exception disappears.

⸻

1 ▪ Add a small model gate

export function modelSupportsResponses(modelId: string): boolean {
  return modelId.startsWith('o3') || modelId.startsWith('o4');
}

In the provider constructor cache the flag once:

this.useResponses =
  config.preferResponses && modelSupportsResponses(config.model);

Why → lets the same engine talk to both pre‑2025 chat models and o3/o4.  ￼

⸻

2 ▪ Split the request builder

2.1  Chat builder (keep what you already have)

private buildChatCompletionsRequest(…): OpenAI.ChatCompletionCreateParams {
  …               //  unchanged
}

2.2  New Responses builder

private buildResponsesRequest(
  thread: Message[],      // your internal message type
  opts: CreateOptions     // streaming, tools, etc.
): OpenAI.ResponseCreateParams {
  const lastUser = thread.at(-1)!;                 // must be a user msg
  const systemMsgs = thread
      .filter(m => m.role === "system")
      .map(m => m.content)
      .join("\n");

  return {
    model: this.model,
    stream: opts.stream ?? false,
    input: lastUser.content,                       // ONLY the new turn
    instructions: systemMsgs || undefined,         // optional
    previous_response_id: this.ctx.lastResponseId, // undefined on turn‑1
    tools: this.transformTools(opts.tools),        // see § 6
    …otherParams
  };
}

Key rule → Responses is stateful: you never resend the whole history, only the new user input and (optionally) previous_response_id.  ￼

⸻

3 ▪ Switch the call‑site

Replace the single chat.completions.create() with:

if (this.useResponses) {
  return this.client.responses.create(
    this.buildResponsesRequest(thread, opts)
  );
}
return this.client.chat.completions.create(
  this.buildChatCompletionsRequest(thread, opts)
);

Pass stream: true exactly the same way for both paths.  ￼

⸻

4 ▪ Handle the streaming events

responses.create({ stream:true }) delivers typed Server‑Sent Events, not choices[].delta. Minimal handler:

for await (const event of stream) {
  switch (event.event) {
    case "outputTextDelta":
      yield { type: "text", delta: event.data.delta };
      break;

    case "functionCallArgumentsDelta":
      currentCallArgs += event.data.delta;
      break;

    case "toolCallCreated":
      yield { type: "toolCall", id: event.data.id, name: event.data.name };
      break;

    case "toolCallDone":
      yield { type: "toolCallDone", id: event.data.id };
      break;

    case "responseCompleted":
      this.ctx.lastResponseId = event.data.id;     // persist for next turn
      break;
  }
}

Keep emitting your existing LlmChunk shape so no caller changes.  ￼

⸻

5 ▪ Usage parsing fallback

Responses returns:

"usage": { "input_tokens": 37, "output_tokens": 125, "reasoning_tokens": 14 }

Extend parseUsage():

prompt = data.usage.prompt_tokens ?? data.usage.input_tokens;
completion = data.usage.completion_tokens ?? data.usage.output_tokens;
reasoning = data.usage.reasoning_tokens ?? 0;

Avoids undefined in billing metrics when running o3/o4.  ￼

⸻

6 ▪ Fix exactly the error you hit (tools[0].type)

Add a transformer used by both builders:

private transformTools(internal: LlmTool[]): OpenAI.Tool[] {
  return (internal ?? []).map(t => {
    if (t.kind === "function") {
      return {
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.jsonSchema
        }
      };
    }
    // hosted built‑ins
    return { type: t.kind as "web_search_preview" | "code_interpreter" };
  });
}

✔️ Every entry now contains the mandatory type field, so the 400 BadRequest disappears.  ￼

⸻

7 ▪ (Opt‑in) helpers for resume / fork

continueResponse(prevId: string, input: string, opts = {}) {
  return this.client.responses.create({ …opts, model: this.model,
    input, previous_response_id: prevId });
}

forkResponse(prevId: string, input: string, opts = {}) {
  return this.client.responses.create({ …opts, model: this.model,
    input, previous_response_id: prevId, is_fork: true });
}

Not strictly required but makes branching UX trivial.  ￼

⸻

Quick regression checklist
	•	✅ Unit tests pass with and without preferResponses.
	•	✅ Only one user message is POSTed per turn when useResponses=true.
	•	✅ Streaming still yields text + tool‑call chunks.
	•	✅ lastResponseId is stored and reused.
	•	✅ Usage numbers are non‑zero; no undefined errors.

Follow the seven steps above and multi‑llm‑ts will work unchanged for legacy chat models and the new o3/o4 models via responses.