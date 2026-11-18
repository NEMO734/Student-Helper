#nullable disable
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;
using Microsoft.Win32;
using Velopack;
using Velopack.Sources;

namespace Student_Helper
{
    public class MusicTrackItem
    {
        public string Title { get; set; } = "";
        public string FilePath { get; set; } = "";
    }

    public class SelectableCourseItem : INotifyPropertyChanged
    {
        private bool _isSelected;
        private string _displayText = "";

        public string Code { get; set; } = "";
        public string MoodleId { get; set; } = "";
        public string RawText { get; set; } = "";

        public string DisplayText
        {
            get => _displayText;
            set
            {
                _displayText = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(DisplayText)));
            }
        }

        public bool IsSelected
        {
            get => _isSelected;
            set
            {
                _isSelected = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsSelected)));
            }
        }

        public event PropertyChangedEventHandler PropertyChanged;
    }

    public partial class MainWindow : Window
    {
        private const string GITHUB_REPO_URL = "https://github.com/NEMO734/Student-Helper";

        [DllImport("dwmapi.dll")]
        internal static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        [DllImport("user32.dll")]
        internal static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WindowCompositionAttributeData data);

        [StructLayout(LayoutKind.Sequential)]
        internal struct WindowCompositionAttributeData
        {
            public int Attribute;
            public IntPtr Data;
            public int SizeOfData;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct AccentPolicy
        {
            public int AccentState;
            public int AccentFlags;
            public uint GradientColor;
            public int AnimationId;
        }

        private void EnablePureBlurBehind()
        {
            try
            {
                IntPtr hwnd = new WindowInteropHelper(this).Handle;
                if (hwnd == IntPtr.Zero) return;

                int cornerPref = 2;
                DwmSetWindowAttribute(hwnd, 33, ref cornerPref, sizeof(int));

                int borderNone = unchecked((int)0xFFFFFFFE);
                DwmSetWindowAttribute(hwnd, 34, ref borderNone, sizeof(int));

                var accent = new AccentPolicy
                {
                    AccentState = 3,
                    AccentFlags = 0,
                    GradientColor = 0
                };

                int size = Marshal.SizeOf(accent);
                IntPtr ptr = Marshal.AllocHGlobal(size);
                Marshal.StructureToPtr(accent, ptr, false);
                var data = new WindowCompositionAttributeData { Attribute = 19, SizeOfData = size, Data = ptr };
                SetWindowCompositionAttribute(hwnd, ref data);
                Marshal.FreeHGlobal(ptr);
            }
            catch { }
        }

        private readonly List<(string Name, string Hex)> _accentSwatches = new()
        {
            ("Blue",    "#2E8BFF"),
            ("Emerald", "#1FD17B"),
            ("Amber",   "#F5C426"),
            ("Orange",  "#FF7A1A"),
            ("Crimson", "#F03A47"),
            ("Magenta", "#D63AF9"),
            ("Violet",  "#7C4DFF"),
            ("Cyan",    "#18E0F5"),
            ("Coral",   "#F26B5B")
        };

        private readonly MoodleService _moodle = new();
        private AppConfig _config = new();
        private bool _isLoadingConfig = true;
        private bool _isDraggingColorWheel = false;
        private bool _isSidebarOpen = true;
        private bool _isTopBarOpen = true;
        private readonly Dictionary<string, string> _sessionCourseTitles = new(StringComparer.OrdinalIgnoreCase);

        // Cheat Code & Music Player State
        private string _cheatKeyBuffer = "";
        private readonly MediaPlayer _mediaPlayer = new();
        private readonly DispatcherTimer _musicTimer = new() { Interval = TimeSpan.FromMilliseconds(250) };
        private bool _isDraggingMusicSeek = false;
        private bool _isMusicPlaying = false;
        private int _currentTrackIndex = -1;

        public ObservableCollection<SelectableCourseItem> PastQuestionItems { get; } = new();
        public ObservableCollection<SelectableCourseItem> CourseNoteItems { get; } = new();
        public ObservableCollection<MusicTrackItem> MusicPlaylist { get; } = new();

        public MainWindow()
        {
            InitializeComponent();

            lstPastQuestions.ItemsSource = PastQuestionItems;
            lstCourseNotes.ItemsSource = CourseNoteItems;
            lstMusicTracks.ItemsSource = MusicPlaylist;

            var initMgr = new UpdateManager(new GithubSource(GITHUB_REPO_URL, null, false));
            string ver = initMgr.IsInstalled && initMgr.CurrentVersion != null
                ? initMgr.CurrentVersion.ToString()
                : (Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.5.0");
            lblAppVersion.Text = $"Version {ver} (win-x64)  •  Official Release";

            this.SourceInitialized += (_, _) =>
            {
                EnablePureBlurBehind();
                ApplyThemeSettings(showToast: false);
            };

            this.Loaded += async (_, _) => await CheckForUpdatesOnGitHubAsync(silentCheck: true);

            InitializeMusicPlayer();
            PopulateYearDropdowns();
            PopulateSystemFonts();
            RenderColorWheelBitmap();
            BuildAccentSwatchControls();
            LoadConfiguration();
            SetActiveNav(btnNavPQ);
        }

        // ====================================================================
        // CHEAT CODE ("ATOR") & MUSIC PLAYER ENGINE
        // ====================================================================
        private void InitializeMusicPlayer()
        {
            _mediaPlayer.Volume = 0.75;
            _mediaPlayer.MediaEnded += (_, _) =>
            {
                if (tglMusicLoop.IsChecked == true && _currentTrackIndex >= 0)
                {
                    _mediaPlayer.Position = TimeSpan.Zero;
                    _mediaPlayer.Play();
                }
                else
                {
                    BtnMusicNext_Click(null, null);
                }
            };

            _musicTimer.Tick += (_, _) =>
            {
                if (!_isDraggingMusicSeek && _mediaPlayer.Source != null && _mediaPlayer.NaturalDuration.HasTimeSpan)
                {
                    var total = _mediaPlayer.NaturalDuration.TimeSpan;
                    var pos = _mediaPlayer.Position;
                    sldMusicSeek.Maximum = Math.Max(1, total.TotalSeconds);
                    sldMusicSeek.Value = pos.TotalSeconds;
                    lblMusicTime.Text = $"{pos:mm\\:ss} / {total:mm\\:ss}";
                }
            };

            // Automatically load bundled secret.mp3 if present
            string bundledMp3 = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "secret.mp3");
            if (File.Exists(bundledMp3))
            {
                MusicPlaylist.Add(new MusicTrackItem
                {
                    Title = "🔥 Team Ator Anthem (secret.mp3)",
                    FilePath = bundledMp3
                });
            }
        }

        private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            // Ignore keystrokes when typing inside a TextBox or PasswordBox
            if (Keyboard.FocusedElement is TextBox || Keyboard.FocusedElement is PasswordBox)
                return;

            if (e.Key >= Key.A && e.Key <= Key.Z)
            {
                char c = (char)('A' + (e.Key - Key.A));
                _cheatKeyBuffer += c;
                if (_cheatKeyBuffer.Length > 16)
                    _cheatKeyBuffer = _cheatKeyBuffer.Substring(_cheatKeyBuffer.Length - 16);

                if (_cheatKeyBuffer.EndsWith("ATOR", StringComparison.OrdinalIgnoreCase))
                {
                    _cheatKeyBuffer = "";
                    ActivateAtorCheatCode();
                }
            }
        }

        private void ActivateAtorCheatCode()
        {
            _config.Settings.IsMusicUnlocked = true;
            SaveConfiguration();

            btnNavMusic.Visibility = Visibility.Visible;
            BtnNavMusic_Click(null, null);

            ShowToastMessage("🔥 Cheat [ATOR] Activated: Music Deck Unlocked!");
            Log("CHEAT CODE [ATOR] ACTIVATED! Secret Music Player unlocked.");

            // Auto-play secret.mp3 or first track in playlist
            if (MusicPlaylist.Count > 0)
            {
                PlayTrackAtIndex(0);
            }
        }

        private void PlayTrackAtIndex(int index)
        {
            if (index < 0 || index >= MusicPlaylist.Count) return;
            var track = MusicPlaylist[index];
            if (!File.Exists(track.FilePath))
            {
                Log($"Audio file not found: {track.FilePath}");
                return;
            }

            try
            {
                _currentTrackIndex = index;
                lstMusicTracks.SelectedIndex = index;
                _mediaPlayer.Open(new Uri(track.FilePath));
                _mediaPlayer.Volume = sldMusicVolume.Value;
                _mediaPlayer.Play();
                _isMusicPlaying = true;
                _musicTimer.Start();

                lblNowPlaying.Text = track.Title;
                btnMusicPlayPause.Content = "⏸ Pause";
            }
            catch (Exception ex)
            {
                Log($"Audio playback error: {ex.Message}");
            }
        }

        private void BtnMusicPlayPause_Click(object sender, RoutedEventArgs e)
        {
            if (_currentTrackIndex < 0 && MusicPlaylist.Count > 0)
            {
                PlayTrackAtIndex(0);
                return;
            }

            if (_mediaPlayer.Source == null) return;

            if (_isMusicPlaying)
            {
                _mediaPlayer.Pause();
                _isMusicPlaying = false;
                btnMusicPlayPause.Content = "▶ Play";
            }
            else
            {
                _mediaPlayer.Play();
                _isMusicPlaying = true;
                btnMusicPlayPause.Content = "⏸ Pause";
            }
        }

        private void BtnMusicPrev_Click(object sender, RoutedEventArgs e)
        {
            if (MusicPlaylist.Count == 0) return;
            int prev = _currentTrackIndex <= 0 ? MusicPlaylist.Count - 1 : _currentTrackIndex - 1;
            PlayTrackAtIndex(prev);
        }

        private void BtnMusicNext_Click(object sender, RoutedEventArgs e)
        {
            if (MusicPlaylist.Count == 0) return;
            int next = (_currentTrackIndex + 1) % MusicPlaylist.Count;
            PlayTrackAtIndex(next);
        }

        private void SldMusicSeek_MouseDown(object sender, MouseButtonEventArgs e) => _isDraggingMusicSeek = true;

        private void SldMusicSeek_MouseUp(object sender, MouseButtonEventArgs e)
        {
            _isDraggingMusicSeek = false;
            if (_mediaPlayer.Source != null && _mediaPlayer.NaturalDuration.HasTimeSpan)
            {
                _mediaPlayer.Position = TimeSpan.FromSeconds(sldMusicSeek.Value);
            }
        }

        private void SldMusicVolume_Changed(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (_mediaPlayer != null)
                _mediaPlayer.Volume = sldMusicVolume.Value;
        }

        private void LstMusicTracks_DoubleClick(object sender, MouseButtonEventArgs e)
        {
            if (lstMusicTracks.SelectedIndex >= 0)
                PlayTrackAtIndex(lstMusicTracks.SelectedIndex);
        }

        private void BtnMusicAddTracks_Click(object sender, RoutedEventArgs e)
        {
            var dlg = new OpenFileDialog
            {
                Title = "Add Audio Files to Team Ator Deck",
                Filter = "Audio Files (*.mp3;*.wav;*.flac;*.m4a)|*.mp3;*.wav;*.flac;*.m4a",
                Multiselect = true
            };

            if (dlg.ShowDialog() == true)
            {
                foreach (string file in dlg.FileNames)
                {
                    MusicPlaylist.Add(new MusicTrackItem
                    {
                        Title = System.IO.Path.GetFileNameWithoutExtension(file),
                        FilePath = file
                    });
                }
                if (_currentTrackIndex < 0 && MusicPlaylist.Count > 0)
                    PlayTrackAtIndex(0);
            }
        }

        private void BtnPlayBundledSecret_Click(object sender, RoutedEventArgs e)
        {
            string bundledMp3 = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "secret.mp3");
            if (!File.Exists(bundledMp3))
            {
                MessageBox.Show("Place a file named 'secret.mp3' in your project folder before building to bundle your signature track!", "secret.mp3 Not Found", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            var existing = MusicPlaylist.FirstOrDefault(t => string.Equals(t.FilePath, bundledMp3, StringComparison.OrdinalIgnoreCase));
            if (existing == null)
            {
                MusicPlaylist.Insert(0, new MusicTrackItem { Title = "🔥 Team Ator Anthem (secret.mp3)", FilePath = bundledMp3 });
            }
            PlayTrackAtIndex(0);
        }

        // ====================================================================
        // UNINSTALLER & FIRST-RUN TERMS GATE
        // ====================================================================
        private void BtnUninstall_Click(object sender, RoutedEventArgs e)
        {
            var ask = MessageBox.Show(
                "Are you sure you want to completely uninstall Team Ator's Student Helper from your PC?",
                "Uninstall Team Ator's Student Helper",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);

            if (ask != MessageBoxResult.Yes) return;

            string updateExe = System.IO.Path.GetFullPath(System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "Update.exe"));
            if (File.Exists(updateExe))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = updateExe,
                    Arguments = "--uninstall",
                    UseShellExecute = true
                });
                Application.Current.Shutdown();
            }
            else
            {
                MessageBox.Show("Uninstaller is only active when installed via Setup.exe (you can also uninstall anytime from Windows Settings -> Installed Apps).", "Portable Mode", MessageBoxButton.OK, MessageBoxImage.Information);
            }
        }

        private void ChkAcceptTerms_Changed(object sender, RoutedEventArgs e)
        {
            if (btnContinueTerms != null)
                btnContinueTerms.IsEnabled = chkAcceptTerms.IsChecked == true;
        }

        private void BtnAcceptTerms_Click(object sender, RoutedEventArgs e)
        {
            _config.Settings.HasAcceptedTerms = true;
            SaveConfiguration();
            overlayTermsGate.Visibility = Visibility.Collapsed;
        }

        private void BtnDeclineTerms_Click(object sender, RoutedEventArgs e)
        {
            Application.Current.Shutdown();
        }

        // ====================================================================
        // GITHUB AUTO-UPDATER
        // ====================================================================
        private async void BtnCheckUpdates_Click(object sender, RoutedEventArgs e)
        {
            await CheckForUpdatesOnGitHubAsync(silentCheck: false);
        }

        private async Task CheckForUpdatesOnGitHubAsync(bool silentCheck)
        {
            try
            {
                btnCheckUpdates.IsEnabled = false;
                lblUpdateStatus.Text = "Checking GitHub...";

                var mgr = new UpdateManager(new GithubSource(GITHUB_REPO_URL, null, false));
                if (!mgr.IsInstalled)
                {
                    lblUpdateStatus.Text = "Dev / Portable Mode";
                    if (!silentCheck)
                        Log("Updater note: App is running from portable folder. Run Setup.exe to test auto-updates.");
                    btnCheckUpdates.IsEnabled = true;
                    return;
                }

                if (!silentCheck)
                    Log($"Checking {GITHUB_REPO_URL} (Current Velopack Version: v{mgr.CurrentVersion})...");

                var newVersion = await mgr.CheckForUpdatesAsync();
                if (newVersion == null)
                {
                    lblUpdateStatus.Text = "Up to date ✓";
                    if (!silentCheck)
                        Log($"No newer release found on GitHub (Installed: v{mgr.CurrentVersion}).");
                    btnCheckUpdates.IsEnabled = true;
                    return;
                }

                string targetVer = newVersion.TargetFullRelease.Version.ToString();
                lblUpdateStatus.Text = $"Downloading v{targetVer}...";
                Log($"Update found! Installed: v{mgr.CurrentVersion} -> New on GitHub: v{targetVer}. Downloading...");

                await mgr.DownloadUpdatesAsync(newVersion, progress =>
                {
                    Dispatcher.Invoke(() => lblUpdateStatus.Text = $"Downloading v{targetVer} ({progress}%)...");
                });

                lblUpdateStatus.Text = $"v{targetVer} Ready!";
                var ask = MessageBox.Show(
                    $"Version {targetVer} of Team Ator's Student Helper has been downloaded.\n\nRestart now to apply the update?",
                    "Update Ready — Team Ator's Student Helper",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Information);

                if (ask == MessageBoxResult.Yes)
                {
                    mgr.ApplyUpdatesAndRestart(newVersion);
                }
            }
            catch (Exception ex)
            {
                lblUpdateStatus.Text = "Update check failed";
                if (!silentCheck) Log($"Update check error: {ex.Message}");
            }
            finally
            {
                btnCheckUpdates.IsEnabled = true;
            }
        }

        // ====================================================================
        // TYPOGRAPHY & THEMES
        // ====================================================================
        private void PopulateSystemFonts()
        {
            cmbFontFamily.Items.Clear();
            var priorityFonts = new[] { "Cascadia Code", "Segoe UI Variable Display", "Inter", "Bahnschrift", "Consolas", "Arial" };
            var allFonts = Fonts.SystemFontFamilies.Select(f => f.Source).OrderBy(n => n).ToList();

            foreach (var pf in priorityFonts)
                cmbFontFamily.Items.Add(pf);

            foreach (var sysFont in allFonts)
            {
                if (!priorityFonts.Contains(sysFont, StringComparer.OrdinalIgnoreCase))
                    cmbFontFamily.Items.Add(sysFont);
            }
        }

        private void BtnImportFont_Click(object sender, RoutedEventArgs e)
        {
            var dialog = new OpenFileDialog
            {
                Title = "Import Font File (.ttf, .otf)",
                Filter = "Font Files (*.ttf;*.otf)|*.ttf;*.otf"
            };

            if (dialog.ShowDialog() == true)
            {
                LoadCustomFontFromFile(dialog.FileName, applyImmediately: true);
            }
        }

        private void LoadCustomFontFromFile(string filePath, bool applyImmediately)
        {
            if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath)) return;

            try
            {
                var families = Fonts.GetFontFamilies(filePath);
                var firstFamily = families.FirstOrDefault();
                if (firstFamily == null) return;

                string familyName = firstFamily.Source.Split('#').LastOrDefault()?.Trim();
                if (string.IsNullOrEmpty(familyName))
                    familyName = System.IO.Path.GetFileNameWithoutExtension(filePath);

                string dirUri = new Uri(System.IO.Path.GetDirectoryName(filePath) + System.IO.Path.DirectorySeparatorChar).AbsoluteUri;
                var customFont = new FontFamily(new Uri(dirUri), $"./#{familyName}");

                string displayTag = $"[Custom] {familyName}";
                if (!cmbFontFamily.Items.Contains(displayTag))
                    cmbFontFamily.Items.Insert(0, displayTag);

                _config.Settings.CustomFontFilePath = filePath;
                _config.Settings.FontName = displayTag;

                _isLoadingConfig = true;
                cmbFontFamily.SelectedItem = displayTag;
                _isLoadingConfig = false;

                this.FontFamily = customFont;
                txtLog.FontFamily = customFont;

                if (applyImmediately)
                {
                    ApplyThemeSettings(showToast: true);
                    SaveConfiguration();
                    Log($"Imported custom font: {familyName}");
                }
            }
            catch (Exception ex)
            {
                Log($"Failed to load font file: {ex.Message}");
            }
        }

        private void CmbFontFamily_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_isLoadingConfig || cmbFontFamily?.SelectedItem == null) return;
            string selected = cmbFontFamily.SelectedItem.ToString();
            _config.Settings.FontName = selected;

            if (!selected.StartsWith("[Custom]"))
                _config.Settings.CustomFontFilePath = "";

            ApplyThemeSettings(showToast: true);
            SaveConfiguration();
        }

        private void TypographySlider_Changed(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (_isLoadingConfig) return;
            _config.Settings.FontSize = sldFontSize.Value;
            _config.Settings.LineSpacing = sldLineSpacing.Value;
            _config.Settings.CharacterSpacing = sldCharSpacing.Value;
            ApplyThemeSettings(showToast: false);
            SaveConfiguration();
        }

        private void CharStyle_Changed(object sender, RoutedEventArgs e)
        {
            if (_isLoadingConfig) return;
            _config.Settings.IsBold = tglBold.IsChecked == true;
            _config.Settings.IsItalic = tglItalic.IsChecked == true;
            ApplyThemeSettings(showToast: true);
            SaveConfiguration();
        }

        private void BtnResetTypography_Click(object sender, RoutedEventArgs e)
        {
            _isLoadingConfig = true;
            _config.Settings.FontName = "Cascadia Code";
            _config.Settings.CustomFontFilePath = "";
            _config.Settings.FontSize = 13.5;
            _config.Settings.LineSpacing = 6.0;
            _config.Settings.CharacterSpacing = 0.0;
            _config.Settings.IsBold = false;
            _config.Settings.IsItalic = false;

            cmbFontFamily.SelectedItem = "Cascadia Code";
            sldFontSize.Value = 13.5;
            sldLineSpacing.Value = 6.0;
            sldCharSpacing.Value = 0.0;
            tglBold.IsChecked = false;
            tglItalic.IsChecked = false;
            _isLoadingConfig = false;

            ApplyThemeSettings(showToast: true);
            SaveConfiguration();
        }

        private void BtnHamburger_Click(object sender, RoutedEventArgs e)
        {
            _isSidebarOpen = !_isSidebarOpen;
            if (_isSidebarOpen)
            {
                SidebarColumn.Width = new GridLength(280);
                CardSidebar.Visibility = Visibility.Visible;
                AnimateViewEntrance(CardSidebar, new TranslateTransform());
            }
            else
            {
                CardSidebar.Visibility = Visibility.Collapsed;
                SidebarColumn.Width = new GridLength(0);
            }
        }

        private void BtnToggleTopBar_Click(object sender, RoutedEventArgs e)
        {
            _isTopBarOpen = !_isTopBarOpen;
            CardTopBar.Visibility = _isTopBarOpen ? Visibility.Visible : Visibility.Collapsed;
            btnToggleTopBar.Content = _isTopBarOpen ? "Account & Paths ▲" : "Account & Paths ▼";
        }

        private void RenderColorWheelBitmap()
        {
            const int size = 148;
            double radius = size / 2.0;
            var bmp = new WriteableBitmap(size, size, 96, 96, PixelFormats.Bgra32, null);
            byte[] pixels = new byte[size * size * 4];

            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    double dx = x - radius;
                    double dy = y - radius;
                    double dist = Math.Sqrt(dx * dx + dy * dy);
                    int idx = (y * size + x) * 4;

                    if (dist <= radius)
                    {
                        double sat = Math.Clamp(dist / radius, 0, 1);
                        double angle = Math.Atan2(dy, dx) * 180.0 / Math.PI;
                        if (angle < 0) angle += 360.0;

                        Color c = HsvToRgb(angle, sat, 1.0);
                        byte alpha = dist > radius - 1.5 ? (byte)Math.Clamp((radius - dist) / 1.5 * 255, 0, 255) : (byte)255;

                        pixels[idx] = c.B;
                        pixels[idx + 1] = c.G;
                        pixels[idx + 2] = c.R;
                        pixels[idx + 3] = alpha;
                    }
                }
            }
            bmp.WritePixels(new Int32Rect(0, 0, size, size), pixels, size * 4, 0);
            imgColorWheel.Source = bmp;
        }

        private static Color HsvToRgb(double h, double s, double v)
        {
            double c = v * s;
            double x = c * (1 - Math.Abs((h / 60.0) % 2 - 1));
            double m = v - c;
            double r = 0, g = 0, b = 0;

            if (h < 60) { r = c; g = x; }
            else if (h < 120) { r = x; g = c; }
            else if (h < 180) { g = c; b = x; }
            else if (h < 240) { g = x; b = c; }
            else if (h < 300) { r = x; b = c; }
            else { r = c; b = x; }

            return Color.FromRgb((byte)Math.Round((r + m) * 255), (byte)Math.Round((g + m) * 255), (byte)Math.Round((b + m) * 255));
        }

        private void ColorWheel_MouseDown(object sender, MouseButtonEventArgs e)
        {
            _isDraggingColorWheel = true;
            imgColorWheel.CaptureMouse();
            PickColorFromWheelPoint(e.GetPosition(imgColorWheel));
        }

        private void ColorWheel_MouseMove(object sender, MouseEventArgs e)
        {
            if (_isDraggingColorWheel && e.LeftButton == MouseButtonState.Pressed)
                PickColorFromWheelPoint(e.GetPosition(imgColorWheel));
        }

        private void ColorWheel_MouseUp(object sender, MouseButtonEventArgs e)
        {
            if (_isDraggingColorWheel)
            {
                _isDraggingColorWheel = false;
                imgColorWheel.ReleaseMouseCapture();
                SaveConfiguration();
            }
        }

        private void PickColorFromWheelPoint(Point pt)
        {
            double radius = imgColorWheel.Width / 2.0;
            double dx = pt.X - radius;
            double dy = pt.Y - radius;
            double dist = Math.Sqrt(dx * dx + dy * dy);

            if (dist > radius) { dx = dx / dist * radius; dy = dy / dist * radius; dist = radius; }

            Canvas.SetLeft(thumbColorWheel, radius + dx - (thumbColorWheel.Width / 2));
            Canvas.SetTop(thumbColorWheel, radius + dy - (thumbColorWheel.Height / 2));

            double sat = Math.Clamp(dist / radius, 0, 1);
            double angle = Math.Atan2(dy, dx) * 180.0 / Math.PI;
            if (angle < 0) angle += 360.0;

            Color picked = HsvToRgb(angle, sat, 1.0);
            string hex = $"#{picked.R:X2}{picked.G:X2}{picked.B:X2}";

            _config.Settings.AccentName = "Custom";
            _config.Settings.CustomAccentHex = hex;
            ApplyThemeSettings(showToast: true);
        }

        private void BuildAccentSwatchControls()
        {
            if (pnlSwatches == null) return;
            pnlSwatches.Children.Clear();
            string currentAccent = _config?.Settings?.AccentName ?? "Cyan";

            foreach (var (name, hex) in _accentSwatches)
            {
                Color c = (Color)ColorConverter.ConvertFromString(hex);
                bool isSelected = name.Equals(currentAccent, StringComparison.OrdinalIgnoreCase);

                var stack = new StackPanel { Width = 46, Margin = new Thickness(0, 0, 5, 0), Cursor = Cursors.Hand, Tag = name };
                stack.MouseLeftButtonDown += Swatch_Clicked;

                var ring = new Border
                {
                    Width = 36,
                    Height = 36,
                    CornerRadius = new CornerRadius(18),
                    BorderThickness = new Thickness(isSelected ? 2.4 : 1.0),
                    BorderBrush = isSelected ? Brushes.White : new SolidColorBrush(Color.FromArgb(90, c.R, c.G, c.B)),
                    Padding = new Thickness(3),
                    Effect = new DropShadowEffect { Color = c, BlurRadius = isSelected ? 18 : 10, ShadowDepth = 0, Opacity = isSelected ? 0.85 : 0.45 },
                    Child = new Ellipse { Fill = new SolidColorBrush(c) }
                };
                stack.Children.Add(ring);
                stack.Children.Add(new TextBlock { Text = isSelected ? name : "", FontSize = 11, Foreground = (Brush)Resources["TextMutedBrush"], HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 4, 0, 0) });
                pnlSwatches.Children.Add(stack);
            }
        }

        private void Swatch_Clicked(object sender, MouseButtonEventArgs e)
        {
            if (sender is StackPanel sp && sp.Tag is string accentName)
            {
                _config.Settings.AccentName = accentName;
                var match = _accentSwatches.FirstOrDefault(s => s.Name.Equals(accentName, StringComparison.OrdinalIgnoreCase));
                if (!string.IsNullOrEmpty(match.Hex)) _config.Settings.CustomAccentHex = match.Hex;
                ApplyThemeSettings(showToast: true);
                SaveConfiguration();
            }
        }

        private void SetThemeColor(string colorKey, Color newColor)
        {
            Resources[colorKey] = newColor;
        }

        private void ApplyThemeSettings(bool showToast)
        {
            if (OuterWindowBorder == null) return;

            string hex = _config.Settings.CustomAccentHex;
            if (!string.Equals(_config.Settings.AccentName, "Custom", StringComparison.OrdinalIgnoreCase))
            {
                var match = _accentSwatches.FirstOrDefault(s => s.Name.Equals(_config.Settings.AccentName, StringComparison.OrdinalIgnoreCase));
                hex = string.IsNullOrEmpty(match.Hex) ? "#18E0F5" : match.Hex;
            }
            if (string.IsNullOrWhiteSpace(hex)) hex = "#18E0F5";

            Color tc = (Color)ColorConverter.ConvertFromString(hex);

            SetThemeColor("ThemeAccentColor", tc);
            SetThemeColor("ThemeAccentGlowColor", Color.FromArgb(75, tc.R, tc.G, tc.B));
            SetThemeColor("ButtonGlassColor", Color.FromArgb(40, tc.R, tc.G, tc.B));
            SetThemeColor("OuterShellColor", Color.FromArgb(10, (byte)(tc.R * 0.42 + 10), (byte)(tc.G * 0.42 + 12), (byte)(tc.B * 0.42 + 18)));
            SetThemeColor("SidebarGlassColor", Color.FromArgb(14, (byte)(tc.R * 0.28 + 14), (byte)(tc.G * 0.28 + 16), (byte)(tc.B * 0.28 + 24)));
            SetThemeColor("SurfaceCardColor", Color.FromArgb(14, (byte)(tc.R * 0.34 + 18), (byte)(tc.G * 0.34 + 20), (byte)(tc.B * 0.34 + 28)));
            SetThemeColor("SubtleBorderColor", Color.FromArgb(90, (byte)((tc.R + 220) / 2), (byte)((tc.G + 220) / 2), (byte)((tc.B + 220) / 2)));

            if (lblCustomHex != null) lblCustomHex.Text = hex.ToUpperInvariant();

            BuildAccentSwatchControls();
            Button activeTab = viewAbout.Visibility == Visibility.Visible ? btnNavAbout :
                               (viewMusicPlayer.Visibility == Visibility.Visible ? btnNavMusic :
                               (viewThemes.Visibility == Visibility.Visible ? btnNavThemes :
                               (viewCourseNotes.Visibility == Visibility.Visible ? btnNavNotes : btnNavPQ)));
            SetActiveNav(activeTab);

            string fontName = string.IsNullOrWhiteSpace(_config.Settings.FontName) ? "Cascadia Code" : _config.Settings.FontName;
            if (fontName.StartsWith("[Custom]") && !string.IsNullOrWhiteSpace(_config.Settings.CustomFontFilePath) && File.Exists(_config.Settings.CustomFontFilePath))
            {
                LoadCustomFontFromFile(_config.Settings.CustomFontFilePath, applyImmediately: false);
            }
            else
            {
                var fam = new FontFamily($"{fontName}, Segoe UI");
                this.FontFamily = fam;
                txtLog.FontFamily = fam;
            }

            double fSize = Math.Clamp(_config.Settings.FontSize > 0 ? _config.Settings.FontSize : 13.5, 10, 18);
            this.FontSize = fSize;
            if (lblFontSizeVal != null) lblFontSizeVal.Text = $"{fSize:0.#} px";

            this.FontWeight = _config.Settings.IsBold ? FontWeights.Bold : FontWeights.Normal;
            this.FontStyle = _config.Settings.IsItalic ? FontStyles.Italic : FontStyles.Normal;

            double leading = Math.Clamp(_config.Settings.LineSpacing, 2, 18);
            if (lblLeadingVal != null) lblLeadingVal.Text = $"{leading:0} px";

            var itemStyle = new Style(typeof(ListBoxItem));
            itemStyle.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(8, leading / 2.0, 8, leading / 2.0)));
            itemStyle.Setters.Add(new Setter(Control.BackgroundProperty, Brushes.Transparent));
            itemStyle.Setters.Add(new Setter(FrameworkElement.FocusVisualStyleProperty, null));
            lstPastQuestions.ItemContainerStyle = itemStyle;
            lstCourseNotes.ItemContainerStyle = itemStyle;

            int charSpace = (int)Math.Clamp(Math.Round(_config.Settings.CharacterSpacing), 0, 5);
            if (lblTrackingVal != null) lblTrackingVal.Text = charSpace == 0 ? "0 (Normal)" : $"+{charSpace}";

            lblAppTitle.Text = TextHelpers.ApplyTracking("Team Ator's Student Helper", charSpace);
            lblHdrWorkspace.Text = TextHelpers.ApplyTracking("WORKSPACE", charSpace);
            lblHdrSelection.Text = TextHelpers.ApplyTracking("SELECTION", charSpace);
            lblThemesHeading.Text = TextHelpers.ApplyTracking("Themes & Character", charSpace);
            lblMusicHeading.Text = TextHelpers.ApplyTracking("Team Ator Secret Deck", charSpace);
            lblAboutHeading.Text = TextHelpers.ApplyTracking("Team Ator's Student Helper", charSpace);
            lblCharSection.Text = TextHelpers.ApplyTracking("CHARACTER & TYPOGRAPHY", charSpace);
            btnNavPQ.Content = "📄  " + TextHelpers.ApplyTracking("Past Questions", charSpace);
            btnNavNotes.Content = "📚  " + TextHelpers.ApplyTracking("Course Notes & Slides", charSpace);
            btnNavThemes.Content = "🎨  " + TextHelpers.ApplyTracking("Themes", charSpace);
            btnNavMusic.Content = "🎵  " + TextHelpers.ApplyTracking("Music Player", charSpace);
            btnNavAbout.Content = "ℹ️  " + TextHelpers.ApplyTracking("About", charSpace);

            foreach (var item in PastQuestionItems)
                item.DisplayText = TextHelpers.ApplyTracking(item.RawText, charSpace);
            foreach (var item in CourseNoteItems)
                item.DisplayText = TextHelpers.ApplyTracking(item.RawText, charSpace);

            if (showToast) ShowToastMessage("Theme updated");
        }

        private void ShowToastMessage(string message)
        {
            if (toastThemeUpdated == null || lblToastText == null) return;
            lblToastText.Text = message;
            var anim = new DoubleAnimationUsingKeyFrames();
            anim.KeyFrames.Add(new LinearDoubleKeyFrame(1.0, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(140))));
            anim.KeyFrames.Add(new LinearDoubleKeyFrame(1.0, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(1600))));
            anim.KeyFrames.Add(new LinearDoubleKeyFrame(0.0, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(2000))));
            toastThemeUpdated.BeginAnimation(OpacityProperty, anim);
        }

        private void AnimateViewEntrance(UIElement view, TranslateTransform transform)
        {
            if (view == null || transform == null) return;
            view.Opacity = 0;
            transform.Y = 12;
            var fade = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(220)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
            var slide = new DoubleAnimation(12, 0, TimeSpan.FromMilliseconds(240)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
            view.BeginAnimation(OpacityProperty, fade);
            transform.BeginAnimation(TranslateTransform.YProperty, slide);
        }

        private void PopulateYearDropdowns()
        {
            cmbYearFrom.Items.Add("All Years"); cmbYearTo.Items.Add("All Years");
            for (int y = 2015; y <= 2026; y++) { cmbYearFrom.Items.Add(y.ToString()); cmbYearTo.Items.Add(y.ToString()); }
            cmbYearFrom.SelectedIndex = 0; cmbYearTo.SelectedIndex = 0;
        }

        private void YearRange_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (cmbYearFrom == null || cmbYearTo == null) return;
            if (cmbYearFrom.SelectedIndex == 0) { cmbYearTo.SelectedIndex = 0; cmbYearTo.IsEnabled = false; }
            else { cmbYearTo.IsEnabled = true; if (cmbYearTo.SelectedIndex < cmbYearFrom.SelectedIndex) cmbYearTo.SelectedIndex = cmbYearFrom.SelectedIndex; }
        }

        private string GetSelectedYearRangeString()
        {
            if (cmbYearFrom.SelectedIndex <= 0) return "all";
            string fromYear = cmbYearFrom.SelectedItem.ToString();
            string toYear = cmbYearTo.SelectedIndex > 0 ? cmbYearTo.SelectedItem.ToString() : fromYear;
            if (int.TryParse(fromYear, out int f) && int.TryParse(toYear, out int t) && t < f) (fromYear, toYear) = (toYear, fromYear);
            return fromYear == toYear ? fromYear : $"{fromYear}-{toYear}";
        }

        private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (e.LeftButton == MouseButtonState.Pressed)
                DragMove();
        }

        private void BtnMinimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
        private void BtnMaximize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
        private void BtnClose_Click(object sender, RoutedEventArgs e) => Close();

        private void Log(string message)
        {
            if (txtLog == null) return;
            Dispatcher.Invoke(() => { txtLog.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}"); txtLog.ScrollToEnd(); });
        }

        private void LoadConfiguration()
        {
            _isLoadingConfig = true;
            _config = ConfigManager.Load();

            txtSavePath.Text = string.IsNullOrWhiteSpace(_config.Settings.DownloadPath) ? System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "UPSA_Downloads") : _config.Settings.DownloadPath;
            txtUsername.Text = _config.Settings.LastUsername ?? "";
            txtPassword.Password = _config.Settings.LastPassword ?? "";
            txtMasterFolderName.Text = string.IsNullOrWhiteSpace(_config.Settings.MasterFolderName) ? "Past_Questions" : _config.Settings.MasterFolderName;

            sldFontSize.Value = _config.Settings.FontSize > 0 ? _config.Settings.FontSize : 13.5;
            sldLineSpacing.Value = _config.Settings.LineSpacing >= 2 ? _config.Settings.LineSpacing : 6.0;
            sldCharSpacing.Value = Math.Clamp(_config.Settings.CharacterSpacing, 0, 5);
            tglBold.IsChecked = _config.Settings.IsBold;
            tglItalic.IsChecked = _config.Settings.IsItalic;

            if (_config.Settings.IsMusicUnlocked)
                btnNavMusic.Visibility = Visibility.Visible;

            if (!_config.Settings.HasAcceptedTerms)
                overlayTermsGate.Visibility = Visibility.Visible;

            if (!string.IsNullOrWhiteSpace(_config.Settings.CustomFontFilePath) && File.Exists(_config.Settings.CustomFontFilePath))
            {
                LoadCustomFontFromFile(_config.Settings.CustomFontFilePath, applyImmediately: false);
            }
            else
            {
                string targetFont = string.IsNullOrWhiteSpace(_config.Settings.FontName) ? "Cascadia Code" : _config.Settings.FontName;
                cmbFontFamily.SelectedItem = cmbFontFamily.Items.Contains(targetFont) ? targetFont : "Cascadia Code";
            }

            PastQuestionItems.Clear(); CourseNoteItems.Clear();
            ApplyThemeSettings(showToast: false);
            _isLoadingConfig = false;
            Log("Ready. Click 'Log In & Sync' to load your current courses.");
        }

        private void SaveConfiguration()
        {
            if (_isLoadingConfig || txtSavePath == null) return;
            _config.Settings.DownloadPath = txtSavePath.Text.Trim();
            _config.Settings.LastUsername = txtUsername.Text.Trim();
            _config.Settings.LastPassword = txtPassword.Password;
            _config.Settings.MasterFolderName = string.IsNullOrWhiteSpace(txtMasterFolderName.Text) ? "Past_Questions" : txtMasterFolderName.Text.Trim();
            _config.Settings.GroupYearsInSubfolders = true;
            ConfigManager.Save(_config);
        }

        private void StyleSidebarTab(Button btn, bool active)
        {
            if (btn == null) return;
            btn.Background = active ? (Brush)Resources["ThemeAccentGlowBrush"] : Brushes.Transparent;
            btn.BorderBrush = active ? (Brush)Resources["ThemeAccentBrush"] : Brushes.Transparent;
            btn.Foreground = active ? (Brush)Resources["TextPrimaryBrush"] : (Brush)Resources["TextMutedBrush"];
            btn.FontWeight = active ? FontWeights.SemiBold : FontWeights.Medium;
        }

        private void SetActiveNav(Button activeBtn)
        {
            StyleSidebarTab(btnNavPQ, activeBtn == btnNavPQ);
            StyleSidebarTab(btnNavNotes, activeBtn == btnNavNotes);
            StyleSidebarTab(btnNavThemes, activeBtn == btnNavThemes);
            StyleSidebarTab(btnNavMusic, activeBtn == btnNavMusic);
            StyleSidebarTab(btnNavAbout, activeBtn == btnNavAbout);
        }

        private void HideAllViews()
        {
            viewPastQuestions.Visibility = Visibility.Collapsed;
            viewCourseNotes.Visibility = Visibility.Collapsed;
            viewThemes.Visibility = Visibility.Collapsed;
            viewMusicPlayer.Visibility = Visibility.Collapsed;
            viewAbout.Visibility = Visibility.Collapsed;
        }

        private void BtnNavPQ_Click(object sender, RoutedEventArgs e)
        {
            HideAllViews(); viewPastQuestions.Visibility = Visibility.Visible;
            SetActiveNav(btnNavPQ); AnimateViewEntrance(viewPastQuestions, transPQ);
        }

        private void BtnNavNotes_Click(object sender, RoutedEventArgs e)
        {
            HideAllViews(); viewCourseNotes.Visibility = Visibility.Visible;
            SetActiveNav(btnNavNotes); AnimateViewEntrance(viewCourseNotes, transNotes);
        }

        private void BtnNavThemes_Click(object sender, RoutedEventArgs e)
        {
            HideAllViews(); viewThemes.Visibility = Visibility.Visible;
            SetActiveNav(btnNavThemes); AnimateViewEntrance(viewThemes, transThemes);
        }

        private void BtnNavMusic_Click(object sender, RoutedEventArgs e)
        {
            HideAllViews(); viewMusicPlayer.Visibility = Visibility.Visible;
            SetActiveNav(btnNavMusic); AnimateViewEntrance(viewMusicPlayer, transMusic);
        }

        private void BtnNavAbout_Click(object sender, RoutedEventArgs e)
        {
            HideAllViews(); viewAbout.Visibility = Visibility.Visible;
            SetActiveNav(btnNavAbout); AnimateViewEntrance(viewAbout, transAbout);
        }

        private void BtnCheckAll_Click(object sender, RoutedEventArgs e)
        { var target = viewCourseNotes.Visibility == Visibility.Visible ? CourseNoteItems : PastQuestionItems; foreach (var item in target) item.IsSelected = true; }

        private void BtnUncheckAll_Click(object sender, RoutedEventArgs e)
        { var target = viewCourseNotes.Visibility == Visibility.Visible ? CourseNoteItems : PastQuestionItems; foreach (var item in target) item.IsSelected = false; }

        private void BtnRemoveUnchecked_Click(object sender, RoutedEventArgs e)
        {
            var target = viewCourseNotes.Visibility == Visibility.Visible ? CourseNoteItems : PastQuestionItems;
            for (int i = target.Count - 1; i >= 0; i--) { if (!target[i].IsSelected) target.RemoveAt(i); }
            Log("Removed unchecked courses from current session list.");
        }

        private void ConfigField_Changed(object sender, RoutedEventArgs e) => SaveConfiguration();
        private void PasswordField_Changed(object sender, RoutedEventArgs e) => SaveConfiguration();

        private void BtnBrowse_Click(object sender, RoutedEventArgs e)
        {
            var dialog = new OpenFolderDialog { Title = "Select Download Folder" };
            if (dialog.ShowDialog() == true) { txtSavePath.Text = dialog.FolderName; SaveConfiguration(); }
        }

        private async void BtnLogin_Click(object sender, RoutedEventArgs e)
        {
            string user = txtUsername.Text.Trim(); string pass = txtPassword.Password;
            if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(pass)) { MessageBox.Show("Please enter your Student ID and Password.", "Missing Credentials", MessageBoxButton.OK, MessageBoxImage.Warning); return; }

            btnLogin.IsEnabled = false; SaveConfiguration(); Log("Connecting to UPSA Virtual...");
            var (success, message) = await _moodle.LoginAsync(user, pass);
            Log(message);

            if (!success) { lblAuthStatus.Text = "● Login Failed"; lblAuthStatus.Foreground = new SolidColorBrush(Color.FromRgb(235, 135, 145)); btnLogin.IsEnabled = true; return; }

            lblAuthStatus.Text = "● Connected"; lblAuthStatus.Foreground = new SolidColorBrush(Color.FromRgb(118, 224, 162));
            Log("Syncing your enrolled courses...");
            PastQuestionItems.Clear(); CourseNoteItems.Clear(); _sessionCourseTitles.Clear();

            var enrolled = await _moodle.FetchEnrolledCoursesAsync();
            try
            {
                var (_, pqTitles) = await _moodle.ScanPastQuestionsRepositoryAsync();
                foreach (var kvp in pqTitles) _sessionCourseTitles[kvp.Key] = kvp.Value;
            }
            catch { }

            int charSpace = (int)Math.Clamp(Math.Round(_config.Settings.CharacterSpacing), 0, 5);
            foreach (var c in enrolled)
            {
                string title = !string.IsNullOrWhiteSpace(c.Title) ? c.Title : (_sessionCourseTitles.TryGetValue(c.Code, out string pqTitle) ? pqTitle : "");
                _sessionCourseTitles[c.Code] = title;
                string cleanDisplay = TextHelpers.FormatCourseFolderName(c.Code, title);
                string trackedDisplay = TextHelpers.ApplyTracking(cleanDisplay, charSpace);

                PastQuestionItems.Add(new SelectableCourseItem { Code = c.Code, RawText = cleanDisplay, DisplayText = trackedDisplay, IsSelected = true });
                if (!string.IsNullOrWhiteSpace(c.MoodleId))
                    CourseNoteItems.Add(new SelectableCourseItem { Code = c.Code, MoodleId = c.MoodleId, RawText = cleanDisplay, DisplayText = trackedDisplay, IsSelected = true });
            }

            Log($"Synced {PastQuestionItems.Count} enrolled courses for this session.");
            btnLogin.IsEnabled = true;
        }

        private static bool IsNullOrNullOrWhiteSpace(string value) => string.IsNullOrWhiteSpace(value);

        private async void BtnDownloadPQ_Click(object sender, RoutedEventArgs e)
        {
            if (!_moodle.IsLoggedIn) { MessageBox.Show("Please log in first!", "Not Logged In", MessageBoxButton.OK, MessageBoxImage.Information); return; }

            var selectedCodes = PastQuestionItems.Where(i => i.IsSelected && !string.IsNullOrEmpty(i.Code)).Select(i => i.Code).ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (selectedCodes.Count == 0) { MessageBox.Show("Check at least one course to download.", "No Courses Selected", MessageBoxButton.OK, MessageBoxImage.Warning); return; }

            Log("Scanning repository for matching Past Questions...");
            var (allEntries, discoveredTitles) = await _moodle.ScanPastQuestionsRepositoryAsync();
            foreach (var kvp in discoveredTitles) { if (!_sessionCourseTitles.ContainsKey(kvp.Key) || string.IsNullOrWhiteSpace(_sessionCourseTitles[kvp.Key])) _sessionCourseTitles[kvp.Key] = kvp.Value; }

            string masterFolder = string.IsNullOrWhiteSpace(txtMasterFolderName.Text) ? "Past_Questions" : txtMasterFolderName.Text.Trim();
            var targetYears = DownloadEngine.ParseYearInput(GetSelectedYearRangeString());

            var tasks = DownloadEngine.BuildPastQuestionTasks(allEntries, selectedCodes, _sessionCourseTitles, masterFolder, targetYears, cmbSemester.SelectedIndex, txtSavePath.Text.Trim(), groupYearsInSubfolders: true);
            await RunBatchAsync(tasks);
        }

        private async void BtnDownloadNotes_Click(object sender, RoutedEventArgs e)
        {
            if (!_moodle.IsLoggedIn) { MessageBox.Show("Please log in first!", "Not Logged In", MessageBoxButton.OK, MessageBoxImage.Information); return; }

            var allTasks = new List<DownloadTask>();

            // Separate Course Notes into their own master folder instead of Past_Questions
            string notesMasterFolder = "Course_Notes";

            foreach (var item in CourseNoteItems.Where(i => i.IsSelected))
            {
                _sessionCourseTitles.TryGetValue(item.Code, out string title);
                string folderLabel = TextHelpers.FormatCourseFolderName(item.Code, title);
                Log($"Scanning Course Notes for {folderLabel}...");
                try
                {
                    var tasks = await _moodle.ScanCourseNotesAsync(folderLabel, item.MoodleId, txtSavePath.Text.Trim(), notesMasterFolder);
                    allTasks.AddRange(tasks);
                }
                catch (Exception ex) { Log($"Failed to scan {folderLabel}: {ex.Message}"); }
            }
            await RunBatchAsync(allTasks);
        }

        private async Task RunBatchAsync(List<DownloadTask> tasks)
        {
            if (tasks.Count == 0) { Log("No matching files found for the checked courses."); return; }
            Log($"Queued {tasks.Count} file(s). Downloading into individual course folders...");
            progressBar.Minimum = 0; progressBar.Maximum = tasks.Count; progressBar.Value = 0;

            var result = await DownloadEngine.ExecuteBatchAsync(_moodle.Client, tasks, Log, (done, dl, sk, fl) =>
            {
                Dispatcher.Invoke(() => { progressBar.Value = Math.Min(done, progressBar.Maximum); lblProgressStatus.Text = $"Progress: {done}/{tasks.Count}  •  Downloaded: {dl}  •  Skipped: {sk}  •  Failed: {fl}"; });
            });
            Log($"Completed! Newly Downloaded: {result.Downloaded} | Skipped: {result.Skipped} | Failed: {result.Failed}");
        }
    }
}
