import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions } from '@/lib/auth';
import { getDb, toObjectId } from '@/lib/mongodb';

type BulkDraftTask = {
  title: string;
  description?: string;
  projectId: string;
  userId: string;
  projectName: string;
  projectEmoji: string;
  userName: string;
};

type SessionLike = { user?: { id?: string; email?: string; role?: string; name?: string } } | null;

type VisibleContext = {
  users: Array<{ _id: ObjectId; name: string }>;
  projects: Array<{ _id: ObjectId; name: string; emoji?: string }>;
  me: { _id: ObjectId; name: string };
};

function normalize(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tryParseJsonArray(text: string): Array<Record<string, unknown>> {
  const trimmed = text.trim();

  const direct = (() => {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  })();
  if (direct) return direct as Array<Record<string, unknown>>;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
    } catch {
      // ignore and continue
    }
  }

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    const slice = trimmed.slice(firstBracket, lastBracket + 1);
    try {
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
    } catch {
      // ignore
    }
  }

  return [];
}

async function resolveSessionUserObjectId(
  db: Awaited<ReturnType<typeof getDb>>,
  session: SessionLike
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

async function getVisibleContext(
  db: Awaited<ReturnType<typeof getDb>>,
  sessionUserId: ObjectId,
  role: string
): Promise<VisibleContext | null> {
  const me = await db
    .collection('users')
    .findOne({ _id: sessionUserId }, { projection: { _id: 1, name: 1, leaderId: 1 } });

  if (!me?._id) return null;

  if (role === 'member') {
    const member = await db
      .collection('users')
      .findOne({ _id: sessionUserId, role: 'member' }, { projection: { leaderId: 1 } });

    if (!member?.leaderId) return null;

    const leader = await db
      .collection('users')
      .findOne({ _id: member.leaderId as ObjectId, role: 'leader' }, { projection: { selectedProjectIds: 1 } });

    const selectedProjectIds = Array.isArray(leader?.selectedProjectIds)
      ? leader.selectedProjectIds.map((id: unknown) => String(id))
      : [];

    const projectObjectIds = selectedProjectIds
      .map((id) => toObjectId(id))
      .filter((id): id is ObjectId => Boolean(id));

    const projects = projectObjectIds.length
      ? await db
          .collection('projects')
          .find({ _id: { $in: projectObjectIds } }, { projection: { _id: 1, name: 1, emoji: 1 } })
          .toArray()
      : [];

    return {
      users: [{ _id: sessionUserId, name: String(me.name || 'Me') }],
      projects: projects.map((project) => ({
        _id: project._id as ObjectId,
        name: String((project as { name?: string }).name || 'Project'),
        emoji: String((project as { emoji?: string }).emoji || '🔷'),
      })),
      me: { _id: sessionUserId, name: String(me.name || 'Me') },
    };
  }

  if (role === 'leader') {
    const members = await db
      .collection('users')
      .find({ role: 'member', leaderId: sessionUserId }, { projection: { _id: 1, name: 1 } })
      .toArray();

    const leader = await db
      .collection('users')
      .findOne({ _id: sessionUserId, role: 'leader' }, { projection: { selectedProjectIds: 1 } });

    const selectedProjectIds = Array.isArray(leader?.selectedProjectIds)
      ? leader.selectedProjectIds.map((id: unknown) => String(id))
      : [];

    const projectObjectIds = selectedProjectIds
      .map((id) => toObjectId(id))
      .filter((id): id is ObjectId => Boolean(id));

    const projects = projectObjectIds.length
      ? await db
          .collection('projects')
          .find({ _id: { $in: projectObjectIds } }, { projection: { _id: 1, name: 1, emoji: 1 } })
          .toArray()
      : [];

    return {
      users: [
        { _id: sessionUserId, name: String(me.name || 'Me') },
        ...members.map((member) => ({
          _id: member._id as ObjectId,
          name: String((member as { name?: string }).name || 'Member'),
        })),
      ],
      projects: projects.map((project) => ({
        _id: project._id as ObjectId,
        name: String((project as { name?: string }).name || 'Project'),
        emoji: String((project as { emoji?: string }).emoji || '🔷'),
      })),
      me: { _id: sessionUserId, name: String(me.name || 'Me') },
    };
  }

  const users = await db
    .collection('users')
    .find({ role: { $in: ['leader', 'member'] } }, { projection: { _id: 1, name: 1 } })
    .toArray();

  const projects = await db
    .collection('projects')
    .find({}, { projection: { _id: 1, name: 1, emoji: 1 } })
    .toArray();

  const normalizedUsers = users.map((user) => ({
    _id: user._id as ObjectId,
    name: String((user as { name?: string }).name || 'User'),
  }));
  const hasMe = normalizedUsers.some((user) => String(user._id) === String(sessionUserId));
  const allUsers = hasMe
    ? normalizedUsers
    : [{ _id: sessionUserId, name: String(me.name || 'Me') }, ...normalizedUsers];

  return {
    users: allUsers,
    projects: projects.map((project) => ({
      _id: project._id as ObjectId,
      name: String((project as { name?: string }).name || 'Project'),
      emoji: String((project as { emoji?: string }).emoji || '🔷'),
    })),
    me: { _id: sessionUserId, name: String(me.name || 'Me') },
  };
}

function resolveByHint<T extends { _id: unknown; name: string }>(
  items: T[],
  hint: string
): T | null {
  const cleanHint = normalize(hint);
  if (!cleanHint) return null;

  const exact = items.find((item) => normalize(item.name) === cleanHint);
  if (exact) return exact;

  const includes = items.find((item) => normalize(item.name).includes(cleanHint) || cleanHint.includes(normalize(item.name)));
  return includes || null;
}

async function generateDraftTasks(
  db: Awaited<ReturnType<typeof getDb>>,
  sessionUserId: ObjectId,
  role: string,
  prompt: string,
  defaultProjectId?: string
): Promise<BulkDraftTask[]> {
  const context = await getVisibleContext(db, sessionUserId, role);
  if (!context) return [];

  if (!context.projects.length) {
    throw new Error('No available projects found for bulk task creation');
  }

  const user = await db
    .collection('users')
    .findOne(
      { _id: sessionUserId },
      { projection: { aiEnabled: 1, groqApiKey: 1, groqModel: 1 } }
    );

  if (!user?.aiEnabled || !user?.groqApiKey) {
    throw new Error('AI is not enabled in your settings');
  }

  const candidateModels = [
    user.groqModel,
    'llama-3.1-8b-instant',
    'llama-3.3-70b-versatile',
    'mixtral-8x7b-32768',
  ].filter((m, idx, arr): m is string => typeof m === 'string' && !!m && arr.indexOf(m) === idx);

  const projectNames = context.projects.map((p) => String((p as { name?: string }).name || '')).filter(Boolean);
  const userNames = context.users.map((u) => String((u as { name?: string }).name || '')).filter(Boolean);

  const aiPrompt = [
    'Convert user text into a JSON array of task objects.',
    'Return ONLY JSON array. No markdown, no explanation.',
    'Each item schema: {"title": string, "description": string, "project": string, "assignee": string}',
    'Rules:',
    '- Split sentence/list into multiple tasks.',
    '- Keep title clear and short.',
    '- description can be short details (optional).',
    '- project should be closest matching project name from available list when possible.',
    '- assignee can be empty string if unknown.',
    '',
    `Available projects: ${projectNames.join(', ')}`,
    `Available users: ${userNames.join(', ')}`,
    '',
    `Input: ${prompt}`,
  ].join('\n');

  let aiText = '';
  let lastError = '';

  for (const model of candidateModels) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
            content: 'You are a task planning assistant. Output strictly valid JSON array only.',
          },
          { role: 'user', content: aiPrompt },
        ],
        temperature: 0.1,
        max_tokens: 900,
      }),
    });

    const data = await res.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content?.trim();

    if (res.ok && text) {
      aiText = text;
      break;
    }

    lastError = data?.error?.message || 'Failed to generate bulk task list';
  }

  if (!aiText) {
    throw new Error(lastError || 'Failed to generate bulk task list');
  }

  const parsed = tryParseJsonArray(aiText);
  if (!parsed.length) {
    throw new Error('AI did not return a valid task list');
  }

  const fallbackProject =
    (defaultProjectId
      ? context.projects.find((project) => String(project._id) === defaultProjectId)
      : null) || context.projects[0];

  const drafts: BulkDraftTask[] = [];

  for (const raw of parsed) {
    const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
    if (!title) continue;
    const description = typeof raw?.description === 'string' ? raw.description.trim() : '';

    const projectHint = typeof raw?.project === 'string' ? raw.project.trim() : '';
    const assigneeHint = typeof raw?.assignee === 'string' ? raw.assignee.trim() : '';

    const matchedProject = projectHint ? resolveByHint(context.projects, projectHint) : null;
    const selectedProject = matchedProject || fallbackProject;
    if (!selectedProject?._id) continue;

    let selectedUser = context.me;
    if (role === 'leader') {
      const matchedUser = assigneeHint ? resolveByHint(context.users, assigneeHint) : null;
      selectedUser = matchedUser || context.me;
    } else if (role === 'admin') {
      const matchedUser = assigneeHint ? resolveByHint(context.users, assigneeHint) : null;
      selectedUser = matchedUser || context.me;
    }

    drafts.push({
      title,
      description,
      projectId: String(selectedProject._id),
      userId: String(selectedUser._id),
      projectName: String((selectedProject as { name?: string }).name || 'Project'),
      projectEmoji: String((selectedProject as { emoji?: string }).emoji || '🔷'),
      userName: String(selectedUser.name || 'Me'),
    });
  }

  return drafts.slice(0, 50);
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

    const body = await request.json().catch(() => ({}));
    const action = body?.action === 'create' ? 'create' : 'preview';
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    const defaultProjectId = typeof body?.defaultProjectId === 'string' ? body.defaultProjectId : '';

    const db = await getDb();
    const sessionUserId = await resolveSessionUserObjectId(db, session);
    if (!sessionUserId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    if (action === 'preview') {
      if (!prompt) {
        return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
      }

      const drafts = await generateDraftTasks(db, sessionUserId, session.user.role, prompt, defaultProjectId);
      if (!drafts.length) {
        return NextResponse.json({ error: 'No tasks generated from prompt' }, { status: 400 });
      }

      return NextResponse.json({ drafts });
    }

    const dateInput = typeof body?.date === 'string' && body.date ? body.date : new Date().toISOString().split('T')[0];
    const tasksInput = Array.isArray(body?.tasks) ? body.tasks : [];

    if (!tasksInput.length) {
      return NextResponse.json({ error: 'No tasks to create' }, { status: 400 });
    }

    const context = await getVisibleContext(db, sessionUserId, session.user.role);
    if (!context) {
      return NextResponse.json({ error: 'Failed to resolve task context' }, { status: 400 });
    }

    const allowedUserIds = new Set(context.users.map((u) => String(u._id)));
    const allowedProjectIds = new Set(context.projects.map((p) => String(p._id)));

    const dateValue = new Date(dateInput);
    if (Number.isNaN(dateValue.getTime())) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }

    const now = new Date();
    const docs = tasksInput
      .map((item: Record<string, unknown>) => {
        const title = typeof item?.title === 'string' ? item.title.trim() : '';
        const description = typeof item?.description === 'string' ? item.description.trim() : '';
        const userId = typeof item?.userId === 'string' ? item.userId : '';
        const projectId = typeof item?.projectId === 'string' ? item.projectId : '';
        const priority = typeof item?.priority === 'string' ? item.priority : 'high';
        const status = typeof item?.status === 'string' ? item.status : 'todo';

        if (!title || !userId || !projectId) return null;
        if (!allowedUserIds.has(userId) || !allowedProjectIds.has(projectId)) return null;

        const userObjectId = toObjectId(userId);
        const projectObjectId = toObjectId(projectId);
        if (!userObjectId || !projectObjectId) return null;

        return {
          title,
          description: description || null,
          projectId: projectObjectId,
          userId: userObjectId,
          date: dateValue,
          status,
          priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'high',
          inProgressStartedAt: status === 'in-progress' ? now : null,
          activeDurationMs: 0,
          doneAt: status === 'done' ? now : null,
          timeUsedHours: null,
          timeAutoCalculated: false,
          transferredAt: null,
          transferredToDate: null,
          createdAt: now,
          updatedAt: now,
        };
      })
      .filter(Boolean);

    if (!docs.length) {
      return NextResponse.json({ error: 'No valid tasks found for creation' }, { status: 400 });
    }

    await db.collection('tasks').insertMany(docs);

    return NextResponse.json({ message: 'Bulk tasks created', createdCount: docs.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process bulk tasks';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
