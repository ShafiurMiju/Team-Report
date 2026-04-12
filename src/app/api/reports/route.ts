import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Filter, ObjectId } from 'mongodb';
import { getDb, toObjectId } from '@/lib/mongodb';
import { format } from 'date-fns';

interface TaskDoc {
  _id: unknown;
  title: string;
  status: string;
  date: Date;
  createdAt: Date;
  userId: unknown;
  projectId: unknown;
  user: { _id: unknown; name: string };
  project: { _id: unknown; name: string; emoji: string; priority?: number };
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

async function getAdminVisibleUserIds(
  db: Awaited<ReturnType<typeof getDb>>,
  leaderId?: ObjectId
) {
  if (leaderId) {
    const leader = await db.collection('users').findOne({ _id: leaderId, role: 'leader' }, { projection: { _id: 1 } });
    if (!leader) return null;

    const members = await db
      .collection('users')
      .find({ role: 'member', leaderId }, { projection: { _id: 1 } })
      .toArray();

    return [leaderId, ...members.map((member) => member._id as ObjectId)];
  }

  const teamUsers = await db
    .collection('users')
    .find({ role: { $in: ['leader', 'member'] } }, { projection: { _id: 1 } })
    .toArray();

  return teamUsers.map((user) => user._id as ObjectId);
}

async function getPriorityProjectIdsForSession(
  db: Awaited<ReturnType<typeof getDb>>,
  role: string,
  sessionUserObjectId: ObjectId
) {
  if (role === 'leader') {
    const leader = await db
      .collection('users')
      .findOne({ _id: sessionUserObjectId, role: 'leader' }, { projection: { selectedProjectIds: 1 } });

    return Array.isArray(leader?.selectedProjectIds)
      ? leader.selectedProjectIds.map((id: unknown) => String(id))
      : [];
  }

  if (role === 'member') {
    const member = await db
      .collection('users')
      .findOne({ _id: sessionUserObjectId, role: 'member' }, { projection: { leaderId: 1 } });

    if (!member?.leaderId) return [];

    const leader = await db
      .collection('users')
      .findOne({ _id: member.leaderId as ObjectId, role: 'leader' }, { projection: { selectedProjectIds: 1 } });

    return Array.isArray(leader?.selectedProjectIds)
      ? leader.selectedProjectIds.map((id: unknown) => String(id))
      : [];
  }

  return [];
}

function getStatusMeta(status: string) {
  if (status === 'done') return { icon: '✅', label: 'Done' };
  if (status === 'in-progress') return { icon: '🔄', label: 'In Progress' };
  if (status === 'pause') return { icon: '⏸️', label: 'Pause' };
  return { icon: '📋', label: 'To Do' };
}

// GET report for a specific date
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const rawScope = searchParams.get('scope');
    const requestedScope: 'team' | 'me' | 'member' = rawScope === 'me' || rawScope === 'member' ? rawScope : 'team';
    const requestedLeaderId = searchParams.get('leaderId');
    const requestedUserId = searchParams.get('userId');

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const db = await getDb();
    const where: Filter<Record<string, unknown>> = {};
    const role = session.user.role;
    const isLeader = role === 'leader';
    const isAdmin = role === 'admin';
    const canTeamScope = isLeader || isAdmin;
    const personalView = !canTeamScope || requestedScope === 'me';
    const memberView = canTeamScope && requestedScope === 'member';
    const sessionUserObjectId = await resolveSessionUserObjectId(db, session);

