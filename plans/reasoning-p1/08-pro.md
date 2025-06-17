Below are the three gaps that still keep the o3‑pro run on your example/index.ts from exercising the Responses API and emitting streaming tokens. Patch them in the shown order and the demo should finally print the streamed text and tool‑call blocks.

⸻

1 ▪ The switch never flips – useResponses defaults to false

Your constructor currently does

this.useResponses =
  config.preferResponses && modelSupportsResponses(config.model);

so, when the caller omits preferResponses, the flag is false and the
provider falls back to chat.completions (that’s why the log still
shows Chat completion).

Replace the line with the “coalesce to true” version:

this.useResponses =
  (config.preferResponses ?? true) && modelSupportsResponses(config.model);

Now every o3 / o4 model automatically takes the Responses path unless
the caller explicitly disables it. (This is the intent of step 2.2 in
the checklist  ￼).

⸻

2 ▪ Your request still sends an object, not a string

Inside buildResponsesRequest you pass the entire internal message
object to input, so the model receives [object Object] and replies
with the diagnostic you saw.

Add one helper that guarantees plain text:

function extractText(msg: Message): string {
  if (typeof msg.content === 'string') return msg.content;
  if ('text' in msg.content)             return msg.content.text;
  // fall‑back: JSON‑encode for debugging but never send raw objects
  return JSON.stringify(msg.content);
}

and change the line that sets input to

input: extractText(lastUser),

Do the same when you concatenate system messages for
instructions.  (This detail is implied by step 3.1 of the
checklist  ￼.)

⸻

3 ▪ No stream parser – so nothing appears under Chat streaming

responses.create({ stream:true }) emits typed SSE events; your
current code still looks for choices[].delta, therefore every chunk is
ignored.

Drop in the minimal parser that was sketched in step 5 of the
checklist  ￼:

for await (const e of stream) {
  switch (e.event) {
    case 'outputTextDelta':
      yield { type: 'text', delta: e.data.delta };
      break;

    case 'toolCallCreated':
      yield {
        type: 'toolCall',
        id:   e.data.id,
        name: e.data.name
      };
      break;

    case 'functionCallArgumentsDelta':
      currentArgs += e.data.delta;
      break;

    case 'toolCallDone':
      yield { type: 'toolCallDone', id: e.data.id, args: currentArgs };
      currentArgs = '';
      break;

    case 'responseCompleted':
      this.ctx.lastResponseId = e.data.id;
      break;
  }
}

The example script can stay unchanged; once the parser yields text
chunks they will appear under the same “Chat streaming” banner you get
from legacy models.

⸻

Quick smoke‑test

OPENAI_API_VERSION=2025‑04‑15 \
MODEL=o3-pro \
npm run example --silent

Expected log headings:

** Load models
…
** Responses completion
…
** Chat streaming
Hello there …   ← streamed deltas appear here

If you see Responses completion (not Chat completion) and the
stream fills, the migration is finished.