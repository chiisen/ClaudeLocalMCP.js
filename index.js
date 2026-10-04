#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
async function main() {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // stdout 專供 MCP 協定使用；診斷訊息只能寫入 stderr。
}
main().catch((error) => {
    console.error("Fatal error in main():", error.message);
    process.exit(1);
});
