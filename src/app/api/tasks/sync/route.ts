import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, toObjectId } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function resolveSessionUserObjectId(
  db: Awaited<ReturnType<typeof getDb>>,
  session: { user?: { id?: string; email?: string } } | null
) {
  const fromSessionId = toObjectId(session?.user?.id ?? '');
  if (fromSessionId) return fromSessionId;

  if (!session?.user?.email) return null;

  const user = await db
    .collection('users')
    .findOne(
      { email: session.user.email },
      { projection: { _id: 1 } }
    );

  if (!user?._id) return null;
  return toObjectId(String(user._id));
}

async function resolveTargetUserObjectId(
  db: Awaited<ReturnType<typeof getDb>>,
  session: { user?: { id?: string; email?: string; role?: string } } | null,
  selectedUserId?: string | null
) {
  if (session?.user?.role === 'leader') {
    if (!selectedUserId) return null;
    const memberId = toObjectId(selectedUserId);
    if (!memberId) return null;

    const member = await db
      .collection('users')
      .findOne(
        { _id: memberId },
        { projection: { _id: 1 } }
      );

    if (!member?._id) return null;
    return memberId;
  }

  if (session?.user?.role === 'admin') {
    if (!selectedUserId) return null;
    const targetId = toObjectId(selectedUserId);
    if (!targetId) return null;

    const target = await db
      .collection('users')
      .findOne({ _id: targetId, role: { $in: ['leader', 'member'] } }, { projection: { _id: 1 } });

    if (!target?._id) return null;
    return targetId;
  }

  return resolveSessionUserObjectId(db, session);
}

