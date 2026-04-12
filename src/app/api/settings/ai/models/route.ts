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

    const body = await request.json().catch(() => ({}));
    const apiKeyFromBody = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';

    const db = await getDb();
    const userObjectId = await resolveSessionUserObjectId(db, session);

    if (!userObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    let finalApiKey = apiKeyFromBody;
    if (!finalApiKey) {
      const user = await db
        .collection('users')
        .findOne({ _id: userObjectId }, { projection: { groqApiKey: 1 } });
      finalApiKey = user?.groqApiKey || '';
    }

    if (!finalApiKey) {
      return NextResponse.json({ error: 'Groq API key not found' }, { status: 400 });
    }

    const res = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${finalApiKey}`,
      },
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return NextResponse.json({ error: data?.error?.message || 'Failed to fetch models from Groq' }, { status: 400 });
    }

    const models = Array.isArray(data?.data)
      ? data.data
          .filter((item: any) => typeof item?.id === 'string' && item.id.trim())
          .filter((item: any) => item?.active !== false)
          .map((item: any) => String(item.id).trim())
          .filter((modelId: string) => isChatCompatibleModel(modelId))
          .sort((a: string, b: string) => a.localeCompare(b))
      : [];

    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 });
  }
}
