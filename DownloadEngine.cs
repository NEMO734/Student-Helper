#nullable disable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Student_Helper
{
    public static class DownloadEngine
    {
        public static List<DownloadTask> BuildPastQuestionTasks(
            List<PastQuestionEntry> allEntries,
            HashSet<string> selectedCodes,
            Dictionary<string, string> knownTitles,
            string masterFolderName,
            HashSet<string> targetYears,
            int semChoice,
            string baseSavePath,
            bool groupYearsInSubfolders)
        {
            var tasks = new List<DownloadTask>();

            foreach (var entry in allEntries)
            {
                if (!selectedCodes.Contains(entry.CourseCode))
                    continue;

                if (targetYears != null && entry.YearFolder.Length >= 4 &&
                    !targetYears.Contains(entry.YearFolder.Substring(0, 4)))
                    continue;

                if (!string.IsNullOrEmpty(entry.SemesterFolder))
                {
                    if (semChoice == 1 && entry.SemesterFolder.Contains("second", StringComparison.OrdinalIgnoreCase)) continue;
                    if (semChoice == 2 && entry.SemesterFolder.Contains("first", StringComparison.OrdinalIgnoreCase)) continue;
                }

                string courseTitle = knownTitles.TryGetValue(entry.CourseCode, out string savedTitle) && !string.IsNullOrWhiteSpace(savedTitle)
                    ? savedTitle
                    : entry.InferredTitle;

                string courseFolderName = TextHelpers.FormatCourseFolderName(entry.CourseCode, courseTitle);
                string courseRootDir = Path.Combine(baseSavePath, masterFolderName, courseFolderName);

                string finalFilePath;
                if (groupYearsInSubfolders)
                {
                    string yearDir = Path.Combine(courseRootDir, entry.YearFolder);
                    if (!string.IsNullOrEmpty(entry.SemesterFolder))
                        yearDir = Path.Combine(yearDir, entry.SemesterFolder);
                    finalFilePath = Path.Combine(yearDir, entry.FileName);
                }
                else
                {
                    string semTag = string.IsNullOrEmpty(entry.SemesterFolder) ? "" : $" {entry.SemesterFolder}";
                    string prefixedFileName = $"[{entry.YearFolder}{semTag}] {entry.FileName}";
                    finalFilePath = Path.Combine(courseRootDir, prefixedFileName);
                }

                tasks.Add(new DownloadTask
                {
                    Url = entry.Url,
                    SavePath = finalFilePath,
                    DisplayName = $"[{courseFolderName}] ({entry.YearFolder}) {entry.FileName}",
                    HasKnownExtension = true
                });
            }

            return tasks;
        }

        public static async Task<BatchResult> ExecuteBatchAsync(
            HttpClient client,
            List<DownloadTask> tasks,
            Action<string> logCallback,
            Action<int, int, int, int> progressCallback)
        {
            int downloaded = 0, skipped = 0, failed = 0, completed = 0;
            using var semaphore = new SemaphoreSlim(4);

            var workerTasks = tasks.Select(async task =>
            {
                await semaphore.WaitAsync();
                try
                {
                    if (task.HasKnownExtension && File.Exists(task.SavePath))
                    {
                        Interlocked.Increment(ref skipped);
                        return;
                    }

                    using var response = await client.GetAsync(task.Url, HttpCompletionOption.ResponseHeadersRead);
                    response.EnsureSuccessStatusCode();

                    string contentType = response.Content.Headers.ContentType?.MediaType?.ToLowerInvariant() ?? "";
                    if (contentType.Contains("text/html")) return;

                    string finalPath = task.SavePath;
                    if (!task.HasKnownExtension)
                    {
                        string ext = ".pdf";
                        string cdFileName = response.Content.Headers.ContentDisposition?.FileNameStar
                                            ?? response.Content.Headers.ContentDisposition?.FileName;
                        if (!string.IsNullOrEmpty(cdFileName))
                        {
                            string candidateExt = Path.GetExtension(cdFileName.Trim('"', '\''));
                            if (!string.IsNullOrEmpty(candidateExt)) ext = candidateExt;
                        }
                        else if (response.RequestMessage?.RequestUri != null)
                        {
                            string uriExt = Path.GetExtension(Uri.UnescapeDataString(response.RequestMessage.RequestUri.AbsolutePath));
                            if (!string.IsNullOrEmpty(uriExt) && !uriExt.Equals(".php", StringComparison.OrdinalIgnoreCase))
                                ext = uriExt;
                        }

                        if (!finalPath.EndsWith(ext, StringComparison.OrdinalIgnoreCase))
                            finalPath += ext;

                        if (File.Exists(finalPath))
                        {
                            Interlocked.Increment(ref skipped);
                            return;
                        }
                    }

                    string dirName = Path.GetDirectoryName(finalPath);
                    if (!string.IsNullOrEmpty(dirName))
                        Directory.CreateDirectory(dirName);

                    string tempPath = finalPath + ".part";

                    await using (var fs = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        await response.Content.CopyToAsync(fs);
                    }

                    File.Move(tempPath, finalPath, true);
                    Interlocked.Increment(ref downloaded);
                    logCallback($"Saved: {task.DisplayName}");
                }
                catch (Exception ex)
                {
                    Interlocked.Increment(ref failed);
                    logCallback($"Failed: {task.DisplayName} ({ex.Message})");
                }
                finally
                {
                    semaphore.Release();
                    int done = Interlocked.Increment(ref completed);
                    progressCallback(done, downloaded, skipped, failed);
                }
            });

            await Task.WhenAll(workerTasks);
            return new BatchResult { Downloaded = downloaded, Skipped = skipped, Failed = failed };
        }

        public static HashSet<string> ParseYearInput(string input)
        {
            string cleaned = input?.Trim().ToLowerInvariant() ?? "all";
            if (cleaned == "all" || string.IsNullOrEmpty(cleaned)) return null;

            var years = new HashSet<string>();
            foreach (var token in Regex.Split(cleaned, @"[,\s]+"))
            {
                var rm = Regex.Match(token, @"^(20\d{2})-(20\d{2})$");
                if (rm.Success && int.TryParse(rm.Groups[1].Value, out int start) && int.TryParse(rm.Groups[2].Value, out int end))
                {
                    for (int y = start; y <= end; y++) years.Add(y.ToString());
                }
                else if (Regex.IsMatch(token, @"^20\d{2}$"))
                {
                    years.Add(token);
                }
            }
            return years;
        }
    }
}