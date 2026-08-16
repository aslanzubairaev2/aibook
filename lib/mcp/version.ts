// The version this MCP server reports, in one place.
//
// It is stated twice — in `initialize`'s serverInfo, which the connected agent
// reads, and on /api/mcp-version, which a human reads to check that a deploy
// landed. Kept apart, the two drifted, and the page whose whole job is to say
// what is deployed was the one saying the wrong thing.
//
// Bump the minor when the tools change shape: a client that cached the tool
// list at connection time has no other way to notice.
export const MCP_SERVER_VERSION = "1.4.0";
