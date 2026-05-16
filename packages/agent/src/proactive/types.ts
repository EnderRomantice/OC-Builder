export type ProactiveDecision = {
    shouldSend: boolean;
    content: string;
    reason: string;
};

export type ProactivePlanDecision = {
    shouldCreateTask: boolean;
    type: string;
    reason: string;
    promptContext: string;
    scheduledAt: string;
};
