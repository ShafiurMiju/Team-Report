import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import nodemailer from 'nodemailer';
import { authOptions } from '@/lib/auth';
import { getDb, toObjectId } from '@/lib/mongodb';

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

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const to = typeof body?.to === 'string' ? body.to.trim() : '';
    const cc = typeof body?.cc === 'string' ? body.cc.trim() : '';
    const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
    const message = typeof body?.body === 'string' ? body.body.trim() : '';
    const isHtml = Boolean(body?.isHtml);

    if (!to) {
      return NextResponse.json({ error: 'Recipient email is required' }, { status: 400 });
    }

    if (!subject || !message) {
      return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 });
    }

    const db = await getDb();
    const userObjectId = await resolveSessionUserObjectId(db, session);

    if (!userObjectId) {
      return NextResponse.json({ error: 'Invalid user in session' }, { status: 400 });
    }

    const sender = await db.collection('users').findOne(
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

    if (!sender?.emailSenderEnabled) {
      return NextResponse.json({ error: 'Email sender is disabled in settings' }, { status: 400 });
    }

    if (!sender.emailSenderAddress || !sender.smtpHost || !sender.smtpUser || !sender.smtpPass) {
      return NextResponse.json({ error: 'Email sender config is incomplete in settings' }, { status: 400 });
    }

    const smtpPort = Number(sender.smtpPort) || 587;
    const useImplicitTls = smtpPort === 465;

    const transporter = nodemailer.createTransport({
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
      await transporter.verify();
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

    const from = sender.emailSenderName
      ? `${sender.emailSenderName} <${sender.emailSenderAddress}>`
      : sender.emailSenderAddress;

    const html = isHtml
      ? message
      : message
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br/>');

    const signatureHtmlRaw = typeof sender.emailSignatureHtml === 'string' ? sender.emailSignatureHtml.trim() : '';
    const baseOrigin = new URL(request.url).origin;
    const signatureHtml = normalizeSignatureHtml(signatureHtmlRaw, baseOrigin);
    const textSignature = signatureHtml
      ? `\n\n${signatureHtml.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').trim()}`
      : '';
    const plainTextFromMessage = isHtml
      ? message
          .replace(/<br\s*\/?\s*>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      : message;

    const hasClosingAlready = /kind regards,?|best regards,?/i.test(plainTextFromMessage);
    const finalText = hasClosingAlready ? plainTextFromMessage : `${plainTextFromMessage}${textSignature}`;
    const finalHtml = hasClosingAlready
      ? `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">${html}</div>`
      : `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">${html}${signatureHtml ? `<br/><br/>${signatureHtml}` : ''}</div>`;

    const info = await transporter.sendMail({
      from,
      to,
      cc: cc || undefined,
      subject,
      text: finalText,
      html: finalHtml,
      replyTo: sender.emailSenderAddress,
    });

    return NextResponse.json({ message: 'Email sent successfully', messageId: info.messageId });
  } catch (error) {
    const details = error instanceof Error ? error.message : undefined;
    return NextResponse.json({ error: 'Failed to send email', details }, { status: 500 });
  }
}
