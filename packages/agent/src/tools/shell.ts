import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolContent } from "./types.js";

const execAsync = promisify(exec);

export async function executeBash(command: string): Promise<ToolContent> {
    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd: process.cwd(),
            timeout: 60_000,
            maxBuffer: 1024 * 1024
        });
        return {
            type: "text",
            text: [stdout.trim(), stderr.trim()].filter(Boolean).join("\n") || "Command completed with no output."
        };
    } catch (error) {
        const err = error as { stdout?: string; stderr?: string; message?: string };
        return {
            type: "text",
            text: [err.stdout?.trim(), err.stderr?.trim(), err.message].filter(Boolean).join("\n")
        };
    }
}
