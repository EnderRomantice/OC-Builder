import { join } from "node:path";
import type { CharacterConfig } from "../core/types.js";

export function loadCharacterConfig(): CharacterConfig {
    return {
        id: process.env.CHARACTER_ID || "kaede-akamatsu",
        name: process.env.CHARACTER_NAME || "Kaede Akamatsu",
        displayName: process.env.CHARACTER_DISPLAY_NAME || "赤松枫",
        soulPath: process.env.CHARACTER_SOUL_PATH || join(process.cwd(), "soul", "rustlove2006.md"),
        modelId: process.env.CHARACTER_MODEL || "deepseek-chat"
    };
}
