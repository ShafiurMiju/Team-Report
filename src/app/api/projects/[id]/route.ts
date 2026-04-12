import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, toObjectId } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function resolveSessionUserObjectId(
  db: Awaited<ReturnType<typeof getDb>>,
  session: Awaited<ReturnType<typeof getServerSession>>
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

// PUT update project
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !['leader', 'admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, emoji, priority, leaderIds } = body;

    const projectId = toObjectId(params.id);
    if (!projectId) {
      return NextResponse.json({ error: 'Invalid project id' }, { status: 400 });
    }

    const db = await getDb();
    const sessionUserObjectId = await resolveSessionUserObjectId(db, session);
    if (!sessionUserObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const existingProject = await db.collection('projects').findOne({ _id: projectId });
    if (!existingProject) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (
      session.user.role === 'leader' &&
      !Array.isArray(existingProject.leaderIds || [])
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (session.user.role === 'leader') {
      const ownsProject = (existingProject.leaderIds || []).some(
        (id: unknown) => String(id) === String(sessionUserObjectId)
      );

      if (!ownsProject) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (emoji !== undefined) updateData.emoji = emoji;
    if (priority !== undefined) updateData.priority = priority;

    if (session.user.role === 'admin' && leaderIds !== undefined) {
      const requested = Array.isArray(leaderIds) ? leaderIds : [];
      const objectIds = requested
        .map((id) => toObjectId(String(id)))
        .filter((id): id is ObjectId => Boolean(id));

      if (objectIds.length !== requested.length) {
        return NextResponse.json({ error: 'Invalid leader ids' }, { status: 400 });
      }

      if (objectIds.length > 0) {
        const leaders = await db
          .collection('users')
          .find({ _id: { $in: objectIds }, role: 'leader' }, { projection: { _id: 1 } })
          .toArray();

        if (leaders.length !== objectIds.length) {
          return NextResponse.json({ error: 'One or more selected leaders are invalid' }, { status: 400 });
        }
      }

      updateData.leaderIds = objectIds;
    }

    const result = await db.collection('projects').findOneAndUpdate(
      { _id: projectId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const taskCount = await db.collection('tasks').countDocuments({ projectId });

    const project = {
      id: result._id.toString(),
      name: result.name,
      emoji: result.emoji,
      leaderIds: Array.isArray(result.leaderIds) ? result.leaderIds.map((id: unknown) => String(id)) : [],
      priority: typeof result.priority === 'number' ? result.priority : 999999,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      _count: { tasks: taskCount },
    };

    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
  }
}

// DELETE project
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !['leader', 'admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = toObjectId(params.id);
    if (!projectId) {
      return NextResponse.json({ error: 'Invalid project id' }, { status: 400 });
    }

    const db = await getDb();
    const sessionUserObjectId = await resolveSessionUserObjectId(db, session);
    if (!sessionUserObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const existingProject = await db.collection('projects').findOne({ _id: projectId });
    if (!existingProject) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (session.user.role === 'leader') {
      const ownsProject = (existingProject.leaderIds || []).some(
        (id: unknown) => String(id) === String(sessionUserObjectId)
      );

      if (!ownsProject) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    await db.collection('tasks').deleteMany({ projectId });
    const result = await db.collection('projects').deleteOne({ _id: projectId });

    if (!result.deletedCount) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Project deleted' });
  } catch {
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}
