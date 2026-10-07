"""Текст резюме: из PDF / DOCX / TXT / HTML-страницы hh, и вырезание контактов перед отправкой в нейросеть."""

import io
import re

from pypdf import PdfReader
from selectolax.lexbor import LexborHTMLParser as HTMLParser

MAX_CHARS = 20000
MIN_CHARS = 300


class ResumeTextError(Exception):
    """Текст не извлёкся — сообщение показывается пользователю."""


def from_pdf(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as e:  # pypdf бросает разное на битых файлах
        raise ResumeTextError("PDF не читается") from e
    return normalize(text)


def from_docx(data: bytes) -> str:
    from docx import Document

    try:
        doc = Document(io.BytesIO(data))
    except Exception as e:
        raise ResumeTextError("DOCX не читается") from e
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            parts.append(" | ".join(cell.text for cell in row.cells))
    return normalize("\n".join(parts))


def from_html(html: str) -> str:
    tree = HTMLParser(html)
    for node in tree.css("script, style, noscript, svg, header, footer, nav"):
        node.decompose()
    body = tree.body
    return normalize(body.text(separator="\n") if body else "")


def from_file(name: str, data: bytes) -> str:
    low = name.lower()
    if low.endswith(".pdf"):
        return from_pdf(data)
    if low.endswith(".docx"):
        return from_docx(data)
    if low.endswith((".txt", ".md")):
        return normalize(data.decode("utf-8", errors="replace"))
    raise ResumeTextError("Формат не поддерживается — пришли PDF, DOCX или TXT")


def normalize(text: str) -> str:
    text = text.replace(" ", " ").replace("\r", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()[:MAX_CHARS]


def check_length(text: str) -> str:
    if len(text) < MIN_CHARS:
        raise ResumeTextError(
            "В резюме слишком мало текста. Если это PDF-скан (картинка), пришли DOCX, текст или PDF, скачанный с hh"
        )
    return text


_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE = re.compile(r"(?<!\d)(?:\+?\d[\s()\-]{0,2}){10,14}(?!\d)")
_TG_LINK = re.compile(r"(?:https?://)?(?:t\.me|telegram\.me)/([A-Za-z0-9_]{5,32})", re.IGNORECASE)
_HANDLE = re.compile(r"(?<![\w.])@([A-Za-z][A-Za-z0-9_]{4,31})\b")
_SOCIAL = re.compile(r"(?:https?://)?(?:www\.)?(?:vk\.com|linkedin\.com|wa\.me|instagram\.com)/\S+", re.IGNORECASE)


def find_telegram(text: str) -> str | None:
    """Telegram-ник из резюме — подсказка для подписи письма («тг: @nick»)."""
    m = _TG_LINK.search(text) or _HANDLE.search(_EMAIL.sub(" ", text))
    return f"@{m.group(1)}" if m else None


def strip_contacts(text: str) -> str:
    """Почта, телефоны, ники и соцсети → [контакт]: в нейросеть уходят только опыт и навыки."""
    for pattern in (_EMAIL, _TG_LINK, _SOCIAL, _PHONE, _HANDLE):
        text = pattern.sub("[контакт]", text)
    return text
