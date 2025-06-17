Below is a mechanics‑only checklist to bring multi‑llm‑ts over to the new Responses API.
Each step is ordered so that you can run the unit‑tests after every change and keep the delta small.
Lines marked “👉 commit point” are safe places to snapshot.

──────────────────────────────────────────────
	1.	Upgrade and preliminaries
1.1  npm i openai@^5 ‑ earliest version with client.responses.*.
1.2  Add export OPENAI_API_VERSION=2025‑04‑15 (latest GA date).
1.3  Ensure the current defaultBaseUrl (https://api.openai.com/v1) stays unchanged – the SDK selects the correct sub‑path internally.
👉 commit point: SDK upgrade & type‑checks green.
	2.	Gate‑switch in openai.ts
2.1  Keep the helper you already wrote:

    export function modelSupportsResponses(modelId: string) {
      return modelId.startsWith('o3') || modelId.startsWith('o4');
    }

2.2  In constructor, honour config.preferResponses and the helper above:

    this.useResponses =
       config.preferResponses && modelSupportsResponses(config.model);

👉 commit point

	3.	Request‑builder helpers
3.1  Add two private helpers:

• `buildChatCompletionsRequest(thread: Message[], opts: …)`  
• `buildResponsesRequest(thread: Message[], opts: …)`

The second one maps the *last* user message to `input`, merges every
system message into a single `instructions` string, and—if you have
already had at least one turn—sets `previous_response_id` from
`threadCtx.lastResponseId`.

(Reason: Responses API is **stateful**; you never resend the entire
history.  See example with `previous_response_id` in Zack Saadioui’s
blog post  [oai_citation:0‡arsturn.com](https://www.arsturn.com/blog/demystifying-the-workings-of-the-responses-api-for-developers).)

👉 commit point

	4.	Call‑site switch
4.1  Replace the single this.client.chat.completions.create(...)
with:

    if (this.useResponses) {
      return this.client.responses.create(await this.buildResponsesRequest(...));
    } else {
      return this.client.chat.completions.create(await this.buildChatCompletionsRequest(...));
    }

 Pass `stream: true` exactly the same way for both paths.

👉 commit point

	5.	Streaming parser
5.1  The Responses stream emits typed events, not a single delta
object.  Handle at least:

 • `outputTextDelta`  → yield `{ type: 'text', delta: e.delta }`  
 • `functionCallArgumentsDelta` → accumulate args  
 • `toolCallCreated` / `toolCallFailed` / `toolCallDone` → map to your existing `LlmToolCall*` events  
 • `responseCompleted` → remember `response.id` in `threadCtx.lastResponseId`

 The event names are listed in James Rochabrun’s post (see bullet list of
 “Key Features Supported”)   [oai_citation:1‡jamesrochabrun.medium.com](https://jamesrochabrun.medium.com/stream-real-time-ai-responses-in-swift-with-openais-response-api-ad599e532f95).

5.2  Do not expect a choices array; every event is already for a
single response.
👉 commit point with an interim unit‑test that feeds a recorded SSE log.

	6.	Usage accounting
6.1  The Responses payload returns

```json
"usage": {
  "input_tokens": 37,
  "output_tokens": 125,
  "reasoning_tokens": 14
}
```

 Extend `parseUsage()` to read those keys as fall‑back when
 `prompt_tokens` / `completion_tokens` are absent.  (Early adopters hit
 this exact error  [oai_citation:2‡github.com](https://github.com/zed-industries/zed/discussions/32550).)

👉 commit point

	7.	Tool definitions
7.1  When you build the request, transform internal tool specs to the API
shape:

    tools: [{ type: 'function', function: { name, description, parameters } }]

 or for hosted tools, e.g.:

    tools: [{ type: 'web_search_preview' }]

 The API will decide when to call; no function‑call schema header is
 needed for built‑ins  [oai_citation:3‡arsturn.com](https://www.arsturn.com/blog/demystifying-the-workings-of-the-responses-api-for-developers).

👉 commit point

	8.	Continue/Fork helpers (optional but recommended)
8.1  Add thin wrappers:

• `continueResponse(previousId: string, input: string, opts?: …)`  
• `forkResponse(previousId: string, input: string, opts?: …)`

 These simply call `client.responses.create` with
 `previous_response_id` set.  They let higher‑level code choose whether
 to branch the conversation or keep it linear.

👉 commit point

	9.	Regression tests
9.1  Add happy‑path and tool‑call streaming fixtures recorded with nock.
9.2  Assert that you never send more than one user message per call when
this.useResponses is true – bullet 1 in the GitHub discussion  ￼.

──────────────────────────────────────────────
Key behavioural differences to remember
	•	The API is stateful – you supply only the new user input plus, optionally, previous_response_id; context is stored server‑side.
	•	Events are typed SSE chunks; there is no outer choices array.
	•	Built‑in tools (web_search, file_search, code_interpreter) are first‑class; treat them exactly as you treat custom functions.
	•	Token accounting fields differ (input_tokens, output_tokens, reasoning_tokens).
	•	You can resume or branch a conversation with .create({…, previous_response_id}) instead of re‑sending the full thread.

──────────────────────────────────────────────
Quick self‑check before closing the branch

☑ Unit‑tests green with and without preferResponses.
☑ Last response ID is persisted and used on the next turn.
☑ Streaming still yields LlmChunk objects in the same shape as before.
☑ Usage numbers are non‑zero again; no exceptions thrown for missing keys.
☑ Network recorder shows one POST per turn (no full history payloads).

Follow the commit points and you can swap the transport in one afternoon without destabilising the rest of multi‑llm‑ts.