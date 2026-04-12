import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Filter, ObjectId } from 'mongodb';
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
    .findOne(
      { email: session.user.email },
      { projection: { _id: 1 } }
    );

  if (!user?._id) return null;
  return toObjectId(String(user._id));
}

async function getLeaderMemberIds(
  db: Awaited<ReturnType<typeof getDb>>,
  leaderId: ObjectId
) {
  const members = await db
    .collection('users')
    .find({ role: 'member', leaderId }, { projection: { _id: 1 } })
    .toArray();

  return members.map((member) => member._id as ObjectId);
}

// GET dashboard stats
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 6);

    const role = session.user.role;
    const isLeader = role === 'leader';
    const isAdmin = role === 'admin';
    const isManager = isLeader || isAdmin;
    const db = await getDb();
    const userId = !isManager ? await resolveSessionUserObjectId(db, session) : null;

    if (!isManager && !userId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    let leaderMemberIds: ObjectId[] = [];
    let leaderVisibleUserIds: ObjectId[] = [];

    if (isLeader) {
      const leaderId = await resolveSessionUserObjectId(db, session);
      if (!leaderId) {
        return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
      }

      leaderMemberIds = await getLeaderMemberIds(db, leaderId);
      leaderVisibleUserIds = [leaderId, ...leaderMemberIds];
    }

    const userFilter: Filter<Record<string, unknown>> = isAdmin
      ? {}
      : isLeader
        ? { userId: { $in: leaderVisibleUserIds } }
        : { userId: userId! };
    const todayDateFilter = { date: { $gte: today, $lte: endOfDay } };
    const carryOverDateFilter = { date: { $lt: today } };

    const [totalProjects, totalMembers, totalTasks, todayTasks, doneTasks, inProgressTasks, todoTasks] =
      await Promise.all([
        db.collection('projects').countDocuments(),
        isAdmin
          ? db.collection('users').countDocuments({ role: { $in: ['leader', 'member'] } })
          : isLeader
            ? Promise.resolve(leaderMemberIds.length)
            : db.collection('users').countDocuments({ _id: userId! }),
        db.collection('tasks').countDocuments(userFilter),
        db.collection('tasks').countDocuments({ ...userFilter, ...todayDateFilter }),
        db.collection('tasks').countDocuments({ ...userFilter, status: 'done', ...todayDateFilter }),
        db.collection('tasks').countDocuments({ ...userFilter, status: 'in-progress', ...todayDateFilter }),
        db.collection('tasks').countDocuments({ ...userFilter, status: 'todo', ...todayDateFilter }),
      ]);

    const pendingCarryOverTasks = await db.collection('tasks').countDocuments({
      ...userFilter,
      ...carryOverDateFilter,
      status: { $in: ['todo', 'in-progress'] },
      $or: [{ transferredToDate: null }, { transferredToDate: { $exists: false } }],
    });

    const completionRate = todayTasks > 0 ? Math.round((doneTasks / todayTasks) * 100) : 0;

    const weeklySeriesRaw = await db
      .collection('tasks')
      .aggregate([
        {
          $match: {
            ...userFilter,
            date: { $gte: weekStart, $lte: endOfDay },
          },
        },
        {
          $group: {
            _id: {
              day: {
                $dateToString: { format: '%Y-%m-%d', date: '$date' },
              },
            },
            total: { $sum: 1 },
            done: {
              $sum: {
                $cond: [{ $eq: ['$status', 'done'] }, 1, 0],
              },
            },
          },
        },
        { $sort: { '_id.day': 1 } },
      ])
      .toArray();

    const weeklyMap = new Map(
      weeklySeriesRaw.map((item) => [
        item._id.day,
        {
          total: Number(item.total || 0),
          done: Number(item.done || 0),
        },
      ])
    );

    const weeklySeries = Array.from({ length: 7 }).map((_, idx) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + idx);
      const key = d.toISOString().split('T')[0];
      const found = weeklyMap.get(key) || { total: 0, done: 0 };

      return {
        date: key,
        label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        total: found.total,
        done: found.done,
      };
    });

    const projectSummaryRaw = await db
      .collection('tasks')
      .aggregate([
        {
          $match: {
            ...userFilter,
            ...todayDateFilter,
          },
        },
        {
          $lookup: {
            from: 'projects',
            localField: 'projectId',
            foreignField: '_id',
            as: 'project',
          },
        },
        { $unwind: '$project' },
        {
          $group: {
            _id: '$projectId',
            name: { $first: '$project.name' },
            emoji: { $first: '$project.emoji' },
            total: { $sum: 1 },
            done: {
              $sum: {
                $cond: [{ $eq: ['$status', 'done'] }, 1, 0],
              },
            },
            inProgress: {
              $sum: {
                $cond: [{ $eq: ['$status', 'in-progress'] }, 1, 0],
              },
            },
            todo: {
              $sum: {
                $cond: [{ $eq: ['$status', 'todo'] }, 1, 0],
              },
            },
            completionHours: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$status', 'done'] }, { $isNumber: '$timeUsedHours' }] },
                  '$timeUsedHours',
                  0,
                ],
              },
            },
          },
        },
        { $sort: { total: -1, name: 1 } },
        { $limit: 8 },
      ])
      .toArray();

    const projectSummary = projectSummaryRaw.map((item) => ({
      id: String(item._id),
      name: item.name,
      emoji: item.emoji,
      total: item.total,
      done: item.done,
      inProgress: item.inProgress,
      todo: item.todo,
      completionHours: Math.round((Number(item.completionHours || 0)) * 100) / 100,
      completionRate: item.total > 0 ? Math.round((item.done / item.total) * 100) : 0,
    }));

    const memberSummary = isManager
      ? await db
          .collection('tasks')
          .aggregate([
            {
              $match: {
                ...userFilter,
                ...todayDateFilter,
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
              $group: {
                _id: '$userId',
                role: { $first: '$user.role' },
                name: { $first: '$user.name' },
                total: { $sum: 1 },
                done: {
                  $sum: {
                    $cond: [{ $eq: ['$status', 'done'] }, 1, 0],
                  },
                },
                inProgress: {
                  $sum: {
                    $cond: [{ $eq: ['$status', 'in-progress'] }, 1, 0],
                  },
                },
                todo: {
                  $sum: {
                    $cond: [{ $eq: ['$status', 'todo'] }, 1, 0],
                  },
                },
              },
            },
            {
              $match: {
                role: 'member',
              },
            },
            { $sort: { total: -1, name: 1 } },
            { $limit: 10 },
          ])
          .toArray()
      : [];

    const normalizedMemberSummary = memberSummary.map((item) => ({
      id: String(item._id),
      name: item.name,
      total: item.total,
      done: item.done,
      inProgress: item.inProgress,
      todo: item.todo,
      completionRate: item.total > 0 ? Math.round((item.done / item.total) * 100) : 0,
    }));

    // Recent tasks
    const recentTasksRaw = await db
      .collection('tasks')
      .aggregate([
        {
          $match: {
            ...userFilter,
            date: { $gte: today, $lte: endOfDay },
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
        { $sort: { updatedAt: -1 } },
        { $limit: 10 },
      ])
      .toArray();

    const recentTasks = recentTasksRaw.map((task) => ({
      id: String(task._id),
      title: task.title,
      status: task.status,
      date: task.date,
      updatedAt: task.updatedAt,
      user: {
        name: task.user?.name,
      },
      project: {
        name: task.project?.name,
        emoji: task.project?.emoji,
      },
    }));

    return NextResponse.json({
      totalProjects,
      totalMembers,
      totalTasks,
      todayTasks,
      doneTasks,
      inProgressTasks,
      todoTasks,
      pendingCarryOverTasks,
      completionRate,
      weeklySeries,
      projectSummary,
      memberSummary: normalizedMemberSummary,
      recentTasks,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
