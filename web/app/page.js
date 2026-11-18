'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import JSZip from 'jszip';

const GITHUB_REPO_URL = 'https://github.com/NEMO734/Student-Helper';
const GITHUB_API_LATEST = 'https://api.github.com/repos/NEMO734/Student-Helper/releases/latest';
const CONFIG_STORAGE_KEY = 'TeamAtor_StudentHelper_Config_v153';

const ACCENT_SWATCHES = [
  { name: 'Blue', hex: '#2E8BFF' },
  { name: 'Emerald', hex: '#1FD17B' },
  { name: 'Amber', hex: '#F5C426' },
  { name: 'Orange', hex: '#FF7A1A' },
  { name: 'Crimson', hex: '#F03A47' },
  { name: 'Magenta', hex: '#D63AF9' },
  { name: 'Violet', hex: '#7C4DFF' },
  { name: 'Cyan', hex: '#18E0F5' },
  { name: 'Coral', hex: '#F26B5B' },
];

const PRIORITY_FONTS = [
  'Cascadia Code',
  'Segoe UI Variable Display',
  'Inter',
  'Bahnschrift',
  'Consolas',
  'Arial',
  'Segoe UI',
  'Courier New',
  'Georgia',
  'Trebuchet MS',
  'Verdana',
];

const YEARS_LIST = ['All Years'];
for (let y = 2015; y <= 2026; y++) YEARS_LIST.push(String(y));

const DEFAULT_SETTINGS = {
  downloadPath: 'Downloads/UPSA_Downloads',
  lastUsername: '',
  lastPassword: '',
  masterFolderName: 'Past_Questions',
  groupYearsInSubfolders: true,
  hasAcceptedTerms: false,
  isMusicUnlocked: false,
  accentName: 'Cyan',
  customAccentHex: '#18E0F5',
  fontName: 'Cascadia Code',
  fontSize: 13.5,
  lineSpacing: 6.0,
  characterSpacing: 0,
  isBold: false,
  isItalic: false,
};

