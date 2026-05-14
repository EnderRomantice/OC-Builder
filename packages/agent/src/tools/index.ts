import { Type } from "@sinclair/typebox";
import { taskManager } from "../memory/task-manager.js";
import { executeBash } from "./shell.js";
import type { AgentTool } from "./types.js";

export const tools: AgentTool<any>[] = [
    {
        name: "bash",
        label: "Bash / PowerShell",
        description: "Execute a command on the host computer. Use this for file operations (reading, writing, deleting, listing) and system commands.",
        parameters: Type.Object({
            command: Type.String()
        }),
        execute: async (id, params: any) => {
            const { command } = params;
            const res = await executeBash(command);
            return { content: [res as any], details: {} };
        }
    } as AgentTool<any>,
    {
        name: "web_search",
        label: "Web Search (SearXNG)",
        description: "Search the internet for real-time information using SearXNG aggregation.",
        parameters: Type.Object({
            query: Type.String()
        }),
        execute: async (id, params: any) => {
            const { query } = params;
            const searxngUrl = process.env.SEARXNG_URL || "https://searx.be/";
            console.log(`[DEBUG] SearXNG searching for: ${query} via ${searxngUrl}`);
            
            try {
                const response = await fetch(`${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json`, {
                    headers: {
                        "Accept": "application/json",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                    }
                });
                
                const contentType = response.headers.get("content-type");
                if (!contentType || !contentType.includes("application/json")) {
                    const text = await response.text();
                    console.error("[DEBUG] SearXNG returned non-JSON:", text.slice(0, 200));
                    return { content: [{ type: "text", text: "SearXNG 实例暂时不可用（返回了非 JSON 页面），请稍后再试或换个问题。" }], details: {} };
                }

                const data = await response.json() as any;
                
                if (data.results && data.results.length > 0) {
                    const snippet = data.results.slice(0, 5).map((r: any, i: number) => 
                        `${i+1}. ${r.title}: ${r.content} (${r.url})`
                    ).join("\n\n");
                    return { content: [{ type: "text", text: snippet }], details: {} };
                } else {
                    return { content: [{ type: "text", text: "No results found on SearXNG." }], details: {} };
                }
            } catch (error) {
                console.error("SearXNG Error:", error);
                return { content: [{ type: "text", text: "Error connecting to SearXNG instance." }], details: {} };
            }
        }
    } as AgentTool<any>,
    {
        name: "complete_task",
        label: "Complete Task",
        description: "Mark a pending task as completed. Use this when you have fulfilled a promise made to the user.",
        parameters: Type.Object({
            memoryId: Type.String({ description: "The identifier for the user memory (handle, alias, or name)." }),
            taskId: Type.String({ description: "The ID of the task to complete." })
        }),
        execute: async (id, params: any) => {
            taskManager.completeTask(params.memoryId, params.taskId);
            return { 
                content: [{ type: "text", text: `Task ${params.taskId} marked as completed for ${params.memoryId}.` }], 
                details: { taskId: params.taskId, status: "done" } 
            };
        }
    } as AgentTool<any>,
    {
        name: "search_contact",
        label: "Search Contact",
        description: "Search for a contact by name or alias in WeChat.",
        parameters: Type.Object({
            query: Type.String({ description: "The name or alias to search for." })
        }),
        execute: async (id, params: any) => {
            // This is a placeholder, real implementation will be injected in index.ts
            return { content: [{ type: "text", text: "Search function initialized." }], details: params };
        }
    } as AgentTool<any>,
    {
        name: "send_private_message",
        label: "Send Private Message",
        description: "Initiate a private message to a contact. You must provide a valid contact ID (usually from search_contact).",
        parameters: Type.Object({
            contactId: Type.String({ description: "The ID of the contact to send message to." }),
            text: Type.String({ description: "The message content." })
        }),
        execute: async (id, params: any) => {
            // This is a placeholder, real implementation will be injected in index.ts
            return { content: [{ type: "text", text: "Send function initialized." }], details: params };
        }
    } as AgentTool<any>
];
