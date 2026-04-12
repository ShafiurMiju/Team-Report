import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, toObjectId } from '@/lib/mongodb';
import { Filter, ObjectId } from 'mongodb';

interface TaskDoc {
  _id: unknown;
  title: string;
  description?: string;
  status: string;
  priority?: 'low' | 'medium' | 'high';
  date: Date;
  inProgressStartedAt?: Date | null;
  doneAt?: Date | null;
  timeUsedHours?: number | null;
  timeAutoCalculated?: boolean | null;
  transferredAt?: Date;
  transferredToDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  userId: unknown;
  projectId: unknown;
  user: { _id: unknown; name: string; email: string };
  project: { _id: unknown; name: string; emoji: string };
}

async function resolveSessionUserObjectId(
  db: Awaited<ReturnType<typeof getDb>>,
  session: Awaited<ReturnType<typeof getServerSession>>
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

async function getLeaderVisibleUserIds(
  db: Awaited<ReturnType<typeof getDb>>,
  leaderId: ObjectId
) {
  const members = await db
    .collection('users')
    .find({ role: 'member', leaderId }, { projection: { _id: 1 } })
    .toArray();

  return [leaderId, ...members.map((member) => member._id as ObjectId)];
}

async function getTaskWithRelations(db: Awaited<ReturnType<typeof getDb>>, taskId: string) {
  const objectId = toObjectId(taskId);
  if (!objectId) return null;

  const [task] = await db
    .collection('tasks')
    .aggregate<TaskDoc>([
      { $match: { _id: objectId } },
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
    ])
    .toArray();

  if (!task) return null;

  return {
    id: String(task._id),
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority || 'high',
    date: task.date,
    inProgressStartedAt: task.inProgressStartedAt || null,
    doneAt: task.doneAt || null,
    timeUsedHours: typeof task.timeUsedHours === 'number' ? task.timeUsedHours : null,
    timeAutoCalculated: Boolean(task.timeAutoCalculated),
    transferredAt: task.transferredAt,
    transferredToDate: task.transferredToDate,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    userId: String(task.userId),
    projectId: String(task.projectId),
    user: {
      id: String(task.user._id),
      name: task.user.name,
      email: task.user.email,
    },
    project: {
      id: String(task.project._id),
      name: task.project.name,
      emoji: task.project.emoji,
    },
  };
}

// GET all tasks with filters
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const userId = searchParams.get('userId');
    const queryUserIds = searchParams.getAll('userIds');
    const userIds = queryUserIds.length > 0
      ? queryUserIds
      : (searchParams.get('userIds')?.split(',').map((v) => v.trim()).filter(Boolean) ?? []);
    const projectId = searchParams.get('projectId');
    const queryProjectIds = searchParams.getAll('projectIds');
    const projectIds = queryProjectIds.length > 0
      ? queryProjectIds
      : (searchParams.get('projectIds')?.split(',').map((v) => v.trim()).filter(Boolean) ?? []);

    const db = await getDb();
    const where: Filter<Record<string, unknown>> = {};
    const role = session.user.role;
    const sessionUserObjectId = await resolveSessionUserObjectId(db, session);

    if (!sessionUserObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    // Members can only see their own tasks
    if (role === 'member') {
      where.userId = sessionUserObjectId;
    } else if (role === 'leader') {
      const visibleUserIds = await getLeaderVisibleUserIds(db, sessionUserObjectId);
      const visibleSet = new Set(visibleUserIds.map((id) => String(id)));

      if (userIds.length > 0) {
        const filterUserIds = userIds
          .map((id) => toObjectId(id))
          .filter((id): id is NonNullable<typeof id> => Boolean(id));

        if (filterUserIds.length !== userIds.length) {
          return NextResponse.json({ error: 'Invalid userIds filter' }, { status: 400 });
        }

        const allVisible = filterUserIds.every((id) => visibleSet.has(String(id)));
        if (!allVisible) {
          return NextResponse.json({ error: 'Forbidden user filter' }, { status: 403 });
        }

        where.userId = { $in: filterUserIds };
      } else if (userId) {
        const filterUserId = toObjectId(userId);
        if (!filterUserId) {
          return NextResponse.json({ error: 'Invalid userId filter' }, { status: 400 });
        }
        if (!visibleSet.has(String(filterUserId))) {
          return NextResponse.json({ error: 'Forbidden user filter' }, { status: 403 });
        }
        where.userId = filterUserId;
      } else {
        where.userId = { $in: visibleUserIds };
      }
    } else if (userIds.length > 0) {
      const filterUserIds = userIds
        .map((id) => toObjectId(id))
        .filter((id): id is NonNullable<typeof id> => Boolean(id));

      if (filterUserIds.length !== userIds.length) {
        return NextResponse.json({ error: 'Invalid userIds filter' }, { status: 400 });
      }

      where.userId = { $in: filterUserIds };
    } else if (userId) {
      const filterUserId = toObjectId(userId);
      if (!filterUserId) {
        return NextResponse.json({ error: 'Invalid userId filter' }, { status: 400 });
      }
      where.userId = filterUserId;
    }

    if (projectIds.length > 0) {
      const filterProjectIds = projectIds
        .map((id) => toObjectId(id))
        .filter((id): id is NonNullable<typeof id> => Boolean(id));

      if (filterProjectIds.length !== projectIds.length) {
        return NextResponse.json({ error: 'Invalid projectIds filter' }, { status: 400 });
      }

      where.projectId = { $in: filterProjectIds };
    } else if (projectId) {
      const filterProjectId = toObjectId(projectId);
      if (!filterProjectId) {
        return NextResponse.json({ error: 'Invalid projectId filter' }, { status: 400 });
      }
      where.projectId = filterProjectId;
    }

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      where.date = { $gte: startOfDay, $lte: endOfDay };
    }

    const tasks = await db
      .collection('tasks')
      .aggregate<TaskDoc>([
        { $match: where },
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
        { $sort: { createdAt: -1 } },
      ])
      .toArray();

    const normalizedTasks = tasks.map((task) => ({
      id: String(task._id),
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority || 'high',
      date: task.date,
      inProgressStartedAt: task.inProgressStartedAt || null,
      doneAt: task.doneAt || null,
      timeUsedHours: typeof task.timeUsedHours === 'number' ? task.timeUsedHours : null,
      timeAutoCalculated: Boolean(task.timeAutoCalculated),
      transferredAt: task.transferredAt,
      transferredToDate: task.transferredToDate,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      userId: String(task.userId),
      projectId: String(task.projectId),
      user: {
        id: String(task.user._id),
        name: task.user.name,
        email: task.user.email,
      },
      project: {
        id: String(task.project._id),
        name: task.project.name,
        emoji: task.project.emoji,
      },
    }));

    return NextResponse.json(normalizedTasks);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

// POST create task
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, projectId, date, status, userId, priority } = body;

    if (!title || !projectId) {
      return NextResponse.json(
        { error: 'Title and project are required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const projectObjectId = toObjectId(projectId);

    const sessionUserObjectId = await resolveSessionUserObjectId(db, session);
    if (!sessionUserObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    let userObjectId = sessionUserObjectId;

    const role = session.user.role;

    if (role === 'leader') {
      if (userId) {
        const selectedUserId = toObjectId(userId);
        if (!selectedUserId) {
          return NextResponse.json({ error: 'Invalid assignee id' }, { status: 400 });
        }

        const visibleIds = await getLeaderVisibleUserIds(db, sessionUserObjectId);
        const visibleSet = new Set(visibleIds.map((id) => String(id)));
        if (!visibleSet.has(String(selectedUserId))) {
          return NextResponse.json({ error: 'Forbidden assignee' }, { status: 403 });
        }

        const assigneeExists = await db.collection('users').findOne({ _id: selectedUserId });
        if (!assigneeExists) {
          return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
        }

        userObjectId = selectedUserId;
      }
    }

    if (role === 'admin') {
      if (!userId) {
        return NextResponse.json({ error: 'Assignee is required' }, { status: 400 });
      }
      const selectedUserId = toObjectId(userId);
      if (!selectedUserId) {
        return NextResponse.json({ error: 'Invalid assignee id' }, { status: 400 });
      }

      const assigneeExists = await db.collection('users').findOne({ _id: selectedUserId });
      if (!assigneeExists) {
        return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
      }

      userObjectId = selectedUserId;
    }

    if (!userObjectId || !projectObjectId) {
      return NextResponse.json({ error: 'Invalid user or project id' }, { status: 400 });
    }

    const projectExists = await db.collection('projects').findOne({ _id: projectObjectId });
    if (!projectExists) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (role === 'leader') {
      const leader = await db
        .collection('users')
        .findOne({ _id: sessionUserObjectId, role: 'leader' }, { projection: { selectedProjectIds: 1 } });

      const selectedProjectIds = Array.isArray(leader?.selectedProjectIds)
        ? leader.selectedProjectIds.map((id: unknown) => String(id))
        : [];

      if (!selectedProjectIds.includes(String(projectObjectId))) {
        return NextResponse.json({ error: 'Project is not in your My Project list' }, { status: 403 });
      }
    }

    if (role === 'member') {
      const currentMember = await db
        .collection('users')
        .findOne({ _id: userObjectId }, { projection: { leaderId: 1 } });

      if (!currentMember?.leaderId) {
        return NextResponse.json({ error: 'No leader assigned' }, { status: 403 });
      }

      const leader = await db
        .collection('users')
        .findOne(
          { _id: currentMember.leaderId, role: 'leader' },
          { projection: { selectedProjectIds: 1 } }
        );

      const selectedProjectIds = Array.isArray(leader?.selectedProjectIds)
        ? leader.selectedProjectIds.map((id: unknown) => String(id))
        : [];

      if (!selectedProjectIds.includes(String(projectObjectId))) {
        return NextResponse.json({ error: 'Project is not in your leader My Project list' }, { status: 403 });
      }
    }

    const allowedStatuses = ['todo', 'in-progress', 'pause', 'done'] as const;
    if (status !== undefined && !allowedStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const now = new Date();
    const allowedPriorities = ['low', 'medium', 'high'] as const;
    const normalizedPriority = allowedPriorities.includes(priority)
      ? priority
      : 'high';

    const initialStatus = status || 'todo';
    const result = await db.collection('tasks').insertOne({
      title,
      description: description || null,
      projectId: projectObjectId,
      userId: userObjectId,
      date: date ? new Date(date) : now,
      status: initialStatus,
      priority: normalizedPriority,
      inProgressStartedAt: initialStatus === 'in-progress' ? now : null,
      activeDurationMs: 0,
      doneAt: initialStatus === 'done' ? now : null,
      timeUsedHours: null,
      timeAutoCalculated: false,
      transferredAt: null,
      transferredToDate: null,
      createdAt: now,
      updatedAt: now,
    });

    const task = await getTaskWithRelations(db, result.insertedId.toString());

    if (!task) {
      return NextResponse.json({ error: 'Failed to load created task' }, { status: 500 });
    }

    return NextResponse.json(task, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
