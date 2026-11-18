import { NextResponse } from 'next/server';
import {
  loginToMoodle,
  fetchEnrolledCourses,
  scanPastQuestionsRepository,
  encodeSessionToken,
} from '@/lib/moodle';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json();
    const username = (body.username || '').trim();
    const password = body.password || '';

    if (!username || !password) {
      return NextResponse.json(
        { success: false, message: 'Please enter your Student ID and Password.' },
        { status: 400 }
      );
    }

    const loginRes = await loginToMoodle(username, password);
    if (!loginRes.success) {
      return NextResponse.json({ success: false, message: loginRes.message });
    }

    const { cookieJar, sesskey } = loginRes;

    const enrolledCourses = await fetchEnrolledCourses(cookieJar, sesskey);
    let discoveredTitles = {};
    try {
      const pqScan = await scanPastQuestionsRepository(cookieJar);
      discoveredTitles = pqScan.discoveredTitles || {};
    } catch {
      // Ignore repository title scan failure during login
    }

    return NextResponse.json({
      success: true,
      message: loginRes.message,
      sessionToken: encodeSessionToken(cookieJar, sesskey),
      enrolledCourses,
      discoveredTitles,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: `Connection error: ${err.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}
