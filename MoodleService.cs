#nullable disable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web;
using System.IO;

namespace Student_Helper
{
    public class MoodleService
    {
        private const string BASE_SITE_URL = "https://join.upsavirtual.site";
        private const string LOGIN_URL = BASE_SITE_URL + "/login/index.php";
        private const string MY_COURSES_URL = BASE_SITE_URL + "/my/courses.php";
        private const string PAST_QUESTIONS_URL = BASE_SITE_URL + "/mod/folder/view.php?id=1669";
        private const string COURSE_VIEW_BASE_URL = BASE_SITE_URL + "/course/view.php?id=";

        private static readonly HashSet<string> GlobalIgnoreIds = new() { "12398", "11077" };

        public HttpClient Client { get; }
        public bool IsLoggedIn { get; private set; }
        private string _sesskey = "";

        public MoodleService()
        {
            var handler = new HttpClientHandler
            {
                CookieContainer = new CookieContainer(),
                AllowAutoRedirect = true,
                AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
            };
            Client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(40) };
            Client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
        }

        public async Task<(bool Success, string Message)> LoginAsync(string username, string password)
        {
            try
            {
                string loginPageHtml = await Client.GetStringAsync(LOGIN_URL);
                var tokenMatch = Regex.Match(loginPageHtml, @"name=[""']logintoken[""']\s+value=[""']([^""']+)[""']", RegexOptions.IgnoreCase);
                if (!tokenMatch.Success)
                    tokenMatch = Regex.Match(loginPageHtml, @"value=[""']([^""']+)[""']\s+name=[""']logintoken[""']", RegexOptions.IgnoreCase);

                if (!tokenMatch.Success)
                    return (false, "Could not find login token on UPSA Virtual.");

                var formContent = new FormUrlEncodedContent(new[]
                {
                    new KeyValuePair<string, string>("username", username),
                    new KeyValuePair<string, string>("password", password),
                    new KeyValuePair<string, string>("logintoken", tokenMatch.Groups[1].Value)
                });

                var response = await Client.PostAsync(LOGIN_URL, formContent);
                string postHtml = await response.Content.ReadAsStringAsync();

                if (postHtml.Contains("Log in to the site") || postHtml.Contains("Invalid login"))
                {
                    IsLoggedIn = false;
                    return (false, "Login failed. Check your username and password.");
                }

                var sessMatch = Regex.Match(postHtml, @"""sesskey""\s*:\s*""([^""]+)""");
                _sesskey = sessMatch.Success ? sessMatch.Groups[1].Value : "";
                IsLoggedIn = true;
                return (true, "Login successful!");
            }
            catch (Exception ex)
            {
                IsLoggedIn = false;
                return (false, $"Connection error: {ex.Message}");
            }
        }

