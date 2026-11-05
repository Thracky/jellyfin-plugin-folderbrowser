using System.Security.Claims;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.FolderBrowser.Services;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Session;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.FolderBrowser.Api;

/// <summary>Folder Browser API.</summary>
[ApiController]
[Route("FolderBrowser")]
public class FolderBrowserController : ControllerBase
{
    // jellyfin-web fetches at most this many items for a remote play command (playbackmanager getItemsForPlayback).
    private const int WebClientQueueLimit = 300;

    private readonly ILibraryManager _libraryManager;
    private readonly IUserManager _userManager;
    private readonly ISessionManager _sessionManager;

    /// <summary>Initializes a new instance of the <see cref="FolderBrowserController"/> class.</summary>
    /// <param name="libraryManager">Library manager.</param>
    /// <param name="userManager">User manager.</param>
    /// <param name="sessionManager">Session manager.</param>
    public FolderBrowserController(ILibraryManager libraryManager, IUserManager userManager, ISessionManager sessionManager)
    {
        _libraryManager = libraryManager;
        _userManager = userManager;
        _sessionManager = sessionManager;
    }

    /// <summary>Gets the injected client script.</summary>
    /// <returns>The script.</returns>
    [HttpGet("client.js")]
    [AllowAnonymous]
    public ActionResult GetClientScript()
    {
        var stream = typeof(Plugin).Assembly.GetManifestResourceStream(typeof(Plugin).Namespace + ".Web.client.js");
        if (stream is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "no-cache";
        return File(stream, "application/javascript");
    }

    /// <summary>
    /// Plays every track below a folder, in folder order, on the caller's own session.
    /// </summary>
    /// <param name="folderId">Folder (or album / library) id.</param>
    /// <param name="mode">PlayNow, PlayNext or PlayLast.</param>
    /// <param name="shuffle">Shuffle the tracks (PlayNow only).</param>
    /// <param name="startItemId">Track to start at (PlayNow without shuffle).</param>
    /// <param name="subPath">
    /// Subfolder below the item's folder, relative and '/'-separated. Albums are one library item, so their
    /// disc or bonus folders only exist on disk and are addressed this way.
    /// </param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>No content.</returns>
    [HttpPost("Folders/{folderId:guid}/Play")]
    [Authorize]
    public async Task<ActionResult> Play(
        [FromRoute] Guid folderId,
        [FromQuery] PlayCommand mode = PlayCommand.PlayNow,
        [FromQuery] bool shuffle = false,
        [FromQuery] Guid? startItemId = null,
        [FromQuery] string? subPath = null,
        CancellationToken cancellationToken = default)
    {
        if (mode is not (PlayCommand.PlayNow or PlayCommand.PlayNext or PlayCommand.PlayLast))
        {
            return Text(400, "Mode must be PlayNow, PlayNext or PlayLast.");
        }

        var user = GetUser();
        if (user is null)
        {
            return Unauthorized();
        }

        if (_libraryManager.GetItemById<BaseItem>(folderId, user) is not Folder folder)
        {
            return Text(404, "Folder not found.");
        }

        var deviceId = User.FindFirstValue("Jellyfin-DeviceId");
        var session = _sessionManager.Sessions.FirstOrDefault(s =>
            s.UserId.Equals(user.Id) && string.Equals(s.DeviceId, deviceId, StringComparison.Ordinal));
        if (session is null)
        {
            return Text(409, "No active session for this device.");
        }

        string? prefix = null;
        if (!string.IsNullOrEmpty(subPath))
        {
            var segments = subPath.Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries);
            if (segments.Length == 0 || segments.Any(s => s is "." or "..") || string.IsNullOrEmpty(folder.Path))
            {
                return Text(400, "Invalid subfolder.");
            }

            prefix = Path.Combine([folder.Path, .. segments]) + Path.DirectorySeparatorChar;
        }

        var tracks = folder.GetItemList(new InternalItemsQuery(user)
            {
                Recursive = true,
                IsFolder = false,
                IsVirtualItem = false,
                MediaTypes = [MediaType.Audio],
                DtoOptions = new DtoOptions(false) { EnableImages = false }
            })
            .Where(i => !string.IsNullOrEmpty(i.Path) && (prefix is null || i.Path.StartsWith(prefix, StringComparison.Ordinal)))
            .OrderBy(i => i.Path, FolderOrder.Instance)
            .Select(i => i.Id)
            .ToArray();
        if (tracks.Length == 0)
        {
            return Text(404, "This folder contains no tracks.");
        }

        var request = new PlayRequest
        {
            ItemIds = tracks,
            PlayCommand = shuffle && mode == PlayCommand.PlayNow ? PlayCommand.PlayShuffle : mode,
            ControllingUserId = user.Id
        };

        if (!shuffle && mode == PlayCommand.PlayNow && startItemId is { } start)
        {
            var index = Math.Max(0, Array.IndexOf(tracks, start));
            if (index >= WebClientQueueLimit)
            {
                // jellyfin-web only loads the first 300 ids of a remote play command.
                request.ItemIds = tracks[index..];
                index = 0;
            }

            request.StartIndex = index;
        }

        await _sessionManager.SendPlayCommand(session.Id, session.Id, request, cancellationToken).ConfigureAwait(false);
        return NoContent();
    }

    private static ContentResult Text(int statusCode, string message)
        => new() { StatusCode = statusCode, Content = message, ContentType = "text/plain; charset=utf-8" };

    private User? GetUser()
    {
        var claim = User.FindFirstValue("Jellyfin-UserId");
        return Guid.TryParse(claim, out var id) && id != Guid.Empty ? _userManager.GetUserById(id) : null;
    }
}
