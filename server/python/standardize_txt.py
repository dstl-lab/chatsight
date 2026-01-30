"""
Standardize TXT conversation exports from DSC10 and CSE8A formats into a common format.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

FormatKind = Literal["DSC10", "CSE8A"]


def detect_format(content: str) -> FormatKind | None:
    """Detect TXT format from content. Returns 'DSC10', 'CSE8A', or None."""
    if "Question ID:" in content and "\n\n" + "-" * 80 in content:
        return "DSC10"
    if "Assignment:" in content and "\n\n" + "=" * 80 in content:
        return "CSE8A"
    # Heuristic: DSC10 uses "Student: ... (email)" and "Question ID:"
    if re.search(r"Student: [A-Za-z0-9._%+-]+ \([A-Za-z0-9._%+-]+@ucsd\.edu\)", content):
        return "DSC10"
    if "Assignment:" in content or ("File(s):" in content and "Terminal History:" in content):
        return "CSE8A"
    return None


def standardize(content: str, format_hint: FormatKind | None = None) -> tuple[str, FormatKind | None]:
    """
    Standardize TXT content to the common format.
    Returns (standardized_content, format_used) or raises ValueError if unparseable.
    """
    fmt = format_hint or detect_format(content)
    if fmt == "DSC10":
        return _standardize_dsc10(content), "DSC10"
    if fmt == "CSE8A":
        return _standardize_cse8a(content), "CSE8A"
    raise ValueError("Unknown or unsupported TXT format; could not detect DSC10 or CSE8A")


# --- DSC10 ---


def _standardize_dsc10(content: str) -> str:
    conversations, intro_lines = _dsc10_split_conversations(content)
    out = [intro_lines]
    for convo in conversations:
        student, assignment, messages = _dsc10_parse_conversation(convo)
        out.append(_write_conversation(student, assignment, messages, leading_newline=False))
    return "".join(out)


def _dsc10_split_conversations(content: str) -> tuple[list[str], str]:
    lines = content.splitlines(keepends=True)
    intro_lines = "Course: DSC 10\n" + "".join(lines[1:3])
    raw = content.split("\n\n" + "-" * 80)
    conversations = [c.strip() for c in raw if c.strip()][1:]
    return conversations, intro_lines


def _dsc10_parse_conversation(convo_text: str) -> tuple[str, str, list[tuple[str, str]]]:
    student, assignment = "", ""
    for line in convo_text.split("\n"):
        if not line:
            continue
        m = re.search(r"Student: ([A-Za-z0-9._%+-]+ \([A-Za-z0-9._%+-]+@ucsd\.edu\))", line)
        if m:
            student = m.group(1).strip()
            continue
        m = re.search(r"Question ID: (.*)", line)
        if m:
            assignment = m.group(1).strip()
            continue

    message_block = r'\n\s*\n(?=(?:\[\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{1,2}:\d{1,2}\].*))'
    parts = [p for p in re.split(message_block, convo_text) if p.strip()]
    messages: list[tuple[str, str]] = []
    i = 1
    while i < len(parts):
        block = parts[i]
        if ":\n" not in block:
            i += 1
            continue
        sep, _, content = block.partition(":\n")
        sep = sep.strip()
        # sep e.g. "[2024-01-15 12:30:00] Assistant"
        bracket = sep.find("] ")
        if bracket != -1:
            date_part = sep[: bracket + 1]
            role = sep[bracket + 2 :].strip()
            header = "----" + role + " " + date_part
        else:
            header = "----" + sep
        messages.append((header, content.strip()))
        i += 1

    return student, assignment, messages


# --- CSE8A ---


def _cse8a_convert_datetime(s: str) -> str:
    s = s.strip().strip("[]")
    dt = datetime.strptime(s, "%m/%d/%Y, %I:%M:%S %p")
    return "[" + dt.strftime("%Y-%m-%d %H:%M:%S") + "]"


def _standardize_cse8a(content: str) -> str:
    conversations, intro_lines = _cse8a_split_conversations(content)
    out = [intro_lines]
    for convo in conversations:
        student, assignment, messages = _cse8a_parse_conversation(convo)
        out.append(_write_conversation(student, assignment, messages, leading_newline=True))
    return "".join(out)


def _cse8a_split_conversations(content: str) -> tuple[list[str], str]:
    lines = content.splitlines(keepends=True)
    intro = "".join(lines[:2])
    if len(lines) >= 3:
        generated_raw = lines[2].split(":", 1)[1].strip() if ":" in lines[2] else ""
        if generated_raw:
            # Original outputs "Generated: YYYY-MM-DD HH:MM:SS" (no brackets)
            generated = _cse8a_convert_datetime(generated_raw).strip("[]")
            intro += f"Generated: {generated}\n"
        else:
            intro += lines[2]
    else:
        intro += "\n"

    raw = content.split("\n\n" + "=" * 80)
    conversations = [c.strip() for c in raw if c.strip()][1:]
    return conversations, intro


def _cse8a_parse_conversation(convo_text: str) -> tuple[str, str, list[tuple[str, str]]]:
    student, assignment = "", ""
    for line in convo_text.split("\n"):
        if not line:
            continue
        m = re.search(r"Student: ([A-Za-z0-9._%+-]+@ucsd\.edu)", line)
        if m:
            student = m.group(1).strip()
            continue
        m = re.search(r"Assignment: (.*)", line)
        if m:
            assignment = m.group(1).strip()
            continue

    message_block = r'\n\s*\n(?=(?:File\(s\):|\[\d{1,2}/\d{1,2}/\d{4}, \d{1,2}:\d{2}:\d{2} (?:AM|PM)\].*|Terminal History:))'
    parts = [p for p in re.split(message_block, convo_text) if p.strip()]
    messages: list[tuple[str, str]] = []
    i = 2
    while i < len(parts):
        if "Sample run #1:" in parts[i]:
            i += 1
            continue
        block = parts[i]
        if ":\n" in block:
            sep, _, content = block.partition(":\n")
            sep = sep.strip()
            content = content.strip()
        else:
            sep = block.strip()
            content = ""

        if sep == "Terminal History":
            i += 1
            continue
        if sep == "File(s)" or sep == "File(s):":
            messages.append(("----Code:", content))
        else:
            bracket = sep.find("] ")
            if bracket != -1:
                date_part = sep[: bracket + 1]
                role = sep[bracket + 2 :].strip()
                try:
                    date_part = _cse8a_convert_datetime(date_part)
                except ValueError:
                    pass
                header = "----" + role + ": " + date_part
            else:
                header = "----" + sep
            messages.append((header, content))
        i += 1

    return student, assignment, messages


def _write_conversation(
    student: str, assignment: str, messages: list[tuple[str, str]], leading_newline: bool = False
) -> str:
    sep = ("\n" + "=" * 80 + "\n") if leading_newline else ("=" * 80 + "\n")
    lines = [
        sep,
        f"Student: {student}\n",
        f"Assignment: {assignment}\n",
        "\n",
        "Messages:\n",
    ]
    for header, content in messages:
        lines.append(header + "\n")
        lines.append(content + "\n\n")
    return "".join(lines)
