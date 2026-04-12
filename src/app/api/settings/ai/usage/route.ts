import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, toObjectId } from '@/lib/mongodb';

function isChatCompatibleModel(modelId: string) {
  const id = modelId.toLowerCase();

  const blockedKeywords = [
    'whisper',
    'tts',
    'playai',
    'orpheus',
    'guard',
    'moderation',
    'transcribe',
    'translation',
    'speech',
  ];

  return !blockedKeywords.some((keyword) => id.includes(keyword));
}

async function runUsageProbe(apiKey: string, model: string) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'OK' }],
      max_tokens: 1,
      temperature: 0,
    }),
  });

  const data = await res.json().catch(() => null);
  return { res, data };
}

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

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
        { projection: { groqApiKey: 1, groqModel: 1 } }
      );

    if (!user?.groqApiKey) {
      return NextResponse.json({ error: 'Groq API key not configured' }, { status: 400 });
    }

    const preferredModel = user.groqModel || 'llama-3.1-8b-instant';

    let selectedModel = preferredModel;
    let { res, data } = await runUsageProbe(user.groqApiKey, selectedModel);

    if (!res.ok) {
      const modelListRes = await fetch('https://api.groq.com/openai/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${user.groqApiKey}`,
        },
      });

      const modelListData = await modelListRes.json().catch(() => null);
      const fallbackModel = Array.isArray(modelListData?.data)
        ? modelListData.data
            .map((item: any) => (typeof item?.id === 'string' ? item.id.trim() : ''))
            .filter((id: string) => Boolean(id))
            .filter((id: string) => isChatCompatibleModel(id))[0]
        : null;

      if (fallbackModel && fallbackModel !== selectedModel) {
        selectedModel = fallbackModel;
        const retry = await runUsageProbe(user.groqApiKey, selectedModel);
        res = retry.res;
        data = retry.data;
      }
    }

    if (!res.ok) {
      const status = res.status === 429 ? 429 : 400;
      return NextResponse.json(
        {
          error: data?.error?.message || 'Failed to fetch usage from Groq',
          details: res.status === 429 ? 'Rate limit reached. Please try again shortly.' : undefined,
        },
        { status }
      );
    }

    return NextResponse.json({
      model: selectedModel,
      usage: data?.usage || null,
      rateLimits: {
        limitRequests: res.headers.get('x-ratelimit-limit-requests'),
        remainingRequests: res.headers.get('x-ratelimit-remaining-requests'),
        resetRequests: res.headers.get('x-ratelimit-reset-requests'),
        limitTokens: res.headers.get('x-ratelimit-limit-tokens'),
        remainingTokens: res.headers.get('x-ratelimit-remaining-tokens'),
        resetTokens: res.headers.get('x-ratelimit-reset-tokens'),
        retryAfter: res.headers.get('retry-after'),
      },
      warning: selectedModel !== preferredModel
        ? `Saved model was unavailable for usage probe. Used ${selectedModel} instead.`
        : null,
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load usage snapshot' }, { status: 500 });
  }
}
