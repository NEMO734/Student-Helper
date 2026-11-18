import { NextResponse } from 'next/server';
import {
  decodeSessionToken,
  scanPastQuestionsRepository,
  parseYearInput,
  buildPastQuestionTasks,
} from '@/lib/moodle';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      sessionToken,
      selectedCodes = [],
      knownTitles = {},
      masterFolderName = 'Past_Questions',
      yearRangeString = 'all',
      semChoice = 0,
      groupYearsInSubfolders = true,
    } = body;

    if (!sessionToken) {
      return NextResponse.json(
        { success: false, message: 'Not logged in. Please log in first.' },
        { status: 401 }
      );
    }

    const { cookies } = decodeSessionToken(sessionToken);
    const { entries, discoveredTitles } = await scanPastQuestionsRepository(cookies);

    const mergedTitles = { ...discoveredTitles, ...knownTitles };
    const targetYears = parseYearInput(yearRangeString);

    const tasks = buildPastQuestionTasks({
      allEntries: entries,
      selectedCodes,
      knownTitles: mergedTitles,
      masterFolderName,
      targetYears,
      semChoice: Number(semChoice) || 0,
      groupYearsInSubfolders,
    });

    return NextResponse.json({
      success: true,
      tasks,
      discoveredTitles: mergedTitles,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: `Failed to scan Past Questions: ${err.message}` },
      { status: 500 }
    );
  }
}
