using Jellyfin.Plugin.FolderBrowser.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.FolderBrowser;

/// <summary>The Folder Browser plugin.</summary>
public class Plugin : BasePlugin<PluginConfiguration>
{
    /// <summary>Initializes a new instance of the <see cref="Plugin"/> class.</summary>
    /// <param name="applicationPaths">Application paths.</param>
    /// <param name="xmlSerializer">Xml serializer.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
    }

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("5777b1cb-2a57-464b-8b75-2c4c9aa3d2be");

    /// <inheritdoc />
    public override string Name => "Folder Browser";

    /// <inheritdoc />
    public override string Description => "Adds a Folders view to music libraries in the web client.";
}