    if (!sessionUserObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    // Personal view always shows current user's tasks only
    if (personalView) {
      where.userId = sessionUserObjectId;
    } else if (memberView && isLeader) {
      const targetUserId = toObjectId(requestedUserId || '');
      if (!targetUserId) {
        return NextResponse.json({ error: 'Valid userId is required for team member report' }, { status: 400 });
      }

      const member = await db
        .collection('users')
        .findOne({ _id: targetUserId, role: 'member', leaderId: sessionUserObjectId }, { projection: { _id: 1 } });

      if (!member) {
        return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
      }

      where.userId = targetUserId;
    } else if (isLeader) {
      const visibleUserIds = await getLeaderVisibleUserIds(db, sessionUserObjectId);
      where.userId = { $in: visibleUserIds };
    } else if (isAdmin) {
      const leaderObjectId = requestedLeaderId ? toObjectId(requestedLeaderId) : null;
      if (requestedLeaderId && !leaderObjectId) {
        return NextResponse.json({ error: 'Invalid leader id' }, { status: 400 });
      }

      const visibleUserIds = await getAdminVisibleUserIds(db, leaderObjectId || undefined);
      if (visibleUserIds === null) {
        return NextResponse.json({ error: 'Leader not found' }, { status: 404 });
      }

      where.userId = { $in: visibleUserIds };
    }

    const tasks = await db
      .collection('tasks')
      .aggregate<TaskDoc>([
        {
          $match: {
            ...where,
            date: { $gte: startOfDay, $lte: endOfDay },
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
        {
          $sort: {
            'project.priority': 1,
            'project.name': 1,
            'user.name': 1,
            createdAt: 1,
          },
        },
      ])
      .toArray();

    const normalizedTasks = tasks.map((task) => ({
      id: String(task._id),
      title: task.title,
      status: task.status,
      date: task.date,
      createdAt: task.createdAt,
      userId: String(task.userId),
      projectId: String(task.projectId),
      user: {
        id: String(task.user._id),
        name: task.user.name,
      },
      project: {
        id: String(task.project._id),
        name: task.project.name,
        emoji: task.project.emoji,
        priority: typeof task.project.priority === 'number' ? task.project.priority : 999999,
      },
    }));

    const priorityProjectIds = await getPriorityProjectIdsForSession(db, role, sessionUserObjectId);
    const priorityOrderMap = new Map(priorityProjectIds.map((id, index) => [id, index]));

    const sortedTasks = [...normalizedTasks].sort((a, b) => {
      const aPriority = priorityOrderMap.has(a.projectId)
        ? Number(priorityOrderMap.get(a.projectId))
        : Number.MAX_SAFE_INTEGER;
      const bPriority = priorityOrderMap.has(b.projectId)
        ? Number(priorityOrderMap.get(b.projectId))
        : Number.MAX_SAFE_INTEGER;

      if (aPriority !== bPriority) return aPriority - bPriority;

      if (a.project.name !== b.project.name) {
        return a.project.name.localeCompare(b.project.name);
      }

      if (a.user.name !== b.user.name) {
        return a.user.name.localeCompare(b.user.name);
      }

      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // Group by project, then by user
    const grouped: Record<string, {
      project: { id: string; name: string; emoji: string; priority: number };
      users: Record<string, {
        user: { id: string; name: string };
        tasks: { title: string; status: string }[];
      }>;
    }> = {};

    for (const task of sortedTasks) {
      const pId = task.projectId;
      if (!grouped[pId]) {
        grouped[pId] = {
          project: task.project,
          users: {},
        };
      }
      const uId = task.userId;
      if (!grouped[pId].users[uId]) {
        grouped[pId].users[uId] = {
          user: task.user,
          tasks: [],
        };
      }
      grouped[pId].users[uId].tasks.push({
        title: task.title,
        status: task.status,
      });
    }

    // Generate WhatsApp-formatted text
    const dateObj = new Date(date);
    const formattedDate = format(dateObj, 'dd MMMM yyyy');

    const lines: string[] = [];
    lines.push(personalView || memberView ? '*DAILY TASK REPORT*' : '*DAILY TEAM REPORT*');

    const reportOwnerName = personalView
      ? (session.user.name || '')
      : (memberView ? (sortedTasks[0]?.user?.name || '') : '');

    if (reportOwnerName) {
      lines.push(`${reportOwnerName}`);
    }

    lines.push(`Date: ${formattedDate}`);
    lines.push(`Total Tasks: ${sortedTasks.length}`);

    const projectEntries = Object.values(grouped);
    for (const entry of projectEntries) {
      lines.push('');
      const projectTitle = entry.project.emoji
        ? `${entry.project.emoji} ${entry.project.name}`
        : entry.project.name;
      lines.push(`*${projectTitle}*`);

      const userEntries = Object.values(entry.users);
      if (!personalView && !memberView) {
        for (const userEntry of userEntries) {
          lines.push(`👤 ${userEntry.user.name}`);

          userEntry.tasks.forEach((task, idx) => {
            const { icon, label } = getStatusMeta(task.status);
            const cleanTitle = task.title.replace(/^\s*\d+\.\s*/u, '').trim();
            lines.push(`  ${idx + 1}. ${cleanTitle} ${icon} [${label}]`);
          });
        }
      } else {
        const memberTasks = userEntries.flatMap((u) => u.tasks);
        memberTasks.forEach((task, idx) => {
          const { icon, label } = getStatusMeta(task.status);
          const cleanTitle = task.title.replace(/^\s*\d+\.\s*/u, '').trim();
          lines.push(`  ${idx + 1}. ${cleanTitle} ${icon} [${label}]`);
        });
      }
    }

    const report = lines.join('\n').trim();

    return NextResponse.json({
      date,
      formattedDate,
      scope: personalView ? 'me' : (memberView ? 'member' : 'team'),
      tasks: sortedTasks,
      grouped,
      report: report.trim(),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
