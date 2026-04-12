import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import nodemailer from 'nodemailer';
import { authOptions } from '@/lib/auth';
import { getDb, toObjectId } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

function normalizeSignatureHtml(input: string, baseOrigin: string) {
  if (!input) return '';

  return input.replace(/<img\b([^>]*)>/gi, (full, attrs: string) => {
    const srcMatch = attrs.match(/src\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i);
    const originalSrc = (srcMatch?.[2] || srcMatch?.[3] || '').trim();
    const normalizedSrc = originalSrc.startsWith('//') ? `https:${originalSrc}` : originalSrc;

    let proxiedSrc = normalizedSrc;
    if (normalizedSrc && !normalizedSrc.startsWith('data:') && !normalizedSrc.startsWith('cid:')) {
      proxiedSrc = `${baseOrigin}/api/signature-image?url=${encodeURIComponent(normalizedSrc)}`;
    }

    let nextAttrsRaw = attrs;
    if (srcMatch) {
      nextAttrsRaw = nextAttrsRaw.replace(srcMatch[0], `src="${proxiedSrc}"`);
    }

    const hasReferrer = /referrerpolicy\s*=\s*/i.test(attrs);
    const hasCrossOrigin = /crossorigin\s*=\s*/i.test(attrs);
    const hasStyle = /style\s*=\s*/i.test(attrs);

    const nextAttrs = [
      nextAttrsRaw.trim(),
      hasReferrer ? '' : 'referrerpolicy="no-referrer"',
      hasCrossOrigin ? '' : 'crossorigin="anonymous"',
      hasStyle ? '' : 'style="max-width:100%;height:auto;display:inline-block;"',
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    return `<img ${nextAttrs}>`;
  });
}

interface TaskDoc {
  _id: unknown;
  title: string;
  description?: string;
  status: string;
  priority?: 'low' | 'medium' | 'high';
  timeUsedHours?: number | null;
  date: Date;
  createdAt: Date;
  userId: unknown;
  projectId: unknown;
  user: { _id: unknown; name: string; email: string };
  project: { _id: unknown; name: string; emoji: string };
}

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
    timeUsedHours: typeof task.timeUsedHours === 'number' ? task.timeUsedHours : null,
    date: task.date,
    createdAt: task.createdAt,
    userId: String(task.userId),
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

function getStatusLabel(status: string) {
  if (status === 'done') return 'Done';
  if (status === 'in-progress') return 'In Progress';
  if (status === 'pause') return 'Pause';
  return 'To Do';
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const to = typeof body?.to === 'string' ? body.to.trim() : '';
    const cc = typeof body?.cc === 'string' ? body.cc.trim() : '';
    const subjectInput = typeof body?.subject === 'string' ? body.subject.trim() : '';
    const intro = typeof body?.intro === 'string' ? body.intro.trim() : '';

    if (!to) {
      return NextResponse.json({ error: 'Recipient email is required' }, { status: 400 });
    }

    const db = await getDb();
    const task = await getTaskWithRelations(db, params.id);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (session.user.role === 'member' && task.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (session.user.role === 'leader') {
      const leaderId = await resolveSessionUserObjectId(db, session);
      if (!leaderId) {
        return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
      }

      const visibleUserIds = await getLeaderVisibleUserIds(db, leaderId);
      const visibleSet = new Set(visibleUserIds.map((id) => String(id)));
      if (!visibleSet.has(task.userId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const senderUserObjectId = await resolveSessionUserObjectId(db, session);
    if (!senderUserObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const sender = await db.collection('users').findOne(
      { _id: senderUserObjectId },
      {
        projection: {
          emailSenderEnabled: 1,
          emailSenderName: 1,
          emailSenderAddress: 1,
          emailSignatureHtml: 1,
          smtpHost: 1,
          smtpPort: 1,
          smtpSecure: 1,
          smtpAllowSelfSigned: 1,
          smtpUser: 1,
          smtpPass: 1,
        },
      }
    );

    if (!sender?.emailSenderEnabled) {
      return NextResponse.json({ error: 'Email sender is disabled in settings' }, { status: 400 });
    }

    if (!sender.emailSenderAddress || !sender.smtpHost || !sender.smtpUser || !sender.smtpPass) {
      return NextResponse.json({ error: 'Email sender config is incomplete in settings' }, { status: 400 });
    }

    const smtpPort = Number(sender.smtpPort) || 587;
    const useImplicitTls = smtpPort === 465;

    const transport = nodemailer.createTransport({
      host: sender.smtpHost,
      port: smtpPort,
      secure: useImplicitTls,
      requireTLS: !useImplicitTls && Boolean(sender.smtpSecure),
      tls: {
        rejectUnauthorized: !Boolean(sender.smtpAllowSelfSigned),
      },
      auth: {
        user: sender.smtpUser,
        pass: sender.smtpPass,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });

    try {
      await transport.verify();
    } catch (verifyError) {
      const verifyMessage = verifyError instanceof Error ? verifyError.message : 'SMTP verify failed';
      const hint = verifyMessage.toLowerCase().includes('self-signed')
        ? 'Enable "Allow self-signed TLS certificate" in Settings → Email Sender, then try again.'
        : undefined;
      return NextResponse.json(
        {
          error: 'SMTP connection failed',
          details: verifyMessage,
          hint,
        },
        { status: 400 }
      );
    }

    const taskDate = new Date(task.date).toLocaleDateString();
    const statusLabel = getStatusLabel(task.status);
    const priorityLabel = (task.priority || 'high').toUpperCase();
    const usedHoursLabel = typeof task.timeUsedHours === 'number' ? `${task.timeUsedHours}h` : '-';
    const subject = subjectInput || `Task Update: ${task.title}`;

    const lines = [
      intro || 'Please find the task details below:',
      '',
      `Task: ${task.title}`,
      `Project: ${task.project.emoji} ${task.project.name}`,
      `Status: ${statusLabel}`,
      `Priority: ${priorityLabel}`,
      `Time Used: ${usedHoursLabel}`,
      `Date: ${taskDate}`,
      `Assigned To: ${task.user.name} (${task.user.email})`,
    ];

    if (task.description) {
      lines.push('', 'Description:', task.description);
    }

    const textBody = lines.join('\n');
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <p>${(intro || 'Please find the task details below:').replace(/</g, '&lt;')}</p>
        <table style="border-collapse: collapse; margin-top: 8px;">
          <tr><td style="padding: 4px 8px 4px 0; color:#6b7280;">Task</td><td style="padding: 4px 0; font-weight:600;">${task.title.replace(/</g, '&lt;')}</td></tr>
          <tr><td style="padding: 4px 8px 4px 0; color:#6b7280;">Project</td><td style="padding: 4px 0;">${task.project.emoji} ${task.project.name.replace(/</g, '&lt;')}</td></tr>
          <tr><td style="padding: 4px 8px 4px 0; color:#6b7280;">Status</td><td style="padding: 4px 0;">${statusLabel}</td></tr>
          <tr><td style="padding: 4px 8px 4px 0; color:#6b7280;">Priority</td><td style="padding: 4px 0;">${priorityLabel}</td></tr>
          <tr><td style="padding: 4px 8px 4px 0; color:#6b7280;">Time Used</td><td style="padding: 4px 0;">${usedHoursLabel}</td></tr>
          <tr><td style="padding: 4px 8px 4px 0; color:#6b7280;">Date</td><td style="padding: 4px 0;">${taskDate}</td></tr>
          <tr><td style="padding: 4px 8px 4px 0; color:#6b7280;">Assigned To</td><td style="padding: 4px 0;">${task.user.name.replace(/</g, '&lt;')} (${task.user.email.replace(/</g, '&lt;')})</td></tr>
        </table>
        ${task.description ? `<p style="margin-top: 12px;"><strong>Description:</strong><br/>${task.description.replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</p>` : ''}
      </div>
    `;

    const signatureHtmlRaw = typeof sender.emailSignatureHtml === 'string' ? sender.emailSignatureHtml.trim() : '';
    const baseOrigin = new URL(request.url).origin;
    const signatureHtml = normalizeSignatureHtml(signatureHtmlRaw, baseOrigin);
    const textSignature = signatureHtml
      ? `\n\n${signatureHtml.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').trim()}`
      : '';

    const from = sender.emailSenderName
      ? `${sender.emailSenderName} <${sender.emailSenderAddress}>`
      : sender.emailSenderAddress;

    const info = await transport.sendMail({
      from,
      to,
      cc: cc || undefined,
      subject,
      text: `${textBody}${textSignature}`,
      html: `${htmlBody}${signatureHtml ? `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5; margin-top: 12px;">${signatureHtml}</div>` : ''}`,
      replyTo: sender.emailSenderAddress,
    });

    return NextResponse.json({
      message: 'Email sent successfully',
      messageId: info.messageId,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : undefined;
    return NextResponse.json({ error: 'Failed to send email', details }, { status: 500 });
  }
}
