import OpenAI from "openai";
import type { CharacterConfig, SocialMessageEvent, SocialRuntimeActions } from "../core/types.js";
import { serviceMemoryClient } from "../memory/service-memory-client.js";
import type { AgentTool, ToolResult } from "../tools/types.js";

export interface AgentLoopInput {
    event: SocialMessageEvent;
    soul: string;
    userProfile: string;
    recentHistory: string;
    referencedProfiles?: string;
    pendingTasks: string;
    serviceContactId?: string;
    decision: { content: string; reason: string };
    history: any[];
}

export interface AgentLoopResult {
    content: string;
    usedPrivateMessagingTool: boolean;
}

export interface AgentLoopOptions {
    character: CharacterConfig;
    client: OpenAI;
    tools: AgentTool<any>[];
    actions: SocialRuntimeActions;
}

export class AgentLoop {
    private readonly character: CharacterConfig;
    private readonly client: OpenAI;
    private readonly tools: AgentTool<any>[];
    private readonly actions: SocialRuntimeActions;

    constructor(options: AgentLoopOptions) {
        this.character = options.character;
        this.client = options.client;
        this.tools = options.tools;
        this.actions = options.actions;
    }

    async run(input: AgentLoopInput): Promise<AgentLoopResult> {
        const { event, soul, userProfile, recentHistory, referencedProfiles, pendingTasks, serviceContactId, decision, history } = input;
        const contactName = event.contact.name;
        const latestMessage = event.segments.map(segment => `${segment.contact.name}: ${segment.text}`).join("\n");
        const messages: any[] = [
            {
                role: "system",
                content: `${soul}

[CHARACTER]
ID: ${this.character.id}
Name: ${this.character.name}
Display Name: ${this.character.displayName}

[PLATFORM CONTEXT]
Platform: ${event.platform}
Account: ${event.accountId}
Channel: ${event.channel}

[LATEST MESSAGE]
${latestMessage}

[USER PROFILE]
${userProfile}

[RECENT PERSISTED CHAT HISTORY]
${recentHistory}

[REFERENCED CONTACT MEMORIES]
${referencedProfiles || "None"}

[PENDING TASKS]
${pendingTasks}

[INTENT FROM SOCIAL DECISION]
${decision.reason}

[INSTRUCTIONS]
- You are in the ACTION phase.
- You are talking DIRECTLY to ${contactName}. Address them as "you" (你).
- CONTEXT TRUTH: Only rely on [RECENT PERSISTED CHAT HISTORY], [HISTORY], and [LATEST MESSAGE] for what has actually been said. The [USER PROFILE] is for long-term personality/facts only.
- ANTI-HALLUCINATION: NEVER claim to remember a list, song, message, or event unless it appears in [RECENT PERSISTED CHAT HISTORY], [HISTORY], or [LATEST MESSAGE]. If it is missing, say you do not have enough context and ask for it again.
- If your intent is to contact someone else, you MUST use \`search_contact\` first to get their ID, then use \`send_private_message\`.
- TASK MANAGEMENT: To mark a task as done, you MUST call the \`complete_task\` tool. NEVER manually update the task list in your text or profile.
- Do not just say you will do it; actually use the tools to do it.
- Your final text response should reflect the actions you took.
- LITERALLY INCLUDE LINKS: If you are sending a link, the URL (https://...) MUST be present in your message text.
- No emojis. Use casual phone-typing style.`
            },
            ...history,
            { role: "user", content: latestMessage || `${contactName}: ${event.text}` }
        ];

        let turn = 0;
        let finalContent = decision.content;
        let usedPrivateMessagingTool = false;
        while (turn < 5) {
            const response = await this.client.chat.completions.create({
                model: this.character.modelId,
                messages,
                tools: this.tools.map(tool => ({
                    type: "function",
                    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
                })),
                tool_choice: "auto"
            });

            const assistantMessage = response.choices[0].message;
            messages.push(assistantMessage);

            if (assistantMessage.tool_calls) {
                for (const toolCall of assistantMessage.tool_calls as any[]) {
                    const tool = this.tools.find(candidate => candidate.name === toolCall.function.name);
                    if (!tool) {
                        console.warn(`[TOOL] Unknown tool requested: ${toolCall.function.name}`);
                        continue;
                    }

                    let args: any;
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (e) {
                        console.warn(`[TOOL] ${tool.name} invalid arguments: ${toolCall.function.arguments}`);
                        messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Invalid tool arguments." });
                        continue;
                    }

                    console.log(`[TOOL] Calling ${tool.name} with ${this.formatToolPayload(args)}`);
                    if (tool.name === "send_private_message") {
                        usedPrivateMessagingTool = true;
                    }
                    let result: ToolResult;
                    try {
                        result = await this.executeTool(tool, toolCall.id, args, serviceContactId);
                    } catch (e) {
                        const message = e instanceof Error ? e.message : String(e);
                        console.error(`[TOOL] ${tool.name} failed: ${message}`);
                        messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Tool failed: ${message}` });
                        continue;
                    }
                    console.log(`[TOOL] ${tool.name} result: ${this.formatToolResult(result)}`);
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: result.content.map(content => content.text).join("\n")
                    });
                }
                turn++;
                continue;
            }

            finalContent = assistantMessage.content || finalContent;
            break;
        }

        return { content: finalContent, usedPrivateMessagingTool };
    }

    private async executeTool(tool: AgentTool<any>, toolCallId: string, args: any, serviceContactId?: string): Promise<ToolResult> {
        if (tool.name === "search_contact") {
            const list = await this.actions.searchContacts(args.query);
            return { content: [{ type: "text", text: JSON.stringify(list) }], details: list };
        }

        if (tool.name === "send_private_message") {
            const result = await this.actions.sendPrivateMessage(args.contactId, args.text);
            const text = result.success ? `Message sent to ${result.label || args.contactId}` : "Contact not found.";
            return { content: [{ type: "text", text }], details: result };
        }

        if (tool.name === "complete_task" && serviceContactId) {
            await serviceMemoryClient.completePromise(args.taskId);
            return {
                content: [{ type: "text", text: `Promise ${args.taskId} marked as completed.` }],
                details: { taskId: args.taskId, status: "done" }
            };
        }

        return tool.execute(toolCallId, args);
    }

    private formatToolPayload(payload: unknown): string {
        try {
            return JSON.stringify(payload);
        } catch (e) {
            return String(payload);
        }
    }

    private formatToolResult(result: ToolResult): string {
        const text = result.content.map(content => content.text).join("\n");
        return this.truncate(text || JSON.stringify(result.details ?? {}), 1200);
    }

    private truncate(text: string, maxLength: number): string {
        return text.length > maxLength ? `${text.slice(0, maxLength)}... [truncated]` : text;
    }
}
