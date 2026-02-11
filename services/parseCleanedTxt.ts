/**
 * Parser for cleaned, standardized TXT (DSC10 / CSE8A output).
 * Format: intro, then blocks separated by "\n" + "="*80 + "\n";
 * each block has "Student:", "Assignment:", "Messages:", then "----Role [ts]" or "----Code:" lines.
 */

const SEP = "\n" + "=".repeat(80) + "\n";

export interface ParsedMessage {
    role: string | null;
    timestamp: string | null;
    content: string;
}

export interface ParsedConversation {
    student: string;
    assignment: string;
    messages: ParsedMessage[];
}

export interface ParsedCleaned {
    intro: string;
    conversations: ParsedConversation[];
}

/**
 * Parse a "----Role [timestamp]" or "----Role: [timestamp]" or "----Code:" header.
 * Returns { role, timestamp } or null if not a message header.
 */
function parseMessageHeader(line: string): { role: string; timestamp: string | null } | null {
    const m = line.match(/^----(.*)$/);
    if (!m) return null;
    const rest = m[1].trim();
    if (rest === "Code:" || rest === "Code") {
        return { role: "Code", timestamp: null };
    }
    const withBracket = rest.match(/^(.+?):\s*\[([^\]]+)\]\s*$/);
    if (withBracket) {
        const role = withBracket[1].replace(/:+$/, "").trim();
        return { role, timestamp: `[${withBracket[2]}]` };
    }
    const noColon = rest.match(/^(.+?)\s+\[([^\]]+)\]\s*$/);
    if (noColon) {
        const role = noColon[1].trim();
        return { role, timestamp: `[${noColon[2]}]` };
    }
    return null;
}

export function parseCleanedTxt(content: string): ParsedCleaned {
    const normalized = content.replace(/\r\n/g, "\n");
    const parts = normalized.split(SEP).map((p) => p.trim()).filter(Boolean);
    const intro = parts[0] ?? "";
    const blocks = parts.slice(1);

    const conversations: ParsedConversation[] = [];

    for (const block of blocks) {
        let student = "";
        let assignment = "";
        const messages: ParsedMessage[] = [];
        const lines = block.split("\n");
        let i = 0;

        while (i < lines.length) {
            const line = lines[i]!;
            if (line.startsWith("Student:")) {
                student = line.replace(/^Student:\s*/, "").trim();
                i++;
                continue;
            }
            if (line.startsWith("Assignment:")) {
                assignment = line.replace(/^Assignment:\s*/, "").trim();
                i++;
                continue;
            }
            if (line === "Messages:" || line.startsWith("Messages:")) {
                i++;
                break;
            }
            i++;
        }

        while (i < lines.length) {
            const line = lines[i]!;
            const header = parseMessageHeader(line);
            if (header) {
                const { role, timestamp } = header;
                const contentStart = line.replace(/^----.*$/, "").trim();
                const contentLines: string[] = contentStart ? [contentStart] : [];
                i++;
                while (i < lines.length && !parseMessageHeader(lines[i]!)) {
                    contentLines.push(lines[i]!);
                    i++;
                }
                const content = contentLines.join("\n").trim();
                messages.push({ role, timestamp, content });
            } else {
                i++;
            }
        }

        conversations.push({ student, assignment, messages });
    }

    return { intro, conversations };
}
