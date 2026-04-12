import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, toObjectId } from '@/lib/mongodb';

async function resolveSessionUserObjectId(
  db: Awaited<ReturnType<typeof getDb>>,
  session: { user?: { id?: string; email?: string } } | null
) {
  const fromSessionId = toObjectId(session?.user?.id ?? '');
  if (fromSessionId) return fromSessionId;

  if (!session?.user?.email) return null;

  const user = await db
    .collection('users')
    .findOne({ email: session.user.email }, { projection: { _id: 1 } });

  if (!user?._id) return null;
  return toObjectId(String(user._id));
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const field = body?.field === 'description' ? 'description' : 'title';

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const db = await getDb();
    const userObjectId = await resolveSessionUserObjectId(db, session);

    if (!userObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const user = await db
      .collection('users')
      .findOne(
        { _id: userObjectId },
        { projection: { aiEnabled: 1, groqApiKey: 1, groqModel: 1 } }
      );

    if (!user?.aiEnabled || !user?.groqApiKey) {
      return NextResponse.json({ error: 'AI is not enabled in your settings' }, { status: 403 });
    }

    const instruction =
      field === 'title'
        ? 'Rewrite this task title into concise, clear US native professional English. Keep it short and action-oriented. Return only rewritten title.'
        : 'Rewrite this task description into clear US native professional English. Preserve intent and details. Return only rewritten description.';

    const prompt = `${instruction}\n\nInput:\n${text}`;

    const candidateModels = [
      user.groqModel,
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
      'mixtral-8x7b-32768',
    ].filter((m, idx, arr): m is string => typeof m === 'string' && !!m && arr.indexOf(m) === idx);

    let rewritten = '';
    let lastError = '';

    for (const model of candidateModels) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${user.groqApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are an expert writing assistant. Convert Banglish or English to natural US native English while preserving meaning. Output only the rewritten text with no extra notes.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: field === 'title' ? 80 : 220,
        }),
      });

      const data = await res.json().catch(() => null);
      const text = data?.choices?.[0]?.message?.content?.trim();

      if (res.ok && text) {
        rewritten = text;
        break;
      }

      lastError = data?.error?.message || 'Failed to process with Groq';
    }

    if (!rewritten) {
      return NextResponse.json({ error: lastError || 'No rewritten text returned' }, { status: 502 });
    }

    return NextResponse.json({ rewritten });
  } catch {
    return NextResponse.json({ error: 'Failed to rewrite text' }, { status: 500 });
  }
}