        public async Task<List<CourseInfo>> FetchEnrolledCoursesAsync()
        {
            var results = new Dictionary<string, CourseInfo>(StringComparer.OrdinalIgnoreCase);

            if (!string.IsNullOrEmpty(_sesskey))
            {
                string ajaxUrl = $"{BASE_SITE_URL}/lib/ajax/service.php?sesskey={_sesskey}&info=core_course_get_enrolled_courses_by_timeline_classification";
                string payload = @"[{""index"":0,""methodname"":""core_course_get_enrolled_courses_by_timeline_classification"",""args"":{""offset"":0,""limit"":0,""classification"":""all"",""sort"":""fullname"",""customfieldname"":"""",""customfieldvalue"":""""}}]";

                try
                {
                    var resp = await Client.PostAsync(ajaxUrl, new StringContent(payload, Encoding.UTF8, "application/json"));
                    string json = await resp.Content.ReadAsStringAsync();
                    using var doc = JsonDocument.Parse(json);
                    var root = doc.RootElement[0];
                    if (!root.GetProperty("error").GetBoolean())
                    {
                        foreach (var c in root.GetProperty("data").GetProperty("courses").EnumerateArray())
                        {
                            string cid = c.GetProperty("id").ToString();
                            string shortname = c.GetProperty("shortname").GetString() ?? "";
                            string fullname = c.GetProperty("fullname").GetString() ?? "";

                            string code = TextHelpers.ExtractCourseCode($"{shortname} {fullname}") ?? shortname.Trim().ToUpperInvariant();
                            string title = TextHelpers.ExtractCourseTitle(fullname, code);

                            if (!string.IsNullOrEmpty(cid) && cid != "1" && !string.IsNullOrEmpty(code))
                            {
                                results[code] = new CourseInfo { Code = code, Title = title, MoodleId = cid };
                            }
                        }
                    }
                }
                catch { }
            }

            if (results.Count == 0)
            {
                try
                {
                    string html = await Client.GetStringAsync(MY_COURSES_URL);
                    var matches = Regex.Matches(html, @"href=[""'][^""']*course/view\.php\?id=(\d+)[""'][^>]*>([^<]+)<", RegexOptions.IgnoreCase);
                    foreach (Match m in matches)
                    {
                        string cid = m.Groups[1].Value;
                        string rawText = HttpUtility.HtmlDecode(m.Groups[2].Value).Trim();
                        if (cid != "1" && !string.IsNullOrEmpty(rawText))
                        {
                            string code = TextHelpers.ExtractCourseCode(rawText);
                            string title = TextHelpers.ExtractCourseTitle(rawText, code);
                            if (string.IsNullOrEmpty(code))
                            {
                                var pageInfo = await FetchCourseDetailsFromPageAsync(cid);
                                code = pageInfo.Code;
                                if (string.IsNullOrEmpty(title)) title = pageInfo.Title;
                            }
                            if (!string.IsNullOrEmpty(code))
                            {
                                results[code] = new CourseInfo { Code = code, Title = title, MoodleId = cid };
                            }
                        }
                    }
                }
                catch { }
            }

            return results.Values.OrderBy(c => c.Code).ToList();
        }

        public async Task<(string Code, string Title)> FetchCourseDetailsFromPageAsync(string courseId)
        {
            try
            {
                string html = await Client.GetStringAsync($"{COURSE_VIEW_BASE_URL}{courseId}");
                string code = null;
                string title = "";

                var h1Match = Regex.Match(html, @"<h1[^>]*>([^<]+)</h1>", RegexOptions.IgnoreCase);
                if (h1Match.Success)
                {
                    string h1Text = HttpUtility.HtmlDecode(h1Match.Groups[1].Value).Trim();
                    code = TextHelpers.ExtractCourseCode(h1Text);
                    title = TextHelpers.ExtractCourseTitle(h1Text, code);
                }

                var titleMatch = Regex.Match(html, @"<title>([^<]+)</title>", RegexOptions.IgnoreCase);
                if (titleMatch.Success)
                {
                    string tText = HttpUtility.HtmlDecode(titleMatch.Groups[1].Value).Trim();
                    if (string.IsNullOrEmpty(code)) code = TextHelpers.ExtractCourseCode(tText);
                    if (string.IsNullOrEmpty(title)) title = TextHelpers.ExtractCourseTitle(tText, code);
                }

                return (code, title);
            }
            catch
            {
                return (null, "");
            }
        }

        public async Task<(List<PastQuestionEntry> Entries, Dictionary<string, string> DiscoveredTitles)> ScanPastQuestionsRepositoryAsync()
        {
            string html = await Client.GetStringAsync(PAST_QUESTIONS_URL);
            var matches = Regex.Matches(html, @"href=[""']([^""']*pluginfile\.php[^""']*\.pdf[^""']*)[""']", RegexOptions.IgnoreCase);

            var entries = new List<PastQuestionEntry>();
            var discoveredTitles = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            foreach (Match m in matches)
            {
                string href = HttpUtility.HtmlDecode(m.Groups[1].Value);
                string decodedUrl = Uri.UnescapeDataString(href);
                string filename = decodedUrl.Split('?')[0].Split('/').Last();
                string[] parts = decodedUrl.Split('/');

                string code = TextHelpers.ExtractCourseCode(filename);
                if (string.IsNullOrEmpty(code)) continue;

                string inferredTitle = TextHelpers.ExtractCourseTitle(filename, code);
                if (!string.IsNullOrWhiteSpace(inferredTitle))
                {
                    if (!discoveredTitles.ContainsKey(code) || inferredTitle.Length > discoveredTitles[code].Length)
                    {
                        discoveredTitles[code] = inferredTitle;
                    }
                }

                string masterFolder = "Uncategorized";
                string yearFolder = "Unknown_Year";
                string semesterFolder = "";

                foreach (var part in parts)
                {
                    if (part.Contains("Level", StringComparison.OrdinalIgnoreCase))
                        masterFolder = part;
                    else if (Regex.IsMatch(part, @"^(20\d{2}[- ]20\d{2})$"))
                        yearFolder = part;
                    else if (part.Contains("semester", StringComparison.OrdinalIgnoreCase))
                        semesterFolder = part;
                }

                entries.Add(new PastQuestionEntry
                {
                    Url = href.Contains("forcedownload=1") ? href : $"{href}?forcedownload=1",
                    FileName = filename,
                    CourseCode = code,
                    InferredTitle = inferredTitle,
                    MasterFolder = masterFolder,
                    YearFolder = yearFolder,
                    SemesterFolder = semesterFolder
                });
            }

            return (entries, discoveredTitles);
        }

