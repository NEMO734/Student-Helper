#nullable disable
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Student_Helper
{
    public class AppConfig
    {
        public AppSettings Settings { get; set; } = new();
    }

    public class AppSettings
    {
        public string DownloadPath { get; set; } = "";
        public string LastUsername { get; set; } = "";
        public string LastPassword { get; set; } = "";
        public string MasterFolderName { get; set; } = "Past_Questions";
        public bool GroupYearsInSubfolders { get; set; } = true;

        public bool HasAcceptedTerms { get; set; } = false;
        public bool IsMusicUnlocked { get; set; } = false;

        public string AccentName { get; set; } = "Cyan";
        public string CustomAccentHex { get; set; } = "#18E0F5";
        public string FontName { get; set; } = "Cascadia Code";
        public string CustomFontFilePath { get; set; } = "";
        public double FontSize { get; set; } = 13.5;
        public double LineSpacing { get; set; } = 6.0;
        public double CharacterSpacing { get; set; } = 0.0;
        public bool IsBold { get; set; } = false;
        public bool IsItalic { get; set; } = false;
    }

    public class CourseInfo
    {
        public string Code { get; set; } = "";
        public string Title { get; set; } = "";
        public string MoodleId { get; set; } = "";

        public string DisplayLabel => string.IsNullOrWhiteSpace(Title) ? Code : $"{Code} - {Title}";
    }

    public class PastQuestionEntry
    {
        public string Url { get; set; } = "";
        public string FileName { get; set; } = "";
        public string CourseCode { get; set; } = "";
        public string InferredTitle { get; set; } = "";
        public string MasterFolder { get; set; } = "";
        public string YearFolder { get; set; } = "";
        public string SemesterFolder { get; set; } = "";
    }

    public class DownloadTask
    {
        public string Url { get; set; } = "";
        public string SavePath { get; set; } = "";
        public string DisplayName { get; set; } = "";
        public bool HasKnownExtension { get; set; }
    }

    public class BatchResult
    {
        public int Downloaded { get; set; }
        public int Skipped { get; set; }
        public int Failed { get; set; }
    }

    public static class TextHelpers
    {
        private static readonly Regex StrictCourseCodeRegex = new(@"\b([A-Z]{4})\s*[-_]?\s*(\d{3})\b", RegexOptions.IgnoreCase);

        public static string ExtractCourseCode(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            var m = StrictCourseCodeRegex.Match(text);
            return m.Success ? $"{m.Groups[1].Value.ToUpperInvariant()}{m.Groups[2].Value}" : null;
        }

        public static string ExtractCourseTitle(string rawText, string code)
        {
            if (string.IsNullOrWhiteSpace(rawText)) return "";
            string cleaned = Path.GetFileNameWithoutExtension(rawText);

            var m = StrictCourseCodeRegex.Match(cleaned);
            if (m.Success)
            {
                cleaned = cleaned.Substring(m.Index + m.Length);
            }
            else if (!string.IsNullOrEmpty(code))
            {
                cleaned = Regex.Replace(cleaned, Regex.Escape(code), "", RegexOptions.IgnoreCase);
            }

            cleaned = Regex.Replace(cleaned, @"(_WKD|\bWKD\b|\(\d+\)|_MAIN|\bMAIN\b|\bRESIT\b)", "", RegexOptions.IgnoreCase);
            cleaned = Regex.Replace(cleaned, @"\s+", " ").Trim(' ', '-', '_', '.', ':', ';');
            return SanitizeFolderName(cleaned);
        }

        public static string FormatCourseFolderName(string code, string title)
        {
            string cleanCode = code?.Trim().ToUpperInvariant() ?? "UNKNOWN";
            string cleanTitle = SanitizeFolderName(title ?? "");
            return string.IsNullOrWhiteSpace(cleanTitle) ? cleanCode : $"{cleanCode} - {cleanTitle}";
        }

        public static string SanitizeFolderName(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return "";
            foreach (char c in Path.GetInvalidFileNameChars())
                name = name.Replace(c.ToString(), "");
            return Regex.Replace(name, @"\s+", " ").Trim();
        }

        public static string ExtractNumericId(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var m = Regex.Match(raw, @"id=(\d+)", RegexOptions.IgnoreCase);
            if (m.Success) return m.Groups[1].Value;
            string digits = Regex.Replace(raw, @"\D", "");
            return string.IsNullOrEmpty(digits) ? null : digits;
        }

        public static string ApplyTracking(string text, int spacingLevel)
        {
            if (string.IsNullOrEmpty(text) || spacingLevel <= 0) return text;
            string pad = spacingLevel switch
            {
                1 => "\u200A",
                2 => "\u2009",
                3 => "\u2006",
                4 => "\u2005",
                _ => " "
            };
            return string.Join(pad, text.ToCharArray());
        }
    }

    public static class ConfigManager
    {
        private static readonly string ConfigFilePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "TeamAtor_StudentHelper_Config.json");

        public static AppConfig Load()
        {
            if (!File.Exists(ConfigFilePath)) return new AppConfig();
            try
            {
                string json = File.ReadAllText(ConfigFilePath);
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                return JsonSerializer.Deserialize<AppConfig>(json, options) ?? new AppConfig();
            }
            catch
            {
                return new AppConfig();
            }
        }

        public static void Save(AppConfig config)
        {
            try
            {
                var options = new JsonSerializerOptions { WriteIndented = true };
                File.WriteAllText(ConfigFilePath, JsonSerializer.Serialize(config, options));
            }
            catch { }
        }
    }
}