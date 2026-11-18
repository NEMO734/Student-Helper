// Port of Models.cs, DownloadEngine.cs, and MoodleService.cs for Next.js / Vercel Serverless

export const BASE_SITE_URL = 'https://join.upsavirtual.site';
export const LOGIN_URL = `${BASE_SITE_URL}/login/index.php`;
export const MY_COURSES_URL = `${BASE_SITE_URL}/my/courses.php`;
export const PAST_QUESTIONS_URL = `${BASE_SITE_URL}/mod/folder/view.php?id=1669`;
export const COURSE_VIEW_BASE_URL = `${BASE_SITE_URL}/course/view.php?id=`;

const GLOBAL_IGNORE_IDS = new Set(['12398', '11077']);
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const STRICT_COURSE_CODE_REGEX = /\b([A-Z]{4})\s*[-_]?\s*(\d{3})\b/i;

export function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function sanitizeFolderName(name) {
  if (!name || !name.trim()) return '';
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractCourseCode(text) {
  if (!text || !text.trim()) return null;
  const m = text.match(STRICT_COURSE_CODE_REGEX);
  return m ? `${m[1].toUpperCase()}${m[2]}` : null;
}

export function extractCourseTitle(rawText, code) {
  if (!rawText || !rawText.trim()) return '';
  // Strip extension if present
  let cleaned = rawText.replace(/\.[^/.]+$/, '');

  const m = cleaned.match(STRICT_COURSE_CODE_REGEX);
  if (m && m.index !== undefined) {
    cleaned = cleaned.substring(m.index + m[0].length);
  } else if (code) {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(escaped, 'gi'), '');
  }

  cleaned = cleaned.replace(/(_WKD|\bWKD\b|\(\d+\)|_MAIN|\bMAIN\b|\bRESIT\b)/gi, '');
  cleaned = cleaned
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-_.:;]+|[\s\-_.:;]+$/g, '');

  return sanitizeFolderName(cleaned);
}

export function formatCourseFolderName(code, title) {
  const cleanCode = (code || 'UNKNOWN').trim().toUpperCase();
  const cleanTitle = sanitizeFolderName(title || '');
  return cleanTitle ? `${cleanCode} - ${cleanTitle}` : cleanCode;
}

export function applyTracking(text, spacingLevel) {
  if (!text || spacingLevel <= 0) return text || '';
  const padMap = {
    1: '\u200A',
    2: '\u2009',
    3: '\u2006',
    4: '\u2005',
  };
  const pad = padMap[spacingLevel] || ' ';
  return Array.from(text).join(pad);
}

export function parseYearInput(input) {
  const cleaned = (input || 'all').trim().toLowerCase();
  if (!cleaned || cleaned === 'all') return null;

  const years = new Set();
  for (const token of cleaned.split(/[,\s]+/)) {
    const rm = token.match(/^(20\d{2})-(20\d{2})$/);
    if (rm) {
      const start = parseInt(rm[1], 10);
      const end = parseInt(rm[2], 10);
      for (let y = start; y <= end; y++) years.add(String(y));
    } else if (/^20\d{2}$/.test(token)) {
      years.add(token);
    }
  }
  return years;
}

export function buildPastQuestionTasks({
  allEntries,
  selectedCodes,
  knownTitles,
  masterFolderName = 'Past_Questions',
  targetYears,
  semChoice = 0,
  groupYearsInSubfolders = true,
}) {
  const selectedSet = new Set(
    Array.from(selectedCodes || []).map((c) => c.toUpperCase())
  );
  const titleMap = {};
  if (knownTitles) {
    for (const [k, v] of Object.entries(knownTitles)) {
      titleMap[k.toUpperCase()] = v;
    }
  }

  const tasks = [];

  for (const entry of allEntries) {
    const codeUpper = (entry.courseCode || '').toUpperCase();
    if (!selectedSet.has(codeUpper)) continue;

    if (
      targetYears &&
      entry.yearFolder &&
      entry.yearFolder.length >= 4 &&
      !targetYears.has(entry.yearFolder.substring(0, 4))
    ) {
      continue;
    }

    if (entry.semesterFolder) {
      const semLower = entry.semesterFolder.toLowerCase();
      if (semChoice === 1 && semLower.includes('second')) continue;
      if (semChoice === 2 && semLower.includes('first')) continue;
    }

    const savedTitle = titleMap[codeUpper];
    const courseTitle =
      savedTitle && savedTitle.trim() ? savedTitle : entry.inferredTitle || '';

    const courseFolderName = formatCourseFolderName(entry.courseCode, courseTitle);
    const courseRootParts = [
      sanitizeFolderName(masterFolderName || 'Past_Questions') || 'Past_Questions',
      courseFolderName,
    ];

    let relativePath;
    if (groupYearsInSubfolders) {
      const parts = [...courseRootParts, sanitizeFolderName(entry.yearFolder || 'Unknown_Year')];
      if (entry.semesterFolder) {
        parts.push(sanitizeFolderName(entry.semesterFolder));
      }
      parts.push(sanitizeFolderName(entry.fileName));
      relativePath = parts.join('/');
    } else {
      const semTag = entry.semesterFolder ? ` ${entry.semesterFolder}` : '';
      const prefixedFileName = sanitizeFolderName(
        `[${entry.yearFolder}${semTag}] ${entry.fileName}`
      );
      relativePath = [...courseRootParts, prefixedFileName].join('/');
    }

    tasks.push({
      url: entry.url,
      relativePath,
      displayName: `[${courseFolderName}] (${entry.yearFolder}) ${entry.fileName}`,
      hasKnownExtension: true,
    });
  }

  return tasks;
}