function applyTracking(text, spacingLevel) {
  const level = Math.max(0, Math.min(5, Math.round(Number(spacingLevel) || 0)));
  if (!text || level <= 0) return text || '';
  const padMap = {
    1: '\u200A',
    2: '\u2009',
    3: '\u2006',
    4: '\u2005',
  };
  const pad = padMap[level] || ' ';
  return Array.from(text).join(pad);
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60.0) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function hexToRgb(hex) {
  const clean = (hex || '#18E0F5').replace('#', '').trim();
  if (clean.length !== 6) return { r: 24, g: 224, b: 245 };
  const num = parseInt(clean, 16);
  if (Number.isNaN(num)) return { r: 24, g: 224, b: 245 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function formatTime(sec) {
  if (!sec || !Number.isFinite(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function StudentHelperWebPage() {
  // Configuration State
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);

  // UI Layout State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isTopBarOpen, setIsTopBarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('pq'); // 'pq' | 'notes' | 'themes' | 'music' | 'about'
  const [termsChecked, setTermsChecked] = useState(false);

  // Toast State
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef(null);

  // Auth & Courses State
  const [sessionToken, setSessionToken] = useState('');
  const [authStatus, setAuthStatus] = useState({ text: '● Offline', color: '#EB8791' });
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [sessionCourseTitles, setSessionCourseTitles] = useState({});
  const [pastQuestionItems, setPastQuestionItems] = useState([]);
  const [courseNoteItems, setCourseNoteItems] = useState([]);
  const [manualCourseInput, setManualCourseInput] = useState('');

  // Past Questions Filters
  const [yearFromIdx, setYearFromIdx] = useState(0);
  const [yearToIdx, setYearToIdx] = useState(0);
  const [semesterIdx, setSemesterIdx] = useState(0);

  // Local Folder Handle (File System Access API)
  const [dirHandle, setDirHandle] = useState(null);
  const [saveMode, setSaveMode] = useState('zip'); // 'folder' | 'zip'

  // Batch Progress & Console Log
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 100 });
  const [progressStatus, setProgressStatus] = useState('Ready.');
  const [logs, setLogs] = useState([]);
  const logBoxRef = useRef(null);

  // Color Wheel State
  const wheelCanvasRef = useRef(null);
  const [wheelThumbPos, setWheelThumbPos] = useState({ x: 37, y: 37 });
  const isDraggingWheelRef = useRef(false);

  // Custom Fonts State
  const [availableFonts, setAvailableFonts] = useState(PRIORITY_FONTS);
  const fontInputRef = useRef(null);

  // Music Player & Cheat Code ("ATOR") State
  const cheatBufferRef = useRef('');
  const audioRef = useRef(null);
  const musicInputRef = useRef(null);
  const [playlist, setPlaylist] = useState([
    {
      title: '🔥 Team Ator Anthem (secret.mp3)',
      url: '/api/secret-mp3',
      isBuiltIn: true,
    },
  ]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [isMusicLoop, setIsMusicLoop] = useState(true);
  const [musicVolume, setMusicVolume] = useState(0.75);
  const [musicTime, setMusicTime] = useState({ current: 0, duration: 0 });
  const [isDraggingSeek, setIsDraggingSeek] = useState(false);

  // About / GitHub Release Check State
  const [updateStatus, setUpdateStatus] = useState('Web Cloud Edition v1.5.3 ✓');
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  // Helper: Append timestamped log
  const appendLog = useCallback((message) => {
    const now = new Date();
    const ts = now.toTimeString().split(' ')[0];
    setLogs((prev) => [...prev, `[${ts}] ${message}`]);
  }, []);

  // Auto-scroll console log
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  // Show Toast
  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
    }, 1900);
  }, []);

  // Load saved config from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.settings) {
          setSettings((prev) => ({ ...prev, ...parsed.settings }));
        }
      }
    } catch {
      // Ignore corrupt localStorage
    }
    setIsConfigLoaded(true);
    appendLog("Ready. Click 'Log In & Sync' to load your current courses.");
  }, [appendLog]);

  // Save config to localStorage whenever settings change
  useEffect(() => {
    if (!isConfigLoaded) return;
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ settings }));
    } catch {
      // Ignore storage quota errors
    }
  }, [settings, isConfigLoaded]);

  // Apply Dynamic Theme & Typography CSS Variables (ported from ApplyThemeSettings in MainWindow.xaml.cs)
  useEffect(() => {
    let hex = settings.customAccentHex || '#18E0F5';
    if ((settings.accentName || '').toLowerCase() !== 'custom') {
      const match = ACCENT_SWATCHES.find(
        (s) => s.name.toLowerCase() === (settings.accentName || '').toLowerCase()
      );
      hex = match ? match.hex : '#18E0F5';
    }
    const tc = hexToRgb(hex);

    const outerR = Math.round(tc.r * 0.42 + 10);
    const outerG = Math.round(tc.g * 0.42 + 12);
    const outerB = Math.round(tc.b * 0.42 + 18);

    const sideR = Math.round(tc.r * 0.28 + 14);
    const sideG = Math.round(tc.g * 0.28 + 16);
    const sideB = Math.round(tc.b * 0.28 + 24);

    const surfR = Math.round(tc.r * 0.34 + 18);
    const surfG = Math.round(tc.g * 0.34 + 20);
    const surfB = Math.round(tc.b * 0.34 + 28);

    const borderR = Math.round((tc.r + 220) / 2);
    const borderG = Math.round((tc.g + 220) / 2);
    const borderB = Math.round((tc.b + 220) / 2);

    const root = document.documentElement;
    root.style.setProperty('--theme-accent', hex.toUpperCase());
    root.style.setProperty('--theme-accent-glow', `rgba(${tc.r}, ${tc.g}, ${tc.b}, 0.29)`);
    root.style.setProperty('--button-glass', `rgba(${tc.r}, ${tc.g}, ${tc.b}, 0.16)`);
    root.style.setProperty('--outer-shell', `rgba(${outerR}, ${outerG}, ${outerB}, 0.84)`);
    root.style.setProperty('--sidebar-glass', `rgba(${sideR}, ${sideG}, ${sideB}, 0.76)`);
    root.style.setProperty('--surface-card', `rgba(${surfR}, ${surfG}, ${surfB}, 0.76)`);
    root.style.setProperty('--subtle-border', `rgba(${borderR}, ${borderG}, ${borderB}, 0.35)`);

    const fontName = (settings.fontName || 'Cascadia Code').replace(/^\[Custom\]\s*/, '');
    root.style.setProperty(
      '--app-font-family',
      `"${fontName}", "Cascadia Code", "Segoe UI Variable Display", "Inter", "Segoe UI", sans-serif`
    );

    const fSize = Math.max(10, Math.min(18, Number(settings.fontSize) || 13.5));
    root.style.setProperty('--app-font-size', `${fSize}px`);
    root.style.setProperty('--app-font-weight', settings.isBold ? '700' : '400');
    root.style.setProperty('--app-font-style', settings.isItalic ? 'italic' : 'normal');

    const leading = Math.max(2, Math.min(18, Number(settings.lineSpacing) || 6));
    root.style.setProperty('--app-row-leading', `${leading}px`);
  }, [settings]);

  // Render HSV Color Wheel Bitmap on Canvas (ported from RenderColorWheelBitmap)
  useEffect(() => {
    const canvas = wheelCanvasRef.current;
    if (!canvas) return;
    const size = 148;
    const radius = size / 2.0;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - radius;
        const dy = y - radius;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (y * size + x) * 4;

        if (dist <= radius) {
          const sat = Math.max(0, Math.min(1, dist / radius));
          let angle = (Math.atan2(dy, dx) * 180.0) / Math.PI;
          if (angle < 0) angle += 360.0;

          const c = hsvToRgb(angle, sat, 1.0);
          const alpha =
            dist > radius - 1.5
              ? Math.max(0, Math.min(255, Math.round(((radius - dist) / 1.5) * 255)))
              : 255;

          data[idx] = c.r;
          data[idx + 1] = c.g;
          data[idx + 2] = c.b;
          data[idx + 3] = alpha;
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }, [activeTab]);

  // Pick color from Color Wheel coordinates
  const pickColorFromWheel = useCallback(
    (clientX, clientY) => {
      const canvas = wheelCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const displaySize = rect.width; // 74px
      const radius = displaySize / 2.0;

      let dx = clientX - rect.left - radius;
      let dy = clientY - rect.top - radius;
      let dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > radius) {
        dx = (dx / dist) * radius;
        dy = (dy / dist) * radius;
        dist = radius;
      }

      setWheelThumbPos({ x: radius + dx, y: radius + dy });

      const sat = Math.max(0, Math.min(1, dist / radius));
      let angle = (Math.atan2(dy, dx) * 180.0) / Math.PI;
      if (angle < 0) angle += 360.0;

      const picked = hsvToRgb(angle, sat, 1.0);
      const hex = `#${picked.r.toString(16).padStart(2, '0')}${picked.g
        .toString(16)
        .padStart(2, '0')}${picked.b.toString(16).padStart(2, '0')}`.toUpperCase();

      setSettings((prev) => ({
        ...prev,
        accentName: 'Custom',
        customAccentHex: hex,
      }));
      showToast('Theme updated');
    },
    [showToast]
  );

  // Global MouseMove/MouseUp for Color Wheel dragging
  useEffect(() => {
    const onMove = (e) => {
      if (isDraggingWheelRef.current) {
        pickColorFromWheel(e.clientX, e.clientY);
      }
    };
    const onUp = () => {
      isDraggingWheelRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [pickColorFromWheel]);

  // Play track helper
  const playTrackAtIndex = useCallback(
    (index, listOverride) => {
      const list = listOverride || playlist;
      if (index < 0 || index >= list.length) return;
      const track = list[index];
      setCurrentTrackIndex(index);

      if (audioRef.current) {
        audioRef.current.src = track.url;
        audioRef.current.volume = musicVolume;
        audioRef.current
          .play()
          .then(() => {
            setIsMusicPlaying(true);
          })
          .catch((err) => {
            appendLog(`Audio playback notice: ${err.message}`);
          });
      }
    },
    [playlist, musicVolume, appendLog]
  );

  // Global KeyDown Listener for "ATOR" Cheat Code (ported from Window_PreviewKeyDown)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = (e.target?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
        return;
      }

      if (e.key && e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
        cheatBufferRef.current = (cheatBufferRef.current + e.key.toUpperCase()).slice(-16);
        if (cheatBufferRef.current.endsWith('ATOR')) {
          cheatBufferRef.current = '';
          setSettings((prev) => ({ ...prev, isMusicUnlocked: true }));
          setActiveTab('music');
          showToast('🔥 Cheat [ATOR] Activated: Music Deck Unlocked!');
          appendLog('CHEAT CODE [ATOR] ACTIVATED! Secret Music Player unlocked.');
          playTrackAtIndex(0);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appendLog, showToast, playTrackAtIndex]);

  // Year Range dropdown logic (ported from YearRange_SelectionChanged)
  const handleYearFromChange = (newIdx) => {
    const idx = Number(newIdx);
    setYearFromIdx(idx);
    if (idx === 0) {
      setYearToIdx(0);
    } else if (yearToIdx < idx) {
      setYearToIdx(idx);
    }
  };

  const getSelectedYearRangeString = () => {
    if (yearFromIdx <= 0) return 'all';
    let fromYear = YEARS_LIST[yearFromIdx];
    let toYear = yearToIdx > 0 ? YEARS_LIST[yearToIdx] : fromYear;
    const f = parseInt(fromYear, 10);
    const t = parseInt(toYear, 10);
    if (!Number.isNaN(f) && !Number.isNaN(t) && t < f) {
      [fromYear, toYear] = [toYear, fromYear];
    }
    return fromYear === toYear ? fromYear : `${fromYear}-${toYear}`;
  };

  // Browse local directory (File System Access API)
  const handleBrowseFolder = async () => {
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        setDirHandle(handle);
        setSaveMode('folder');
        setSettings((prev) => ({ ...prev, downloadPath: `[Local Folder] ${handle.name}` }));
        appendLog(
          `Connected local folder '${handle.name}' for direct disk sync (skips existing files automatically).`
        );
        showToast(`Folder set: ${handle.name}`);
      } catch (err) {
        if (err.name !== 'AbortError') {
          appendLog(`Folder picker error: ${err.message}`);
        }
      }
    } else {
      setSaveMode('zip');
      appendLog(
        'Your browser does not support Direct Folder Sync (Chrome/Edge only). Using .ZIP Bundle download mode.'
      );
      showToast('Using .ZIP Archive Mode');
    }
  };

  // Import Custom .TTF / .OTF Font
  const handleImportFont = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const rawName = file.name.replace(/\.[^/.]+$/, '');
      const displayTag = `[Custom] ${rawName}`;
      const fontFace = new FontFace(rawName, buffer);
      await fontFace.load();
      document.fonts.add(fontFace);

      setAvailableFonts((prev) => (prev.includes(displayTag) ? prev : [displayTag, ...prev]));
      setSettings((prev) => ({ ...prev, fontName: displayTag }));
      showToast('Theme updated');
      appendLog(`Imported custom font: ${rawName}`);
    } catch (err) {
      appendLog(`Failed to load font file: ${err.message}`);
    }
  };

  // Add Audio Files to Music Deck
  const handleAddAudioTracks = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newTracks = files.map((file) => ({
      title: file.name.replace(/\.[^/.]+$/, ''),
      url: URL.createObjectURL(file),
      isBuiltIn: false,
    }));

    setPlaylist((prev) => {
      const updated = [...prev, ...newTracks];
      if (currentTrackIndex < 0 && updated.length > 0) {
        setTimeout(() => playTrackAtIndex(0, updated), 50);
      }
      return updated;
    });
  };

  // Log In & Sync Courses (ported from BtnLogin_Click)
  const handleLoginAndSync = async () => {
    const user = (settings.lastUsername || '').trim();
    const pass = settings.lastPassword || '';
    if (!user || !pass) {
      alert('Please enter your Student ID and Password.');
      return;
    }

    setIsLoggingIn(true);
    appendLog('Connecting to UPSA Virtual...');

    try {
      const res = await fetch('/api/moodle/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });
      const data = await res.json();
      appendLog(data.message || 'Response received.');

      if (!data.success) {
        setAuthStatus({ text: '● Login Failed', color: '#EB8791' });
        setIsLoggingIn(false);
        return;
      }

      setAuthStatus({ text: '● Connected', color: '#76E0A2' });
      setSessionToken(data.sessionToken);
      appendLog('Syncing your enrolled courses...');

      const titlesMap = { ...(data.discoveredTitles || {}) };
      const pqList = [];
      const notesList = [];

      for (const c of data.enrolledCourses || []) {
        const title = c.title || titlesMap[c.code] || '';
        titlesMap[c.code] = title;
        const cleanDisplay = title ? `${c.code} - ${title}` : c.code;

        pqList.push({
          code: c.code,
          rawText: cleanDisplay,
          isSelected: true,
        });

        if (c.moodleId) {
          notesList.push({
            code: c.code,
            moodleId: c.moodleId,
            title,
            rawText: cleanDisplay,
            isSelected: true,
          });
        }
      }

      setSessionCourseTitles(titlesMap);
      setPastQuestionItems(pqList);
      setCourseNoteItems(notesList);
      appendLog(`Synced ${pqList.length} enrolled courses for this session.`);
    } catch (err) {
      appendLog(`Connection error: ${err.message}`);
      setAuthStatus({ text: '● Login Failed', color: '#EB8791' });
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Manually add a course code to Past Questions list
  const handleAddManualCourse = (e) => {
    e.preventDefault();
    const raw = manualCourseInput.trim().toUpperCase();
    if (!raw) return;
    const match = raw.match(/\b([A-Z]{4})\s*[-_]?\s*(\d{3})\b/);
    const code = match ? `${match[1]}${match[2]}` : raw;
    if (pastQuestionItems.some((i) => i.code.toUpperCase() === code)) {
      setManualCourseInput('');
      return;
    }
    const knownTitle = sessionCourseTitles[code] || '';
    const cleanDisplay = knownTitle ? `${code} - ${knownTitle}` : code;
    setPastQuestionItems((prev) => [...prev, { code, rawText: cleanDisplay, isSelected: true }]);
    setManualCourseInput('');
    appendLog(`Added course ${code} to Past Questions selection.`);
  };

  // Selection Controls (Check All / Uncheck All / Remove Unchecked)
  const handleCheckAll = (checked) => {
    if (activeTab === 'notes') {
      setCourseNoteItems((prev) => prev.map((item) => ({ ...item, isSelected: checked })));
    } else {
      setPastQuestionItems((prev) => prev.map((item) => ({ ...item, isSelected: checked })));
    }
  };

  const handleRemoveUnchecked = () => {
    if (activeTab === 'notes') {
      setCourseNoteItems((prev) => prev.filter((item) => item.isSelected));
    } else {
      setPastQuestionItems((prev) => prev.filter((item) => item.isSelected));
    }
    appendLog('Removed unchecked courses from current session list.');
  };

  // Helper: Check if file exists or write file in local directory handle
  const checkFileExistsInDir = async (rootHandle, relativePath) => {
    try {
      const parts = relativePath.split('/').filter(Boolean);
      const fileName = parts.pop();
      let curr = rootHandle;
      for (const dirName of parts) {
        curr = await curr.getDirectoryHandle(dirName, { create: false });
      }
      await curr.getFileHandle(fileName, { create: false });
      return true;
    } catch {
      return false;
    }
  };

  const writeFileToDir = async (rootHandle, relativePath, arrayBuffer) => {
    const parts = relativePath.split('/').filter(Boolean);
    const fileName = parts.pop();
    let curr = rootHandle;
    for (const dirName of parts) {
      curr = await curr.getDirectoryHandle(dirName, { create: true });
    }
    const fileHandle = await curr.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(arrayBuffer);
    await writable.close();
  };

  // Execute Batch Download (4 concurrent workers — ported from DownloadEngine.ExecuteBatchAsync)
  const runBatchAsync = async (tasks, bundleZipName) => {
    if (!tasks || tasks.length === 0) {
      appendLog('No matching files found for the checked courses.');
      return;
    }

    const useDirectFolder = saveMode === 'folder' && dirHandle !== null;
    appendLog(
      `Queued ${tasks.length} file(s). ${
        useDirectFolder
          ? `Syncing directly to local folder '${dirHandle.name}'...`
          : 'Downloading and packaging into structured .ZIP archive...'
      }`
    );

    setIsDownloading(true);
    setProgress({ current: 0, total: tasks.length });
    setProgressStatus(
      `Progress: 0/${tasks.length}  •  Downloaded: 0  •  Skipped: 0  •  Failed: 0`
    );

    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    let completed = 0;
    const zip = useDirectFolder ? null : new JSZip();

    let nextIndex = 0;
    const concurrency = 4;

    const worker = async () => {
      while (true) {
        const idx = nextIndex++;
        if (idx >= tasks.length) break;
        const task = tasks[idx];

        try {
          // If saving to local folder and extension is known, skip before downloading if file exists
          if (useDirectFolder && task.hasKnownExtension) {
            const exists = await checkFileExistsInDir(dirHandle, task.relativePath);
            if (exists) {
              skipped++;
              continue;
            }
          }

          const resp = await fetch('/api/moodle/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionToken,
              url: task.url,
              hasKnownExtension: task.hasKnownExtension,
            }),
          });

          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
          }

          let finalRelativePath = task.relativePath;
          if (!task.hasKnownExtension) {
            const ext = resp.headers.get('X-Resolved-Extension') || '.pdf';
            if (!finalRelativePath.toLowerCase().endsWith(ext.toLowerCase())) {
              finalRelativePath += ext;
            }

            if (useDirectFolder) {
              const exists = await checkFileExistsInDir(dirHandle, finalRelativePath);
              if (exists) {
                skipped++;
                continue;
              }
            }
          }

          const buffer = await resp.arrayBuffer();

          if (useDirectFolder) {
            await writeFileToDir(dirHandle, finalRelativePath, buffer);
          } else if (zip) {
            zip.file(finalRelativePath, buffer);
          }

          downloaded++;
          appendLog(`Saved: ${task.displayName}`);
        } catch (err) {
          failed++;
          appendLog(`Failed: ${task.displayName} (${err.message})`);
        } finally {
          completed++;
          setProgress({ current: completed, total: tasks.length });
          setProgressStatus(
            `Progress: ${completed}/${tasks.length}  •  Downloaded: ${downloaded}  •  Skipped: ${skipped}  •  Failed: ${failed}`
          );
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));

    if (!useDirectFolder && zip && downloaded > 0) {
      appendLog(`Generating ${bundleZipName} (${downloaded} files)...`);
      try {
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = bundleZipName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        appendLog(`Browser download started: ${bundleZipName}`);
      } catch (err) {
        appendLog(`ZIP generation error: ${err.message}`);
      }
    }

    appendLog(
      `Completed! Newly Downloaded: ${downloaded} | Skipped: ${skipped} | Failed: ${failed}`
    );
    setIsDownloading(false);
  };

  // Download Past Questions (ported from BtnDownloadPQ_Click)
  const handleDownloadPastQuestions = async () => {
    if (!sessionToken) {
      alert('Please log in first!');
      return;
    }

    const selectedCodes = pastQuestionItems
      .filter((i) => i.isSelected && i.code)
      .map((i) => i.code);

    if (selectedCodes.length === 0) {
      alert('Check at least one course to download.');
      return;
    }

    setIsDownloading(true);
    appendLog('Scanning repository for matching Past Questions...');

    try {
      const masterFolder = (settings.masterFolderName || '').trim() || 'Past_Questions';
      const res = await fetch('/api/moodle/past-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          selectedCodes,
          knownTitles: sessionCourseTitles,
          masterFolderName: masterFolder,
          yearRangeString: getSelectedYearRangeString(),
          semChoice: semesterIdx,
          groupYearsInSubfolders: true,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        appendLog(data.message || 'Failed to scan Past Questions.');
        setIsDownloading(false);
        return;
      }

      if (data.discoveredTitles) {
        setSessionCourseTitles((prev) => ({ ...data.discoveredTitles, ...prev }));
      }

      await runBatchAsync(data.tasks || [], `${masterFolder}.zip`);
    } catch (err) {
      appendLog(`Error scanning Past Questions: ${err.message}`);
      setIsDownloading(false);
    }
  };

  // Download Course Notes (ported from BtnDownloadNotes_Click)
  const handleDownloadCourseNotes = async () => {
    if (!sessionToken) {
      alert('Please log in first!');
      return;
    }

    const selectedCourses = courseNoteItems.filter((i) => i.isSelected && i.moodleId);
    if (selectedCourses.length === 0) {
      alert('Check at least one enrolled course to download lecture notes.');
      return;
    }

    setIsDownloading(true);
    appendLog(`Scanning Course Notes for ${selectedCourses.length} selected course(s)...`);

    try {
      const res = await fetch('/api/moodle/course-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          courses: selectedCourses,
          knownTitles: sessionCourseTitles,
          masterFolderName: 'Course_Notes',
        }),
      });

      const data = await res.json();
      if (Array.isArray(data.logs)) {
        data.logs.forEach((l) => appendLog(l));
      }
      if (!data.success) {
        appendLog(data.message || 'Failed to scan Course Notes.');
        setIsDownloading(false);
        return;
      }

      await runBatchAsync(data.tasks || [], 'Course_Notes.zip');
    } catch (err) {
      appendLog(`Error scanning Course Notes: ${err.message}`);
      setIsDownloading(false);
    }
  };

  // Check GitHub Releases (About View)
  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateStatus('Checking GitHub...');
    appendLog(`Checking ${GITHUB_REPO_URL} for latest desktop & web releases...`);
    try {
      const res = await fetch(GITHUB_API_LATEST);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const release = await res.json();
      const latestTag = release.tag_name || 'v1.5.3';
      setUpdateStatus(`Latest GitHub Release: ${latestTag} ✓`);
      appendLog(`Latest release on GitHub: ${latestTag} (${release.html_url || GITHUB_REPO_URL})`);
    } catch (err) {
      setUpdateStatus('Web Edition v1.5.3 (Up to date ✓)');
      appendLog(`GitHub release check complete (Web Edition v1.5.3).`);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // Reset Local Settings (Web equivalent of Uninstall/Clear Data)
  const handleResetLocalData = () => {
    if (
      !window.confirm(
        "Reset all saved preferences, credentials, and local configuration for Team Ator's Student Helper in this browser?"
      )
    ) {
      return;
    }
    localStorage.removeItem(CONFIG_STORAGE_KEY);
    setSettings(DEFAULT_SETTINGS);
    setSessionToken('');
    setPastQuestionItems([]);
    setCourseNoteItems([]);
    setAuthStatus({ text: '● Offline', color: '#EB8791' });
    appendLog('Local browser configuration reset to defaults.');
    showToast('Settings Reset');
  };

  // Computed display strings with Character Tracking
  const charSpace = Math.max(0, Math.min(5, Math.round(Number(settings.characterSpacing) || 0)));
  const currentAccentHex =
    (settings.accentName || '').toLowerCase() === 'custom'
      ? settings.customAccentHex || '#18E0F5'
      : ACCENT_SWATCHES.find(
          (s) => s.name.toLowerCase() === (settings.accentName || '').toLowerCase()
        )?.hex || '#18E0F5';

  const progressPct =
    progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;

  return (
    <div className="app-viewport">
      {/* Hidden Audio Element for Secret Music Player */}
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (!isDraggingSeek && audioRef.current) {
            setMusicTime({
              current: audioRef.current.currentTime || 0,
              duration: audioRef.current.duration || 0,
            });
          }
        }}
        onEnded={() => {
          if (isMusicLoop && currentTrackIndex >= 0 && audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play();
          } else if (playlist.length > 0) {
            const next = (currentTrackIndex + 1) % playlist.length;
            playTrackAtIndex(next);
          }
        }}
      />

      {/* OUTER CLEAR-GLASS SHELL */}
      <div className="outer-window-border">
        {/* ROW 0: HEADER BAR */}
        <div className="header-bar">
          <div className="header-left">
            <button
              type="button"
              className="glass-btn icon-btn"
              title="Toggle Sidebar"
              onClick={() => setIsSidebarOpen((prev) => !prev)}
            >
              <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
                <path
                  d="M0 1H14M0 6H14M0 11H14"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
            </button>
            <div className="accent-dot" />
            <span className="app-title">
              {applyTracking("Team Ator's Student Helper", charSpace)}
            </span>
          </div>

          <div className="header-right">
            <div className="auth-badge" style={{ color: authStatus.color }}>
              {authStatus.text}
            </div>

            <button
              type="button"
              className="glass-btn top-toggle-btn"
              onClick={() => setIsTopBarOpen((prev) => !prev)}
            >
              {isTopBarOpen ? 'Account & Paths ▲' : 'Account & Paths ▼'}
            </button>
          </div>
        </div>

        {/* ROW 1: TOP BAR (ACCOUNT & PATHS) */}
        {isTopBarOpen && (
          <div className="card-top-bar">
            <div className="top-bar-row">
              <span className="field-label">Student ID:</span>
              <input
                type="text"
                className="glass-input"
                placeholder="e.g. 10318299"
                value={settings.lastUsername}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, lastUsername: e.target.value }))
                }
              />

              <span className="field-label" style={{ marginLeft: 8 }}>
                Password:
              </span>
              <input
                type="password"
                className="glass-input"
                placeholder="UPSA Virtual Password"
                value={settings.lastPassword}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, lastPassword: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLoginAndSync();
                }}
              />

              <button
                type="button"
                className="glass-btn accent-btn"
                disabled={isLoggingIn}
                onClick={handleLoginAndSync}
              >
                {isLoggingIn ? 'Syncing...' : 'Log In & Sync'}
              </button>
            </div>

            <div className="top-bar-row">
              <span className="field-label">Master Folder:</span>
              <input
                type="text"
                className="glass-input"
                value={settings.masterFolderName}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, masterFolderName: e.target.value }))
                }
              />

              <span className="field-label" style={{ marginLeft: 8 }}>
                Save Mode:
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
                <select
                  className="glass-select"
                  style={{ maxWidth: 210 }}
                  value={saveMode}
                  onChange={(e) => {
                    const mode = e.target.value;
                    if (mode === 'folder' && !dirHandle) {
                      handleBrowseFolder();
                    } else {
                      setSaveMode(mode);
                    }
                  }}
                >
                  <option value="zip">📦 .ZIP Archive Bundle</option>
                  <option value="folder">📁 Direct Local Folder Sync</option>
                </select>
                <input
                  type="text"
                  className="glass-input"
                  value={
                    saveMode === 'folder' && dirHandle
                      ? `[Local Disk] ${dirHandle.name}/${settings.masterFolderName || 'Past_Questions'}`
                      : `${settings.masterFolderName || 'Past_Questions'}.zip (Browser Download)`
                  }
                  readOnly
                />
              </div>

              <button type="button" className="glass-btn" onClick={handleBrowseFolder}>
                Browse...
              </button>
            </div>
          </div>
        )}

        {/* ROW 2: WORKSPACE */}
        <div className="workspace-row">
          {/* SIDEBAR */}
          {isSidebarOpen && (
            <div className="card-sidebar">
              <div className="section-header">
                {applyTracking('WORKSPACE', charSpace)}
              </div>

              <button
                type="button"
                className={`sidebar-tab-btn ${activeTab === 'pq' ? 'active' : ''}`}
                onClick={() => setActiveTab('pq')}
              >
                📄&nbsp;&nbsp;{applyTracking('Past Questions', charSpace)}
              </button>

              <button
                type="button"
                className={`sidebar-tab-btn ${activeTab === 'notes' ? 'active' : ''}`}
                onClick={() => setActiveTab('notes')}
              >
                📚&nbsp;&nbsp;{applyTracking('Course Notes & Slides', charSpace)}
              </button>

              <button
                type="button"
                className={`sidebar-tab-btn ${activeTab === 'themes' ? 'active' : ''}`}
                onClick={() => setActiveTab('themes')}
              >
                🎨&nbsp;&nbsp;{applyTracking('Themes', charSpace)}
              </button>

              {settings.isMusicUnlocked && (
                <button
                  type="button"
                  className={`sidebar-tab-btn ${activeTab === 'music' ? 'active' : ''}`}
                  onClick={() => setActiveTab('music')}
                >
                  🎵&nbsp;&nbsp;{applyTracking('Music Player', charSpace)}
                </button>
              )}

              <button
                type="button"
                className={`sidebar-tab-btn ${activeTab === 'about' ? 'active' : ''}`}
                style={{ marginBottom: 10 }}
                onClick={() => setActiveTab('about')}
              >
                ℹ️&nbsp;&nbsp;{applyTracking('About', charSpace)}
              </button>

              <hr className="sidebar-sep" />

              <div className="section-header">
                {applyTracking('SELECTION', charSpace)}
              </div>

              <button
                type="button"
                className="glass-btn"
                style={{ marginBottom: 5, width: '100%' }}
                onClick={() => handleCheckAll(true)}
              >
                Check All
              </button>
              <button
                type="button"
                className="glass-btn"
                style={{ marginBottom: 5, width: '100%' }}
                onClick={() => handleCheckAll(false)}
              >
                Uncheck All
              </button>
              <button
                type="button"
                className="glass-btn"
                style={{ marginBottom: 2, width: '100%' }}
                onClick={handleRemoveUnchecked}
              >
                Remove Unchecked
              </button>
            </div>
          )}

          {/* MAIN VIEW CONTENT CARD */}
          <div className="card-content">
            {/* VIEW 1: PAST QUESTIONS */}
            {activeTab === 'pq' && (
              <div className="view-pane">
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 140px auto 140px 24px auto 1fr',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 14,
                  }}
                >
                  <span className="field-label">From Year:</span>
                  <select
                    className="glass-select"
                    value={yearFromIdx}
                    onChange={(e) => handleYearFromChange(e.target.value)}
                  >
                    {YEARS_LIST.map((y, idx) => (
                      <option key={y} value={idx}>
                        {y}
                      </option>
                    ))}
                  </select>

                  <span className="field-label">To:</span>
                  <select
                    className="glass-select"
                    value={yearToIdx}
                    disabled={yearFromIdx === 0}
                    onChange={(e) => setYearToIdx(Number(e.target.value))}
                  >
                    {YEARS_LIST.map((y, idx) => (
                      <option key={y} value={idx} disabled={idx > 0 && idx < yearFromIdx}>
                        {y}
                      </option>
                    ))}
                  </select>

                  <span />

                  <span className="field-label">Semester:</span>
                  <select
                    className="glass-select"
                    value={semesterIdx}
                    onChange={(e) => setSemesterIdx(Number(e.target.value))}
                  >
                    <option value={0}>Both / All Semesters</option>
                    <option value={1}>First Semester Only</option>
                    <option value={2}>Second Semester Only</option>
                  </select>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                    gap: 12,
                  }}
                >
                  <span className="field-label">Target Courses (Synced on Login):</span>
                  <form
                    onSubmit={handleAddManualCourse}
                    style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                  >
                    <input
                      type="text"
                      className="glass-input"
                      style={{ minHeight: 28, height: 28, width: 170, fontSize: 12 }}
                      placeholder="+ Add code (e.g. BCPC212)"
                      value={manualCourseInput}
                      onChange={(e) => setManualCourseInput(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="glass-btn"
                      style={{ minHeight: 28, height: 28, padding: '0 10px', fontSize: 12 }}
                    >
                      Add
                    </button>
                  </form>
                </div>

                <div className="course-list-well">
                  {pastQuestionItems.length === 0 ? (
                    <div
                      style={{
                        color: 'var(--text-muted)',
                        padding: '18px 10px',
                        textAlign: 'center',
                      }}
                    >
                      Log in with your UPSA Virtual credentials above to sync your enrolled courses,
                      or add course codes manually.
                    </div>
                  ) : (
                    pastQuestionItems.map((item, idx) => (
                      <div
                        key={item.code}
                        className="course-check-item"
                        onClick={() => {
                          setPastQuestionItems((prev) =>
                            prev.map((it, i) =>
                              i === idx ? { ...it, isSelected: !it.isSelected } : it
                            )
                          );
                        }}
                      >
                        <div className={`custom-chk ${item.isSelected ? 'checked' : ''}`}>
                          {item.isSelected && (
                            <svg width="13" height="10" viewBox="0 0 13 10" fill="none">
                              <path
                                d="M1.5 5L5 8.5L11.5 1.5"
                                stroke="#FFFFFF"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </div>
                        <span>{applyTracking(item.rawText, charSpace)}</span>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  className="glass-btn accent-btn"
                  style={{ minHeight: 42, width: '100%' }}
                  disabled={isDownloading}
                  onClick={handleDownloadPastQuestions}
                >
                  {isDownloading ? 'Downloading Batch...' : 'Download Past Questions'}
                </button>
              </div>
            )}

            {/* VIEW 2: COURSE NOTES */}
            {activeTab === 'notes' && (
              <div className="view-pane">
                <div className="field-label" style={{ marginBottom: 10 }}>
                  Enrolled Courses for Lecture Notes &amp; Slides (Synced on Login):
                </div>

                <div className="course-list-well">
                  {courseNoteItems.length === 0 ? (
                    <div
                      style={{
                        color: 'var(--text-muted)',
                        padding: '18px 10px',
                        textAlign: 'center',
                      }}
                    >
                      Log in with your UPSA Virtual credentials above to load your enrolled courses.
                    </div>
                  ) : (
                    courseNoteItems.map((item, idx) => (
                      <div
                        key={item.code}
                        className="course-check-item"
                        onClick={() => {
                          setCourseNoteItems((prev) =>
                            prev.map((it, i) =>
                              i === idx ? { ...it, isSelected: !it.isSelected } : it
                            )
                          );
                        }}
                      >
                        <div className={`custom-chk ${item.isSelected ? 'checked' : ''}`}>
                          {item.isSelected && (
                            <svg width="13" height="10" viewBox="0 0 13 10" fill="none">
                              <path
                                d="M1.5 5L5 8.5L11.5 1.5"
                                stroke="#FFFFFF"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </div>
                        <span>{applyTracking(item.rawText, charSpace)}</span>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  className="glass-btn accent-btn"
                  style={{ minHeight: 42, width: '100%' }}
                  disabled={isDownloading}
                  onClick={handleDownloadCourseNotes}
                >
                  {isDownloading
                    ? 'Downloading Batch...'
                    : 'Download Lecture Notes & Slides'}
                </button>
              </div>
            )}

            {/* VIEW 3: THEMES & AFTER EFFECTS CHARACTER PANEL */}
            {activeTab === 'themes' && (
              <div className="view-pane view-scroll">
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>
                  {applyTracking('Themes & Character', charSpace)}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: 'var(--text-muted)',
                    marginBottom: 18,
                  }}
                >
                  Customize glass tint and After Effects-style workspace typography.
                </div>

                {/* 1. ACCENT SWATCHES & COLOR WHEEL */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 20,
                    marginBottom: 22,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 10 }}>
                      Glass Accent Tint
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {ACCENT_SWATCHES.map((sw) => {
                        const isSelected =
                          (settings.accentName || '').toLowerCase() ===
                          sw.name.toLowerCase();
                        return (
                          <div
                            key={sw.name}
                            onClick={() => {
                              setSettings((prev) => ({
                                ...prev,
                                accentName: sw.name,
                                customAccentHex: sw.hex,
                              }));
                              showToast('Theme updated');
                            }}
                            style={{
                              width: 46,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              cursor: 'pointer',
                            }}
                          >
                            <div
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: '50%',
                                padding: 3,
                                border: isSelected
                                  ? '2.4px solid #FFFFFF'
                                  : `1px solid ${sw.hex}66`,
                                boxShadow: isSelected
                                  ? `0 0 18px ${sw.hex}`
                                  : `0 0 10px ${sw.hex}66`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <div
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  borderRadius: '50%',
                                  background: sw.hex,
                                }}
                              />
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                color: 'var(--text-muted)',
                                marginTop: 4,
                                minHeight: 15,
                              }}
                            >
                              {isSelected ? sw.name : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Color Wheel Box */}
                  <div
                    style={{
                      background: 'var(--input-well)',
                      border: '1px solid var(--subtle-border)',
                      borderRadius: 12,
                      padding: '8px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        position: 'relative',
                        width: 76,
                        height: 76,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <canvas
                        ref={wheelCanvasRef}
                        width={148}
                        height={148}
                        onMouseDown={(e) => {
                          isDraggingWheelRef.current = true;
                          pickColorFromWheel(e.clientX, e.clientY);
                        }}
                        style={{
                          width: 74,
                          height: 74,
                          borderRadius: '50%',
                          cursor: 'crosshair',
                          border: '1.5px solid var(--subtle-border)',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          left: wheelThumbPos.x - 7,
                          top: wheelThumbPos.y - 7,
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          border: '2px solid #FFFFFF',
                          pointerEvents: 'none',
                          boxShadow: '0 0 4px rgba(0,0,0,0.8)',
                        }}
                      />
                    </div>

                    <div style={{ minWidth: 135 }}>
                      <div style={{ fontWeight: 600 }}>Color Wheel</div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: 'var(--text-muted)',
                          margin: '2px 0 7px 0',
                        }}
                      >
                        Drag to tint glass
                      </div>
                      <div
                        style={{
                          display: 'inline-block',
                          background: 'var(--theme-accent)',
                          borderRadius: 6,
                          padding: '3px 9px',
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: '#FFFFFF',
                        }}
                      >
                        {currentAccentHex.toUpperCase()}
                      </div>
                    </div>
                  </div>
                </div>

                <hr className="sidebar-sep" style={{ marginBottom: 16 }} />

                {/* 2. AFTER EFFECTS CHARACTER / TYPOGRAPHY PANEL */}
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                    marginBottom: 12,
                  }}
                >
                  {applyTracking('CHARACTER & TYPOGRAPHY', charSpace)}
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'flex-end',
                    gap: 14,
                    marginBottom: 18,
                  }}
                >
                  <div style={{ width: 260 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        marginBottom: 6,
                      }}
                    >
                      Font Family
                    </div>
                    <select
                      className="glass-select"
                      value={settings.fontName}
                      onChange={(e) => {
                        setSettings((prev) => ({ ...prev, fontName: e.target.value }));
                        showToast('Theme updated');
                      }}
                    >
                      {availableFonts.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <input
                      ref={fontInputRef}
                      type="file"
                      accept=".ttf,.otf,.woff,.woff2"
                      style={{ display: 'none' }}
                      onChange={handleImportFont}
                    />
                    <button
                      type="button"
                      className="glass-btn"
                      onClick={() => fontInputRef.current?.click()}
                    >
                      + Import .TTF / .OTF
                    </button>
                  </div>

                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        marginBottom: 6,
                      }}
                    >
                      Style
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        title="Faux Bold"
                        className={`char-toggle-btn ${settings.isBold ? 'active' : ''}`}
                        onClick={() => {
                          setSettings((prev) => ({ ...prev, isBold: !prev.isBold }));
                          showToast('Theme updated');
                        }}
                      >
                        <span style={{ fontWeight: 900, fontSize: 14 }}>B</span>
                      </button>

                      <button
                        type="button"
                        title="Faux Italic"
                        className={`char-toggle-btn ${settings.isItalic ? 'active' : ''}`}
                        onClick={() => {
                          setSettings((prev) => ({ ...prev, isItalic: !prev.isItalic }));
                          showToast('Theme updated');
                        }}
                      >
                        <span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: 14 }}>
                          I
                        </span>
                      </button>

                      <button
                        type="button"
                        className="glass-btn"
                        onClick={() => {
                          setSettings((prev) => ({
                            ...prev,
                            fontName: 'Cascadia Code',
                            fontSize: 13.5,
                            lineSpacing: 6.0,
                            characterSpacing: 0,
                            isBold: false,
                            isItalic: false,
                          }));
                          showToast('Theme updated');
                        }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                </div>

                {/* AE Scrubbers Row */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 16,
                  }}
                >
                  {/* Font Size */}
                  <div
                    style={{
                      background: 'var(--input-well)',
                      border: '1px solid var(--subtle-border)',
                      borderRadius: 10,
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 10,
                      }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                        T↕&nbsp;&nbsp;Font Size
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: 'var(--theme-accent)',
                        }}
                      >
                        {Number(settings.fontSize).toFixed(1).replace(/\.0$/, '')} px
                      </span>
                    </div>
                    <input
                      type="range"
                      className="glow-slider"
                      min="10"
                      max="18"
                      step="0.5"
                      value={settings.fontSize}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          fontSize: parseFloat(e.target.value),
                        }))
                      }
                    />
                  </div>

                  {/* Row Leading */}
                  <div
                    style={{
                      background: 'var(--input-well)',
                      border: '1px solid var(--subtle-border)',
                      borderRadius: 10,
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 10,
                      }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                        A↕&nbsp;&nbsp;Row Leading
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: 'var(--theme-accent)',
                        }}
                      >
                        {Math.round(settings.lineSpacing)} px
                      </span>
                    </div>
                    <input
                      type="range"
                      className="glow-slider"
                      min="2"
                      max="18"
                      step="1"
                      value={settings.lineSpacing}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          lineSpacing: parseFloat(e.target.value),
                        }))
                      }
                    />
                  </div>

                  {/* Character Spacing */}
                  <div
                    style={{
                      background: 'var(--input-well)',
                      border: '1px solid var(--subtle-border)',
                      borderRadius: 10,
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 10,
                      }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                        A↔&nbsp;&nbsp;Char Spacing
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: 'var(--theme-accent)',
                        }}
                      >
                        {charSpace === 0 ? '0 (Normal)' : `+${charSpace}`}
                      </span>
                    </div>
                    <input
                      type="range"
                      className="glow-slider"
                      min="0"
                      max="5"
                      step="1"
                      value={settings.characterSpacing}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          characterSpacing: parseInt(e.target.value, 10),
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {/* VIEW 4: SECRET MUSIC PLAYER (UNLOCKED BY 'ATOR' CHEAT CODE) */}
            {activeTab === 'music' && (
              <div className="view-pane">
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {applyTracking('Team Ator Secret Deck', charSpace)}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: 'var(--theme-accent)',
                      marginTop: 2,
                    }}
                  >
                    Cheat Code [ATOR] Activated  •  Built-in Study &amp; Phonk Audio Deck
                  </div>
                </div>

                {/* Now Playing Card */}
                <div
                  style={{
                    background: 'var(--input-well)',
                    border: '1px solid var(--subtle-border)',
                    borderRadius: 12,
                    padding: '14px 18px',
                    marginBottom: 14,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-end',
                      marginBottom: 10,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: 'var(--text-muted)',
                        }}
                      >
                        NOW PLAYING
                      </div>
                      <div
                        style={{
                          fontSize: 15.5,
                          fontWeight: 700,
                          marginTop: 2,
                        }}
                      >
                        {currentTrackIndex >= 0 && playlist[currentTrackIndex]
                          ? playlist[currentTrackIndex].title
                          : 'No Track Loaded'}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: 'var(--theme-accent)',
                      }}
                    >
                      {formatTime(musicTime.current)} / {formatTime(musicTime.duration)}
                    </div>
                  </div>

                  {/* Seek Slider */}
                  <input
                    type="range"
                    className="glow-slider"
                    style={{ marginBottom: 12 }}
                    min={0}
                    max={Math.max(1, musicTime.duration)}
                    step={0.25}
                    value={musicTime.current}
                    onMouseDown={() => setIsDraggingSeek(true)}
                    onMouseUp={(e) => {
                      setIsDraggingSeek(false);
                      if (audioRef.current) {
                        audioRef.current.currentTime = parseFloat(e.target.value);
                      }
                    }}
                    onChange={(e) =>
                      setMusicTime((prev) => ({
                        ...prev,
                        current: parseFloat(e.target.value),
                      }))
                    }
                  />

                  {/* Transport Controls */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="glass-btn"
                        onClick={() => {
                          if (playlist.length === 0) return;
                          const prev =
                            currentTrackIndex <= 0
                              ? playlist.length - 1
                              : currentTrackIndex - 1;
                          playTrackAtIndex(prev);
                        }}
                      >
                        ⏮ Prev
                      </button>

                      <button
                        type="button"
                        className="glass-btn accent-btn"
                        style={{ minWidth: 105 }}
                        onClick={() => {
                          if (currentTrackIndex < 0 && playlist.length > 0) {
                            playTrackAtIndex(0);
                            return;
                          }
                          if (!audioRef.current) return;
                          if (isMusicPlaying) {
                            audioRef.current.pause();
                            setIsMusicPlaying(false);
                          } else {
                            audioRef.current.play();
                            setIsMusicPlaying(true);
                          }
                        }}
                      >
                        {isMusicPlaying ? '⏸ Pause' : '▶ Play'}
                      </button>

                      <button
                        type="button"
                        className="glass-btn"
                        onClick={() => {
                          if (playlist.length === 0) return;
                          const next = (currentTrackIndex + 1) % playlist.length;
                          playTrackAtIndex(next);
                        }}
                      >
                        ⏭ Next
                      </button>

                      <button
                        type="button"
                        className={`char-toggle-btn ${isMusicLoop ? 'active' : ''}`}
                        onClick={() => setIsMusicLoop((prev) => !prev)}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600 }}>🔁 Loop</span>
                      </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        🔊 Vol
                      </span>
                      <input
                        type="range"
                        className="glow-slider"
                        style={{ width: 120 }}
                        min={0}
                        max={1}
                        step={0.02}
                        value={musicVolume}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setMusicVolume(v);
                          if (audioRef.current) audioRef.current.volume = v;
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Playlist Box */}
                <div className="course-list-well">
                  {playlist.map((track, idx) => (
                    <div
                      key={`${track.title}-${idx}`}
                      className="course-check-item"
                      style={{
                        background:
                          idx === currentTrackIndex
                            ? 'var(--theme-accent-glow)'
                            : undefined,
                        fontWeight: idx === currentTrackIndex ? 600 : 500,
                      }}
                      onClick={() => playTrackAtIndex(idx)}
                    >
                      <span>{track.title}</span>
                    </div>
                  ))}
                </div>

                {/* Add Songs Row */}
                <div style={{ display: 'flex', gap: 12 }}>
                  <input
                    ref={musicInputRef}
                    type="file"
                    accept=".mp3,.wav,.flac,.m4a,audio/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleAddAudioTracks}
                  />
                  <button
                    type="button"
                    className="glass-btn accent-btn"
                    style={{ flex: 1, minHeight: 40 }}
                    onClick={() => musicInputRef.current?.click()}
                  >
                    + Add MP3 / WAV / FLAC Tracks...
                  </button>
                  <button
                    type="button"
                    className="glass-btn"
                    style={{ minHeight: 40 }}
                    onClick={() => playTrackAtIndex(0)}
                  >
                    Play Built-In &apos;secret.mp3&apos;
                  </button>
                </div>
              </div>
            )}

            {/* VIEW 5: ABOUT & LEGAL */}
            {activeTab === 'about' && (
              <div className="view-pane view-scroll">
                <div
                  style={{
                    background: 'var(--input-well)',
                    border: '1px solid var(--subtle-border)',
                    borderRadius: 12,
                    padding: '16px 18px',
                    marginBottom: 16,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>
                      {applyTracking("Team Ator's Student Helper", charSpace)}
                    </div>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: 'var(--theme-accent)',
                        margin: '4px 0',
                      }}
                    >
                      Developed by Kingseight  •  Team Ator
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Version 1.5.3 (Vercel Web &amp; Cloud Edition)  •  Official Release
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="glass-btn accent-btn"
                        disabled={isCheckingUpdate}
                        onClick={handleCheckUpdates}
                      >
                        Check for Updates
                      </button>
                      <a
                        href={`${GITHUB_REPO_URL}/releases/latest`}
                        target="_blank"
                        rel="noreferrer"
                        className="glass-btn"
                        style={{ textDecoration: 'none' }}
                      >
                        Windows Desktop App
                      </a>
                      <button
                        type="button"
                        className="glass-btn"
                        style={{ color: '#FF9AA2' }}
                        onClick={handleResetLocalData}
                      >
                        Reset App Data
                      </button>
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: 'var(--text-muted)',
                        marginTop: 6,
                      }}
                    >
                      {updateStatus}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                    margin: '0 0 10px 2px',
                  }}
                >
                  LEGAL NOTICE &amp; TERMS OF USE
                </div>

                <div
                  style={{
                    background: 'var(--input-well)',
                    border: '1px solid var(--subtle-border)',
                    borderRadius: 12,
                    padding: '14px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 3 }}>
                      1. Non-Affiliation &amp; Independent Tool
                    </div>
                    <div
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 12.5,
                        lineHeight: 1.5,
                      }}
                    >
                      Team Ator&apos;s Student Helper (developed by Kingseight) is an independent
                      student productivity utility and is not officially affiliated with, endorsed
                      by, or sponsored by the University of Professional Studies, Accra (UPSA) or
                      Moodle Pty Ltd.
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 3 }}>
                      2. Local Privacy &amp; Credential Security
                    </div>
                    <div
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 12.5,
                        lineHeight: 1.5,
                      }}
                    >
                      Your Student ID and Password are stored locally on your personal device and
                      are transmitted strictly via encrypted HTTPS requests directly to the official
                      UPSA Virtual learning portal. Neither Team Ator nor Kingseight collects,
                      transmits, or stores your credentials on any external database.
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 3 }}>
                      3. Academic Fair Use &amp; Copyright
                    </div>
                    <div
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 12.5,
                        lineHeight: 1.5,
                      }}
                    >
                      All past examination papers, lecture slides, and course materials retrieved
                      through this software remain the intellectual property of the University and
                      their respective authors. Downloaded materials are strictly for personal
                      academic study and revision.
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 3 }}>
                      4. No Warranty (&apos;As-Is&apos; Provision)
                    </div>
                    <div
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 12.5,
                        lineHeight: 1.5,
                      }}
                    >
                      This software is provided &apos;as is&apos; without warranty of any kind. Team
                      Ator and Kingseight shall not be held liable for portal downtime, incomplete
                      downloads, or account misuse.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Toast Notification */}
            <div
              className="toast-badge"
              style={{
                opacity: toastVisible ? 1 : 0,
                transform: toastVisible ? 'translateY(0)' : 'translateY(6px)',
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  background: 'var(--theme-accent)',
                }}
              />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{toastMsg}</span>
            </div>
          </div>
        </div>

        {/* ROW 3: BOTTOM CONSOLE */}
        <div className="bottom-console">
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              marginBottom: 5,
            }}
          >
            {progressStatus}
          </div>

          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
          </div>

          <div ref={logBoxRef} className="console-log-box">
            {logs.join('\n')}
          </div>
        </div>

        {/* FIRST-RUN TERMS & CONDITIONS GATE */}
        {isConfigLoaded && !settings.hasAcceptedTerms && (
          <div className="terms-overlay">
            <div style={{ maxWidth: 680, width: '100%' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                License Agreement &amp; Terms of Use
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--text-muted)',
                  margin: '4px 0 16px 0',
                }}
              >
                Please review and accept the terms below to use Team Ator&apos;s Student Helper.
              </div>

              <div
                style={{
                  background: 'var(--input-well)',
                  border: '1px solid var(--subtle-border)',
                  borderRadius: 8,
                  padding: 16,
                  maxHeight: 250,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      color: 'var(--theme-accent)',
                      marginBottom: 4,
                    }}
                  >
                    1. Independent Utility (Non-Affiliation)
                  </div>
                  <div style={{ lineHeight: 1.45 }}>
                    Team Ator&apos;s Student Helper is an independent student productivity tool
                    developed by Kingseight and is not affiliated with or endorsed by UPSA or
                    Moodle Pty Ltd.
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      color: 'var(--theme-accent)',
                      marginBottom: 4,
                    }}
                  >
                    2. Local Credential Privacy
                  </div>
                  <div style={{ lineHeight: 1.45 }}>
                    Your Student ID and Password stay strictly on your local machine and are
                    transmitted only to the official UPSA Virtual portal via HTTPS.
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      color: 'var(--theme-accent)',
                      marginBottom: 4,
                    }}
                  >
                    3. Academic Fair Use &amp; As-Is Warranty
                  </div>
                  <div style={{ lineHeight: 1.45 }}>
                    Downloaded past questions and slides are strictly for personal study. This
                    software is provided &apos;as-is&apos; without warranty of any kind.
                  </div>
                </div>
              </div>

              <div
                className="course-check-item"
                style={{ margin: '16px 0 20px 0' }}
                onClick={() => setTermsChecked((prev) => !prev)}
              >
                <div className={`custom-chk ${termsChecked ? 'checked' : ''}`}>
                  {termsChecked && (
                    <svg width="13" height="10" viewBox="0 0 13 10" fill="none">
                      <path
                        d="M1.5 5L5 8.5L11.5 1.5"
                        stroke="#FFFFFF"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <span>I have read and agree to the Terms and Conditions</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button
                  type="button"
                  className="glass-btn accent-btn"
                  disabled={!termsChecked}
                  onClick={() =>
                    setSettings((prev) => ({ ...prev, hasAcceptedTerms: true }))
                  }
                >
                  Accept &amp; Continue
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
