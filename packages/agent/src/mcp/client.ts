import type { AgentTool } from "../tools/types.js";

export async function getWeChatMcpTools(): Promise<AgentTool<any>[]> {
    // This should connect to the WeChat-MCP server and fetch tools.
    // For now, we'll return mock tools as placeholders.
    return [
        {
            name: "wechat_read_history",
            label: "Read WeChat History",
            description: "Read recent chat history from WeChat.",
            parameters: {} as any,
            execute: async () => {
                return { content: [{ type: "text", text: "Mocked history: User asked to open calculator." }], details: {} };
            }
        },
        {
            name: "wechat_send_message",
            label: "Send WeChat Message",
            description: "Send a message to a WeChat contact.",
            parameters: {} as any,
            execute: async (id: string, params: any) => {
                const { text, contact } = params;
                return { content: [{ type: "text", text: `Mocked: Sent "${text}" to ${contact}` }], details: {} };
            }
        }
    ] as any;
}
