import type {
  AssistantCapabilities,
  AssistantSlashCommand,
} from "@/shared/pi-capabilities";

export type SlashCandidate = AssistantSlashCommand & { hint: string };

/** Return every Pi runtime command, filtered only by the text after `/`. */
export function buildSlashCandidates(
  capabilities: AssistantCapabilities | null,
  query: string
): SlashCandidate[] {
  if (!capabilities) return [];
  const normalized = query.trim().toLowerCase();
  return capabilities.commands
    .map((command) => ({
      ...command,
      hint: command.description || command.sourceLabel,
    }))
    .filter((command) =>
      `${command.name} ${command.hint}`.toLowerCase().includes(normalized)
    );
}
