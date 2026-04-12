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

// PUT reorder projects (leader only)
export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !['leader', 'admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const orderedIds: string[] = Array.isArray(body?.orderedIds) ? body.orderedIds : [];

    if (!orderedIds.length) {
      return NextResponse.json({ error: 'orderedIds is required' }, { status: 400 });
    }

    const objectIds = orderedIds
      .map((id) => toObjectId(id))
      .filter((id): id is NonNullable<typeof id> => Boolean(id));

    if (objectIds.length !== orderedIds.length) {
      return NextResponse.json({ error: 'One or more project ids are invalid' }, { status: 400 });
    }

    const db = await getDb();
    if (session.user.role === 'leader') {
      const leaderId = await resolveSessionUserObjectId(db, session);
      if (!leaderId) {
        return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
      }

      const allowedCount = await db.collection('projects').countDocuments({
        _id: { $in: objectIds },
        leaderIds: leaderId,
      });

      if (allowedCount !== objectIds.length) {
        return NextResponse.json({ error: 'Forbidden project reorder' }, { status: 403 });
      }

      const now = new Date();

      await Promise.all(
        objectIds.map((projectId) =>
          db.collection('projects').updateOne(
            { _id: projectId },
            {
              $pull: {
                leaderPriorities: { leaderId },
              },
              $set: {
                updatedAt: now,
              },
            } as Record<string, unknown>
          )
        )
      );

      await Promise.all(
        objectIds.map((projectId, index) =>
          db.collection('projects').updateOne(
            { _id: projectId },
            {
              $push: {
                leaderPriorities: { leaderId, priority: index },
              },
              $set: {
                updatedAt: now,
              },
            } as Record<string, unknown>
          )
        )
      );

      return NextResponse.json({ message: 'Project order updated' });
    }

    const now = new Date();

    const operations = objectIds.map((projectId, index) => ({
      updateOne: {
        filter: { _id: projectId },
        update: {
          $set: {
            priority: index,
            updatedAt: now,
          },
        },
      },
    }));

    if (operations.length > 0) {
      await db.collection('projects').bulkWrite(operations);
    }

    return NextResponse.json({ message: 'Project order updated' });
  } catch {
    return NextResponse.json({ error: 'Failed to reorder projects' }, { status: 500 });
  }
}
