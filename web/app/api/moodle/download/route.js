import { NextResponse } from 'next/server';
import {
  BASE_SITE_URL,
  decodeSessionToken,
  fetchWithCookies,
} from '@/lib/moodle';

export const dynamic = 'force-dynamic';

function extractExtensionFromName(name) {
  if (!name) return '';
  const cleaned = name.replace(/^["']+|["']+$/g, '').trim();
  const lastDot = cleaned.lastIndexOf('.');
  if (lastDot > 0 && lastDot < cleaned.length - 1) {
    return cleaned.substring(lastDot);
  }
  return '';
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { sessionToken, url, hasKnownExtension } = body;

    if (!sessionToken || !url) {
      return NextResponse.json(
        { error: 'Missing sessionToken or target URL.' },
        { status: 400 }
      );
    }

    // Security check: only proxy requests to UPSA Virtual
    const parsedTarget = new URL(url, BASE_SITE_URL);
    if (parsedTarget.origin !== BASE_SITE_URL) {
      return NextResponse.json(
        { error: 'Only join.upsavirtual.site URLs are permitted.' },
        { status: 403 }
      );
    }

    const { cookies } = decodeSessionToken(sessionToken);
    const { response, finalUrl } = await fetchWithCookies(
      parsedTarget.toString(),
      { method: 'GET' },
      cookies
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: `HTTP ${response.status} from UPSA Virtual` },
        { status: response.status }
      );
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
      return NextResponse.json(
        { error: 'Skipped HTML response (not a downloadable document).' },
        { status: 422 }
      );
    }

    let resolvedExt = '.pdf';
    if (!hasKnownExtension) {
      const cd = response.headers.get('content-disposition') || '';
      const starMatch = cd.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
      const stdMatch = cd.match(/filename\s*=\s*([^;]+)/i);
      const cdFileName = starMatch
        ? decodeURIComponent(starMatch[1].trim())
        : stdMatch
        ? stdMatch[1].trim()
        : '';

      if (cdFileName) {
        const candidateExt = extractExtensionFromName(cdFileName);
        if (candidateExt) resolvedExt = candidateExt;
      } else if (finalUrl) {
        try {
          const finalPath = decodeURIComponent(new URL(finalUrl).pathname);
          const uriExt = extractExtensionFromName(finalPath.split('/').pop() || '');
          if (uriExt && uriExt.toLowerCase() !== '.php') {
            resolvedExt = uriExt;
          }
        } catch {
          // Keep .pdf fallback
        }
      }
    }

    const arrayBuffer = await response.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'X-Resolved-Extension': resolvedExt,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Download failed' },
      { status: 500 }
    );
  }
}
