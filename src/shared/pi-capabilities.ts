import type { AiModelRef } from "./ai-config";

export interface AssistantSlashCommand {
  name: string;
  description: string;
  source: "extension" | "prompt" | "skill";
  sourceLabel: string;
}

export interface AssistantCapabilities {
  commands: AssistantSlashCommand[];
}

export interface AssistantCapabilitiesRequest {
  projectId: string;
  modelOverride?: AiModelRef;
}