async function resolveTargetUserFilter(
  db: Awaited<ReturnType<typeof getDb>>,
  session: { user?: { id?: string; email?: string; role?: string } } | null,
  selectedUserId?: string | null,
  selectedUserIds?: string[]
): Promise<{ userFilter: ObjectId | { $in: ObjectId[] } } | null> {
  if (session?.user?.role === 'leader') {
    const leaderId = await resolveSessionUserObjectId(db, session);
    if (!leaderId) return null;

    if (selectedUserId === '__all__') {
      const members = await db
        .collection('users')
        .find({ role: 'member', leaderId }, { projection: { _id: 1 } })
        .toArray();

      return {
        userFilter: {
          $in: [leaderId, ...members.map((member) => member._id as ObjectId)],
        },
      };
    }

    const normalizedSelectedUserIds = Array.from(new Set((selectedUserIds ?? []).filter(Boolean)));

    if (normalizedSelectedUserIds.length > 0) {
      const objectIds = normalizedSelectedUserIds
        .map((id) => toObjectId(id))
        .filter((id): id is ObjectId => Boolean(id));

      if (objectIds.length !== normalizedSelectedUserIds.length) {
        return null;
      }

      const users = await db
        .collection('users')
        .find(
          {
            _id: { $in: objectIds },
            $or: [
              { _id: leaderId },
              { role: 'member', leaderId },
            ],
          },
          { projection: { _id: 1 } }
        )
        .toArray();

      if (users.length !== objectIds.length) {
        return null;
      }

      return { userFilter: { $in: objectIds } };
    }
  }

  if (session?.user?.role === 'admin') {
    if (selectedUserId === '__all__') {
      const users = await db
        .collection('users')
        .find({ role: { $in: ['leader', 'member'] } }, { projection: { _id: 1 } })
        .toArray();

      return {
        userFilter: {
          $in: users.map((user) => user._id as ObjectId),
        },
      };
    }

    const normalizedSelectedUserIds = Array.from(new Set((selectedUserIds ?? []).filter(Boolean)));
    if (normalizedSelectedUserIds.length > 0) {
      const objectIds = normalizedSelectedUserIds
        .map((id) => toObjectId(id))
        .filter((id): id is ObjectId => Boolean(id));

      if (objectIds.length !== normalizedSelectedUserIds.length) {
        return null;
      }

      const users = await db
        .collection('users')
        .find({ _id: { $in: objectIds }, role: { $in: ['leader', 'member'] } }, { projection: { _id: 1 } })
        .toArray();

      if (users.length !== objectIds.length) {
        return null;
      }

      return { userFilter: { $in: objectIds } };
    }
  }

  const userObjectId = await resolveTargetUserObjectId(db, session, selectedUserId);
  if (!userObjectId) return null;
  return { userFilter: userObjectId };
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!['member', 'leader', 'admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const targetDate = searchParams.get('targetDate');
    const userId = searchParams.get('userId');
    const queryUserIds = searchParams.getAll('userIds');
    const userIds = queryUserIds.length > 0
      ? queryUserIds
      : (searchParams.get('userIds')?.split(',').map((v) => v.trim()).filter(Boolean) ?? []);

    if (!targetDate) {
      return NextResponse.json({ error: 'targetDate is required' }, { status: 400 });
    }

    const targetStart = new Date(targetDate);
    targetStart.setHours(0, 0, 0, 0);

    const db = await getDb();
    const targetUser = await resolveTargetUserFilter(db, session, userId, userIds);

    if (!targetUser) {
      return NextResponse.json({ error: 'Invalid selected member' }, { status: 400 });
    }

    const tasks = await db
      .collection('tasks')
      .aggregate([
        {
          $match: {
            userId: targetUser.userFilter,
            status: { $in: ['todo', 'in-progress', 'pause'] },
            date: { $lt: targetStart },
            $or: [
              { transferredToDate: null },
              { transferredToDate: { $exists: false } },
            ],
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        {
          $lookup: {
            from: 'projects',
            localField: 'projectId',
            foreignField: '_id',
            as: 'project',
          },
        },
        { $unwind: '$project' },
        { $sort: { date: -1, createdAt: -1 } },
        {
          $project: {
            id: { $toString: '$_id' },
            title: 1,
            status: 1,
            date: 1,
            user: {
              id: { $toString: '$user._id' },
              name: '$user.name',
            },
            project: {
              id: { $toString: '$project._id' },
              name: '$project.name',
              emoji: '$project.emoji',
            },
          },
        },
      ])
      .toArray();

    return NextResponse.json(tasks);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch sync candidates' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!['member', 'leader', 'admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const targetDate: string | undefined = body?.targetDate;
    const taskIds: string[] = Array.isArray(body?.taskIds) ? body.taskIds : [];
    const userId: string | undefined = body?.userId;
    const userIds: string[] = Array.isArray(body?.userIds) ? body.userIds : [];

    if (!targetDate || taskIds.length === 0) {
      return NextResponse.json({ error: 'targetDate and taskIds are required' }, { status: 400 });
    }

    const objectIds = taskIds
      .map((id) => toObjectId(id))
      .filter((id): id is NonNullable<typeof id> => Boolean(id));

    if (objectIds.length !== taskIds.length) {
      return NextResponse.json({ error: 'Invalid task id in selection' }, { status: 400 });
    }

    const targetStart = new Date(targetDate);
    targetStart.setHours(0, 0, 0, 0);

    const db = await getDb();
    const targetUser = await resolveTargetUserFilter(db, session, userId, userIds);

    if (!targetUser) {
      return NextResponse.json({ error: 'Invalid selected member' }, { status: 400 });
    }

    const sourceTasks = await db
      .collection('tasks')
      .find({
        _id: { $in: objectIds },
        userId: targetUser.userFilter,
        status: { $in: ['todo', 'in-progress', 'pause'] },
        date: { $lt: targetStart },
        $or: [
          { transferredToDate: null },
          { transferredToDate: { $exists: false } },
        ],
      })
      .toArray();

    if (sourceTasks.length === 0) {
      return NextResponse.json({ error: 'No eligible tasks found to transfer' }, { status: 400 });
    }

    const now = new Date();

    const newTasks = sourceTasks.map((task) => ({
      title: task.title,
      description: task.description ?? null,
      status: task.status,
      priority: task.priority || 'high',
      date: targetStart,
      userId: task.userId,
      projectId: task.projectId,
      inProgressStartedAt: task.inProgressStartedAt ?? null,
      activeDurationMs: typeof task.activeDurationMs === 'number' ? task.activeDurationMs : 0,
      doneAt: null,
      timeUsedHours: typeof task.timeUsedHours === 'number' ? task.timeUsedHours : null,
      timeAutoCalculated: Boolean(task.timeAutoCalculated),
      transferredAt: null,
      transferredToDate: null,
      createdAt: now,
      updatedAt: now,
    }));

    await db.collection('tasks').insertMany(newTasks);

    await db.collection('tasks').updateMany(
      { _id: { $in: sourceTasks.map((task) => task._id) } },
      {
        $set: {
          transferredAt: now,
          transferredToDate: targetStart,
          updatedAt: now,
        },
      }
    );

    return NextResponse.json({
      message: 'Tasks transferred',
      transferredCount: sourceTasks.length,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to transfer tasks' }, { status: 500 });
  }
}
