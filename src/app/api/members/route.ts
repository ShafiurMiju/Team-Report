import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';

async function resolveSessionUserObjectId(
  db: Awaited<ReturnType<typeof getDb>>,
  session: { user?: { id?: string; email?: string } } | null
) {
  const id = session?.user?.id;
  if (id && ObjectId.isValid(id)) return new ObjectId(id);

  if (!session?.user?.email) return null;

  const user = await db
    .collection('users')
    .findOne({ email: session.user.email }, { projection: { _id: 1 } });

  if (!user?._id) return null;
  return new ObjectId(String(user._id));
}

// GET team members
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !['leader', 'admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDb();
    const isAdmin = session.user.role === 'admin';
    const sessionUserId = await resolveSessionUserObjectId(db, session);

    if (!isAdmin && !sessionUserId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const userMatch = isAdmin
      ? { role: { $in: ['leader', 'member'] } }
      : { role: 'member', leaderId: sessionUserId };

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const members = await db
      .collection('users')
      .aggregate([
        {
          $match: userMatch,
        },
        {
          $lookup: {
            from: 'tasks',
            localField: '_id',
            foreignField: 'userId',
            as: 'tasks',
          },
        },
        {
          $addFields: {
            taskCount: { $size: '$tasks' },
            todayTaskCount: {
              $size: {
                $filter: {
                  input: '$tasks',
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
        {
          $project: {
            id: { $toString: '$_id' },
            name: 1,
            email: 1,
            role: 1,
            leaderId: {
              $cond: [{ $ifNull: ['$leaderId', false] }, { $toString: '$leaderId' }, null],
            },
            createdAt: 1,
            totalCount: '$taskCount',
            todayCount: '$todayTaskCount',
            _count: {
              tasks: '$taskCount',
            },
          },
        },
        {
          $sort: { createdAt: 1 },
        },
      ])
      .toArray();

    return NextResponse.json(members);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}

// POST create user
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !['leader', 'admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, email, password, role, leaderId } = body;

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email and password are required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const sessionUserId = await resolveSessionUserObjectId(db, session);
    if (!sessionUserId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const existing = await db.collection('users').findOne({ email });
    if (existing) {
      return NextResponse.json(
        { error: 'A user with this email already exists' },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const isAdmin = session.user.role === 'admin';

    let targetRole: 'leader' | 'member' = 'member';
    let targetLeaderId: ObjectId | null = sessionUserId;

    if (isAdmin) {
      targetRole = role === 'member' ? 'member' : 'leader';
      targetLeaderId = null;

      if (targetRole === 'member') {
        if (!leaderId || !ObjectId.isValid(leaderId)) {
          return NextResponse.json(
            { error: 'Valid leaderId is required when creating a member as admin' },
            { status: 400 }
          );
        }

        const leaderObjectId = new ObjectId(leaderId);
        const leader = await db.collection('users').findOne({ _id: leaderObjectId, role: 'leader' });
        if (!leader) {
          return NextResponse.json({ error: 'Leader not found' }, { status: 404 });
        }

        targetLeaderId = leaderObjectId;
      }
    }

    const now = new Date();
    const result = await db.collection('users').insertOne({
      name,
      email,
      password: hashedPassword,
      role: targetRole,
      ...(targetRole === 'member' ? { leaderId: targetLeaderId } : {}),
      createdAt: now,
      updatedAt: now,
    });

    const user = {
      id: result.insertedId.toString(),
      name,
      email,
      role: targetRole,
      leaderId: targetRole === 'member' && targetLeaderId ? String(targetLeaderId) : null,
      createdAt: now,
    };

    return NextResponse.json(user, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 });
  }
}
