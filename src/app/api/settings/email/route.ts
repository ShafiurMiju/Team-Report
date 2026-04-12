import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, toObjectId } from '@/lib/mongodb';

function maskSecret(secret: string) {
  if (!secret) return '';
  if (secret.length <= 6) return '••••••';
  return `${secret.slice(0, 2)}••••••${secret.slice(-2)}`;
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

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDb();
    const userObjectId = await resolveSessionUserObjectId(db, session);

    if (!userObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const user = await db.collection('users').findOne(
      { _id: userObjectId },
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

    const sessionEmail = session.user?.email?.trim() || '';
    const effectiveSenderEmail = (user?.emailSenderAddress || user?.smtpUser || sessionEmail || '').trim();
    const effectiveSmtpUser = (user?.smtpUser || user?.emailSenderAddress || sessionEmail || '').trim();
    const effectiveSmtpHost = (user?.smtpHost || 'mail.octopi-digital.com').trim();

    return NextResponse.json({
      emailSenderEnabled: Boolean(user?.emailSenderEnabled),
      emailSenderName: user?.emailSenderName || '',
      emailSenderAddress: effectiveSenderEmail,
      emailSignatureHtml: user?.emailSignatureHtml || '',
      smtpHost: effectiveSmtpHost,
      smtpPort: typeof user?.smtpPort === 'number' ? user.smtpPort : 587,
      smtpSecure: typeof user?.smtpSecure === 'boolean' ? user.smtpSecure : true,
      smtpAllowSelfSigned: typeof user?.smtpAllowSelfSigned === 'boolean' ? user.smtpAllowSelfSigned : true,
      smtpUser: effectiveSmtpUser,
      hasSmtpPassword: Boolean(user?.smtpPass),
      maskedSmtpPassword: user?.smtpPass ? maskSecret(user.smtpPass) : null,
      configured: Boolean(effectiveSenderEmail && effectiveSmtpHost && effectiveSmtpUser && user?.smtpPass),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load email settings' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const emailSenderEnabled = Boolean(body?.emailSenderEnabled);
    const removeSmtpPassword = Boolean(body?.removeSmtpPassword);
    const emailSenderName = typeof body?.emailSenderName === 'string' ? body.emailSenderName.trim() : '';
    const rawSenderEmail = typeof body?.emailSenderAddress === 'string' ? body.emailSenderAddress.trim() : '';
    const emailSignatureHtml = typeof body?.emailSignatureHtml === 'string' ? body.emailSignatureHtml : '';
    const rawSmtpHost = typeof body?.smtpHost === 'string' ? body.smtpHost.trim() : '';
    const smtpPortRaw = Number(body?.smtpPort);
    const smtpPort = Number.isFinite(smtpPortRaw) && smtpPortRaw > 0 ? Math.floor(smtpPortRaw) : 587;
    const smtpSecure = typeof body?.smtpSecure === 'boolean' ? body.smtpSecure : true;
    const smtpAllowSelfSigned = typeof body?.smtpAllowSelfSigned === 'boolean' ? body.smtpAllowSelfSigned : true;
    const rawSmtpUser = typeof body?.smtpUser === 'string' ? body.smtpUser.trim() : '';
    const smtpPass = typeof body?.smtpPass === 'string' ? body.smtpPass.trim() : '';

    const db = await getDb();
    const userObjectId = await resolveSessionUserObjectId(db, session);

    if (!userObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const existing = await db
      .collection('users')
      .findOne({ _id: userObjectId }, { projection: { smtpPass: 1 } });

    const sessionEmail = session.user?.email?.trim() || '';
    const emailSenderAddress = rawSenderEmail || rawSmtpUser || sessionEmail;
    const smtpUser = rawSmtpUser || rawSenderEmail || sessionEmail;
    const smtpHost = rawSmtpHost || 'mail.octopi-digital.com';

    if (removeSmtpPassword) {
      await db.collection('users').updateOne(
        { _id: userObjectId },
        {
          $set: {
            emailSenderEnabled: false,
            updatedAt: new Date(),
          },
          $unset: {
            smtpPass: '',
          },
        }
      );

      return NextResponse.json({
        emailSenderEnabled: false,
        hasSmtpPassword: false,
        maskedSmtpPassword: null,
        configured: false,
      });
    }

    const finalSmtpPass = smtpPass || existing?.smtpPass || '';

    const configured = Boolean(emailSenderAddress && smtpHost && smtpUser && finalSmtpPass);
    if (emailSenderEnabled && !configured) {
      return NextResponse.json(
        { error: 'Complete sender email + SMTP settings before enabling email sender' },
        { status: 400 }
      );
    }

    await db.collection('users').updateOne(
      { _id: userObjectId },
      {
        $set: {
          emailSenderEnabled,
          emailSenderName,
          emailSenderAddress,
          emailSignatureHtml,
          smtpHost,
          smtpPort,
          smtpSecure,
          smtpAllowSelfSigned,
          smtpUser,
          ...(finalSmtpPass ? { smtpPass: finalSmtpPass } : {}),
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({
      emailSenderEnabled,
      emailSenderName,
      emailSenderAddress,
      emailSignatureHtml,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpAllowSelfSigned,
      smtpUser,
      hasSmtpPassword: Boolean(finalSmtpPass),
      maskedSmtpPassword: finalSmtpPass ? maskSecret(finalSmtpPass) : null,
      configured,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to save email settings' }, { status: 500 });
  }
}
