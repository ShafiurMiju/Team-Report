import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, toObjectId } from '@/lib/mongodb';

const DEFAULT_MODEL = 'llama-3.1-8b-instant';

function maskApiKey(apiKey: string) {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return '••••••••';
  return `${apiKey.slice(0, 4)}••••••${apiKey.slice(-4)}`;
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

async function hasValidGroqKey(apiKey: string) {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  return res.ok;
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
      .findOne({ _id: userObjectId }, { projection: { aiEnabled: 1, groqApiKey: 1, groqModel: 1 } });

    return NextResponse.json({
      aiEnabled: Boolean(user?.aiEnabled),
      hasApiKey: Boolean(user?.groqApiKey),
      maskedApiKey: user?.groqApiKey ? maskApiKey(user.groqApiKey) : null,
      groqModel: user?.groqModel || DEFAULT_MODEL,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load AI settings' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const aiEnabled = Boolean(body?.aiEnabled);
    const removeApiKey = Boolean(body?.removeApiKey);
    const groqApiKey = typeof body?.groqApiKey === 'string' ? body.groqApiKey.trim() : '';
    const groqModel = typeof body?.groqModel === 'string' && body.groqModel.trim()
      ? body.groqModel.trim()
      : DEFAULT_MODEL;

    const db = await getDb();
    const userObjectId = await resolveSessionUserObjectId(db, session);

    if (!userObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const existing = await db
      .collection('users')
      .findOne({ _id: userObjectId }, { projection: { groqApiKey: 1 } });

    if (removeApiKey) {
      await db.collection('users').updateOne(
        { _id: userObjectId },
        {
          $set: {
            aiEnabled: false,
            groqModel,
            updatedAt: new Date(),
          },
          $unset: {
            groqApiKey: '',
          },
        }
      );

      return NextResponse.json({
        aiEnabled: false,
        hasApiKey: false,
        maskedApiKey: null,
        groqModel,
      });
    }

    let nextModel = groqModel;

    if (groqApiKey) {
      const isKeyValid = await hasValidGroqKey(groqApiKey);
      if (!isKeyValid) {
        return NextResponse.json({ error: 'Invalid Groq API key' }, { status: 400 });
      }

    }

    const finalApiKey = groqApiKey || existing?.groqApiKey || '';

    if (aiEnabled) {
      if (!finalApiKey) {
        return NextResponse.json({ error: 'Groq API key is required to enable AI' }, { status: 400 });
      }

      if (!groqApiKey) {
        const isValid = await hasValidGroqKey(finalApiKey);
        if (!isValid) {
          return NextResponse.json({ error: 'Invalid Groq API key' }, { status: 400 });
        }
      }
    }

    await db.collection('users').updateOne(
      { _id: userObjectId },
      {
        $set: {
          aiEnabled,
          groqModel: nextModel,
          ...(finalApiKey ? { groqApiKey: finalApiKey } : {}),
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({
      aiEnabled,
      hasApiKey: Boolean(finalApiKey),
      maskedApiKey: finalApiKey ? maskApiKey(finalApiKey) : null,
      groqModel: nextModel,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to save AI settings' }, { status: 500 });
  }
}
