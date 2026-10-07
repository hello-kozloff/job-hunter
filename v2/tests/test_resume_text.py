import io

import pytest

from app.domain import resume_text
from app.domain.resume_text import ResumeTextError

CV = """Никита Костров, QA Automation Engineer
Телефон: +7 (999) 123-45-67, почта nik.k@example.com, тг @freshraveprince
https://t.me/freshraveprince  linkedin.com/in/nik
Опыт работы: 3 года, Playwright, TypeScript"""


def test_strip_contacts() -> None:
    out = resume_text.strip_contacts(CV)
    for secret in ("999", "example.com", "freshraveprince", "linkedin"):
        assert secret not in out
    assert "Playwright" in out and "QA Automation" in out


def test_find_telegram() -> None:
    assert resume_text.find_telegram(CV) == "@freshraveprince"
    assert resume_text.find_telegram("почта a@b.com") is None


def test_docx_and_txt() -> None:
    from docx import Document

    doc = Document()
    doc.add_paragraph("QA Engineer")
    doc.add_paragraph("Playwright TypeScript")
    buf = io.BytesIO()
    doc.save(buf)
    assert resume_text.from_file("cv.DOCX", buf.getvalue()) == "QA Engineer\nPlaywright TypeScript"
    assert resume_text.from_file("cv.txt", "a\n\n\n\nb".encode()) == "a\n\nb"
    with pytest.raises(ResumeTextError):
        resume_text.from_file("cv.jpg", b"x")
    with pytest.raises(ResumeTextError):
        resume_text.from_file("cv.pdf", b"not a pdf")


def test_html_and_length() -> None:
    html = "<html><head><style>x{}</style></head><body><nav>menu</nav><h1>QA</h1><p>Опыт работы</p></body></html>"
    assert resume_text.from_html(html) == "QA\nОпыт работы"
    with pytest.raises(ResumeTextError):
        resume_text.check_length("коротко")


def test_hh_url() -> None:
    from app.services import hh_resume

    assert hh_resume.find_url("вот https://spb.hh.ru/resume/0123456789abcdef0123456789abcdef?x=1") == (
        "https://spb.hh.ru/resume/0123456789abcdef0123456789abcdef"
    )
    assert hh_resume.find_url("https://example.com/resume/0123456789abcdef0123") is None
