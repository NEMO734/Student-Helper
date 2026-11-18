import { NextResponse } from 'next/server';
import {
  decodeSessionToken,
  scanCourseNotes,
  formatCourseFolderName,
} from '@/lib/moodle';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      sessionToken,
      courses = [],
      knownTitles = {},
      masterFolderName = 'Course_Notes',
    } = body;

    if (!sessionToken) {
      return NextResponse.json(
        { success: false, message: 'Not logged in. Please log in first.' },
        { status: 401 }
      );
    }

    const { cookies } = decodeSessionToken(sessionToken);
    const allTasks = [];
    const logs = [];

    for (const item of courses) {
      if (!item.moodleId) continue;
      const title = knownTitles[item.code] || item.title || '';
      const folderLabel = formatCourseFolderName(item.code, title);
      try {
        const tasks = await scanCourseNotes(
          folderLabel,
          item.moodleId,
          masterFolderName,
          cookies
        );
        allTasks.push(...tasks);
      } catch (err) {
        logs.push(`Failed to scan ${folderLabel}: ${err.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      tasks: allTasks,
      logs,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: `Failed to scan Course Notes: ${err.message}` },
      { status: 500 }
    );
  }
}