        public async Task<List<DownloadTask>> ScanCourseNotesAsync(string courseFolderLabel, string courseId, string baseSavePath, string masterFolderName)
        {
            var tasks = new List<DownloadTask>();
            var seenUrls = new HashSet<string>();

            string html = await Client.GetStringAsync($"{COURSE_VIEW_BASE_URL}{courseId}");

            var sectionHeaders = new List<(int Index, string Name)>();
            foreach (Match sm in Regex.Matches(html, @"<(?:h2|h3|h4)[^>]*>\s*(?:<[^>]+>\s*)*([^<]+?)\s*(?:</[^>]+>\s*)*</(?:h2|h3|h4)>", RegexOptions.IgnoreCase))
            {
                string sName = HttpUtility.HtmlDecode(sm.Groups[1].Value).Trim();
                if (Regex.IsMatch(sName, @"(week\s*\d+|general|topic\s*\d+|module\s*\d+|section\s*\d+)", RegexOptions.IgnoreCase))
                {
                    sectionHeaders.Add((sm.Index, TextHelpers.SanitizeFolderName(sName)));
                }
            }

            var resourceMatches = Regex.Matches(html, @"<a[^>]+href=[""']([^""']*mod/resource/view\.php\?id=(\d+)[^""']*)[""'][^>]*>(.*?)</a>", RegexOptions.IgnoreCase | RegexOptions.Singleline);

            foreach (Match rm in resourceMatches)
            {
                string resUrl = HttpUtility.HtmlDecode(rm.Groups[1].Value);
                string resId = rm.Groups[2].Value;
                string innerHtml = rm.Groups[3].Value;

                if (GlobalIgnoreIds.Contains(resId) || !seenUrls.Add(resUrl))
                    continue;

                string cleanText = Regex.Replace(innerHtml, @"<span[^>]*class=[""'][^""']*accesshide[^""']*""[^>]*>.*?</span>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
                cleanText = Regex.Replace(cleanText, @"<[^>]+>", " ");
                cleanText = HttpUtility.HtmlDecode(cleanText).Trim();
                cleanText = Regex.Replace(cleanText, @"\s+(File|Folder|Document)$", "", RegexOptions.IgnoreCase).Trim();
                string safeTitle = TextHelpers.SanitizeFolderName(string.IsNullOrEmpty(cleanText) ? $"Document_{resId}" : cleanText);

                string sectionName = "General";
                foreach (var sec in sectionHeaders)
                {
                    if (sec.Index < rm.Index) sectionName = sec.Name;
                    else break;
                }

                string saveDir = Path.Combine(baseSavePath, masterFolderName, courseFolderLabel, sectionName);
                string savePath = Path.Combine(saveDir, safeTitle);
                if (tasks.Any(t => t.SavePath.Equals(savePath, StringComparison.OrdinalIgnoreCase)))
                    savePath = Path.Combine(saveDir, $"{safeTitle}_{resId}");

                tasks.Add(new DownloadTask
                {
                    Url = $"{resUrl}&redirect=1",
                    SavePath = savePath,
                    DisplayName = $"[{courseFolderLabel} | {sectionName}] {safeTitle}",
                    HasKnownExtension = false
                });
            }

            return tasks;
        }
    }
}