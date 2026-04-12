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

async function resolveMemberLeaderId(
  db: Awaited<ReturnType<typeof getDb>>,
  memberId: ObjectId
) {
  const member = await db
    .collection('users')
    .findOne({ _id: memberId, role: 'member' }, { projection: { leaderId: 1 } });

  if (!member?.leaderId) return null;
  return member.leaderId as ObjectId;
}

// GET projects
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope') === 'all' ? 'all' : 'selected';
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const role = session.user.role;
    const isMember = role === 'member';
    const isLeader = role === 'leader';
    const isAdmin = role === 'admin';
    const memberObjectId = isMember ? await resolveSessionUserObjectId(db, session) : null;
    const leaderObjectId = isLeader ? await resolveSessionUserObjectId(db, session) : null;
    const leaderVisibleUserIds =
      isLeader && leaderObjectId ? await getLeaderVisibleUserIds(db, leaderObjectId) : null;
    const memberLeaderId =
      isMember && memberObjectId ? await resolveMemberLeaderId(db, memberObjectId) : null;

    if (isMember && !memberObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    if (isLeader && !leaderVisibleUserIds) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const selectedProjectMatch = isAdmin
      ? {}
      : isLeader
        ? { leaderIds: leaderObjectId }
        : memberLeaderId
          ? { leaderIds: memberLeaderId }
          : { _id: { $exists: false } };

    const projectMatch = scope === 'all' && !isAdmin ? {} : selectedProjectMatch;

    const rolePriorityUserId = isLeader ? leaderObjectId : isMember ? memberLeaderId : null;
    const useRolePriority = scope === 'selected' && !isAdmin && !!rolePriorityUserId;

    const projects = await db
      .collection('projects')
      .aggregate([
        {
          $match: projectMatch,
        },
        {
          $lookup: {
            from: 'tasks',
            localField: '_id',
            foreignField: 'projectId',
            as: 'tasks',
          },
        },
        {
          $addFields: {
            relevantTasks: isMember
              ? {
                  $filter: {
                    input: '$tasks',
                    as: 'task',
                    cond: { $eq: ['$$task.userId', memberObjectId] },
                  },
                }
              : isLeader
                ? {
                    $filter: {
                      input: '$tasks',
                      as: 'task',
                      cond: { $in: ['$$task.userId', leaderVisibleUserIds] },
                    },
                  }
              : '$tasks',
          },
        },
        {
          $addFields: {
            taskCount: { $size: '$relevantTasks' },
            todayTaskCount: {
              $size: {
                $filter: {
                  input: '$relevantTasks',
                  as: 'task',
                  cond: {
                    $and: [
                      { $gte: ['$$task.date', startOfDay] },
                      { $lte: ['$$task.date', endOfDay] },
                    ],
                  },
                },
              },
            },
          },
        },
        ...(useRolePriority
          ? [
              {
                $addFields: {
                  rolePriority: {
                    $let: {
                      vars: {
                        matchedPriority: {
                          $first: {
                            $filter: {
                              input: { $ifNull: ['$leaderPriorities', []] },
                              as: 'lp',
                              cond: { $eq: ['$$lp.leaderId', rolePriorityUserId] },
                            },
                          },
                        },
                      },
                      in: { $ifNull: ['$$matchedPriority.priority', 999999] },
                    },
                  },
                },
              },
            ]
          : []),
        {
          $project: {
            id: { $toString: '$_id' },
            name: 1,
            emoji: 1,
            leaderIds: {
              $map: {
                input: { $ifNull: ['$leaderIds', []] },
                as: 'id',
                in: { $toString: '$$id' },
              },
            },
            priority: useRolePriority
              ? '$rolePriority'
              : { $ifNull: ['$priority', 999999] },
            createdAt: 1,
            updatedAt: 1,
            totalCount: '$taskCount',
            todayCount: '$todayTaskCount',
            _count: {
              tasks: '$taskCount',
            },
          },
        },
        {
          $sort:
            scope === 'all' && !isAdmin
              ? { createdAt: -1 }
              : { priority: 1, createdAt: -1 },
        },
      ])
      .toArray();

    return NextResponse.json(projects);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}

// POST create project (leader/admin)
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !['leader', 'admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, emoji, leaderIds } = body;

    if (!name) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    const db = await getDb();
    const sessionUserObjectId = await resolveSessionUserObjectId(db, session);
    if (!sessionUserObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const now = new Date();
    const normalizedEmoji = emoji || '🔷';

    let normalizedLeaderIds: ObjectId[] = [];

    if (session.user.role === 'leader') {
      normalizedLeaderIds = [sessionUserObjectId];
    } else {
      const requested = Array.isArray(leaderIds) ? leaderIds : null;

      if (!requested) {
        const allLeaders = await db
          .collection('users')
          .find({ role: 'leader' }, { projection: { _id: 1 } })
          .toArray();

        normalizedLeaderIds = allLeaders.map((leader) => leader._id as ObjectId);
      } else {
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

      normalizedLeaderIds = objectIds;
      }
    }

    const highestPriorityProject = await db
      .collection('projects')
      .find({}, { projection: { priority: 1 } })
      .sort({ priority: -1 })
      .limit(1)
      .next();

    const nextPriority =
      typeof highestPriorityProject?.priority === 'number'
        ? highestPriorityProject.priority + 1
        : 0;

    const result = await db.collection('projects').insertOne({
      name,
      emoji: normalizedEmoji,
      leaderIds: normalizedLeaderIds,
      priority: nextPriority,
      createdAt: now,
      updatedAt: now,
    });

    if (session.user.role === 'leader') {
      await db.collection('users').updateOne(
        { _id: sessionUserObjectId, role: 'leader' },
        {
          $addToSet: {
            selectedProjectIds: result.insertedId,
          },
          $set: {
            updatedAt: now,
          },
        }
      );
    }

    const project = {
      id: result.insertedId.toString(),
      name,
      emoji: normalizedEmoji,
      leaderIds: normalizedLeaderIds.map((id) => String(id)),
      priority: nextPriority,
      createdAt: now,
      updatedAt: now,
      totalCount: 0,
      todayCount: 0,
      _count: { tasks: 0 },
    };

    return NextResponse.json(project, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
