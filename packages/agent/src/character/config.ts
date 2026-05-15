import { join } from "node:path";
import type { CharacterConfig } from "../core/types.js";

export function loadCharacterConfig(): CharacterConfig {
    return loadCharacterConfigs()[0];
}

export function loadCharacterConfigs(): CharacterConfig[] {
    const configured = (process.env.AGENT_CHARACTERS || process.env.CHARACTERS || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);

    if (configured.length === 0) {
        return [loadDefaultCharacter()];
    }

    return configured.map((id, index) => {
        const ordinal = index + 1;
        return {
            ...loadKnownCharacter(id),
            ...loadIndexedOverrides(ordinal)
        };
    });
}

function loadDefaultCharacter(): CharacterConfig {
    return {
        id: process.env.CHARACTER_ID || "kaede-akamatsu",
        name: process.env.CHARACTER_NAME || "Kaede Akamatsu",
        displayName: process.env.CHARACTER_DISPLAY_NAME || "赤松枫",
        soulPath: process.env.CHARACTER_SOUL_PATH || join(process.cwd(), "soul", "Kaede Akamatsu.md"),
        modelId: process.env.CHARACTER_MODEL || "deepseek-chat"
    };
}

function loadKnownCharacter(id: string): CharacterConfig {
    if (id === "kaede" || id === "kaede-akamatsu" || id === "rustlove2006") {
        return {
            id: "kaede-akamatsu",
            name: "Kaede Akamatsu",
            displayName: "赤松枫",
            soulPath: join(process.cwd(), "soul", "Kaede Akamatsu.md"),
            modelId: process.env.CHARACTER_MODEL || "deepseek-chat"
        };
    }

    if (id === "enromantice") {
        return {
            id: "enromantice",
            name: "Socrates",
            displayName: "苏格拉底",
            soulPath: join(process.cwd(), "soul", "enromantice.md"),
            modelId: process.env.CHARACTER_MODEL || "deepseek-chat"
        };
    }

    return {
        id,
        name: id,
        displayName: id,
        soulPath: join(process.cwd(), "soul", `${id}.md`),
        modelId: process.env.CHARACTER_MODEL || "deepseek-chat"
    };
}

function loadIndexedOverrides(ordinal: number): Partial<CharacterConfig> {
    const overrides: Partial<CharacterConfig> = {};
    const id = process.env[`CHARACTER_${ordinal}_ID`];
    const name = process.env[`CHARACTER_${ordinal}_NAME`];
    const displayName = process.env[`CHARACTER_${ordinal}_DISPLAY_NAME`];
    const soulPath = process.env[`CHARACTER_${ordinal}_SOUL_PATH`];
    const modelId = process.env[`CHARACTER_${ordinal}_MODEL`];

    if (id) overrides.id = id;
    if (name) overrides.name = name;
    if (displayName) overrides.displayName = displayName;
    if (soulPath) overrides.soulPath = soulPath;
    if (modelId) overrides.modelId = modelId;
    return overrides;
}
