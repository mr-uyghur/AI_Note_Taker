import Anthropic from '@anthropic-ai/sdk';
import type { ConversationMessage } from '@shared/types';
import { env } from './env';

let _client: Anthropic | undefined;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

export async function* streamReply(
  transcriptFull: string,
  history: ConversationMessage[],
  userMessage: string
): AsyncIterable<string> {
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const stream = getClient().messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: `You are a helpful assistant that answers questions about a recorded meeting. When referencing moments in the recording, cite the timestamp as [mm:ss] (e.g. [02:34]).\n\n<transcript>\n${transcriptFull}\n</transcript>`,
        // Cache the transcript across follow-up turns in the same conversation
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      yield event.delta.text;
    }
  }
}
