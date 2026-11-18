import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const candidates = [
    path.join(process.cwd(), 'public', 'secret.mp3'),
    path.join(process.cwd(), '..', 'secret.mp3'),
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': String(buffer.length),
          'Accept-Ranges': 'bytes',
        },
      });
    }
  }

  return NextResponse.json(
    { error: 'secret.mp3 not found in public/ or root folder.' },
    { status: 404 }
  );
}