// ============================================================================
// COOKIE JAR & REDIRECT-AWARE FETCH FOR MOODLE SESSION MANAGEMENT
// ============================================================================

export function parseSetCookieHeaders(headers, cookieJar = {}) {
  let rawCookies = [];
  if (typeof headers.getSetCookie === 'function') {
    rawCookies = headers.getSetCookie();
  } else {
    const single = headers.get('set-cookie');
    if (single) rawCookies = single.split(/,(?=\s*[A-Za-z0-9_\-]+=)/);
  }

  for (const cookieStr of rawCookies) {
    const firstPart = cookieStr.split(';')[0];
    if (!firstPart) continue;
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const name = firstPart.substring(0, eqIdx).trim();
      const val = firstPart.substring(eqIdx + 1).trim();
      if (val === 'deleted' || val === '') {
        delete cookieJar[name];
      } else {
        cookieJar[name] = val;
      }
    }
  }
  return cookieJar;
}

export function serializeCookieJar(cookieJar) {
  return Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export function encodeSessionToken(cookieJar, sesskey = '') {
  return Buffer.from(JSON.stringify({ cookies: cookieJar, sesskey }), 'utf-8').toString('base64');
}

export function decodeSessionToken(token) {
  if (!token) return { cookies: {}, sesskey: '' };
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
    return {
      cookies: parsed.cookies || {},
      sesskey: parsed.sesskey || '',
    };
  } catch {
    return { cookies: {}, sesskey: '' };
  }
}

export async function fetchWithCookies(url, options = {}, cookieJar = {}, maxRedirects = 8) {
  let currentUrl = url;
  let currentMethod = options.method || 'GET';
  let currentBody = options.body || undefined;
  let currentHeaders = {
    'User-Agent': USER_AGENT,
    ...(options.headers || {}),
  };

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const cookieHeader = serializeCookieJar(cookieJar);
    const reqHeaders = { ...currentHeaders };
    if (cookieHeader) {
      reqHeaders['Cookie'] = cookieHeader;
    }

    const response = await fetch(currentUrl, {
      method: currentMethod,
      headers: reqHeaders,
      body: currentBody,
      redirect: 'manual',
    });

    parseSetCookieHeaders(response.headers, cookieJar);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return { response, finalUrl: currentUrl };

      currentUrl = new URL(location, currentUrl).toString();
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')) {
        currentMethod = 'GET';
        currentBody = undefined;
        delete currentHeaders['Content-Type'];
      }
      continue;
    }

    return { response, finalUrl: currentUrl };
  }

  throw new Error('Too many redirects while communicating with UPSA Virtual.');
}

// ============================================================================
// MOODLE SCRAPING & API HELPERS (PORTED FROM MoodleService.cs)
// ============================================================================

