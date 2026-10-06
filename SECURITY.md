# Security

herdr plugins run as your user with full access to the herdr CLI. This plugin
moves panes between tabs and workspaces and writes a state file under
herdr's per-plugin state directory; it makes no network requests and reads no
credentials. If you find it doing anything beyond that, treat it as a bug.

## Reporting a vulnerability

Report privately through
[GitHub security advisories](https://github.com/MMSs/herdr-minimize/security/advisories/new),
not a public issue. Include the herdr version, OS, plugin version or commit,
and steps to reproduce. Only the latest release is supported.
