import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongo';
import { streamReply } from '@/lib/claude';
import { sessionOptions } from '@/lib/auth';
import type { SessionData } from '@/lib/auth';
import type { ConversationMessage, Recording } from '@shared/types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  if (!session.isLoggedIn) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json()) as {
    conversationId?: string;
    message: string;
  };

  const db = await getDb();
  let doc: Record<string, unknown> | null;
  try {
    doc = await db.collection('recordings').findOne({ _id: new ObjectId(id) });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid id' }), { status: 400 });
  }
  if (!doc) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  const recording = { ...doc, _id: (doc._id as ObjectId).toHexString() } as unknown as Recording;
  if (!recording.transcript) {
    return new Response(JSON.stringify({ error: 'No transcript yet' }), { status: 422 });
  }

  // Find or create conversation
  let convIdx = -1;
  if (body.conversationId) {
    convIdx = recording.conversations.findIndex((c) => c._id === body.conversationId);
  }

  const history: ConversationMessage[] =
    convIdx >= 0 ? recording.conversations[convIdx].messages : [];

  // Collect the full assistant reply while streaming
  const chunks: string[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const text of streamReply(
          recording.transcript!.full,
          history,
          body.message
        )) {
          chunks.push(text);
          controller.enqueue(encoder.encode(text));
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();

      // Persist after stream completes
      const userMsg: ConversationMessage = {
        role: 'user',
        content: body.message,
        createdAt: new Date().toISOString(),
      };
      const assistantMsg: ConversationMessage = {
        role: 'assistant',
        content: chunks.join(''),
        createdAt: new Date().toISOString(),
      };

      if (convIdx >= 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.collection('recordings').updateOne(
          { _id: new ObjectId(id) },
          {
            $push: {
              [`conversations.${convIdx}.messages`]: { $each: [userMsg, assistantMsg] },
            } as any,
          }
        );
      } else {
        const newConv = {
          _id: new ObjectId(),
          createdAt: new Date().toISOString(),
          title: body.message.slice(0, 60),
          messages: [userMsg, assistantMsg],
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.collection('recordings').updateOne(
          { _id: new ObjectId(id) },
          { $push: { conversations: newConv } as any }
        );
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
