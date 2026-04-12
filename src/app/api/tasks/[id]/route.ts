import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, toObjectId } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

interface TaskDoc {
  _id: unknown;
  title: string;
  description?: string;
  status: string;
  priority?: 'low' | 'medium' | 'high';
  date: Date;
  inProgressStartedAt?: Date | null;
  activeDurationMs?: number | null;
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
    .findOne({ email: session.user.email }, { projection: { _id: 1 } });

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

// PUT update task (status, title, etc.)
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const taskId = toObjectId(params.id);
    if (!taskId) {
      return NextResponse.json({ error: 'Invalid task id' }, { status: 400 });
    }

    const db = await getDb();
    const body = await request.json();
    const { title, description, status, projectId, date, priority, timeUsedHours, userId } = body;

    const existingTask = await db.collection('tasks').findOne({ _id: taskId });
    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Members can only update their own tasks
    if (session.user.role === 'member') {
      if (String(existingTask.userId) !== session.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (session.user.role === 'leader') {
      const sessionUserId = await resolveSessionUserObjectId(db, session);
      if (!sessionUserId) {
        return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
      }

      const visibleIds = await getLeaderVisibleUserIds(db, sessionUserId);
      const visibleSet = new Set(visibleIds.map((id) => String(id)));
      if (!visibleSet.has(String(existingTask.userId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) {
      const allowedStatuses = ['todo', 'in-progress', 'pause', 'done'] as const;
      if (!allowedStatuses.includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      updateData.status = status;
    }
    if (priority !== undefined) {
      const allowedPriorities = ['low', 'medium', 'high'] as const;
      if (!allowedPriorities.includes(priority)) {
        return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
      }
      updateData.priority = priority;
    }
    if (projectId !== undefined) {
      const projectObjectId = toObjectId(projectId);
      if (!projectObjectId) {
        return NextResponse.json({ error: 'Invalid project id' }, { status: 400 });
      }

      const project = await db.collection('projects').findOne({ _id: projectObjectId });
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      if (session.user.role === 'leader') {
        const sessionUserId = await resolveSessionUserObjectId(db, session);
        if (!sessionUserId) {
          return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
        }

        const leader = await db
          .collection('users')
          .findOne({ _id: sessionUserId, role: 'leader' }, { projection: { selectedProjectIds: 1 } });

        const selectedProjectIds = Array.isArray(leader?.selectedProjectIds)
          ? leader.selectedProjectIds.map((id: unknown) => String(id))
          : [];

        const canAccess = selectedProjectIds.includes(String(projectObjectId));

        if (!canAccess) {
          return NextResponse.json({ error: 'Project is not in your My Project list' }, { status: 403 });
        }
      }

      if (session.user.role === 'member') {
        const memberId = await resolveSessionUserObjectId(db, session);
        if (!memberId) {
          return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
        }

        const member = await db
          .collection('users')
          .findOne({ _id: memberId }, { projection: { leaderId: 1 } });

        if (!member?.leaderId) {
          return NextResponse.json({ error: 'No leader assigned' }, { status: 403 });
        }

        const leader = await db
          .collection('users')
          .findOne(
            { _id: member.leaderId, role: 'leader' },
            { projection: { selectedProjectIds: 1 } }
          );

        const selectedProjectIds = Array.isArray(leader?.selectedProjectIds)
          ? leader.selectedProjectIds.map((id: unknown) => String(id))
          : [];

        const canAccess = selectedProjectIds.includes(String(projectObjectId));

        if (!canAccess) {
          return NextResponse.json({ error: 'Project is not in your leader My Project list' }, { status: 403 });
        }
      }

      updateData.projectId = projectObjectId;
    }
    if (date !== undefined) updateData.date = new Date(date);

    if (userId !== undefined) {
      const nextUserId = toObjectId(userId);
      if (!nextUserId) {
        return NextResponse.json({ error: 'Invalid assignee id' }, { status: 400 });
      }

      const assignee = await db.collection('users').findOne({ _id: nextUserId }, { projection: { _id: 1 } });
      if (!assignee) {
        return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
      }

      if (session.user.role === 'member') {
        if (String(nextUserId) !== String(existingTask.userId)) {
          return NextResponse.json({ error: 'Forbidden assignee' }, { status: 403 });
        }
      }

      if (session.user.role === 'leader') {
        const sessionUserId = await resolveSessionUserObjectId(db, session);
        if (!sessionUserId) {
          return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
        }

        const visibleIds = await getLeaderVisibleUserIds(db, sessionUserId);
        const visibleSet = new Set(visibleIds.map((id) => String(id)));
        if (!visibleSet.has(String(nextUserId))) {
          return NextResponse.json({ error: 'Forbidden assignee' }, { status: 403 });
        }
      }

      updateData.userId = nextUserId;
    }

    if (timeUsedHours !== undefined) {
      const parsedTime = Number(timeUsedHours);
      if (!Number.isFinite(parsedTime) || parsedTime < 0) {
        return NextResponse.json({ error: 'Invalid time used value' }, { status: 400 });
      }
      updateData.timeUsedHours = Math.round(parsedTime * 100) / 100;
      updateData.timeAutoCalculated = false;
    }

    const previousStatus = String(existingTask.status || 'todo');
    const nextStatus = status !== undefined ? String(status) : previousStatus;
    const now = new Date();

    if (status !== undefined && previousStatus !== 'todo' && nextStatus === 'todo') {
      return NextResponse.json({ error: 'Task cannot be moved back to To Do' }, { status: 400 });
    }

    if (status !== undefined && nextStatus === 'pause' && previousStatus !== 'in-progress') {
      return NextResponse.json({ error: 'Pause is allowed only from In Progress' }, { status: 400 });
    }

    const currentActiveDurationMs =
      typeof existingTask.activeDurationMs === 'number' && Number.isFinite(existingTask.activeDurationMs)
        ? Math.max(0, existingTask.activeDurationMs)
        : 0;
    let nextActiveDurationMs = currentActiveDurationMs;

    if (previousStatus === 'in-progress' && nextStatus !== 'in-progress') {
      const startedAt = existingTask.inProgressStartedAt ? new Date(existingTask.inProgressStartedAt) : null;
      if (startedAt && !Number.isNaN(startedAt.getTime())) {
        const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
        nextActiveDurationMs += elapsedMs;
      }
      updateData.activeDurationMs = nextActiveDurationMs;
      updateData.inProgressStartedAt = null;
    }

    if (previousStatus !== 'in-progress' && nextStatus === 'in-progress') {
      updateData.inProgressStartedAt = now;
      updateData.doneAt = null;
    }

    if (previousStatus !== 'done' && nextStatus === 'done') {
      const computedHours = Math.round((nextActiveDurationMs / 36e5) * 100) / 100;

      updateData.doneAt = now;

      if (timeUsedHours === undefined) {
        updateData.timeUsedHours = computedHours;
        updateData.timeAutoCalculated = true;
      }
    }

    if (nextStatus !== 'done' && previousStatus === 'done') {
      updateData.doneAt = null;
    }

    updateData.updatedAt = new Date();

    const result = await db
      .collection('tasks')
      .updateOne({ _id: taskId }, { $set: updateData });

    if (!result.matchedCount) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const task = await getTaskWithRelations(db, params.id);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json(task);
  } catch {
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

// DELETE task
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const taskId = toObjectId(params.id);
    if (!taskId) {
      return NextResponse.json({ error: 'Invalid task id' }, { status: 400 });
    }

    const db = await getDb();
    const existing = await db.collection('tasks').findOne({ _id: taskId });
    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Members can only delete their own tasks
    if (session.user.role === 'member') {
      if (String(existing.userId) !== session.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (session.user.role === 'leader') {
      const sessionUserId = await resolveSessionUserObjectId(db, session);
      if (!sessionUserId) {
        return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
      }

      const visibleIds = await getLeaderVisibleUserIds(db, sessionUserId);
      const visibleSet = new Set(visibleIds.map((id) => String(id)));
      if (!visibleSet.has(String(existing.userId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const result = await db.collection('tasks').deleteOne({ _id: taskId });

    if (!result.deletedCount) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Task deleted' });
  } catch {
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
