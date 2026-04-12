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
      .findOne({ _id: userObjectId }, { projection: { emailSignatureHtml: 1 } });

    return NextResponse.json({
      emailSignatureHtml: typeof user?.emailSignatureHtml === 'string' ? user.emailSignatureHtml : '',
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load signature' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const emailSignatureHtml = typeof body?.emailSignatureHtml === 'string' ? body.emailSignatureHtml : '';

    const db = await getDb();
    const userObjectId = await resolveSessionUserObjectId(db, session);

    if (!userObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    await db.collection('users').updateOne(
      { _id: userObjectId },
      {
        $set: {
          emailSignatureHtml,
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({ emailSignatureHtml });
  } catch {
    return NextResponse.json({ error: 'Failed to save signature' }, { status: 500 });
  }
}
