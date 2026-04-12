import { NextResponse } from 'next/server';
import http from 'http';
import https from 'https';

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}

async function fetchInsecureWithRedirects(imageUrl: URL, depth = 0): Promise<{ body: Buffer; contentType: string }> {
  if (depth > 5) {
    throw new Error('Too many redirects');
  }

  const transport = imageUrl.protocol === 'http:' ? http : https;

  return new Promise((resolve, reject) => {
    const req = transport.get(
      imageUrl,
      {
        headers: {
          Accept: 'image/*,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0',
          Referer: `${imageUrl.protocol}//${imageUrl.host}/`,
          Origin: `${imageUrl.protocol}//${imageUrl.host}`,
        },
        ...(imageUrl.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;

        if (status >= 300 && status < 400 && location) {
          const nextUrl = new URL(location, imageUrl);
          if (!['http:', 'https:'].includes(nextUrl.protocol) || isPrivateHost(nextUrl.hostname)) {
            reject(new Error('Redirect blocked'));
            return;
          }

          fetchInsecureWithRedirects(nextUrl, depth + 1).then(resolve).catch(reject);
          return;
        }

        if (status < 200 || status >= 300) {
          reject(new Error(`Image fetch failed: ${status || 'unknown'}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            body: Buffer.concat(chunks),
            contentType: res.headers['content-type'] || 'image/png',
          });
        });
        res.on('error', reject);
      }
    );

    req.on('error', reject);
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const urlParam = searchParams.get('url') || '';

    if (!urlParam) {
      return new NextResponse('Missing url', { status: 400 });
    }

    const normalizedUrlParam = urlParam.startsWith('//') ? `https:${urlParam}` : urlParam;

    let imageUrl: URL;
    try {
      imageUrl = new URL(normalizedUrlParam);
    } catch {
      return new NextResponse('Invalid url', { status: 400 });
    }

    if (!['http:', 'https:'].includes(imageUrl.protocol)) {
      return new NextResponse('Unsupported protocol', { status: 400 });
    }

    if (isPrivateHost(imageUrl.hostname)) {
      return new NextResponse('Blocked host', { status: 400 });
    }

    let upstream: Response;
    try {
      upstream = await fetch(imageUrl.toString(), {
        method: 'GET',
        headers: {
          Accept: 'image/*,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0',
          Referer: `${imageUrl.protocol}//${imageUrl.host}/`,
          Origin: `${imageUrl.protocol}//${imageUrl.host}`,
        },
        cache: 'no-store',
        redirect: 'follow',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : '';
      if (!message.includes('self-signed') && !message.includes('certificate')) {
        throw err;
      }

      const insecure = await fetchInsecureWithRedirects(imageUrl);

      return new NextResponse(new Uint8Array(insecure.body), {
        status: 200,
        headers: {
          'Content-Type': insecure.contentType,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    if (!upstream.ok) {
      return new NextResponse('Image fetch failed', { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || 'image/png';
    const body = await upstream.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new NextResponse('Failed to proxy image', { status: 500 });
  }
}