export async function loginToMoodle(username, password) {
  const cookieJar = {};

  const { response: getResp } = await fetchWithCookies(LOGIN_URL, { method: 'GET' }, cookieJar);
  const loginPageHtml = await getResp.text();

  let tokenMatch = loginPageHtml.match(/name=["']logintoken["']\s+value=["']([^"']+)["']/i);
  if (!tokenMatch) {
    tokenMatch = loginPageHtml.match(/value=["']([^"']+)["']\s+name=["']logintoken["']/i);
  }

  if (!tokenMatch) {
    return { success: false, message: 'Could not find login token on UPSA Virtual.' };
  }

  const formParams = new URLSearchParams();
  formParams.set('username', username);
  formParams.set('password', password);
  formParams.set('logintoken', tokenMatch[1]);

  const { response: postResp } = await fetchWithCookies(
    LOGIN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formParams.toString(),
    },
    cookieJar
  );

  const postHtml = await postResp.text();

  if (postHtml.includes('Log in to the site') || postHtml.includes('Invalid login')) {
    return { success: false, message: 'Login failed. Check your username and password.' };
  }

  const sessMatch = postHtml.match(/"sesskey"\s*:\s*"([^"]+)"/);
  const sesskey = sessMatch ? sessMatch[1] : '';

  return {
    success: true,
    message: 'Login successful!',
    cookieJar,
    sesskey,
    sessionToken: encodeSessionToken(cookieJar, sesskey),
  };
}

export async function fetchCourseDetailsFromPage(courseId, cookieJar) {
  try {
    const { response } = await fetchWithCookies(`${COURSE_VIEW_BASE_URL}${courseId}`, { method: 'GET' }, cookieJar);
    const html = await response.text();
    let code = null;
    let title = '';

    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match) {
      const h1Text = decodeHtmlEntities(h1Match[1]).trim();
      code = extractCourseCode(h1Text);
      title = extractCourseTitle(h1Text, code);
    }

    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      const tText = decodeHtmlEntities(titleMatch[1]).trim();
      if (!code) code = extractCourseCode(tText);
      if (!title) title = extractCourseTitle(tText, code);
    }

    return { code, title };
  } catch {
    return { code: null, title: '' };
  }
}

export async function fetchEnrolledCourses(cookieJar, sesskey) {
  const results = new Map();

  if (sesskey) {
    const ajaxUrl = `${BASE_SITE_URL}/lib/ajax/service.php?sesskey=${encodeURIComponent(
      sesskey
    )}&info=core_course_get_enrolled_courses_by_timeline_classification`;
    const payload = JSON.stringify([
      {
        index: 0,
        methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
        args: {
          offset: 0,
          limit: 0,
          classification: 'all',
          sort: 'fullname',
          customfieldname: '',
          customfieldvalue: '',
        },
      },
    ]);

    try {
      const { response } = await fetchWithCookies(
        ajaxUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        },
        cookieJar
      );
      const data = await response.json();
      const root = Array.isArray(data) ? data[0] : null;
      if (root && !root.error && root.data && Array.isArray(root.data.courses)) {
        for (const c of root.data.courses) {
          const cid = String(c.id || '');
          const shortname = c.shortname || '';
          const fullname = c.fullname || '';
          const code =
            extractCourseCode(`${shortname} ${fullname}`) || shortname.trim().toUpperCase();
          const title = extractCourseTitle(fullname, code);

          if (cid && cid !== '1' && code) {
            results.set(code.toUpperCase(), { code: code.toUpperCase(), title, moodleId: cid });
          }
        }
      }
    } catch {
      // Fallback to HTML scraping below
    }
  }

  if (results.size === 0) {
    try {
      const { response } = await fetchWithCookies(MY_COURSES_URL, { method: 'GET' }, cookieJar);
      const html = await response.text();
      const regex = /href=["'][^"']*course\/view\.php\?id=(\d+)["'][^>]*>([^<]+)</gi;
      let m;
      while ((m = regex.exec(html)) !== null) {
        const cid = m[1];
        const rawText = decodeHtmlEntities(m[2]).trim();
        if (cid !== '1' && rawText) {
          let code = extractCourseCode(rawText);
          let title = extractCourseTitle(rawText, code);
          if (!code) {
            const pageInfo = await fetchCourseDetailsFromPage(cid, cookieJar);
            code = pageInfo.code;
            if (!title) title = pageInfo.title;
          }
          if (code) {
            results.set(code.toUpperCase(), { code: code.toUpperCase(), title, moodleId: cid });
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  return Array.from(results.values()).sort((a, b) => a.code.localeCompare(b.code));
}

export async function scanPastQuestionsRepository(cookieJar) {
  const { response } = await fetchWithCookies(PAST_QUESTIONS_URL, { method: 'GET' }, cookieJar);
  const html = await response.text();

  const regex = /href=["']([^"']*pluginfile\.php[^"']*\.pdf[^"']*)["']/gi;
  const entries = [];
  const discoveredTitles = {};

  let m;
  while ((m = regex.exec(html)) !== null) {
    const href = decodeHtmlEntities(m[1]);
    let decodedUrl = href;
    try {
      decodedUrl = decodeURIComponent(href);
    } catch {
      // Keep raw href if malformed URI encoding
    }

    const withoutQuery = decodedUrl.split('?')[0];
    const parts = withoutQuery.split('/');
    const filename = parts[parts.length - 1] || '';

    const code = extractCourseCode(filename);
    if (!code) continue;

    const inferredTitle = extractCourseTitle(filename, code);
    if (inferredTitle) {
      const existing = discoveredTitles[code];
      if (!existing || inferredTitle.length > existing.length) {
        discoveredTitles[code] = inferredTitle;
      }
    }

    let masterFolder = 'Uncategorized';
    let yearFolder = 'Unknown_Year';
    let semesterFolder = '';

    for (const part of parts) {
      if (/level/i.test(part)) {
        masterFolder = part;
      } else if (/^(20\d{2}[- ]20\d{2})$/.test(part)) {
        yearFolder = part;
      } else if (/semester/i.test(part)) {
        semesterFolder = part;
      }
    }

    entries.push({
      url: href.includes('forcedownload=1') ? href : `${href}?forcedownload=1`,
      fileName: filename,
      courseCode: code,
      inferredTitle,
      masterFolder,
      yearFolder,
      semesterFolder,
    });
  }

  return { entries, discoveredTitles };
}

export async function scanCourseNotes(courseFolderLabel, courseId, masterFolderName, cookieJar) {
  const tasks = [];
  const seenUrls = new Set();

  const { response } = await fetchWithCookies(`${COURSE_VIEW_BASE_URL}${courseId}`, { method: 'GET' }, cookieJar);
  const html = await response.text();

  const sectionHeaders = [];
  const secRegex = /<(?:h2|h3|h4)[^>]*>\s*(?:<[^>]+>\s*)*([^<]+?)\s*(?:<\/[^>]+>\s*)*<\/(?:h2|h3|h4)>/gi;
  let sm;
  while ((sm = secRegex.exec(html)) !== null) {
    const sName = decodeHtmlEntities(sm[1]).trim();
    if (/(week\s*\d+|general|topic\s*\d+|module\s*\d+|section\s*\d+)/i.test(sName)) {
      sectionHeaders.push({
        index: sm.index,
        name: sanitizeFolderName(sName) || 'General',
      });
    }
  }

  const resRegex = /<a[^>]+href=["']([^"']*mod\/resource\/view\.php\?id=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let rm;
  while ((rm = resRegex.exec(html)) !== null) {
    const resUrl = decodeHtmlEntities(rm[1]);
    const resId = rm[2];
    const innerHtml = rm[3];

    if (GLOBAL_IGNORE_IDS.has(resId) || seenUrls.has(resUrl)) continue;
    seenUrls.add(resUrl);

    let cleanText = innerHtml.replace(
      /<span[^>]*class=["'][^"']*accesshide[^"']*["'][^>]*>[\s\S]*?<\/span>/gi,
      ''
    );
    cleanText = cleanText.replace(/<[^>]+>/g, ' ');
    cleanText = decodeHtmlEntities(cleanText).trim();
    cleanText = cleanText.replace(/\s+(File|Folder|Document)$/i, '').trim();
    const safeTitle = sanitizeFolderName(cleanText || `Document_${resId}`);

    let sectionName = 'General';
    for (const sec of sectionHeaders) {
      if (sec.index < rm.index) sectionName = sec.name;
      else break;
    }

    const baseParts = [
      sanitizeFolderName(masterFolderName || 'Course_Notes') || 'Course_Notes',
      sanitizeFolderName(courseFolderLabel),
      sectionName,
    ];

    let relativePath = [...baseParts, safeTitle].join('/');
    if (tasks.some((t) => t.relativePath.toLowerCase() === relativePath.toLowerCase())) {
      relativePath = [...baseParts, `${safeTitle}_${resId}`].join('/');
    }

    tasks.push({
      url: `${resUrl}&redirect=1`,
      relativePath,
      displayName: `[${courseFolderLabel} | ${sectionName}] ${safeTitle}`,
      hasKnownExtension: false,
    });
  }

  return tasks;
}
