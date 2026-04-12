import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
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

function normalizeObjectIdList(input: unknown): ObjectId[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((id) => toObjectId(String(id)))
    .filter((id): id is ObjectId => Boolean(id));
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDb();
    const sessionUserId = await resolveSessionUserObjectId(db, session);
    if (!sessionUserId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    let selectedProjectIds: ObjectId[] = [];

    if (session.user.role === 'leader') {
      const leader = await db
        .collection('users')
        .findOne({ _id: sessionUserId, role: 'leader' }, { projection: { selectedProjectIds: 1 } });

      selectedProjectIds = normalizeObjectIdList(leader?.selectedProjectIds);
    } else if (session.user.role === 'member') {
      const member = await db
        .collection('users')
        .findOne({ _id: sessionUserId, role: 'member' }, { projection: { leaderId: 1 } });

      if (!member?.leaderId) {
        return NextResponse.json([]);
      }

      const leader = await db
        .collection('users')
        .findOne(
          { _id: member.leaderId as ObjectId, role: 'leader' },
          { projection: { selectedProjectIds: 1 } }
        );

      selectedProjectIds = normalizeObjectIdList(leader?.selectedProjectIds);
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (selectedProjectIds.length === 0) {
      return NextResponse.json([]);
    }

    const projects = await db
      .collection('projects')
      .find({ _id: { $in: selectedProjectIds } })
      .toArray();

    const orderMap = new Map(selectedProjectIds.map((id, index) => [String(id), index]));

    const normalized = projects
      .map((project) => ({
        id: String(project._id),
        name: project.name,
        emoji: project.emoji,
        priority: typeof project.priority === 'number' ? project.priority : 999999,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        _count: { tasks: 0 },
      }))
      .sort((a, b) => (orderMap.get(a.id) ?? 999999) - (orderMap.get(b.id) ?? 999999));

    return NextResponse.json(normalized);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch my projects' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'leader') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDb();
    const sessionUserId = await resolveSessionUserObjectId(db, session);
    if (!sessionUserId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const selectedProjectIdsRaw = Array.isArray(body?.projectIds) ? body.projectIds : [];

    const selectedProjectIds = selectedProjectIdsRaw
      .map((id: unknown) => toObjectId(String(id)))
      .filter((id: ObjectId | null): id is ObjectId => Boolean(id));

    if (selectedProjectIds.length !== selectedProjectIdsRaw.length) {
      return NextResponse.json({ error: 'Invalid project ids' }, { status: 400 });
    }

    if (selectedProjectIds.length > 0) {
      const existingCount = await db.collection('projects').countDocuments({ _id: { $in: selectedProjectIds } });
      if (existingCount !== selectedProjectIds.length) {
        return NextResponse.json({ error: 'One or more projects not found' }, { status: 404 });
      }
    }

    await db.collection('users').updateOne(
      { _id: sessionUserId, role: 'leader' },
      {
        $set: {
          selectedProjectIds,
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({ message: 'My projects updated' });
  } catch {
    return NextResponse.json({ error: 'Failed to update my projects' }, { status: 500 });
  }
}
