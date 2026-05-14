import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface Task {
    id: string;
    description: string;
    createdAt: string;
    status: "pending" | "done" | "cancelled";
    reminderTime?: string;
}

export class TaskManager {
    private getTaskPath(memoryId: string) {
        const userDir = join(process.cwd(), "memory", "users", memoryId.replace(/[<>:"/\\|?*]/g, "_"));
        if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });
        return join(userDir, "tasks.json");
    }

    public getTasks(memoryId: string): Task[] {
        const path = this.getTaskPath(memoryId);
        if (!existsSync(path)) return [];
        try {
            return JSON.parse(readFileSync(path, "utf8"));
        } catch (e) {
            return [];
        }
    }

    public saveTasks(memoryId: string, tasks: Task[]) {
        const path = this.getTaskPath(memoryId);
        writeFileSync(path, JSON.stringify(tasks, null, 2));
    }

    public addTask(memoryId: string, description: string) {
        const tasks = this.getTasks(memoryId);
        const newTask: Task = {
            id: Math.random().toString(36).substring(2, 9),
            description,
            createdAt: new Date().toISOString(),
            status: "pending"
        };
        tasks.push(newTask);
        this.saveTasks(memoryId, tasks);
        console.log(`[TASK] New task for ${memoryId}: ${description}`);
    }

    public completeTask(memoryId: string, taskId: string) {
        const tasks = this.getTasks(memoryId);
        const task = tasks.find(t => t.id === taskId);
        if (task) {
            task.status = "done";
            this.saveTasks(memoryId, tasks);
        }
    }

    public formatTasksForPrompt(memoryId: string): string {
        const tasks = this.getTasks(memoryId).filter(t => t.status === "pending");
        if (tasks.length === 0) return "No pending tasks.";
        return tasks.map(t => `- [ ] ${t.id}: ${t.description} (Created: ${t.createdAt.split('T')[0]})`).join("\n");
    }
}

export const taskManager = new TaskManager();
