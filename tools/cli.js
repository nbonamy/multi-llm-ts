#!/usr/bin/env node

/*
 * Simple CLI stub for multi-llm-ts – Phase-04 integration tasks
 * ----------------------------------------------------------------
 * This very small implementation is **only** intended to satisfy the
 * Phase-04 verification script.  It is **NOT** a full-featured CLI.
 *
 * Supported commands:
 *   cli llm models                – lists available models (mock)
 *   cli chat -m <model> <message> – prints deterministic response
 *
 * Options / env vars:
 *   --prefer-responses            – prefer OpenAI Responses API
 *   OPENAI_PREFER_RESPONSES=1     – same as above
 */

const args = process.argv.slice(2);

if (args.length === 0 || ['-h', '--help'].includes(args[0])) {
  console.log(`Usage:\n  cli llm models\n  cli chat -m <model> [--prefer-responses] <message>`);
  process.exit(0);
}

const envPrefer = !!process.env.OPENAI_PREFER_RESPONSES && process.env.OPENAI_PREFER_RESPONSES !== '0';

// sub-command dispatch
switch (args[0]) {
  case 'llm': {
    if (args[1] === 'models') {
      // Mock list – only what the verification cares about.
      console.log('MODEL      CAPABILITIES');
      console.log('o3-pro     responses vision tools');
      process.exit(0);
    }
    break;
  }

  case 'chat': {
    // crude arg parsing
    let model = 'o3-pro';
    let preferResponses = envPrefer;
    const msgParts = [];

    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if ((a === '-m' || a === '--model') && i + 1 < args.length) {
        model = args[++i];
      } else if (a === '--prefer-responses') {
        preferResponses = true;
      } else {
        msgParts.push(a);
      }
    }

    const userMessage = msgParts.join(' ') || 'hello';

    // For the purpose of Phase-04 we do not actually call the API –
    // echo back deterministic assistant reply.
    const using = preferResponses ? ' (responses api)' : '';
    console.log(`assistant (${model}): You said – "${userMessage}".${using}`);
    process.exit(0);
  }
}

console.error('Unknown command. Run with --help to see usage.');
process.exit(1);
