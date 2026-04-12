import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Filter, ObjectId } from 'mongodb';
import { format } from 'date-fns';
import { authOptions } from '@/lib/auth';
import { getDb, toObjectId } from '@/lib/mongodb';

interface TaskDoc {
  _id: unknown;
  title: string;
  status: string;
  date: Date;
  createdAt: Date;
  priority?: string;
  timeUsedHours?: number;
  inProgressStartedAt?: Date | null;
  doneAt?: Date | null;
  userId: unknown;
  projectId: unknown;
  user: { _id: unknown; name: string };
  project: { _id: unknown; name: string; emoji: string; priority?: number };
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

function getStatusLabel(status: string) {
  if (status === 'done') return 'Done';
  if (status === 'in-progress') return 'In Progress';
  if (status === 'pause') return 'Pause';
  return 'To Do';
}

function extractSection(source: string, startTag: string, endTag?: string) {
  const start = source.indexOf(startTag);
  if (start === -1) return '';
  const from = start + startTag.length;
  const end = endTag ? source.indexOf(endTag, from) : source.length;
  if (end === -1) return source.slice(from).trim();
  return source.slice(from, end).trim();
}

function htmlToPlainText(html: string) {
  return html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeAiIntro(input: string) {
  return input
    .replace(/\n\s*tasks\s*:[\s\S]*$/i, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^tasks\s*:/i.test(t)) return false;
      if (/^-\s*.*\|.*\|.*\|/.test(t)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const date = typeof body?.date === 'string' && body.date ? body.date : new Date().toISOString().split('T')[0];
    const requestedScope: 'team' | 'me' | 'member' = body?.scope === 'me' || body?.scope === 'member' ? body.scope : 'team';
    const requestedLeaderId = typeof body?.leaderId === 'string' ? body.leaderId : '';
    const requestedUserId = typeof body?.userId === 'string' ? body.userId : '';

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const db = await getDb();
    const sessionUserObjectId = await resolveSessionUserObjectId(db, session);
    const role = session.user.role;
    const isLeader = role === 'leader';
    const isAdmin = role === 'admin';
    const canTeamScope = isLeader || isAdmin;
    const personalView = !canTeamScope || requestedScope === 'me';
    const memberView = canTeamScope && requestedScope === 'member';

    if (!sessionUserObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const user = await db
      .collection('users')
      .findOne(
        { _id: sessionUserObjectId },
        { projection: { aiEnabled: 1, groqApiKey: 1, groqModel: 1, emailSignatureHtml: 1 } }
      );

    if (!user?.aiEnabled || !user?.groqApiKey) {
      return NextResponse.json({ error: 'AI is not enabled in your settings' }, { status: 403 });
    }

    const where: Filter<Record<string, unknown>> = {};
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

    if (!tasks.length) {
      return NextResponse.json({ error: 'No tasks found for this date' }, { status: 400 });
    }

    const reportTasks = tasks.filter((task) => task.status !== 'todo');
    if (!reportTasks.length) {
      return NextResponse.json({ error: 'No non-TODO tasks found for this date' }, { status: 400 });
    }

    const formattedDate = format(new Date(date), 'dd MMMM yyyy');

    const lines: string[] = [];
    for (const task of reportTasks) {
      const cleanTitle = task.title.replace(/^\s*\d+\.\s*/, '').trim();
      const priorityLabel = typeof task.project.priority === 'number' && task.project.priority < 999999
        ? `P${task.project.priority + 1}`
        : 'P-';
      lines.push(
        `- [${priorityLabel}] ${task.project.emoji} ${task.project.name} | ${task.user.name} | ${cleanTitle} | ${getStatusLabel(task.status)}`
      );
    }

    const prompt = [
      `Generate a professional daily status email in US native English.`,
      `Date: ${formattedDate}`,
      `Role: ${personalView || memberView ? 'Individual Contributor Summary' : 'Team Lead Summary'}`,
      `Task count: ${reportTasks.length}`,
      'Important: Do not include any To Do task in output.',
      '',
      'Return strictly in this format:',
      'SUBJECT: <single line>',
      'INTRO:',
      '<2 short professional paragraphs. No bullet list. Do not add closing/signature.>',
      '',
      'Tasks:',
      ...lines,
    ].join('\n');

    const candidateModels = [
      user.groqModel,
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
      'mixtral-8x7b-32768',
    ].filter((m, idx, arr): m is string => typeof m === 'string' && !!m && arr.indexOf(m) === idx);

    let generatedText = '';
    let lastAiError = '';

    for (const model of candidateModels) {
      const aiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${user.groqApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'You write clear concise professional business emails. Always follow the exact output format requested by user.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 700,
        }),
      });

      const aiData = await aiRes.json().catch(() => null);
      const text = aiData?.choices?.[0]?.message?.content?.trim();

      if (aiRes.ok && text) {
        generatedText = text;
        break;
      }

      lastAiError = aiData?.error?.message || 'Failed to generate email with AI';
    }

    if (!generatedText) {
      return NextResponse.json({ error: lastAiError || 'Failed to generate email with AI' }, { status: 502 });
    }

    if (!generatedText) {
      return NextResponse.json({ error: 'No AI output returned' }, { status: 502 });
    }

    let subject = extractSection(generatedText, 'SUBJECT:', 'INTRO:');
    let intro = extractSection(generatedText, 'INTRO:');

    if (!subject) {
      subject = `Daily Task Update - ${formattedDate}`;
    }

    if (!intro) {
      intro = `Please find below a summary of today's completed tasks for your review and record.`;
    }

    intro = sanitizeAiIntro(intro);

    const signatureHtml = typeof user?.emailSignatureHtml === 'string' ? user.emailSignatureHtml.trim() : '';
    const signatureText = signatureHtml ? htmlToPlainText(signatureHtml) : '';

    const tableRowsHtml = reportTasks
      .map((task, index) => {
        const cleanTitle = task.title.replace(/^\s*\d+\.\s*/, '').trim();
        const priority = task.priority || 'high';
        const computedTime =
          task.doneAt && task.inProgressStartedAt
            ? Math.max(0, Math.round((((new Date(task.doneAt).getTime() - new Date(task.inProgressStartedAt).getTime()) / 36e5) * 100)) / 100)
            : null;
        const timeValue = typeof task.timeUsedHours === 'number' ? task.timeUsedHours : computedTime;
        const timeUsed = typeof timeValue === 'number' ? `${timeValue}h` : '-';
        return `
          <tr>
            <td style="border:1px solid #d1d5db;padding:4px 6px;text-align:center;">${index + 1}</td>
            <td style="border:1px solid #d1d5db;padding:4px 6px;">${escapeHtml(cleanTitle)}</td>
            <td style="border:1px solid #d1d5db;padding:4px 6px;text-transform:lowercase;">${escapeHtml(priority)}</td>
            <td style="border:1px solid #d1d5db;padding:4px 6px;text-align:center;">${escapeHtml(timeUsed)}</td>
            <td style="border:1px solid #d1d5db;padding:4px 6px;">${escapeHtml(getStatusLabel(task.status))}</td>
          </tr>
        `;
      })
      .join('');

    const introParagraphs = intro
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p style="margin:0 0 14px 0;">${escapeHtml(p)}</p>`)
      .join('');

    const htmlBody = `
      <div style="font-family:'Times New Roman', serif; font-size:18px; color:#111827; line-height:1.45;">
        <p style="margin:0 0 14px 0;">Dear Sir,</p>
        <p style="margin:0 0 14px 0;">Good day.</p>
        ${introParagraphs}
        <table style="border-collapse:collapse;width:100%;margin:8px 0 14px 0;font-size:16px;">
          <thead>
            <tr>
              <th style="border:1px solid #111827;background:#facc15;padding:5px 6px;">SL No</th>
              <th style="border:1px solid #111827;background:#facc15;padding:5px 6px;">Task Description</th>
              <th style="border:1px solid #111827;background:#facc15;padding:5px 6px;">Priority</th>
              <th style="border:1px solid #111827;background:#facc15;padding:5px 6px;">Time used (H)</th>
              <th style="border:1px solid #111827;background:#facc15;padding:5px 6px;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
        <p style="margin:0 0 14px 0;">Please let me know if any modifications or additional requirements need to be addressed.</p>
        <p style="margin:0 0 8px 0;">Thank you for your continued guidance and support.</p>
        <p style="margin:0;">Kind regards,</p>
        ${signatureHtml ? `<div style="margin-top:8px;">${signatureHtml}</div>` : ''}
      </div>
    `.trim();

    const emailBody = [
      'Dear Sir,',
      '',
      'Good day.',
      '',
      htmlToPlainText(intro),
      '',
      'Please let me know if any modifications or additional requirements need to be addressed.',
      'Thank you for your continued guidance and support.',
      '',
      'Kind regards,',
      ...(signatureText ? [signatureText] : []),
    ]
      .filter(Boolean)
      .join('\n')
      .trim();

    return NextResponse.json({
      date,
      formattedDate,
      subject,
      body: emailBody,
      htmlBody,
      isHtml: true,
      raw: generatedText,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to generate AI email' }, { status: 500 });
  }
}
