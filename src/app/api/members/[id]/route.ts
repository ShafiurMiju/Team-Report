import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, toObjectId } from '@/lib/mongodb';
import bcrypt from 'bcryptjs';

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

// PUT update member/leader
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !['leader', 'admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const memberId = toObjectId(params.id);
    if (!memberId) {
      return NextResponse.json({ error: 'Invalid member id' }, { status: 400 });
    }

    const body = await request.json();
    const { name, email, password, leaderId } = body;

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const sessionUserId = await resolveSessionUserObjectId(db, session);
    if (!sessionUserId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const existing = await db.collection('users').findOne({ _id: memberId });

    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    if (session.user.role === 'leader') {
      const isOwnedMember =
        existing.role === 'member' &&
        existing.leaderId &&
        String(existing.leaderId) === String(sessionUserId);

      if (!isOwnedMember) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    if (session.user.role === 'admin' && existing.role === 'admin') {
      return NextResponse.json({ error: 'Cannot edit admin user' }, { status: 400 });
    }

    const duplicateEmail = await db.collection('users').findOne({
      email,
      _id: { $ne: memberId },
    });

    if (duplicateEmail) {
      return NextResponse.json(
        { error: 'A user with this email already exists' },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {
      name,
      email,
      updatedAt: new Date(),
    };

    if (existing.role === 'member') {
      if (session.user.role === 'leader') {
        updateData.leaderId = sessionUserId;
      }

      if (session.user.role === 'admin' && leaderId !== undefined) {
        const nextLeaderId = toObjectId(String(leaderId));
        if (!nextLeaderId) {
          return NextResponse.json({ error: 'Invalid leader id' }, { status: 400 });
        }

        const leader = await db.collection('users').findOne({ _id: nextLeaderId, role: 'leader' });
        if (!leader) {
          return NextResponse.json({ error: 'Leader not found' }, { status: 404 });
        }

        updateData.leaderId = nextLeaderId;
      }
    }

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const result = await db.collection('users').findOneAndUpdate(
      { _id: memberId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: result._id.toString(),
      name: result.name,
      email: result.email,
      role: result.role,
      leaderId: result.leaderId ? String(result.leaderId) : null,
      createdAt: result.createdAt,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
  }
}

// DELETE member/leader
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !['leader', 'admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Don't allow deleting yourself
    if (params.id === session.user.id) {
      return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
    }

    const memberId = toObjectId(params.id);
    if (!memberId) {
      return NextResponse.json({ error: 'Invalid member id' }, { status: 400 });
    }

    const db = await getDb();
    const sessionUserId = await resolveSessionUserObjectId(db, session);
    if (!sessionUserId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const targetUser = await db.collection('users').findOne({ _id: memberId });
    if (!targetUser) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    if (session.user.role === 'leader') {
      const isOwnedMember =
        targetUser.role === 'member' &&
        targetUser.leaderId &&
        String(targetUser.leaderId) === String(sessionUserId);

      if (!isOwnedMember) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    if (session.user.role === 'admin' && targetUser.role === 'admin') {
      return NextResponse.json({ error: 'Cannot delete admin user' }, { status: 400 });
    }

    if (targetUser.role === 'leader') {
      const membersUnderLeader = await db
        .collection('users')
        .find({ role: 'member', leaderId: memberId }, { projection: { _id: 1 } })
        .toArray();

      const memberIds = membersUnderLeader.map((m) => m._id);
      if (memberIds.length > 0) {
        await db.collection('tasks').deleteMany({ userId: { $in: memberIds } });
        await db.collection('users').deleteMany({ _id: { $in: memberIds } });
      }
    }

    await db.collection('tasks').deleteMany({ userId: memberId });
    const result = await db.collection('users').deleteOne({ _id: memberId });

    if (!result.deletedCount) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Member deleted' });
  } catch {
    return NextResponse.json({ error: 'Failed to delete member' }, { status: 500 });
  }
}
