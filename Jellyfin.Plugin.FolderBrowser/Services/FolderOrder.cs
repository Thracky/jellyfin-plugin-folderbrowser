using System.Globalization;

namespace Jellyfin.Plugin.FolderBrowser.Services;

/// <summary>
/// Orders paths the way the folder view lists them: within each folder, files come before subfolders,
/// and names compare case-insensitively with numbers in numeric order ("Disc 2" before "Disc 10").
/// </summary>
public sealed class FolderOrder : IComparer<string>
{
    private static readonly char[] _separators = { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar };
    private static readonly CompareInfo _compareInfo = CultureInfo.InvariantCulture.CompareInfo;

    /// <summary>Gets the shared instance.</summary>
    public static FolderOrder Instance { get; } = new();

    /// <inheritdoc />
    public int Compare(string? x, string? y)
    {
        if (ReferenceEquals(x, y))
        {
            return 0;
        }

        if (x is null)
        {
            return -1;
        }

        if (y is null)
        {
            return 1;
        }

        var a = x.Split(_separators, StringSplitOptions.RemoveEmptyEntries);
        var b = y.Split(_separators, StringSplitOptions.RemoveEmptyEntries);
        var common = Math.Min(a.Length, b.Length);
        for (var i = 0; i < common; i++)
        {
            var aIsFile = i == a.Length - 1;
            var bIsFile = i == b.Length - 1;
            if (aIsFile != bIsFile)
            {
                // One path ends here (a file in this folder), the other continues into a subfolder.
                return aIsFile ? -1 : 1;
            }

            var result = _compareInfo.Compare(a[i], b[i], CompareOptions.IgnoreCase | CompareOptions.NumericOrdering);
            if (result != 0)
            {
                return result;
            }
        }

        return a.Length.CompareTo(b.Length);
    }
}
