import OpenAI from "openai";
import type { CharacterConfig, SocialMessageEvent, SocialRuntimeActions } from "../core/types.js";
import type { AgentTool, ToolResult } from "../tools/types.js";

export interface AgentLoopInput {
    event: SocialMessageEvent;
    soul: string;
    userProfile: string;
    pendingTasks: string;
    decision: { content: string; reason: string };
    history: any[];
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

    async run(input: AgentLoopInput): Promise<string> {
        const { event, soul, userProfile, pendingTasks, decision, history } = input;
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

[PENDING TASKS]
${pendingTasks}

[INTENT FROM SOCIAL DECISION]
${decision.reason}

[INSTRUCTIONS]
- You are in the ACTION phase.
- You are talking DIRECTLY to ${contactName}. Address them as "you" (你).
- CONTEXT TRUTH: Only rely on the [HISTORY] and [LATEST MESSAGE] for what has actually been said. The [USER PROFILE] is for long-term personality/facts only.
- ANTI-HALLUCINATION: NEVER say you have "seen" or "read" something unless it is explicitly in the [HISTORY]. If you need more info, ask for it using natural language.
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
                    if (!tool) continue;

                    let args: any;
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (e) {
                        messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Invalid tool arguments." });
                        continue;
                    }

                    const result = await this.executeTool(tool, toolCall.id, args);
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

        return finalContent;
    }

    private async executeTool(tool: AgentTool<any>, toolCallId: string, args: any): Promise<ToolResult> {
        if (tool.name === "search_contact") {
            const list = await this.actions.searchContacts(args.query);
            return { content: [{ type: "text", text: JSON.stringify(list) }], details: list };
        }

        if (tool.name === "send_private_message") {
            const result = await this.actions.sendPrivateMessage(args.contactId, args.text);
            const text = result.success ? `Message sent to ${result.label || args.contactId}` : "Contact not found.";
            return { content: [{ type: "text", text }], details: result };
        }

        return tool.execute(toolCallId, args);
    }
}
