// The pinned renderer registers pane contributions, plugins, routing, and
// overlay bindings while its controller module is evaluated. Athena uses those
// registrations without mounting the desktop controller. Keep this dependency
// behind startBrowserHost, after bridge installation and profile restoration.
import '../../../desktop/src/app/contrib/controller'
